import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { FacebookReelsMonitor } from './facebookReelsMonitor'
import { ReelsMonitorStore } from './facebookReelsMonitorStore'
import { reelsDownloadLibrary } from './facebookReelsLibraryRuntime'
import { crawlFacebookReels } from './facebookReels'
import { withResolvedDomainCookie } from './cookies'
import { facebookCookieAccount } from './facebookReelsAccount'
import { download, fetchInfo } from './ytdlp'
import { reelsOperation } from './facebookReelsController'
import { logError } from './logger'
import { facebookReelEntry, facebookReelsSource, mergeFacebookReel } from '../shared/facebookReels'
import type { ReelsWatchRequest } from '../shared/facebookReelsMonitor'
import { fetchArticle } from './facebookArticle'
import { startAutoShortJob, cancelAutoShort, getAutoShortBatch } from './autoshort'
import { runReelsAutoShort } from './reelsAutoShortRunner'
import { getWorkflowAutoShortConfig } from './autoShortWorkflowConfig'
import { createFacebookReelDetailsBrowser } from './facebookReelDetails'

let monitor: FacebookReelsMonitor | undefined
export function reelsMonitor(changed?: () => void): FacebookReelsMonitor {
  return monitor ??= new FacebookReelsMonitor(new ReelsMonitorStore(join(app.getPath('userData'), 'facebook-reels-monitor')), {
    library: reelsDownloadLibrary(), now: Date.now, changed,
    failed: () => { logError('Lượt theo dõi Reels thất bại; kiểm tra dữ liệu hoặc thư mục lưu.'); changed?.() },
    account: w => withResolvedDomainCookie(w.url, w.useCookies, facebookCookieAccount),
    scan: (w, signal) => crawlFacebookReels({ url: w.url, useCookies: w.useCookies, maxEntries: null }, { signal, expectedAccount: w.account }),
    download: async (entry, channel, watch, signal, targetDir, stem) => {
      const controller = new AbortController(), abort = (): void => controller.abort()
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
      const timer = setTimeout(abort, 180000)
      const outDir = targetDir || channel.outputDir
      const template = stem ? `${stem}.%(ext)s` : '%(title)s [%(id)s].%(ext)s'
      try {
        return await download(randomUUID(), { url: entry.url, mediaId: entry.id, kind: 'video', height: null,
          audioFormat: 'mp3', outputDir: outDir, embedThumbnail: false, embedMetadata: true,
          useCookies: watch.useCookies, ensureH264: false, formatId: null, container: 'mp4',
          outputTemplate: template, writeSubs: false, autoSubs: false, subLangs: '', embedSubs: false,
          useArchive: false, forceOverwrite: false, proxy: null, reelsSource: { url: channel.url, name: channel.name }
        }, () => {}, controller.signal, watch.account)
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
    },
    fetchArticle,
    resolveDetails: async (entry, s, account, watch) => {
      let current = entry
      if (!current.facebook?.caption) {
        const child = new AbortController(), abort = (): void => child.abort()
        s.addEventListener('abort', abort, { once: true }); if (s.aborted) abort(); const timer = setTimeout(abort, 20000)
        try {
          const info = await reelsOperation(fetchInfo(entry.url, undefined, account !== 'guest', child.signal, account), child.signal, 21000)
          if (info.id === entry.id && info.description) {
            current = mergeFacebookReel(current, facebookReelEntry(entry.id, info.description, 'ytdlp', info.uploader))
          }
        } catch { if (s.aborted) throw Error('Đã hủy lấy metadata.') }
        finally { clearTimeout(timer); s.removeEventListener('abort', abort) }
      }
      if (watch.autoExportArticle !== false && !current.facebook?.links?.length) {
        const browser = createFacebookReelDetailsBrowser({ url: watch.url, useCookies: watch.useCookies }, account)
        try { current = await browser.resolve(current, s) }
        finally { await browser.dispose() }
      }
      return current
    },
    runAutoShort: async (videoPaths, outputDir, signal, onProgress, hooks) => {
      signal.throwIfAborted()
      const config = await getWorkflowAutoShortConfig(outputDir)
      return runReelsAutoShort(videoPaths, config, signal, { start: startAutoShortJob, cancel: cancelAutoShort }, onProgress, hooks)
    },
    recoverAutoShort: async jobId => {
      const recovered = await getAutoShortBatch(jobId)
      if (!recovered.ok) throw Error(recovered.error)
      return (recovered.snapshot?.items || []).filter(i => ['succeeded', 'needs-review'].includes(i.state) && i.outputReceipt).map(i => ({
        itemId: i.itemId, filePath: i.inputPath, status: 'done' as const, outputPath: i.outputReceipt!.path
      }))
    }

  })
}
export async function setReelsWatch(request: ReelsWatchRequest): Promise<void> {
  if (!request || typeof request.enabled !== 'boolean' || typeof request.useCookies !== 'boolean') throw Error('Cấu hình theo dõi không hợp lệ.')
  if (request.autoShortPresetId) throw Error('Workflow dùng cấu hình hiện tại trong tab AutoShort; preset theo kênh chưa được hỗ trợ.')
  const source = facebookReelsSource(request.url)
  const m = reelsMonitor(), channel = (await reelsDownloadLibrary().list()).find(c => c.key === source?.key)
  if (!channel) throw Error('Kênh không còn trong thư viện.')
  const existing = (await m.state()).watches.find(w => w.key === channel.key)
  const account = request.enabled ? await reelsOperation(withResolvedDomainCookie(channel.url, request.useCookies, facebookCookieAccount), undefined, 15000)
    .catch(() => { throw Error('Phiên Facebook đang bận; hãy thử lại sau lượt tải hiện tại.') }) : existing?.account ?? 'guest'
  if (request.enabled && request.useCookies && account === 'guest') throw Error('Cần đăng nhập Facebook trước khi bật theo dõi với cookie.')
  await m.store.setWatch({
    key: channel.key,
    url: channel.url,
    name: channel.name.slice(0, 200),
    enabled: request.enabled,
    enabledAt: existing?.enabledAt ?? new Date().toISOString(),
    useCookies: request.useCookies,
    account,
    autoExportArticle: request.autoExportArticle ?? existing?.autoExportArticle ?? true,
    autoRunAutoShort: request.autoRunAutoShort ?? (existing ? existing.autoRunAutoShort ?? false : true),
    autoShortPresetId: undefined
  })
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
