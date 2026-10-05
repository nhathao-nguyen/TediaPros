import { randomUUID } from 'node:crypto'
import type { PlaylistEntry, PlaylistProbe, VideoInfo } from '../shared/types'
import { facebookReelEntry, mergeFacebookReel, facebookReelsSource, buildFacebookReelsFolderName,
  type FacebookReelsRequest, type FacebookReelsProgress } from '../shared/facebookReels'
import type { FacebookReelsExportRequest, FacebookReelsExportResult } from '../shared/facebookReels'
import { reelsOperation, type FacebookReelsControllerOptions } from './facebookReelsController'
import { FacebookReelsStore, reelsContext } from './facebookReelsStore'

type Crawl = (request: FacebookReelsRequest, options: FacebookReelsControllerOptions) => Promise<PlaylistProbe>
type Metadata = (url: string, proxy: string | null | undefined, cookies: boolean, signal: AbortSignal, expectedAccount?: string) => Promise<VideoInfo>
type CaptionBrowser = { resolve(entry: PlaylistEntry, signal: AbortSignal): Promise<PlaylistEntry>; dispose(): Promise<void> }
type CaptionBrowserFactory = (request: FacebookReelsRequest, account: string) => CaptionBrowser
type Export = (request:FacebookReelsRequest,expectedAccount:string,entries:PlaylistEntry[],options:FacebookReelsExportRequest,signal:AbortSignal,progress?:(p:FacebookReelsProgress)=>void)=>Promise<FacebookReelsExportResult>
interface Job {
  id: string; owner: number; request: FacebookReelsRequest; context: string; account: string; controller: AbortController;
  result: Promise<PlaylistProbe>; playlist?: PlaylistProbe; busy: boolean; touched: number;
  progress?: (p: FacebookReelsProgress) => void
}

export class FacebookReelsJobs {
  private readonly jobs = new Map<string, Job>()
  private readonly starting = new Set<number>()
  constructor(private readonly store: FacebookReelsStore, private readonly crawl: Crawl,
    private readonly metadata: Metadata, private readonly account: (r: FacebookReelsRequest) => Promise<string> = async () => 'guest',private readonly exporter?:Export,
    private readonly captionBrowser?: CaptionBrowserFactory) {}
  private owned(owner: number, id: string): Job {
    const job = this.jobs.get(id)
    if (!job || job.owner !== owner) throw new Error('Không có quyền truy cập lượt quét Reels này.')
    job.touched = Date.now(); return job
  }
  async start(owner: number, request: FacebookReelsRequest, progress?: Job['progress']): Promise<string> {
    if (!request || typeof request.url !== 'string' || !facebookReelsSource(request.url) ||
      (request.proxy != null && (typeof request.proxy !== 'string' || request.proxy.length > 2048)) ||
      (request.useCookies != null && typeof request.useCookies !== 'boolean') ||
      (request.resumeKey != null && typeof request.resumeKey !== 'string') ||
      (request.maxEntries != null && (!Number.isInteger(request.maxEntries) || request.maxEntries < 1 || request.maxEntries > 10000))) throw new Error('Yêu cầu quét Reels không hợp lệ.')
    if (this.starting.has(owner) || [...this.jobs.values()].some(j => j.owner === owner && j.busy)) throw new Error('Một lượt Reels đang chạy. Hãy dừng hoặc chờ hoàn tất.')
    this.starting.add(owner)
    try {
      for (const [id, j] of this.jobs) if (!j.busy && Date.now() - j.touched > 15 * 60000) this.jobs.delete(id)
      const account = await this.account(request)
      const context = reelsContext(request, account)
      const seed = request.resumeKey ? await this.store.load(request.resumeKey, context) : undefined
      const id = randomUUID(); const controller = new AbortController()
      const job: Job = { id, owner, request: { ...request }, context, account, controller, busy: true,
        touched: Date.now(), result: Promise.resolve(null as unknown as PlaylistProbe), progress }
      const report = (p: FacebookReelsProgress): void => { try { progress?.(p) } catch { /* owner closed */ } }
      this.jobs.set(id, job)
      job.result = this.crawl(job.request, { signal: controller.signal, jobId: id, expectedAccount: account,
        initialEntries: seed?.entries, onProgress: report }).then(async p => {
        job.playlist = p
        try {
          if (p.facebook && p.facebook.completion !== 'complete') {
            if (p.count < 10000) p.facebook.resumeKey = await this.store.save(context, p, request.resumeKey)
            else p.facebook.warnings.push('Danh sách đạt ngưỡng 10.000 Reel. Hãy xử lý phần đã có trước khi quét mới.')
          }
        } catch { p.facebook?.warnings.push('Không lưu được lượt quét để tiếp tục.') }
        return p
      }).finally(() => { job.busy = false; job.touched = Date.now() })
      // A caller may close before invoking result; keep rejection observed.
      void job.result.catch(() => {})
      // Keep a bounded number of completed jobs for this owner.
      const completed = [...this.jobs.values()].filter(j => j.owner === owner && !j.busy).sort((a,b) => b.touched - a.touched)
      for (const old of completed.slice(8)) this.jobs.delete(old.id)
      return id
    } finally { this.starting.delete(owner) }
  }
  async result(owner: number, id: string): Promise<PlaylistProbe> { return this.owned(owner, id).result }
  cancel(owner: number, id: string): void { this.owned(owner, id).controller.abort() }
  async export(owner:number,id:string,options:FacebookReelsExportRequest):Promise<FacebookReelsExportResult> {
    const job=this.owned(owner,id)
    if(job.busy)throw Error('Lượt Reels đang chạy.')
    if(!options || !Array.isArray(options.ids)||!options.ids.length||options.ids.length>10000||
      options.ids.some(v=>typeof v!=='string')||typeof options.outputRoot!=='string'||typeof options.downloadVideos!=='boolean'||
      (options.folderName != null && (typeof options.folderName !== 'string' || options.folderName.length > 255))) throw Error('Yêu cầu xuất Reels không hợp lệ.')
    if(!this.exporter)throw Error('Xuất Reels chưa khả dụng.')
    job.busy=true;job.controller=new AbortController();const controller=job.controller
    try {
      const playlist=await job.result,ids=new Set(options.ids)
      const entries=playlist.entries.filter(e=>ids.has(e.id))
      if(entries.length!==ids.size)throw Error('Reel không thuộc lượt quét này.')
      if(await this.account(job.request)!==job.account)throw Error('Tài khoản Facebook đã thay đổi. Hãy bắt đầu lượt quét mới.')
      const folderName = options.folderName ||
        buildFacebookReelsFolderName({
          pageTitle: playlist.facebook?.pageTitle,
          profileId: playlist.facebook?.profileId,
          uploader: entries.find(e => e.uploader?.trim())?.uploader,
          ownerId: entries.find(e => e.facebook?.ownerId)?.facebook?.ownerId,
          sourceUrl: job.request.url
        }) || undefined
      const exportOptions: FacebookReelsExportRequest = { ...options, folderName }
      return await this.exporter(job.request,job.account,entries,exportOptions,controller.signal,p=>{
        try{job.progress?.({...p,jobId:id})}catch{/* owner closed */}
      })
    }finally{job.busy=false;job.touched=Date.now()}
  }
  async enrich(owner: number, id: string, ids: string[]): Promise<PlaylistEntry[]> {
    const job = this.owned(owner, id)
    if (job.busy) throw new Error('Lượt Reels đang chạy.')
    if (!Array.isArray(ids) || ids.length > 1000 || ids.some(v => typeof v !== 'string')) throw new Error('Chọn tối đa 1.000 Reel mỗi lượt lấy tiêu đề.')
    job.busy = true; job.controller = new AbortController(); const controller = job.controller
    let browser: CaptionBrowser | undefined
    try {
      const playlist = await job.result
      const selected = new Set(ids)
      if ([...selected].some(v => !playlist.entries.some(e => e.id === v))) throw new Error('Reel không thuộc lượt quét này.')
      if (controller.signal.aborted) return playlist.entries.filter(e => selected.has(e.id))
      if (await this.account(job.request) !== job.account) throw new Error('Tài khoản Facebook đã thay đổi. Hãy bắt đầu lượt quét mới.')
      const total = playlist.entries.filter(e => selected.has(e.id) && e.facebook?.status !== 'verified').length
      let attempted = 0
      for (let i = 0; i < playlist.entries.length; i++) {
        const entry = playlist.entries[i]
        if (!selected.has(entry.id) || entry.facebook?.status === 'verified') continue
        if (controller.signal.aborted) break
        try { job.progress?.({ jobId: id, phase: 'metadata', discoveredCount: playlist.count,
          message: `Đang lấy caption ${++attempted}/${total} · Reel ${entry.id}…` }) } catch { /* owner closed */ }
        const signal = controller.signal
        // Abort the provider too when an individual operation times out.
        const child = new AbortController(); const abort = (): void => child.abort()
        signal.addEventListener('abort', abort, { once: true })
        const timer = setTimeout(abort, 20000)
        try {
          const info = await reelsOperation(this.metadata(entry.url, job.request.proxy, !!job.request.useCookies, child.signal, job.account), child.signal, 21000)
          if (info.id !== entry.id || info.isPlaylist) throw new Error('Metadata không khớp Reel ID.')
          const caption = info.description?.trim() || null
          if (caption) playlist.entries[i] = mergeFacebookReel(entry, { ...facebookReelEntry(entry.id, caption, 'ytdlp', info.uploader),
            duration: info.duration, durationString: info.durationString })
          else playlist.entries[i] = { ...entry, facebook: { ...entry.facebook!, status: 'missing' } }
        } catch {
          if (!signal.aborted) playlist.entries[i] = { ...entry, facebook: { ...entry.facebook!, status: 'error' } }
        } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
        if (!signal.aborted && playlist.entries[i].facebook?.status !== 'verified' && this.captionBrowser) {
          try {
            browser ??= this.captionBrowser(job.request, job.account)
            const found = await browser.resolve(playlist.entries[i], signal)
            if (found.id !== entry.id || found.url !== entry.url) throw new Error('Chi tiết không khớp Reel ID.')
            if (found.facebook?.caption) playlist.entries[i] = mergeFacebookReel(entry, found)
          } catch {
            if (!signal.aborted) playlist.entries[i] = { ...playlist.entries[i], facebook: { ...playlist.entries[i].facebook!, status: 'error' } }
          }
        }
      }
      if (playlist.facebook?.resumeKey) {
        try { await this.store.save(job.context, playlist, playlist.facebook.resumeKey) }
        catch { playlist.facebook.warnings.push('Không lưu được caption mới để tiếp tục.') }
      }
      return playlist.entries.filter(e => selected.has(e.id))
    } finally {
      try { await browser?.dispose() }
      finally { job.busy = false; job.touched = Date.now() }
    }
  }
  release(owner: number): void {
    for (const [id, j] of this.jobs) if (j.owner === owner) { j.controller.abort(); this.jobs.delete(id) }
  }
  shutdown(): void { for (const j of this.jobs.values()) j.controller.abort(); this.jobs.clear() }
}
