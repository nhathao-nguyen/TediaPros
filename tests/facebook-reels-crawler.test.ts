import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isFacebookReelsTabUrl, crawlFacebookReels, readFacebookReelsPageScript, scrollFacebookReelsScript, type FacebookReelsBrowserDependencies } from '../src/main/facebookReels'
import { JSDOM } from 'jsdom'
import { EventEmitter } from 'node:events'
import { facebookReelEntry } from '../src/shared/facebookReels'
import { facebookAccountDigest } from '../src/main/facebookReelsAccount'

test('reads newly appended bootstrap data beyond the first thirty scripts', () => {
  const dom = new JSDOM('<body><main role="main"></main></body>', { runScripts:'outside-only' })
  for (let i=0; i<72; i++) {
    const s=dom.window.document.createElement('script'); s.type='application/json'
    s.textContent=JSON.stringify({aggregated_fb_shorts:{marker:i}}); dom.window.document.body.append(s)
  }
  const page=dom.window.eval(readFacebookReelsPageScript)
  assert.ok(page.scripts.some((s:string)=>JSON.parse(s).aggregated_fb_shorts.marker===71))
  dom.window.close()
})

test('scrolls the nearest Reel container incrementally rather than jumping over its sentinel', () => {
  const dom=new JSDOM('<main role="main"><section style="overflow-y:auto"><a href="/reel/111111/?s=fb_shorts_profile">Reel</a></section></main>',{runScripts:'outside-only'})
  const section=dom.window.document.querySelector('section')!; let top=0
  Object.defineProperties(section,{scrollHeight:{value:3000},clientHeight:{value:600},scrollTop:{get:()=>top,set:(v:number)=>{top=v}}})
  dom.window.eval(scrollFacebookReelsScript)
  assert.ok(top>0 && top<1500, `scrollTop=${top}`)
  dom.window.close()
})

test('isFacebookReelsTabUrl matches profile reels tab URLs', () => {
  assert.equal(
    isFacebookReelsTabUrl('https://www.facebook.com/profile.php?id=61580381841572&sk=reels_tab'),
    true
  )
  assert.equal(
    isFacebookReelsTabUrl(
      'https://facebook.com/profile.php?id=1000123456&sk=reels_tab&mibextid=ZbWKwL'
    ),
    true
  )
  assert.equal(
    isFacebookReelsTabUrl('https://www.facebook.com/profile.php?id=1000123456&sk=reels'),
    true
  )
})

test('isFacebookReelsTabUrl matches fanpage and username reels tabs', () => {
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/TheBeatVietnam/reels/'), true)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/TheBeatVietnam/reels'), true)
  assert.equal(isFacebookReelsTabUrl('https://facebook.com/someone.cool/reels/'), true)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/reels/'), true)
})

test('isFacebookReelsTabUrl does not match single reel or video URLs', () => {
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/reel/123456789012345'), false)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/reel/123456789012345/'), false)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/watch/?v=123456789'), false)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/photo.php?fbid=123456'), false)
  assert.equal(isFacebookReelsTabUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false)
  assert.equal(isFacebookReelsTabUrl('invalid-url'), false)
})

test('rejects impostor domains and non-web protocols before opening a browser', () => {
  for (const url of [
    'https://notfacebook.com/person/reels/',
    'https://facebook.com.evil.example/person/reels/',
    'ftp://www.facebook.com/person/reels/',
    'https://user:password@facebook.com/person/reels/'
  ]) assert.equal(isFacebookReelsTabUrl(url), false, url)
})

test('routes plain profile and fanpage links to their Reels tab', () => {
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/profile.php?id=123456789'), true)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/someone.cool'), true)
  assert.equal(isFacebookReelsTabUrl('https://www.facebook.com/pages/Some-Page/123456789'), true)
})

test('does not reinterpret posts, groups or share links as profile Reels', () => {
  for (const url of [
    'https://www.facebook.com/groups/123456/reels/',
    'https://www.facebook.com/person/posts/123456',
    'https://www.facebook.com/share/r/example/',
    'https://www.facebook.com/login/?sk=reels_tab'
  ]) assert.equal(isFacebookReelsTabUrl(url), false, url)
})

test('browser boundary isolates jobs, honors guest mode, resets direct proxy and cleans cancelled sessions', async () => {
  const proxies: unknown[] = []; let sessions = 0; let cookies = 0; let cleared = 0; let destroyed = 0
  let controller = new AbortController()
  const dependencies = {
    newSession: () => { sessions++; return { setProxy: async (p: unknown) => { proxies.push(p) },
      clearStorageData: async () => { cleared++ } } },
    populateCookies: async () => { cookies++; return 1 },
    newWindow: () => {
      let closed = false
      const debuggerApi = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true, sendCommand: async () => ({}) })
      const wc = Object.assign(new EventEmitter(), { debugger: debuggerApi, getUserAgent: () => 'Chrome Electron/34.5.8',
        setUserAgent() {}, setWindowOpenHandler() {} })
      return { webContents: wc, loadURL: async () => { controller.abort() }, isDestroyed: () => closed,
        destroy: () => { closed = true; destroyed++ } }
    }
  } as unknown as FacebookReelsBrowserDependencies
  const url = 'https://facebook.com/profile.php?id=123456789'
  const first = await crawlFacebookReels({ url, useCookies: false, proxy: 'localhost:8080' },
    { signal: controller.signal, initialEntries: [facebookReelEntry('111111')] }, dependencies)
  controller = new AbortController()
  await crawlFacebookReels({ url, useCookies: true }, { signal: controller.signal }, dependencies)
  assert.equal(first.facebook?.completion, 'cancelled')
  assert.equal(first.count, 1)
  assert.equal(cookies, 1)
  assert.equal(sessions, 2)
  assert.equal(cleared, 2)
  assert.equal(destroyed, 2)
  assert.deepEqual(proxies, [{ proxyRules: 'localhost:8080' }, { mode: 'direct' }])
})

test('browser checks the loaded cookie account before navigating and preserves seed on mismatch', async () => {
  let navigations = 0; let cleared = 0
  const dependencies = {
    newSession: () => ({ setProxy: async () => {}, cookies: { get: async () => [{ name:'c_user', domain:'.facebook.com', value:'222222' }] },
      clearStorageData: async () => { cleared++ } }),
    populateCookies: async () => 1,
    newWindow: () => { navigations++; throw new Error('must not navigate') }
  } as unknown as FacebookReelsBrowserDependencies
  const result = await crawlFacebookReels({ url:'https://facebook.com/profile.php?id=123456789', useCookies:true },
    { expectedAccount:facebookAccountDigest('111111'), initialEntries:[facebookReelEntry('333333')] }, dependencies)
  assert.equal(navigations, 0)
  assert.equal(cleared, 1)
  assert.equal(result.count, 1)
  assert.equal(result.facebook?.completion, 'partial')
  assert.ok(result.facebook?.warnings.some(w => w.includes('Tài khoản Facebook đã thay đổi')))
})
