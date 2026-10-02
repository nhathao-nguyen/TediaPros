import { facebookReelsStopMessage, mergeFacebookReel, buildFacebookReelsFolderName, type FacebookReelsSource,
  type FacebookReelsRequest, type FacebookReelsProgress, type FacebookReelsStopReason } from '../shared/facebookReels'
import type { PlaylistEntry, PlaylistProbe } from '../shared/types'
import type { FacebookReelsNetworkSnapshot } from './facebookReelsNetwork'

export interface FacebookReelsPage {
  title: string
  url: string
  entries: PlaylistEntry[]
  loading: boolean
  atBottom: boolean
  blocked?: 'login-required' | 'checkpoint'
}
export interface FacebookReelsEnvironment {
  readPage(): Promise<FacebookReelsPage>
  scroll(): Promise<void>
  network(): FacebookReelsNetworkSnapshot
  wait(ms: number): Promise<void>
  now(): number
}
export interface FacebookReelsControllerOptions {
  /** Safe account identity digest expected when the fresh browser session is populated. */
  expectedAccount?: string
  signal?: AbortSignal
  jobId?: string
  initialEntries?: PlaylistEntry[]
  onProgress?: (progress: FacebookReelsProgress) => void
}

/** Make browser operations abortable and bound a hung CDP/DOM operation. */
export function reelsOperation<T>(operation: Promise<T>, signal?: AbortSignal, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => { finish(new Error('Reels operation cancelled')) }
    const timer = setTimeout(() => finish(new Error('Reels operation timed out')), timeoutMs)
    let settled = false
    function finish(error?: Error, value?: T): void {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(value as T)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    operation.then(v => finish(undefined, v), error => finish(error instanceof Error ? error : new Error(String(error))))
  })
}

export async function runFacebookReelsController(source: FacebookReelsSource, request: FacebookReelsRequest | {},
  env: FacebookReelsEnvironment, options: FacebookReelsControllerOptions = {}): Promise<PlaylistProbe> {
  const limit = 'maxEntries' in request && request.maxEntries != null ? request.maxEntries : 10000
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Số Reel phải từ 1 đến 10.000.')
  const entries = new Map<string, PlaylistEntry>()
  const excludedIds=new Set<string>()
  for (const e of options.initialEntries ?? []) if (entries.size < limit) entries.set(e.id, e)
  let title = 'Facebook'; let reason: FacebookReelsStopReason = 'stalled'
  const started = env.now(); let lastActivity = started; let revision = -1; let reported = -1
  let terminalSince: number | null = null
  const report = (phase: FacebookReelsProgress['phase'], message?: string): void => {
    options.onProgress?.({ jobId: options.jobId ?? '', phase, discoveredCount: entries.size,
      message: message ?? `Đã tìm thấy ${entries.size} Reels…` })
  }
  const add = (items: PlaylistEntry[]): void => {
    for (const item of items) {
      if(excludedIds.has(item.id))continue
      const old = entries.get(item.id)
      if (!old && entries.size >= limit) break
      entries.set(item.id, old ? mergeFacebookReel(old, item) : item)
    }
  }
  report('opening', 'Đang mở tab Reels…')
  let warnings: string[] = []
  while (true) {
    if (options.signal?.aborted) { reason = 'cancelled'; break }
    if (entries.size >= limit) { reason = 'maxEntries' in request && request.maxEntries != null ? 'limit' : 'resource-limit'; break }
    if (env.now() - started >= 120000) { reason = 'deadline'; break }
    try {
      const page = await reelsOperation(env.readPage(), options.signal)
      const previousCount = entries.size
      title = page.title || title
      add(page.entries)
      const network = env.network()
      for(const id of network.excludedIds??[]){excludedIds.add(id);entries.delete(id)}
      add(network.entries); warnings = network.warnings
      if (network.revision !== revision || entries.size !== previousCount) {
        lastActivity = env.now(); revision = network.revision
      }
      if (entries.size !== reported) { reported = entries.size; report('scanning') }
      if (options.signal?.aborted) { reason = 'cancelled'; break }
      if (page.blocked) { reason = page.blocked; break }
      if (warnings.some(w => w.includes('giới hạn truy cập'))) { reason = 'rate-limited'; break }
      if (entries.size >= limit) { reason = 'maxEntries' in request && request.maxEntries != null ? 'limit' : 'resource-limit'; break }
      if (network.connections.length > 0 && network.connections.every(c => !c.hasNextPage) &&
        !network.pending && !page.loading && page.atBottom && warnings.length === 0 &&
        [...entries.values()].every(e => e.facebook?.sourceVerified === true)) {
        terminalSince ??= env.now()
        if (env.now() - terminalSince >= 800) { reason = 'end-of-list'; break }
      } else terminalSince = null
      if (!network.pending && !page.loading && env.now() - lastActivity >= 12000) { reason = 'stalled'; break }
      if (!network.pending && !page.loading && terminalSince === null) await reelsOperation(env.scroll(), options.signal)
      await reelsOperation(env.wait(400), options.signal)
    } catch {
      reason = options.signal?.aborted ? 'cancelled' : 'network-error'; break
    }
  }
  // A response may finish during the final wait/DOM operation. Retain everything already parsed.
  try { const final = env.network(); for(const id of final.excludedIds??[]){excludedIds.add(id);entries.delete(id)} add(final.entries); warnings = final.warnings } catch { /* browser closed */ }
  if (title === 'Facebook') {
    const uploader = [...entries.values()].find(e => e.uploader?.trim())?.uploader?.trim()
    if (uploader) title = uploader
  }
  if (!source.profileId) {
    const ownerId = [...entries.values()].find(e => e.facebook?.ownerId)?.facebook?.ownerId
    if (ownerId) source.profileId = ownerId
  }
  const pageTitle = (title && title !== 'Facebook') ? title : ([...entries.values()].find(e => e.uploader?.trim())?.uploader?.trim() || 'Facebook')
  const profileId = source.profileId || [...entries.values()].find(e => e.facebook?.ownerId)?.facebook?.ownerId || source.slug || null
  const playlistTitle = buildFacebookReelsFolderName({ pageTitle, profileId, sourceUrl: source.url }) ||
    (pageTitle && pageTitle !== 'Facebook' ? `${pageTitle} - Reels` : 'Facebook Reels')
  const result: PlaylistProbe = { isPlaylist: true, title: playlistTitle, count: entries.size,
    entries: [...entries.values()], facebook: { sourceUrl: source.url, discoveredCount: entries.size,
      completion: reason === 'end-of-list' ? 'complete' : reason === 'cancelled' ? 'cancelled' : 'partial',
      stopReason: reason, warnings, pageTitle, profileId } }
  report('done', facebookReelsStopMessage(reason))
  return result
}
