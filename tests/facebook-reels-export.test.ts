import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import ExcelJS from 'exceljs'
import { externalArticleUrl, articleLinksFromMessage } from '../src/shared/facebookArticleLinks'
import { extractArticleHtml, isPublicArticleAddress, fetchArticle, type FacebookArticleTransport } from '../src/main/facebookArticle'
import { EventEmitter } from 'node:events'
import { exportFacebookReels } from '../src/main/facebookReelsExporter'
import { facebookReelEntry, facebookReelsSource } from '../src/shared/facebookReels'
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

test('exports matching caption/article/video/XLSX files and preserves full text beyond Excel cell limits', async () => {
  const root=await mkdtemp(join(tmpdir(),'tedia-reels-export-'))
  try {
    const e=facebookReelEntry('111111','First caption\nSecond line','graphql')
    e.facebook!.links=[{url:'https://news.example/story',foundIn:'comment'}]
    const full='Complete article paragraph.\n'.repeat(1500)
    const result=await exportFacebookReels([e],{outputRoot:root,downloadVideos:true},new AbortController().signal,{
      resolve:async entry=>entry,
      article:async()=>({url:'https://news.example/story',title:'Story',content:full,status:'success'}),
      video:async(entry,dir,stem)=>{const file=join(dir,stem+'.mp4');await writeFile(file,'video fixture');return file}
    })
    assert.equal(result.rows.length,1); const r=result.rows[0]
    assert.equal(await readFile(r.captionPath!,'utf8'),e.facebook!.caption)
    assert.equal(await readFile(r.articlePath!,'utf8'),full)
    assert.equal(r.videoStatus,'success'); assert.equal(r.articleStatus,'success')
    const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(result.excelPath)
    const sheet=wb.worksheets[0]; assert.equal(sheet.rowCount,2); assert.equal(sheet.getCell('B2').value,e.url)
    assert.ok(String(sheet.getCell('F2').value).length<=32767)
    assert.ok(String(sheet.getCell('G2').value).endsWith('.mp4'))
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
