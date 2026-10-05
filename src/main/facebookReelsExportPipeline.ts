import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { resolveFfmpeg } from './deps'
import { trackChildProcess, terminateProcessTree } from './processTree'
import { reelsDownloadLibrary } from './facebookReelsLibraryRuntime'
import { reuseReelMp4 } from './facebookReelsReuse'
import { download, fetchInfo } from './ytdlp'
import { createFacebookReelDetailsBrowser } from './facebookReelDetails'
import { exportFacebookReels } from './facebookReelsExporter'
import { fetchArticle } from './facebookArticle'
import { reelsOperation } from './facebookReelsController'
import { facebookReelEntry, facebookReelsSource, mergeFacebookReel, type FacebookReelsRequest, type FacebookReelsExportRequest,
  type FacebookReelsExportResult, type FacebookReelsProgress } from '../shared/facebookReels'
import type { PlaylistEntry } from '../shared/types'
import { articleLinksFromMessage } from '../shared/facebookArticleLinks'

async function convertReelMp4(input: string, output: string, signal: AbortSignal): Promise<void> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw Error('Cần FFmpeg để chuyển video đã tải sang MP4.')
  if (signal.aborted) throw Error('Đã hủy chuyển MP4.')
  await new Promise<void>((resolve, reject) => {
    const child = trackChildProcess(spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-i', input,
      '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', output], { windowsHide: true }))
    const abort = (): void => terminateProcessTree(child)
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
    child.stderr.resume()
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(Error('Đã hủy chuyển MP4.'))
      else if (code !== 0) reject(Error('Không chuyển được video đã tải sang MP4.'))
      else resolve()
    })
  })
}

export async function runFacebookReelsExport(request:FacebookReelsRequest,account:string,entries:PlaylistEntry[],options:FacebookReelsExportRequest,
  signal:AbortSignal,progress?:(p:FacebookReelsProgress)=>void):Promise<FacebookReelsExportResult> {
  const browser=createFacebookReelDetailsBrowser(request,account)
  try {
    return await exportFacebookReels(entries,options,signal,{
      resolve:async(entry,s)=>{
        let current=entry
        if(!current.facebook?.caption) {
          const child=new AbortController();const abort=():void=>child.abort();s.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,20000)
          try {
            const info=await reelsOperation(fetchInfo(entry.url,request.proxy,!!request.useCookies,child.signal,account),child.signal,21000)
            if(info.id!==entry.id||info.isPlaylist)throw Error('Metadata không khớp Reel ID.')
            if(info.description)current=mergeFacebookReel(current,facebookReelEntry(entry.id,info.description,'ytdlp',info.uploader))
          }catch{if(s.aborted)throw Error('Đã hủy lấy metadata.')}
          finally{clearTimeout(timer);s.removeEventListener('abort',abort)}
        }
        if(current.facebook?.links?.length || articleLinksFromMessage({text:current.facebook?.caption}).length)return current
        return browser.resolve(current,s)
      },
      article:fetchArticle,
      video:async(entry,dir,stem,s)=>{
        const child=new AbortController();const abort=():void=>child.abort();s.addEventListener('abort',abort,{once:true});if(s.aborted)abort()
        const timer=setTimeout(abort,180000)
        try {
          const result=await download(randomUUID(),{url:entry.url,mediaId:entry.id,kind:'video',height:null,audioFormat:'mp3',outputDir:dir,
            ...(facebookReelsSource(request.url)?.kind === 'profile' ? { reelsSource: { url: request.url, name: entry.uploader ?? options.folderName ?? 'Kênh Facebook' } } : {}),
            embedThumbnail:false,embedMetadata:false,useCookies:!!request.useCookies,ensureH264:false,formatId:'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]',container:'mp4',
            outputTemplate:stem+'.%(ext)s',writeSubs:false,autoSubs:false,subLangs:'',embedSubs:false,useArchive:false,forceOverwrite:false,proxy:request.proxy??null
          },()=>{},child.signal,account)
          if(!result.ok||!result.file)throw Error(result.error??'Không xác định được file MP4.')
          // A prior successful download may live in a different folder. Reuse its
          // bytes while preserving this export's contained video/caption layout.
          if (result.skipped) {
            const library = reelsDownloadLibrary(), original = await library.existing(entry.id)
            if (!original) throw Error('Video đã tải không còn trên đĩa.')
            const target = await reuseReelMp4(original.file, original.root, dir, stem, child.signal, convertReelMp4)
            await library.recordCopy(entry.id, target, dir)
            return target
          }
          return result.file
        }finally{clearTimeout(timer);s.removeEventListener('abort',abort)}
      },
      progress:(row,message)=>progress?.({jobId:'',phase:'exporting',discoveredCount:entries.length,message,exportRow:row})
    })
  }finally{await browser.dispose()}
}
