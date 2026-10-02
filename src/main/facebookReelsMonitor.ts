import { assertContainedParentDirectory } from './safeContainedPath'
import { join } from 'node:path'
import type { PlaylistEntry, PlaylistProbe, DownloadResult } from '../shared/types'
import type { FacebookReelsChannel } from '../shared/facebookReels'
import { facebookReelId, facebookReelsSource, facebookReelsStopMessage } from '../shared/facebookReels'
import { reelsDueDay, reelsLocalDay, reelsWatchDue, type ReelsMonitorState,
  type ReelsWatch, type ReelsNotice } from '../shared/facebookReelsMonitor'
import { FacebookReelsLibrary } from './facebookReelsLibrary'
import { ReelsMonitorStore } from './facebookReelsMonitorStore'
import { reelsOperation } from './facebookReelsController'

export interface ReelsMonitorDependencies {
  library: FacebookReelsLibrary; now(): number; account(watch: ReelsWatch): Promise<string>
  scan(watch: ReelsWatch, signal: AbortSignal): Promise<PlaylistProbe>
  download(entry: PlaylistEntry, channel: FacebookReelsChannel, watch: ReelsWatch, signal: AbortSignal): Promise<DownloadResult>
  changed?(): void
  failed?(error: unknown): void
}
/** One persistent daily claim per channel; discovery and downloads run serially outside Renderer. */
export class FacebookReelsMonitor {
  private running: Promise<void> | null = null
  private active: ReelsMonitorState['active'] = null
  private controller: AbortController | null = null
  private timer?: ReturnType<typeof setInterval>
  private closed = false
  private activeFinished: Promise<void> | null = null
  private suspended = new Set<string>()
  constructor(readonly store: ReelsMonitorStore, private readonly deps: ReelsMonitorDependencies) {}
  private changed(): void { try { this.deps.changed?.() } catch { /* renderer might have closed */ } }
  async initialize(): Promise<void> { await this.store.recover(); this.changed() }
  async state(): Promise<ReelsMonitorState> { return { ...await this.store.read(), active: this.active } }
  async markRead(ids: string[]): Promise<void> { await this.store.markRead(ids); this.changed() }
  async deleteNotices(ids: string[]): Promise<void> { await this.store.deleteNotices(ids); this.changed() }
  start(): void {
    if (this.timer || this.closed) return
    const tick = (): void => { void this.tick().catch(error => this.deps.failed?.(error)) }
    this.timer = setInterval(tick, 60000); this.timer.unref?.(); tick()
  }
  tick(manualKey?: string): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.running) {
      if (manualKey) return Promise.reject(Error('Đang kiểm tra một kênh; hãy chờ lượt hiện tại kết thúc.'))
      return this.running
    }
    const work = this.run(manualKey)
    this.running = work
    void work.finally(() => { if (this.running === work) this.running = null }).catch(() => undefined)
    return work
  }
  private async run(manualKey?: string): Promise<void> {
    const state = await this.store.read(), now = this.deps.now()
    const channels = new Map((await this.deps.library.list()).map(c => [c.key, c]))
    if (manualKey && !state.watches.some(w => w.enabled && w.key === manualKey && channels.has(w.key))) throw Error('Hãy bật theo dõi cho kênh này trước.')
    for (const watch of state.watches) {
      if (this.closed) break
      if (manualKey ? watch.key !== manualKey : !reelsWatchDue(watch, now, state.settings.time)) continue
      // Re-read preferences/library because the user can disable/remove/relocate a
      // later channel while an earlier channel is being processed.
      const current = (await this.store.read()).watches.find(w => w.key === watch.key)
      const channel = (await this.deps.library.list()).find(c => c.key === watch.key)
      if (!current?.enabled || !channel || this.suspended.has(watch.key)) continue
      const day = manualKey ? reelsLocalDay(now) : reelsDueDay(now, state.settings.time)
      const notice = await this.store.reserve(watch.key, day, new Date(now).toISOString(), channel.outputDir, !!manualKey)
      if (!notice) continue
      const boundWatch = (await this.store.read()).watches.find(w => w.key === watch.key)
      const boundChannel = (await this.deps.library.list()).find(c => c.key === watch.key)
      if (this.closed || this.suspended.has(watch.key) || !boundWatch?.enabled || !boundChannel) {
        notice.status = 'cancelled'; notice.message = 'Kênh đã tạm dừng hoặc bỏ theo dõi.'
        await this.store.updateNotice(notice); this.changed(); continue
      }
      notice.outputDir = boundChannel.outputDir
      await this.check(boundWatch, boundChannel, notice)
    }
  }
  private async check(watch: ReelsWatch, channel: FacebookReelsChannel, notice: ReelsNotice): Promise<void> {
    let finished!: () => void
    this.activeFinished = new Promise(resolve => { finished = resolve })
    const controller = new AbortController(); this.controller = controller
    const signal = controller.signal
    this.active = { key: watch.key, name: channel.name, message: 'Đang kiểm tra video mới…' }; this.changed()
    let reason = '', incomplete = false, uncertain = 0
    try {
      await assertContainedParentDirectory(join(channel.outputDir, '.reels-monitor-check'), channel.outputDir, 'Thư mục theo dõi Reels')
      const account = await reelsOperation(this.deps.account(watch), signal, 15000).catch(() => { throw Error('Không kiểm tra được phiên Facebook. Hãy chờ lượt tải khác kết thúc hoặc đăng nhập lại.') })
      if (account !== watch.account) throw Error('Tài khoản Facebook đã thay đổi hoặc hết phiên. Đăng nhập và bật lại theo dõi cho kênh.')
      const playlist = await this.deps.scan(watch, signal)
      if (signal.aborted) throw Error('Đã dừng kiểm tra.')
      const source = facebookReelsSource(playlist.facebook?.sourceUrl ?? '')
      if (source?.key !== watch.key) throw Error('Danh sách trả về không khớp kênh theo dõi.')
      const summary = playlist.facebook!
      reason = facebookReelsStopMessage(summary.stopReason)
      if (['login-required','checkpoint','rate-limited','network-error','cancelled'].includes(summary.stopReason)) throw Error(reason)
      incomplete = summary.completion !== 'complete' || summary.warnings.length > 0
      const history = new Set(await this.deps.library.historyIds()), seen = new Set<string>()
      const entries = playlist.entries.filter(entry => {
        if (facebookReelId(entry.url) !== entry.id || seen.has(entry.id) || history.has(entry.id)) return false
        seen.add(entry.id)
        if (!entry.facebook?.sourceVerified) { uncertain++; return false }
        return true
      })
      notice.found = entries.length
      for (const entry of entries) {
        if (signal.aborted) break
        const enabled = (await this.store.read()).watches.find(w => w.key === watch.key)?.enabled
        const current = (await this.deps.library.list()).find(c => c.key === watch.key)
        if (!enabled || !current || current.outputDir !== channel.outputDir) { controller.abort(); break }
        // Other manual jobs can finish after discovery. Never download a prior
        // successful ID again, even if its file was removed meanwhile.
        if ((await this.deps.library.historyIds()).includes(entry.id)) { notice.skipped++; continue }
        this.active = { key: watch.key, name: channel.name, message: `Đang tải ${notice.downloaded + notice.skipped + notice.failed + 1}/${entries.length} video mới…` }; this.changed()
        try {
          const result = await this.deps.download(entry, channel, watch, signal)
          if (!result.ok || !result.file) {
            if (signal.aborted) break
            notice.failed++
          } else if (result.skipped) notice.skipped++
          else {
            await this.deps.library.recordCopy(entry.id, result.file, channel.outputDir)
            notice.downloaded++
            if (notice.videos.length < 100) notice.videos.push({ id: entry.id, title: entry.title.slice(0, 500), file: result.file })
          }
        } catch { if (signal.aborted) break; notice.failed++ }
        await this.store.updateNotice(notice)
        // Blocked downloads should not proceed through the entire channel.
        if (notice.failed >= 3) { incomplete = true; reason = 'Đã dừng sau 3 video tải lỗi; sẽ kiểm tra lại ở lượt kế tiếp.'; break }
      }
      notice.status = signal.aborted ? 'cancelled' : notice.failed || incomplete || uncertain ? 'partial' : 'success'
      notice.message = `${notice.downloaded} video mới đã tải · ${notice.skipped} bỏ qua · ${notice.failed} lỗi.` +
        (signal.aborted ? ' Đã dừng; giữ video hoàn tất.' : incomplete ? ` ${reason}` : '') +
        (uncertain ? ` ${uncertain} ID chưa xác minh thuộc kênh nên chưa tải.` : '')
      if (!entries.length && !signal.aborted && !incomplete && !uncertain) notice.message = 'Không có video mới so với lịch sử tải trước.'
    } catch (error) {
      notice.status = signal.aborted ? 'cancelled' : 'error'
      notice.message = signal.aborted ? 'Đã dừng kiểm tra; giữ video đã tải.' :
        error instanceof Error ? error.message.slice(0, 1000) : 'Không kiểm tra được kênh Reels.'
    } finally {
      try { await this.store.updateNotice(notice) }
      finally { this.active = null; this.controller = null; this.activeFinished = null; finished(); this.changed() }
    }
  }
  cancel(key?: string): void { if (!key || this.active?.key === key) this.controller?.abort() }
  suspend(key: string): void { this.suspended.add(key) }
  resume(key: string): void { this.suspended.delete(key) }
  async cancelAndWait(key: string): Promise<void> {
    if (this.active?.key !== key) return
    const work = this.activeFinished; this.cancel(key); await work
  }
  async stop(): Promise<void> {
    this.closed = true; if (this.timer) clearInterval(this.timer); this.timer = undefined
    this.cancel(); await this.running?.catch(() => undefined)
  }
}
