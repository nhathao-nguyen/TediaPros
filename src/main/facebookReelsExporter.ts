import type { PlaylistEntry } from '../shared/types'
import type { FacebookArticle } from './facebookArticle'
import type { FacebookReelsExportRequest, FacebookReelsExportResult, FacebookReelsExportRow } from '../shared/facebookReels'
import { externalArticleUrl, articleLinksFromMessage } from '../shared/facebookArticleLinks'
import { facebookReelId, sanitizeFolderName, buildFacebookReelsFolderName } from '../shared/facebookReels'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, lstat, rename } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import ExcelJS from 'exceljs'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'

export interface FacebookReelsExportDependencies {
  resolve(e:PlaylistEntry,signal:AbortSignal):Promise<PlaylistEntry>
  article(url:string,signal:AbortSignal):Promise<FacebookArticle>
  video(e:PlaylistEntry,dir:string,stem:string,signal:AbortSignal):Promise<string>
  progress?(row:FacebookReelsExportRow,message:string):void
}
async function writeContained(path:string,root:string,text:string):Promise<void> {
  await assertContainedParentDirectory(path,root,'Xuất Reels')
  const temp=path+'.tmp'
  await assertContainedParentDirectory(temp,root,'Xuất Reels')
  await writeFile(temp,text,{encoding:'utf8',flag:'w'})
  await assertContainedRegularFile(temp,root,'Xuất Reels')
  await rename(temp,path)
}
export async function exportFacebookReels(entries: PlaylistEntry[], options: Pick<FacebookReelsExportRequest,'outputRoot'|'downloadVideos'|'folderName'>,
  signal:AbortSignal,dependencies:FacebookReelsExportDependencies):Promise<FacebookReelsExportResult> {
  if(!isAbsolute(options.outputRoot))throw new Error('Hãy chọn thư mục kết quả tuyệt đối.')
  const rootStat=await lstat(options.outputRoot)
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw new Error('Thư mục kết quả không hợp lệ hoặc là liên kết.')
  if(entries.some(e=>facebookReelId(e.url)!==e.id))throw new Error('Reel ID không khớp đường dẫn xuất.')
  const folderCandidate = options.folderName || buildFacebookReelsFolderName({
    uploader: entries.find(e => e.uploader?.trim())?.uploader,
    ownerId: entries.find(e => e.facebook?.ownerId)?.facebook?.ownerId
  })
  const folderName = sanitizeFolderName(folderCandidate) ||
    `facebook-reels_${new Date().toISOString().replace(/[:.]/g,'-')}_${randomUUID().slice(0,8)}`
  const directory = join(options.outputRoot, folderName)
  await assertContainedParentDirectory(directory, options.outputRoot, 'Thư mục Reels')
  try {
    const existing = await lstat(directory)
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error('Thư mục kết quả trùng tên với một tệp hoặc liên kết có sẵn.')
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await mkdir(directory, { recursive: true })
  const dirs = {
    video: join(directory, 'video'),
    caption: join(directory, 'caption'),
    article: join(directory, 'article'),
    excel: join(directory, 'excel')
  }
  for (const dir of Object.values(dirs)) {
    await assertContainedParentDirectory(dir, directory, 'Thư mục Reels')
    await mkdir(dir, { recursive: true })
  }
  const rows:FacebookReelsExportRow[]=entries.map((e,i)=>({index:i+1,id:e.id,reelUrl:e.url,title:e.title,caption:e.facebook?.caption??'',
    targetUrl:null,foundIn:null,articleTitle:'',content:'',captionPath:null,articlePath:null,videoPath:null,
    captionStatus:'pending',articleStatus:'pending',videoStatus:options.downloadVideos?'pending':'disabled',errors:[]}))
  const manifestPath=join(directory,'results.json'),excelPath=join(dirs.excel,'reels_content.xlsx')
  const checkpoint=():Promise<void>=>writeContained(manifestPath,directory,JSON.stringify({version:1,cancelled:signal.aborted,rows},null,2))
  const errorText=(err:unknown):string=>err instanceof Error?err.message:'Không xử lý được dữ liệu.'
  const report=(row:FacebookReelsExportRow,message:string):void=>{try{dependencies.progress?.({...row},message)}catch{/* owner closed */}}
  await checkpoint()
  for(let i=0;i<entries.length;i++) {
    const row=rows[i];let entry=entries[i],detailsFailed=false;const stem=`${String(row.index).padStart(3,'0')}_${row.id}`
    if(signal.aborted){row.captionStatus='cancelled';row.articleStatus='cancelled';if(options.downloadVideos)row.videoStatus='cancelled';report(row,'Đã dừng và giữ kết quả.');continue}
    report(row,`Đang lấy caption/link web ${i+1}/${entries.length}…`)
    try {const resolved=await dependencies.resolve(entry,signal);if(resolved.id!==entry.id||resolved.url!==entry.url)throw Error('Thông tin không khớp Reel ID.');entry=resolved}
    catch(err){detailsFailed=true;row.errors.push(`Chi tiết Reel: ${errorText(err)}`)}
    row.title=entry.title;row.caption=entry.facebook?.caption??''
    row.captionPath=join(dirs.caption,stem+'.txt')
    await writeContained(row.captionPath,directory,row.caption)
    row.captionStatus=row.caption?'success':'missing'
    const links=[...(entry.facebook?.links??[]),...articleLinksFromMessage({text:row.caption}).map(url=>({url,foundIn:'caption' as const}))]
    const link=links.find(l=>externalArticleUrl(l.url))
    if(link){row.targetUrl=externalArticleUrl(link.url);row.foundIn=link.foundIn}
    if(signal.aborted)row.articleStatus='cancelled'
    else if(!row.targetUrl)row.articleStatus=detailsFailed?'error':'no-link'
    else {
      report(row,`Đang lấy nội dung web ${i+1}/${entries.length}…`)
      try {
        const article=await dependencies.article(row.targetUrl,signal)
        row.articleTitle=article.title;row.content=article.content.length>32700?article.content.slice(0,32700)+'\n[Nội dung đầy đủ nằm trong file TXT]':article.content;row.targetUrl=article.url;row.articleStatus=article.status
        if(article.error)row.errors.push(`Bài viết: ${article.error}`)
        if(article.status==='success'&&article.content){row.articlePath=join(dirs.article,stem+'.txt');await writeContained(row.articlePath,directory,article.content)}
      }catch(err){row.articleStatus=signal.aborted?'cancelled':'error';row.errors.push(`Bài viết: ${errorText(err)}`)}
    }
    if(options.downloadVideos) {
      if(signal.aborted)row.videoStatus='cancelled'
      else {
        report(row,`Đang tải MP4 ${i+1}/${entries.length}…`)
        try {
          const path=await dependencies.video(entry,dirs.video,stem,signal)
          row.videoPath=await assertContainedRegularFile(path,dirs.video,'Video Reels');row.videoStatus='success'
        }catch(err){row.videoStatus=signal.aborted?'cancelled':'error';row.errors.push(`Video: ${errorText(err)}`)}
      }
    }
    await checkpoint();report(row,`Đã xử lý ${i+1}/${entries.length} Reels.`)
  }
  // Excel limits text cells to 32,767 characters; TXT holds the complete article.
  const wb=new ExcelJS.Workbook();const sheet=wb.addWorksheet('Facebook Reels Content')
  sheet.columns=['STT','Link Reel','Caption','Vị trí link','Link Web','Nội dung bài viết','Đường dẫn Video','Trạng thái','Thời gian','Tiêu đề Reel','Tiêu đề bài viết','File caption','File nội dung','Chi tiết lỗi']
    .map((header,i)=>({header,key:String(i),width:[8,40,65,16,45,75,45,55,26,60,60,45,45,55][i]}))
  sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter='A1:N1'
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF2F5496'}}
  const clipped=(s:string):string=>s.length>32767?s.slice(0,32700)+'\n[Nội dung đầy đủ nằm trong file TXT]':s
  for(const row of rows){const r=sheet.addRow([row.index,row.reelUrl,clipped(row.caption),row.foundIn??'',row.targetUrl??'',clipped(row.content),row.videoPath??'',
    `Caption: ${row.captionStatus}; Bài viết: ${row.articleStatus}; Video: ${row.videoStatus}`,new Date().toISOString(),clipped(row.title),clipped(row.articleTitle),row.captionPath??'',row.articlePath??'',clipped(row.errors.join('\n'))]);r.alignment={vertical:'top',wrapText:true}}
  await assertContainedParentDirectory(excelPath,directory,'Excel Reels');await wb.xlsx.writeFile(excelPath)
  await checkpoint()
  return {rows,directory,excelPath,manifestPath,cancelled:signal.aborted}
}
