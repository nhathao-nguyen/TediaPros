import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { reelCommentsClickScript, createFacebookReelDetailsBrowser } from '../src/main/facebookReelDetails'
import { facebookReelEntry } from '../src/shared/facebookReels'
import { readFacebookReelsPageScript, type FacebookReelsBrowserDependencies } from '../src/main/facebookReels'
import { facebookAccountDigest } from '../src/main/facebookReelsAccount'
import { EventEmitter } from 'node:events'

test('opens only a visible comment button while the URL matches the selected Reel', () => {
  const dom=new JSDOM('<div role="dialog"><button role="button" aria-label="Bình luận" id="hidden"></button><button role="button" aria-label="Bình luận" id="current"></button></div>',{url:'https://facebook.com/reel/111111/',runScripts:'outside-only'})
  let current=0,hidden=0
  const a=dom.window.document.getElementById('current')!,b=dom.window.document.getElementById('hidden')!
  a.getBoundingClientRect=()=>({x:20,y:100,width:40,height:40,top:100,bottom:140,left:20,right:60,toJSON(){}})
  b.getBoundingClientRect=()=>({x:20,y:-200,width:40,height:40,top:-200,bottom:-160,left:20,right:60,toJSON(){}})
  a.addEventListener('click',()=>current++);b.addEventListener('click',()=>hidden++)
  dom.window.eval(reelCommentsClickScript('222222'));assert.equal(current,0)
  dom.window.eval(reelCommentsClickScript('111111'));assert.equal(current,1);assert.equal(hidden,0)
  dom.window.close()
})

test('detail browser checks account before navigation and cleans its temporary session', async()=>{
  let opened=0,cleared=0
  const deps={newSession:()=>({setProxy:async()=>{},cookies:{get:async()=>[{domain:'.facebook.com',value:'222222'}]},clearStorageData:async()=>{cleared++}}),
    populateCookies:async()=>1,newWindow:()=>{opened++;throw Error('should not open')}} as unknown as FacebookReelsBrowserDependencies
  const browser=createFacebookReelDetailsBrowser({url:'https://facebook.com/profile.php?id=123456789',useCookies:true},facebookAccountDigest('111111'),deps)
  await assert.rejects(browser.resolve(facebookReelEntry('111111'),new AbortController().signal),/Tài khoản/)
  await browser.dispose();assert.equal(opened,0);assert.equal(cleared,1)
})

test('keeps exact caption and URL received during a slow successful navigation',async()=>{
  const originalNow=Date.now;let time=0,reads=0
  const raw=JSON.stringify({data:{video:{id:'111111',creation_story:{message:{text:'Exact caption https://article.example/story'}}}}})
  const debuggerApi=Object.assign(new EventEmitter(),{attach(){},detach(){},isAttached:()=>true,sendCommand:async(method:string)=>method==='Network.getResponseBody'?{body:raw}:{}})
  const wc=Object.assign(new EventEmitter(),{debugger:debuggerApi,getUserAgent:()=>'',setUserAgent(){},setAudioMuted(){},setWindowOpenHandler(){},
    executeJavaScript:async()=>{reads++;return {url:'https://facebook.com/reel/111111/',scripts:[]}}})
  let closed=false
  const deps={newSession:()=>({setProxy:async()=>{},cookies:{get:async()=>[]},clearStorageData:async()=>{}}),populateCookies:async()=>0,
    newWindow:()=>({webContents:wc,isDestroyed:()=>closed,destroy:()=>{closed=true},loadURL:async()=>{
      time=16000
      debuggerApi.emit('message',{},'Network.requestWillBeSent',{requestId:'r',request:{url:'https://www.facebook.com/api/graphql/',postData:'fb_api_req_friendly_name=VideoReelViewerQuery'}})
      debuggerApi.emit('message',{},'Network.loadingFinished',{requestId:'r',encodedDataLength:1000})
      await Promise.resolve();await Promise.resolve()
    }})} as unknown as FacebookReelsBrowserDependencies
  Date.now=()=>time
  const browser=createFacebookReelDetailsBrowser({url:'https://facebook.com/profile.php?id=123456789'},'guest',deps)
  try {
    const result=await browser.resolve(facebookReelEntry('111111'),new AbortController().signal)
    assert.equal(result.facebook?.caption,'Exact caption https://article.example/story')
    assert.equal(result.facebook?.links?.[0].url,'https://article.example/story');assert.ok(reads>0)
  }finally{Date.now=originalNow;await browser.dispose()}
})

test('caption-only resolution reads the exact Reel caption without waiting for comments or a website link', async () => {
  const originalNow = Date.now
  let clock = 0, reads = 0, commentClicks = 0, closed = false
  const debuggerApi = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true, sendCommand: async () => ({}) })
  const raw = JSON.stringify({ data: { video: { id: '111111', creation_story: { message: { text: 'Full caption without a website link' } } } } })
  const wc = Object.assign(new EventEmitter(), { debugger: debuggerApi, getUserAgent: () => '', setUserAgent() {}, setAudioMuted() {}, setWindowOpenHandler() {},
    executeJavaScript: async (script: string) => {
      if (script !== readFacebookReelsPageScript) { commentClicks++; return false }
      reads++; clock += 5000
      return { url: 'https://facebook.com/reel/111111/', scripts: [raw] }
    } })
  const deps = { newSession: () => ({ setProxy: async () => {}, cookies: { get: async () => [] }, clearStorageData: async () => {} }),
    populateCookies: async () => 0, newWindow: () => ({ webContents: wc, isDestroyed: () => closed, destroy: () => { closed = true }, loadURL: async () => {} }) } as unknown as FacebookReelsBrowserDependencies
  Date.now = () => clock
  const browser = createFacebookReelDetailsBrowser(requestForCaptionTest(), 'guest', deps)
  try {
    const result = await browser.resolve(facebookReelEntry('111111'), new AbortController().signal, { captionOnly: true })
    assert.equal(result.facebook?.caption, 'Full caption without a website link')
    assert.equal(reads, 1); assert.equal(commentClicks, 0)
  } finally { Date.now = originalNow; await browser.dispose() }
  assert.equal(closed, true)
})

function requestForCaptionTest() { return { url: 'https://facebook.com/profile.php?id=123456789' } }

test('caption-only fallback waits for verified data when the entry already has provisional text', async () => {
  const originalNow = Date.now
  let clock = 0, reads = 0, closed = false
  const debuggerApi = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true, sendCommand: async () => ({}) })
  const raw = JSON.stringify({ data: { video: { id: '111111', creation_story: { message: { text: 'Verified full caption received later' } } } } })
  const wc = Object.assign(new EventEmitter(), { debugger: debuggerApi, getUserAgent: () => '', setUserAgent() {}, setAudioMuted() {}, setWindowOpenHandler() {},
    executeJavaScript: async () => { reads++; clock += 4000; return { url: 'https://facebook.com/reel/111111/', scripts: reads > 1 ? [raw] : [] } } })
  const deps = { newSession: () => ({ setProxy: async () => {}, cookies: { get: async () => [] }, clearStorageData: async () => {} }),
    populateCookies: async () => 0, newWindow: () => ({ webContents: wc, isDestroyed: () => closed, destroy: () => { closed = true }, loadURL: async () => {} }) } as unknown as FacebookReelsBrowserDependencies
  Date.now = () => clock
  const browser = createFacebookReelDetailsBrowser(requestForCaptionTest(), 'guest', deps)
  try {
    const result = await browser.resolve(facebookReelEntry('111111', 'Truncated DOM preview', 'dom'), new AbortController().signal, { captionOnly: true })
    assert.equal(result.facebook?.caption, 'Verified full caption received later')
    assert.equal(result.facebook?.status, 'verified'); assert.equal(reads, 2)
  } finally { Date.now = originalNow; await browser.dispose() }
})

test('failed detail initialization creates one session and clears it without retrying account mismatch', async () => {
  let opened = 0, cleared = 0
  const deps = { newSession: () => { opened++; return { setProxy: async () => {}, cookies: { get: async () => [{ domain: '.facebook.com', value: '222222' }] }, clearStorageData: async () => { cleared++ } } },
    populateCookies: async () => 1, newWindow: () => { throw Error('should not open') } } as unknown as FacebookReelsBrowserDependencies
  const browser = createFacebookReelDetailsBrowser({ ...requestForCaptionTest(), useCookies: true }, facebookAccountDigest('111111'), deps)
  try {
    for (const id of ['111111', '222222', '333333']) await assert.rejects(browser.resolve(facebookReelEntry(id), new AbortController().signal, { captionOnly: true }), /Tài khoản/)
    assert.equal(opened, 1); assert.equal(cleared, 1)
  } finally { await browser.dispose() }
  assert.equal(cleared, 1)
})
