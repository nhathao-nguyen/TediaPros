import { randomUUID } from 'node:crypto'
import { classifyEdgeFailure, EdgeTtsError, retryableEdgeFailure, type EdgeFailureCode } from './edgeTtsRecovery'

export const EDGE_TTS_DEFAULT_SPACING_MS = 1_500

export interface EdgeServiceState {
  nextEligibleAt: number
  blocked?: EdgeFailureCode
  circuit: boolean
  probeFailures: number
}

export interface EdgeAttempt {
  requestId: string
  retryIndex: number
  queuedAtUtc: string
  startedAtUtc?: string
  endedAtUtc?: string
  queueWaitMs?: number
  durationMs?: number
  status?: number
  edgeFailureCode?: EdgeFailureCode
  retryReason?: string
}

interface Ticket {
  eligible: number
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  abort: () => void
}

export interface EdgeSchedulerOptions {
  concurrency?: 1 | 2
  spacingMs?: number
  backoffMs?: number
  cooldownMs?: number
  random?: () => number
  state?: EdgeServiceState
  saveState?: (state: EdgeServiceState) => void
}

/** One owner per Main process; queue waits never own media or provider leases. */
export class EdgeTtsScheduler {
  private active = 0
  private queue: Ticket[] = []
  private timer?: ReturnType<typeof setTimeout>
  private nextStart = 0
  private failures = 0
  private maxActive: 1 | 2
  private listeners = new Set<(state: ReturnType<EdgeTtsScheduler['snapshot']>) => void>()
  private state: EdgeServiceState

  constructor(private readonly options: EdgeSchedulerOptions = {}) {
    this.maxActive = options.concurrency === 2 ? 2 : 1
    this.state = { nextEligibleAt: 0, circuit: false, probeFailures: 0, ...options.state }
  }

  snapshot() {
    return { ...this.state, active: this.active, queued: this.queue.length, concurrency: this.maxActive }
  }

  subscribe(listener: (state: ReturnType<EdgeTtsScheduler['snapshot']>) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  configure(concurrency: 1 | 2): void { this.maxActive = concurrency === 2 ? 2 : 1; this.pump() }

  /** Explicit start/resume can unlock a previous denial, but cannot skip Retry-After. */
  resume(): void {
    this.state.blocked = undefined
    this.state.probeFailures = 0
    this.failures = 0
    this.persist()
    this.pump()
  }

  private emit(): void {
    for (const listener of this.listeners) { try { listener(this.snapshot()) } catch { /* observers do not own scheduling */ } }
  }

  private persist(): void { this.options.saveState?.({ ...this.state }); this.emit() }

  private pump(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.state.blocked) {
      for (const ticket of this.queue.splice(0)) {
        ticket.signal?.removeEventListener('abort', ticket.abort)
        ticket.reject(new EdgeTtsError('circuit_open', `Edge-TTS tạm dừng (${this.state.blocked}); xử lý kết nối rồi chọn tiếp tục.`))
      }
      this.emit()
      return
    }
    const capacity = this.state.circuit ? 1 : this.maxActive
    if (!this.queue.length || this.active >= capacity) { this.emit(); return }
    const now = Date.now()
    const candidate = this.queue.findIndex((ticket) => ticket.eligible <= now)
    const waitUntil = Math.max(this.state.nextEligibleAt, this.nextStart,
      candidate < 0 ? Math.min(...this.queue.map((ticket) => ticket.eligible)) : now)
    if (waitUntil > now) {
      this.timer = setTimeout(() => this.pump(), Math.min(waitUntil - now, 2_147_483_647))
      this.emit()
      return
    }
    const ticket = this.queue.splice(candidate, 1)[0]
    ticket.signal?.removeEventListener('abort', ticket.abort)
    this.active++
    this.nextStart = now + (this.options.spacingMs ?? EDGE_TTS_DEFAULT_SPACING_MS)
    let released = false
    ticket.resolve(() => { if (!released) { released = true; this.active--; this.pump() } })
    this.pump()
  }

  private acquire(signal: AbortSignal | undefined, eligible: number): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(classifyEdgeFailure(undefined, true))
    return new Promise((resolve, reject) => {
      const ticket: Ticket = { resolve, reject, signal, eligible, abort: () => {
        const index = this.queue.indexOf(ticket)
        if (index >= 0) this.queue.splice(index, 1)
        signal?.removeEventListener('abort', ticket.abort)
        reject(classifyEdgeFailure(undefined, true))
        this.pump()
      } }
      signal?.addEventListener('abort', ticket.abort, { once: true })
      this.queue.push(ticket)
      this.pump()
    })
  }

  async run<T>(operation: (attempt: EdgeAttempt) => Promise<T>, signal?: AbortSignal, onAttempt?: (attempt: EdgeAttempt) => void): Promise<T> {
    const requestId = randomUUID()
    let eligible = 0
    let retryReason: string | undefined
    for (let retryIndex = 0; retryIndex < 3; retryIndex++) {
      const queued = Date.now()
      const attempt: EdgeAttempt = { requestId, retryIndex, queuedAtUtc: new Date(queued).toISOString(), retryReason }
      const release = await this.acquire(signal, eligible)
      const started = Date.now()
      attempt.startedAtUtc = new Date(started).toISOString()
      attempt.queueWaitMs = started - queued
      const isProbe = this.state.circuit
      try {
        if (signal?.aborted) throw classifyEdgeFailure(undefined, true)
        const value = await operation(attempt)
        this.failures = 0
        // A success already in flight must never reopen a circuit tripped by another call.
        if (isProbe && !this.state.blocked) {
          this.state.circuit = false
          this.state.probeFailures = 0
          this.persist()
        }
        return value
      } catch (raw) {
        const error = classifyEdgeFailure(raw, signal?.aborted)
        attempt.edgeFailureCode = error.code
        attempt.status = error.status
        retryReason = error.code
        const backoff = (this.options.backoffMs ?? 2000) * 2 ** retryIndex + Math.floor((this.options.random ?? Math.random)() * 500)
        if (error.code === 'access_denied') this.state.blocked = error.code
        if (retryableEdgeFailure(error)) {
          this.failures++
          if (error.code === 'rate_limited') {
            this.maxActive = 1
            this.state.circuit = true
            this.state.nextEligibleAt = Math.max(this.state.nextEligibleAt, Date.now() + Math.max(backoff, error.retryAfterMs ?? 0))
          }
          if (isProbe) this.state.probeFailures++
          if (this.failures >= 3 || isProbe) {
            this.state.circuit = true
            this.state.nextEligibleAt = Math.max(this.state.nextEligibleAt, Date.now() + (this.options.cooldownMs ?? 30_000))
          }
          // A request that exhausts all three transport attempts must give the
          // item-level recovery pass a real cooldown even if a concurrent call
          // happened to succeed between those attempts.
          if (retryIndex === 2) {
            this.state.circuit = true
            this.state.nextEligibleAt = Math.max(this.state.nextEligibleAt, Date.now() + (this.options.cooldownMs ?? 30_000))
          }
          if (this.state.probeFailures >= 2) this.state.blocked = 'circuit_open'
        }
        this.persist()
        if (!retryableEdgeFailure(error) || retryIndex === 2 || this.state.blocked) throw error
        eligible = Date.now() + backoff
      } finally {
        attempt.endedAtUtc = new Date().toISOString()
        attempt.durationMs = Date.now() - started
        try { onAttempt?.(attempt) } finally { release() }
      }
    }
    throw new EdgeTtsError('unknown', 'Edge-TTS không hoàn tất yêu cầu.')
  }
}
