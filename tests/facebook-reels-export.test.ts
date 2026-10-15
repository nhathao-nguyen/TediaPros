import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import ExcelJS from 'exceljs'
import { externalArticleUrl, articleLinksFromMessage } from '../src/shared/facebookArticleLinks'
import { extractArticleHtml, isPublicArticleAddress, fetchArticle, type FacebookArticleTransport } from '../src/main/facebookArticle'
import { EventEmitter } from 'node:events'
import { exportFacebookReels } from '../src/main/facebookReelsExporter'
import { facebookReelsExportSelection, facebookReelEntry, facebookReelsSource } from '../src/shared/facebookReels'
import { parseFacebookReelsPayload } from '../src/main/facebookReelsParser'

test('unwraps Facebook links, preserves article query parameters and rejects private/nonarticle routes', () => {
  assert.equal(externalArticleUrl('https://l.facebook.com/l.php?u='+encodeURIComponent('https://news.example/story?a=1&fbclid=track&b=2')),'https://news.example/story?a=1&b=2')
  for(const u of ['file:///secret','https://facebook.com/reel/111111','http://127.0.0.1/a','http://localhost/a','https://user:pass@example.com/a']) assert.equal(externalArticleUrl(u),null)
  assert.deepEqual(articleLinksFromMessage({text:'Read https://news.example/story.',ranges:[{entity:{external_url:'https://news.example/story'}}]}),['https://news.example/story'])
  assert.deepEqual(articleLinksFromMessage({text:'Full story: votera.treeiq.biz/blog/example-story'}),['https://votera.treeiq.biz/blog/example-story'])
  assert.deepEqual(articleLinksFromMessage({text:'She was k.i.c.k.ed out of the office.'}),[])
})

test('extracts article paragraphs without executing HTML scripts or substituting meta descriptions', () => {
  const paragraphs=Array.from({length:6},(_,i)=>`<p>Paragraph ${i}: ${'This is the complete story text with names and details. '.repeat(12)}</p>`).join('')
  const result=extractArticleHtml(`<html><head><title>Full story</title></head><body><nav>Navigation advertisements</nav><article><h1>Full story</h1>${paragraphs}</article><script>throw Error('must not run')</script></body></html>`,'https://news.example/story')
  assert.equal(result.status,'success'); assert.ok(result.content.includes('Paragraph 5:')); assert.ok(!result.content.includes('Navigation advertisements'))
  const missing=extractArticleHtml('<head><meta name="description" content="Only teaser"></head><body></body>','https://news.example/story')
  assert.equal(missing.status,'no-article'); assert.equal(missing.content,'')
})

test('rejects local addresses and aborted requests before network activity', async () => {
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.2','192.168.1.1','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','fe80::1']) assert.equal(isPublicArticleAddress(ip),false,ip)
  assert.equal(isPublicArticleAddress('8.8.8.8'),true)
  const c=new AbortController(); c.abort()
  await assert.rejects(fetchArticle('https://news.example/a',c.signal),/cancel|abort/i)
})

test('validates redirect DNS before a second request and sends no Facebook cookie headers',async()=>{
  let requests=0
  const transport={resolveHost:async(host:string)=>[{address:host==='news.example'?'8.8.8.8':'127.0.0.1',family:4}],
    request:(_url:URL,options:any,receive:any)=>{
      requests++;assert.equal(options.headers.Cookie,undefined);assert.equal(options.headers.cookie,undefined);assert.equal(options.family,4)
      options.lookup('news.example',{},(_err:unknown,address:string)=>assert.equal(address,'8.8.8.8'))
      const req=Object.assign(new EventEmitter(),{end(){queueMicrotask(()=>receive({statusCode:302,headers:{location:'https://internal.example/secret'},resume(){}}))}})
      return req
    }} as unknown as FacebookArticleTransport
  await assert.rejects(fetchArticle('https://news.example/a',new AbortController().signal,transport),/nội bộ/)
  assert.equal(requests,1)
})

test('keeps linked comment content associated with the exact video, excludes recommendation links', () => {
  const source=facebookReelsSource('https://facebook.com/profile.php?id=123456789')!
  const raw=JSON.stringify({data:{video:{id:'111111',creation_story:{message:{text:'Exact caption',ranges:[{entity:{external_url:'https://news.example/caption'}}]}}},
    reels_feedback_renderer:{story:{attachments:[{media:{id:'111111',__typename:'Video'}}],feedback:{associated_video:{id:'111111'},comment_list_renderer:{feedback:{comments:{edges:[{node:{body:{text:'https://news.example/article'},author:{id:'123456789'}}}]}}}}}},
    recommendations:{id:'222222',creation_story:{message:{text:'https://evil.example/foreign'}}}}})
  const entry=parseFacebookReelsPayload(raw,{source,knownIds:new Set(['111111'])}).entries.find(e=>e.id==='111111')!
  assert.deepEqual(entry.facebook?.links?.map(l=>[l.url,l.foundIn]),[['https://news.example/caption','caption'],['https://news.example/article','comment']])
  assert.equal(entry.facebook?.caption,'Exact caption')
})

test('slug profiles derive the Reel creator ID and never export another commenter\'s article',()=>{
  const source=facebookReelsSource('https://facebook.com/creator.name')!
  const feedback={associated_video:{id:'111111'},comment_list_renderer:{feedback:{comments:{edges:[
    {node:{author:{id:'999999999'},body:{text:'https://foreign.example/ad'}}},
    {node:{author:{id:'123456789'},body:{text:'https://article.example/full'}}}
  ]}}}}
  const raw=[{data:{video:{id:'111111',owner:{id:'123456789'},creation_story:{message:{text:'Creator caption'}}}}},
    {data:{reels_feedback_renderer:{story:{feedback}}}}].map(o=>JSON.stringify(o)).join('\n')
  const parsed=parseFacebookReelsPayload(raw,{source,knownIds:new Set(['111111'])})
  assert.deepEqual(parsed.entries[0].facebook?.links,[{url:'https://article.example/full',foundIn:'comment'}])
  const unknown=parseFacebookReelsPayload(JSON.stringify({data:{feedback}}),{source,knownIds:new Set(['111111'])})
  assert.equal(unknown.entries.flatMap(e=>e.facebook?.links??[]).length,0)
})

test('extracts article thumbnail URL from og:image, twitter:image, or JSON-LD of source webpage', () => {
  const paragraphs = Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i}: ${'Story paragraph words. '.repeat(10)}</p>`).join('')
  const htmlWithOg = `<html><head><meta property="og:image" content="/images/cover.webp"></head><body><article>${paragraphs}</article></body></html>`
  const resOg = extractArticleHtml(htmlWithOg, 'https://story.example/post-1')
  assert.equal(resOg.thumbnailUrl, 'https://story.example/images/cover.webp')

  const htmlWithJsonLd = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"News","articleBody":"${'Body text long enough '.repeat(20)}","image":"https://cdn.example/lead.jpg"}</script></head><body></body></html>`
  const resJson = extractArticleHtml(htmlWithJsonLd, 'https://story.example/post-2')
  assert.equal(resJson.thumbnailUrl, 'https://cdn.example/lead.jpg')
})

test('exports matching caption/article/video/XLSX files and preserves full text beyond Excel cell limits', async () => {
  const root=await mkdtemp(join(tmpdir(),'tedia-reels-export-'))
  try {
    const e=facebookReelEntry('111111','First caption\nSecond line','graphql')
    e.facebook!.links=[{url:'https://news.example/story',foundIn:'comment'}]
    const full='Complete article paragraph.\n'.repeat(1500)
    const result=await exportFacebookReels([e],{outputRoot:root,downloadVideos:true},new AbortController().signal,{
      resolve:async entry=>entry,
      article:async()=>({url:'https://news.example/story',title:'Story',content:full,status:'success',thumbnailUrl:'https://news.example/thumb.jpg'}),
      video:async(entry,dir,stem)=>{const file=join(dir,stem+'.mp4');await writeFile(file,'video fixture');return file},
      thumbnail:async()=>({buffer:Buffer.from('fake-image-bytes'),ext:'.jpg'})
    })
    assert.equal(result.rows.length,1); const r=result.rows[0]
    assert.equal(await readFile(r.captionPath!,'utf8'),e.facebook!.caption)
    assert.equal(await readFile(r.articlePath!,'utf8'),full)
    assert.equal(r.videoStatus,'success'); assert.equal(r.articleStatus,'success')
    assert.equal(r.thumbnailUrl,'https://news.example/thumb.jpg')
    assert.ok(r.thumbnailPath?.endsWith('.jpg'))
    assert.equal(await readFile(r.thumbnailPath!,'utf8'),'fake-image-bytes')
    const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(result.excelPath)
    const sheet=wb.worksheets[0]; assert.equal(sheet.rowCount,2); assert.equal(sheet.getCell('B2').value,e.url)
    assert.ok(String(sheet.getCell('F2').value).length<=32767)
    assert.ok(String(sheet.getCell('G2').value).endsWith('.mp4'))
    assert.equal(sheet.getCell('O2').value,'https://news.example/thumb.jpg')
    assert.equal(sheet.getCell('P2').value,r.thumbnailPath)
    assert.equal(JSON.parse(await readFile(result.manifestPath,'utf8')).rows[0].id,e.id)
  } finally { assert.equal(dirname(root),tmpdir());await rm(root,{recursive:true,force:true}) }
})

test('keeps per-stage failures and cancelled batch artifacts without claiming all files succeeded', async () => {
  const root=await mkdtemp(join(tmpdir(),'tedia-reels-export-')); const controller=new AbortController()
  try {
    const a=facebookReelEntry('111111','No link','graphql'),b=facebookReelEntry('222222','Other','graphql')
    const result=await exportFacebookReels([a,b],{outputRoot:root,downloadVideos:true},controller.signal,{
      resolve:async e=>e,article:async()=>{throw Error('not called')},video:async()=>{controller.abort();throw Error('video failed')}
    })
    assert.equal(result.cancelled,true); assert.equal(result.rows.length,2)
    assert.equal(result.rows[0].articleStatus,'no-link'); assert.equal(result.rows[1].videoStatus,'cancelled')
    assert.ok(await readFile(result.excelPath))
  } finally { assert.equal(dirname(root),tmpdir());await rm(root,{recursive:true,force:true}) }
})

test('a failed detail lookup is an article error rather than proof that no website link exists',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tedia-reels-export-'))
  try {
    const result=await exportFacebookReels([facebookReelEntry('111111','Known caption','graphql')],{outputRoot:root,downloadVideos:false},new AbortController().signal,{
      resolve:async()=>{throw Error('Facebook network response failed')},article:async()=>{throw Error('unused')},video:async()=>{throw Error('unused')}
    })
    assert.equal(result.rows[0].articleStatus,'error');assert.equal(result.rows[0].captionStatus,'success')
    assert.ok(result.rows[0].errors.some(e=>e.includes('Facebook network response failed')))
  }finally{assert.equal(dirname(root),tmpdir());await rm(root,{recursive:true,force:true})}
})

test('names output directory as page name - profile ID when metadata is present and reuses existing directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-reels-name-'))
  try {
    const entry = facebookReelEntry('12345678', 'Sample Reel', 'graphql', 'Woodard Baraka')
    entry.facebook!.ownerId = '61593283816056'
    const result = await exportFacebookReels([entry], { outputRoot: root, downloadVideos: false }, new AbortController().signal, {
      resolve: async e => e,
      article: async () => ({ url: '', title: '', content: '', status: 'no-link' }),
      video: async () => { throw Error('unused') }
    })
    assert.equal(result.directory, join(root, 'Woodard Baraka - 61593283816056'))
    assert.ok(await readFile(result.manifestPath, 'utf8'))

    // Second export into the same directory succeeds cleanly without EEXIST error
    const result2 = await exportFacebookReels([entry], { outputRoot: root, downloadVideos: false }, new AbortController().signal, {
      resolve: async e => e,
      article: async () => ({ url: '', title: '', content: '', status: 'no-link' }),
      video: async () => { throw Error('unused') }
    })
    assert.equal(result2.directory, join(root, 'Woodard Baraka - 61593283816056'))
  } finally { assert.equal(dirname(root), tmpdir()); await rm(root, { recursive: true, force: true }) }
})

test('respects folderName option and sanitizes invalid filesystem characters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-reels-custom-'))
  try {
    const entry = facebookReelEntry('888888', 'Reel', 'graphql')
    const result = await exportFacebookReels([entry], { outputRoot: root, downloadVideos: false, folderName: 'Woodard: Baraka / Page? - 61593283816056' }, new AbortController().signal, {
      resolve: async e => e,
      article: async () => ({ url: '', title: '', content: '', status: 'no-link' }),
      video: async () => { throw Error('unused') }
    })
    assert.equal(result.directory, join(root, 'Woodard Baraka Page - 61593283816056'))
  } finally { assert.equal(dirname(root), tmpdir()); await rm(root, { recursive: true, force: true }) }
})

const videoOnly = { downloadVideos: true, downloadCaptions: false, downloadArticles: false, downloadThumbnails: false, exportExcel: false }
test('video-only export never resolves captions/articles/thumbnails and only creates video folder plus receipt', async () => {
  const root=await mkdtemp(join(tmpdir(),'tedia-reels-parts-'))
  try {
    let downloads=0
    const result=await exportFacebookReels([facebookReelEntry('111111','caption with https://news.example/story','graphql')],{outputRoot:root,...videoOnly},new AbortController().signal,{
      resolve:async()=>{throw Error('must not resolve metadata')},article:async()=>{throw Error('must not crawl article')},thumbnail:async()=>{throw Error('must not download thumbnail')},
      video:async(_e,dir,stem)=>{downloads++;const p=join(dir,stem+'.mp4');await writeFile(p,'video');return p}
    })
    assert.equal(downloads,1);assert.equal(result.excelPath,'')
    assert.deepEqual((await readdir(result.directory)).sort(),['results.json','video'])
    assert.equal(result.rows[0].videoStatus,'success');assert.equal(result.rows[0].captionStatus,'disabled');assert.equal(result.rows[0].articleStatus,'disabled');assert.deepEqual(result.rows[0].errors,[])
    assert.equal(result.rows[0].captionPath,null);assert.equal(result.rows[0].articlePath,null);assert.equal(result.rows[0].thumbnailPath,null)
    assert.deepEqual(JSON.parse(await readFile(result.manifestPath,'utf8')).selection,videoOnly)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('caption-only and thumbnail-only exports do not save unchecked outputs', async () => {
  for(const selected of ['downloadCaptions','downloadThumbnails'] as const){
    const root=await mkdtemp(join(tmpdir(),'tedia-reels-parts-'))
    try {
      let articles=0,thumbs=0
      const result=await exportFacebookReels([facebookReelEntry('111111','caption https://news.example/story','graphql')],{outputRoot:root,...videoOnly,downloadVideos:false,[selected]:true},new AbortController().signal,{
        resolve:async e=>e,
        article:async(_url,_signal,maxChapters)=>{articles++;assert.equal(maxChapters,1);return {url:'https://news.example/story',title:'Story',content:'Content',status:'success',thumbnailUrl:'https://news.example/a.jpg'}},
        thumbnail:async()=>{thumbs++;return {buffer:Buffer.from('image'),ext:'.jpg'}},video:async()=>{throw Error('must not download video')}
      })
      assert.equal(result.excelPath,'');assert.equal(result.rows[0].articlePath,null);assert.equal(result.rows[0].videoStatus,'disabled')
      assert.deepEqual((await readdir(result.directory)).sort(),[selected==='downloadCaptions'?'caption':'results.json',selected==='downloadCaptions'?'results.json':'thumbnail'])
      assert.equal(articles,selected==='downloadThumbnails'?1:0);assert.equal(thumbs,selected==='downloadThumbnails'?1:0)
    }finally{await rm(root,{recursive:true,force:true})}
  }
})

test('export selection preserves legacy defaults but rejects empty selections and non-booleans',()=>{
  assert.equal(facebookReelsExportSelection({downloadVideos:false}).downloadArticles,true)
  assert.throws(()=>facebookReelsExportSelection({...videoOnly,downloadVideos:false}),/ít nhất/)
  assert.throws(()=>facebookReelsExportSelection({downloadVideos:true,downloadCaptions:'false'} as any),/không hợp lệ/)
})

test('article-only and Excel-only selections keep web fetching and file creation independent',async()=>{
  for(const selected of ['downloadArticles','exportExcel'] as const){
    const root=await mkdtemp(join(tmpdir(),'tedia-reels-parts-'))
    try{
      let articleCalls=0
      const result=await exportFacebookReels([facebookReelEntry('111111','caption https://news.example/story','graphql')],{outputRoot:root,...videoOnly,downloadVideos:false,[selected]:true},new AbortController().signal,{
        resolve:async e=>e,article:async(_url,_s,max)=>{articleCalls++;assert.equal(max,80);return {url:'https://news.example/story',title:'Story',content:'Full text',status:'success'}},
        thumbnail:async()=>{throw Error('unchecked thumbnail')},video:async()=>{throw Error('unchecked video')}
      })
      assert.equal(articleCalls,selected==='downloadArticles'?1:0)
      assert.equal(result.rows[0].captionPath,null);assert.equal(result.rows[0].thumbnailPath,null)
      if(selected==='downloadArticles'){
        assert.equal(result.excelPath,'');assert.equal(await readFile(result.rows[0].articlePath!,'utf8'),'Full text')
        assert.deepEqual((await readdir(result.directory)).sort(),['article','chapters','results.json'])
      }else{
        assert.ok(await readFile(result.excelPath));assert.equal(result.rows[0].articleStatus,'disabled')
        assert.deepEqual((await readdir(result.directory)).sort(),['excel','results.json'])
      }
    }finally{await rm(root,{recursive:true,force:true})}
  }
})

test('cancelled video-only export keeps unchecked stages disabled',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tedia-reels-parts-')),controller=new AbortController();controller.abort()
  try{
    const never=async()=>{throw Error('cancelled export must not call dependencies')}
    const result=await exportFacebookReels([facebookReelEntry('111111')],{outputRoot:root,...videoOnly},controller.signal,{resolve:never,article:never,video:never})
    assert.equal(result.rows[0].videoStatus,'cancelled');assert.equal(result.rows[0].captionStatus,'disabled');assert.equal(result.rows[0].articleStatus,'disabled')
  }finally{await rm(root,{recursive:true,force:true})}
})
