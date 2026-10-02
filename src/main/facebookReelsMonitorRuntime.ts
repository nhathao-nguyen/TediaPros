import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { FacebookReelsMonitor } from './facebookReelsMonitor'
import { ReelsMonitorStore } from './facebookReelsMonitorStore'
import { reelsDownloadLibrary } from './facebookReelsLibraryRuntime'
import { crawlFacebookReels } from './facebookReels'
import { withResolvedDomainCookie } from './cookies'
import { facebookCookieAccount } from './facebookReelsAccount'
import { download } from './ytdlp'
import { reelsOperation } from './facebookReelsController'
import { logError } from './logger'
import { facebookReelsSource } from '../shared/facebookReels'
import type { ReelsWatchRequest } from '../shared/facebookReelsMonitor'

let monitor: FacebookReelsMonitor | undefined
export function reelsMonitor(changed?: () => void): FacebookReelsMonitor {
  return monitor ??= new FacebookReelsMonitor(new ReelsMonitorStore(join(app.getPath('userData'), 'facebook-reels-monitor')), {
    library: reelsDownloadLibrary(), now: Date.now, changed,
    failed: () => { logError('Lượt theo dõi Reels thất bại; kiểm tra dữ liệu hoặc thư mục lưu.'); changed?.() },
    account: w => withResolvedDomainCookie(w.url, w.useCookies, facebookCookieAccount),
    scan: (w, signal) => crawlFacebookReels({ url: w.url, useCookies: w.useCookies, maxEntries: null }, { signal, expectedAccount: w.account }),
    download: async (entry, channel, watch, signal) => {
      const controller = new AbortController(), abort = (): void => controller.abort()
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
      const timer = setTimeout(abort, 180000)
      try {
        return await download(randomUUID(), { url: entry.url, mediaId: entry.id, kind: 'video', height: null,
          audioFormat: 'mp3', outputDir: channel.outputDir, embedThumbnail: false, embedMetadata: true,
          useCookies: watch.useCookies, ensureH264: false, formatId: null, container: 'mp4',
          outputTemplate: '%(title)s [%(id)s].%(ext)s', writeSubs: false, autoSubs: false, subLangs: '', embedSubs: false,
          useArchive: false, forceOverwrite: false, proxy: null, reelsSource: { url: channel.url, name: channel.name }
        }, () => {}, controller.signal, watch.account)
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    }
  })
}
export async function setReelsWatch(request: ReelsWatchRequest): Promise<void> {
  if (!request || typeof request.enabled !== 'boolean' || typeof request.useCookies !== 'boolean') throw Error('Cấu hình theo dõi không hợp lệ.')
  const source = facebookReelsSource(request.url)
  const m = reelsMonitor(), channel = (await reelsDownloadLibrary().list()).find(c => c.key === source?.key)
  if (!channel) throw Error('Kênh không còn trong thư viện.')
  const existing = (await m.state()).watches.find(w => w.key === channel.key)
  const account = request.enabled ? await reelsOperation(withResolvedDomainCookie(channel.url, request.useCookies, facebookCookieAccount), undefined, 15000)
    .catch(() => { throw Error('Phiên Facebook đang bận; hãy thử lại sau lượt tải hiện tại.') }) : existing?.account ?? 'guest'
  if (request.enabled && request.useCookies && account === 'guest') throw Error('Cần đăng nhập Facebook trước khi bật theo dõi với cookie.')
  await m.store.setWatch({ key: channel.key, url: channel.url, name: channel.name.slice(0, 200), enabled: request.enabled,
    enabledAt: existing?.enabledAt ?? new Date().toISOString(), useCookies: request.useCookies, account })
  // Wait for the previous account's work before rebinding or removing a channel.
  await m.cancelAndWait(channel.key)
}
export async function pauseReelsChannel(url: string, disable = false): Promise<void> {
  const key = facebookReelsSource(url)?.key
  if (!key) throw Error('Link kênh không hợp lệ.')
  const m = reelsMonitor(), watch = (await m.state()).watches.find(w => w.key === key)
  m.suspend(key)
  try {
    if (watch && disable) await m.store.setWatch({ ...watch, enabled: false })
    await m.cancelAndWait(key)
  } catch (error) { m.resume(key); throw error }
}
