import { BrowserWindow, session as electronSession } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import type { PlaylistProbe } from '../shared/types'
import { facebookReelEntry, facebookReelId, facebookReelsSource,
  type FacebookReelsRequest } from '../shared/facebookReels'
import { populateSessionFromDomainCookies } from './cookies'
import { reelsOperation, runFacebookReelsController, type FacebookReelsControllerOptions } from './facebookReelsController'
import { observeFacebookReelsNetwork } from './facebookReelsNetwork'
import { facebookAccountDigest } from './facebookReelsAccount'

export function isFacebookReelsTabUrl(url: string): boolean { return facebookReelsSource(url) !== null }

export function facebookBrowserUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && !u.username && !u.password &&
      (u.hostname === 'facebook.com' || u.hostname.endsWith('.facebook.com'))
  } catch { return false }
}

export interface FacebookReelsBrowserDependencies {
  newSession(): Electron.Session
  newWindow(session: Electron.Session): BrowserWindow
  populateCookies: typeof populateSessionFromDomainCookies
}
export const facebookReelsBrowserDependencies: FacebookReelsBrowserDependencies = {
  newSession: () => electronSession.fromPartition(`facebook-reels:${randomUUID()}`),
  newWindow: ses => new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: {
    session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
  } }), populateCookies: populateSessionFromDomainCookies
}

const reelScrollersScript = `const root = document.querySelector('[role="main"]') || document.body;
  const scrollers = new Set();
  for (const a of root.querySelectorAll('a[href*="/reel/"]')) {
    for (let e=a.parentElement; e; e=e.parentElement) {
      if (e.clientHeight > 0 && e.scrollHeight > e.clientHeight + 30 &&
        (e === document.scrollingElement || /auto|scroll/.test(getComputedStyle(e).overflowY))) { scrollers.add(e); break; }
    }
  }
  if (!scrollers.size && document.scrollingElement) scrollers.add(document.scrollingElement);`

// Preview/alt/aria text is not a caption. Read ID-associated Relay data instead.
export const readFacebookReelsPageScript = `(() => {
  ${reelScrollersScript}
  const links = [...root.querySelectorAll('a[href*="/reel/"]')].map(a => a.href);
  const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const loading = [...root.querySelectorAll('[role="progressbar"], [aria-busy="true"]')].some(visible);
  const atBottom = [...scrollers].every(e => e.scrollTop + e.clientHeight >= e.scrollHeight - 30);
  const rawTitle = (root.querySelector('h1')?.innerText || document.title || '')
    .replace(/^\\(\\d+\\+?\\)\\s*/, '')
    .replace(/\\s*[|•-]\\s*(?:Facebook|Reels).*/gi, '')
    .trim();
  const title = rawTitle.split(/\\r?\\n/)[0]?.trim() || '';
  const profileId = [...root.querySelectorAll('a[href]')].map(a => {
    try { const u = new URL(a.href); return u.pathname === '/profile.php' && u.searchParams.get('sk') === 'followers' ? u.searchParams.get('id') : null } catch {return null}
  }).find(id => id && /^\\d{5,30}$/.test(id)) || null;
  let bytes=0;
  const scripts = [...document.querySelectorAll('script[type="application/json"]')].reverse()
    .map(s => s.textContent || '').filter(s => {
      if (s.length > 4*1024*1024 || !/aggregated_fb_shorts|creation_story/.test(s) || bytes+s.length>24*1024*1024) return false;
      bytes+=s.length; return true;
    }).slice(0,256).reverse();
  const blocked = /\\/checkpoint(?:\\/|$)/.test(location.pathname) ? 'checkpoint' :
    (/\\/login(?:\\/|\\.php|$)/.test(location.pathname) || (!links.length && document.querySelector('input[name="pass"]'))) ? 'login-required' : undefined;
  return {title, url:location.href, links, loading, atBottom, profileId, scripts, blocked};
})()`

export const scrollFacebookReelsScript = `(() => {
  ${reelScrollersScript}
  for (const e of scrollers) {
    const step = Math.max(400, Math.min(1500, e.clientHeight * 0.85));
    if (e.scrollTop + e.clientHeight >= e.scrollHeight - 30) e.scrollTop=Math.max(0,e.scrollTop-80);
    e.scrollTop += step;
  }
})()`

/** Each scan gets an isolated, nonpersistent session; cookies and proxy are explicit. */
export async function crawlFacebookReels(request: FacebookReelsRequest,
  options: FacebookReelsControllerOptions = {}, dependencies = facebookReelsBrowserDependencies): Promise<PlaylistProbe> {
  const source = facebookReelsSource(request.url)
  if (!source) throw new Error('Liên kết profile/fanpage Facebook không hợp lệ.')
  const ses = dependencies.newSession()
  let win: BrowserWindow | undefined
  let observer: ReturnType<typeof observeFacebookReelsNetwork> | undefined
  let accountMismatch = false
  const knownIds = new Set((options.initialEntries ?? []).map(e => e.id))
  const scriptsSeen = new Set<string>()
  const abort = (): void => { if (win && !win.isDestroyed()) win.destroy() }
  try {
    await reelsOperation(ses.setProxy(request.proxy ? { proxyRules: request.proxy } : { mode: 'direct' }), options.signal)
    if (request.useCookies) await reelsOperation(dependencies.populateCookies('facebook.com', ses), options.signal)
    if (options.expectedAccount) {
      const account = (await reelsOperation(ses.cookies.get({ name: 'c_user' }), options.signal))
        .find(c => c.domain?.replace(/^\./, '') === 'facebook.com')?.value
      if (facebookAccountDigest(account) !== options.expectedAccount) { accountMismatch = true; throw new Error('Tài khoản đã thay đổi.') }
    }
    if (options.signal?.aborted) throw new Error('Cancelled')
    win = dependencies.newWindow(ses)
    const wc = win.webContents
    wc.setUserAgent(wc.getUserAgent().replace(/\sElectron\/[\d.]+/gi, '').replace(/\s(?:T-blao|TediaPros)\/[\d.]+/gi, ''))
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    const guardNavigation = (e: Electron.Event, target: string): void => { if (!facebookBrowserUrl(target)) e.preventDefault() }
    wc.on('will-navigate', guardNavigation)
    wc.on('will-redirect', guardNavigation)
    options.signal?.addEventListener('abort', abort, { once: true })
    observer = observeFacebookReelsNetwork(wc.debugger, () => ({ source, knownIds }))
    await reelsOperation(Promise.all([observer.ready, win.loadURL(source.url)]), options.signal, 45000)
    const network = observer
    return await runFacebookReelsController(source, request, {
      readPage: async () => {
        const page = await wc.executeJavaScript(readFacebookReelsPageScript) as {
          title: string; url: string; links: string[]; loading: boolean; atBottom: boolean;
          profileId: string | null; scripts: string[]; blocked?: 'login-required' | 'checkpoint'
        }
        if (!facebookBrowserUrl(page.url)) throw new Error('Facebook navigation left allowed origin')
        const ids = page.links.filter(link => source.kind === 'feed' || new URL(link).searchParams.get('s') === 'fb_shorts_profile')
          .map(facebookReelId).filter((id): id is string => id !== null)
        for (const id of ids) knownIds.add(id)
        if (!source.profileId && page.profileId) source.profileId = page.profileId
        for (const raw of page.scripts) {
          const hash = createHash('sha256').update(raw).digest('hex')
          if (!scriptsSeen.has(hash)) { scriptsSeen.add(hash); network.ingest(raw) }
        }
        return { ...page, entries: ids.map(id => facebookReelEntry(id)) }
      },
      scroll: async () => { await wc.executeJavaScript(scrollFacebookReelsScript) },
      network: () => network.snapshot(), wait: ms => new Promise(resolve => setTimeout(resolve, ms)), now: Date.now
    }, options)
  } catch {
    const partial = await runFacebookReelsController(source, request, {
      readPage: async () => { throw new Error('Không mở được Facebook') }, scroll: async () => {},
      network: () => observer?.snapshot() ?? { entries: [], connections: [], pending: 0, revision: 0, warnings: [] },
      wait: async () => {}, now: Date.now
    }, { ...options, initialEntries: [...(options.initialEntries ?? []), ...(observer?.snapshot().entries ?? [])] })
    if (accountMismatch) partial.facebook?.warnings.push('Tài khoản Facebook đã thay đổi. Hãy bắt đầu lượt quét mới.')
    return partial
  } finally {
    options.signal?.removeEventListener('abort', abort)
    observer?.dispose()
    if (win && !win.isDestroyed()) win.destroy()
    await reelsOperation(ses.clearStorageData(), undefined, 10000).catch(() => {})
  }
}

/** Compatibility path for existing getInfo/getPlaylist callers. */
export async function crawlFacebookReelsTab(url: string, proxy?: string | null, useCookies = false): Promise<PlaylistProbe> {
  return crawlFacebookReels({ url, proxy, useCookies })
}
