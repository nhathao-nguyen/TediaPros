import { createHash, randomUUID } from 'node:crypto'
import type { AutoShortConfig, AutoShortEvent, AutoShortItemResult, AutoShortStartRequest } from '../shared/types'
import { createAutoShortMusicAssignments } from '../shared/autoShortBackgroundMusic'

export interface ReelsAutoShortHooks {
  started?(jobId: string, configRevision: string): Promise<void>
  result?(result: AutoShortItemResult): Promise<void>
}
export interface ReelsAutoShortEngine {
  start(request: AutoShortStartRequest, event: (event: AutoShortEvent) => void): { ok: true; jobId: string } | { ok: false; error: string }
  cancel(jobId: string): Promise<unknown>
}

/** Join the owned job on cancellation and persist terminal results before returning. */
export async function runReelsAutoShort(
  videoPaths: string[], config: AutoShortConfig, signal: AbortSignal, engine: ReelsAutoShortEngine,
  progress?: (p: { index: number; total: number; message: string }) => void, hooks: ReelsAutoShortHooks = {}
): Promise<AutoShortItemResult[]> {
  signal.throwIfAborted()
  const items = videoPaths.map(filePath => ({ id: randomUUID(), filePath }))
  if (config.backgroundMusic) {
    const tracks = [...new Set(Object.values(config.backgroundMusic.assignments))]
    if (!tracks.length || config.backgroundMusic.mode === 'per-video') throw Error('Nhạc theo từng video cần chọn lại cho workflow; hãy dùng một bài hoặc chế độ ngẫu nhiên.')
    const assigned = createAutoShortMusicAssignments({ mode: config.backgroundMusic.mode, itemIds: items.map(i => i.id), trackPaths: tracks, selectedTrackPath: tracks[0] })
    if (!assigned.ok) throw Error(assigned.error)
    config = { ...config, backgroundMusic: { ...config.backgroundMusic, assignments: assigned.assignments } }
  }
  const revision = createHash('sha256').update(JSON.stringify(config)).digest('hex')
  return new Promise((resolve, reject) => {
    let startReady!: () => void, startFailed!: (error: unknown) => void
    let writes = new Promise<void>((resolveStart, rejectStart) => { startReady = resolveStart; startFailed = rejectStart })
    let jobId: string | undefined, completed = 0, settled = false
    const abort = (): void => { if (jobId) void engine.cancel(jobId).catch(reject) }
    const finish = (results: AutoShortItemResult[]): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      void writes.then(() => resolve(results), reject)
    }
    const job = engine.start({ items, config }, event => {
      if (event.type === 'item-progress') {
        const percent = typeof event.itemPercent === 'number'
          ? Math.round(event.itemPercent)
          : (typeof event.percent === 'number' ? Math.round(event.percent) : undefined)
        const stepMessage = (event.itemMessage || event.message || '').trim()
        const message = stepMessage || (percent !== undefined ? `Đang xử lý ${percent}%` : 'Đang xử lý…')
        progress?.({ index: completed + 1, total: items.length, message })
      }
      if (event.type === 'item-done' || event.type === 'item-error' || event.type === 'item-cancelled') {
        completed++
        writes = writes.then(() => hooks.result?.(event.result))
        void writes.catch(() => { if (jobId) void engine.cancel(jobId).catch(() => undefined) })
        progress?.({ index: completed, total: items.length, message: event.result.status === 'done' ? 'Đã xuất video' : event.result.error || event.result.status })
      }
      if (event.type === 'batch-done') finish(event.results)
    })
    if (!job.ok) { startReady(); reject(Error(job.error)); return }
    jobId = job.jobId
    void Promise.resolve().then(() => hooks.started?.(job.jobId, revision)).then(startReady, startFailed)
    void writes.catch(() => { void engine.cancel(job.jobId).catch(() => undefined) })
    if (!settled) {
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    }
  })
}
