import { appendFile, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AutoShortRequestSpan,
  AutoShortStage,
  AutoShortStageEventV1,
  AutoShortStagePhase,
  AutoShortStageSummaryV1
} from '../shared/types'

export const MAX_DIAGNOSTICS_BYTES = 20 * 1024 * 1024 // 20 MiB
export const RESERVED_TERMINAL_BYTES = 1 * 1024 * 1024 // 1 MiB

export function sanitizeEndpointAlias(rawUrl?: string): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined
  try {
    const parsed = new URL(rawUrl)
    let host = parsed.hostname
    if (host.startsWith('[') && host.endsWith(']')) {
      host = host.slice(1, -1)
    }
    const port = parsed.port ? `:${parsed.port}` : ''
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0:0:0:0:0:0:0:1') {
      return `localhost${port}`
    }
    if (
      /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host) ||
      host.startsWith('fe80:') ||
      host.startsWith('fc00:') ||
      host.startsWith('fd')
    ) {
      return `internal-lan${port}`
    }
    return `${host}${port}`
  } catch {
    const cleaned = rawUrl.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]
    const withoutAuth = cleaned.includes('@') ? cleaned.split('@')[1] : cleaned
    return withoutAuth ? withoutAuth.slice(0, 100) : 'custom-endpoint'
  }
}

export function sanitizeTelemetryPath(rawPath?: string): string | undefined {
  if (!rawPath || typeof rawPath !== 'string') return undefined
  return rawPath
    .replace(/[A-Za-z]:[\\\/][Uu]sers[\\\/][^\\\/]+/g, '<user>')
    .replace(/\/(?:Users|home)\/[^\/]+/g, '<user>')
    .replace(/^\\\\+[^\\]+\\[^\\]+/g, '\\\\<unc-server>\\<unc-share>')
}

export function sanitizeTelemetryText(rawText?: string): string | undefined {
  if (!rawText || typeof rawText !== 'string') return undefined

  let sanitized = rawText

  // 1. Strip stack traces: remove "\n    at ..."
  const stackMatch = sanitized.search(/\r?\n\s+at\s+/)
  if (stackMatch !== -1) {
    sanitized = sanitized.slice(0, stackMatch)
  }

  // 2. Redact URL credentials: http(s)://user:password@host -> http(s)://<user>:<redacted>@host
  sanitized = sanitized.replace(/(https?:\/\/)([^:\s\/@]+):([^@\s\/]+)@/g, '$1<user>:<redacted>@')

  // 3. Redact private LAN IPv4 addresses: 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  sanitized = sanitized.replace(/\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g, 'internal-lan')

  // 4. Redact IPv6 loopback
  sanitized = sanitized.replace(/\[?(?:::1|0:0:0:0:0:0:0:1)\]?/g, 'localhost')

  // 5. Redact URL query tokens / secrets / credentials in query parameters
  sanitized = sanitized.replace(/([?&](?:token|key|api_key|apikey|secret|password|auth|access_token|credential|sig|signature)=)[^&\s'"\)\]]+/gi, '$1<redacted>')

  // 6. Redact Authorization-like headers / tokens
  sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9_\-\.~+/]+=*/gi, '$1<redacted>')
  sanitized = sanitized.replace(/(Basic\s+)[A-Za-z0-9_\-\.~+/]+=*/gi, '$1<redacted>')

  // 7. Redact Windows paths (C:\Users\Username\... and C:/Users/Username/...)
  sanitized = sanitized.replace(/([A-Za-z]:[\\\/](?:Users|users)[\\\/])([^\\\/]+)(?=[\\\/]|[\s"'\)\]]|$)/g, '$1<user>')

  // 8. Redact macOS & Linux home paths (/Users/Username/... and /home/Username/...)
  sanitized = sanitized.replace(/(\/(?:Users|home)\/)([^\\\/]+)(?=[\\\/]|[\s"'\)\]]|$)/g, '$1<user>')

  // 9. Redact UNC paths (\\server\share\... or //server/share/...)
  sanitized = sanitized.replace(/(\\\\[^\s\\\/]+[\\\/][^\s\\\/]+)/g, '\\\\<unc-server>\\<unc-share>')
  sanitized = sanitized.replace(/(\/\/[^\s\\\/]+[\\\/][^\s\\\/]+)/g, '//<unc-server>/<unc-share>')

  // 10. Bounded length (max 500 chars)
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500) + '... (truncated)'
  }

  return sanitized
}

export function sanitizeTelemetryEvent(event: AutoShortStageEventV1): AutoShortStageEventV1 {
  const sanitized: AutoShortStageEventV1 = {
    schemaVersion: 1,
    jobId: String(event.jobId || ''),
    itemId: String(event.itemId || ''),
    attemptId: String(event.attemptId || ''),
    stageId: String(event.stageId || ''),
    eventId: String(event.eventId || ''),
    stage: event.stage,
    phase: event.phase,
    timestampUtc: event.timestampUtc,
    monotonicElapsedMs: typeof event.monotonicElapsedMs === 'number' ? Math.round(event.monotonicElapsedMs) : 0
  }

  if (typeof event.queueWaitMs === 'number') sanitized.queueWaitMs = Math.round(event.queueWaitMs)
  if (typeof event.activeMs === 'number') sanitized.activeMs = Math.round(event.activeMs)
  if (typeof event.totalMs === 'number') sanitized.totalMs = Math.round(event.totalMs)
  if (event.parentSpanId) sanitized.parentSpanId = String(event.parentSpanId)
  if (event.engineVersion) sanitized.engineVersion = String(event.engineVersion).slice(0, 64)
  if (event.model) sanitized.model = String(event.model).slice(0, 128)
  if (event.contentHash) sanitized.contentHash = String(event.contentHash).slice(0, 128)
  if (event.requestedProvider) sanitized.requestedProvider = String(event.requestedProvider).slice(0, 64)
  if (event.effectiveProvider !== undefined) {
    sanitized.effectiveProvider = event.effectiveProvider === null ? undefined : String(event.effectiveProvider).slice(0, 64)
  }
  if (event.fallbackReason) sanitized.fallbackReason = sanitizeTelemetryText(event.fallbackReason)
  if (event.endpointAlias) sanitized.endpointAlias = sanitizeEndpointAlias(event.endpointAlias)
  if (event.resourceGroup) sanitized.resourceGroup = String(event.resourceGroup).slice(0, 64)
  if (typeof event.workerPid === 'number') sanitized.workerPid = event.workerPid

  if (event.counters && typeof event.counters === 'object') {
    const cleanCounters: Record<string, number | null> = {}
    for (const [k, v] of Object.entries(event.counters)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        cleanCounters[k.slice(0, 64)] = v
      } else if (v === null) {
        cleanCounters[k.slice(0, 64)] = null
      }
    }
    sanitized.counters = cleanCounters
  }

  if (Array.isArray(event.requestSpans)) {
    sanitized.requestSpans = event.requestSpans.map((rs) => ({
      url: rs.url ? sanitizeEndpointAlias(rs.url) : undefined,
      batchCueCount: typeof rs.batchCueCount === 'number' ? rs.batchCueCount : undefined,
      sourceChars: typeof rs.sourceChars === 'number' ? rs.sourceChars : undefined,
      tokenBudget: typeof rs.tokenBudget === 'number' ? rs.tokenBudget : undefined,
      actualTokens: typeof rs.actualTokens === 'number' ? rs.actualTokens : undefined,
      status: typeof rs.status === 'number' ? rs.status : undefined,
      durationMs: typeof rs.durationMs === 'number' ? Math.round(rs.durationMs) : undefined,
      error: rs.error ? sanitizeTelemetryText(rs.error) : undefined
    }))
  }

  if (event.error) {
    sanitized.error = sanitizeTelemetryText(event.error)
  }

  return sanitized
}

export function isTerminalPhase(phase: AutoShortStagePhase): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled'
}

export interface AutoShortTelemetryJobBudgetOptions {
  maxTotalBytes?: number
  reservedTerminalBytes?: number
}

export class AutoShortTelemetryJobBudget {
  readonly maxTotalBytes: number
  readonly reservedTerminalBytes: number
  private currentTotalBytesWritten = 0
  private diagnosticsIncomplete = false
  private quotaExceeded = false

  constructor(options: AutoShortTelemetryJobBudgetOptions = {}) {
    this.maxTotalBytes = options.maxTotalBytes ?? MAX_DIAGNOSTICS_BYTES
    this.reservedTerminalBytes = options.reservedTerminalBytes ?? RESERVED_TERMINAL_BYTES
  }

  get nonTerminalBudget(): number {
    return Math.max(0, this.maxTotalBytes - this.reservedTerminalBytes)
  }

  getBytesWritten(): number {
    return this.currentTotalBytesWritten
  }

  isQuotaExceeded(): boolean {
    return this.quotaExceeded
  }

  isDiagnosticsIncomplete(): boolean {
    return this.diagnosticsIncomplete
  }

  markDiagnosticsIncomplete(): void {
    this.diagnosticsIncomplete = true
  }

  /**
   * Attempts to claim byte quota for writing.
   * If terminal, can use up to maxTotalBytes (using the reserved 1MB).
   * If non-terminal, can only use up to maxTotalBytes - reservedTerminalBytes (19MB).
   */
  claimWriteBudget(bytes: number, isTerminal: boolean): boolean {
    if (bytes <= 0) return true
    if (isTerminal) {
      if (this.currentTotalBytesWritten + bytes <= this.maxTotalBytes) {
        this.currentTotalBytesWritten += bytes
        return true
      }
      this.diagnosticsIncomplete = true
      return false
    } else {
      if (this.currentTotalBytesWritten + bytes <= this.nonTerminalBudget) {
        this.currentTotalBytesWritten += bytes
        return true
      }
      this.quotaExceeded = true
      return false
    }
  }
}

export interface AutoShortTelemetryOptions {
  jobId: string
  itemId: string
  attemptId?: string
  diagnosticsDir?: string
  budget?: AutoShortTelemetryJobBudget
}

export interface SpanStartOptions {
  parentSpanId?: string
  engineVersion?: string
  model?: string
  contentHash?: string
  requestedProvider?: string
  effectiveProvider?: string | null
  fallbackReason?: string
  endpointAlias?: string
  resourceGroup?: string
  workerPid?: number
  counters?: Record<string, number | null>
}

export class AutoShortTelemetrySpan {
  readonly stageId: string
  readonly stage: AutoShortStage
  private phase: AutoShortStagePhase = 'queued'
  private startMonotonicMs: number
  private queueWaitMs = 0
  private activeMs = 0
  private terminal = false
  private options: SpanStartOptions
  private requestSpans: AutoShortRequestSpan[] = []
  private counters: Record<string, number | null> = {}
  private collector: AutoShortTelemetryCollector

  constructor(collector: AutoShortTelemetryCollector, stage: AutoShortStage, options: SpanStartOptions = {}) {
    this.collector = collector
    this.stage = stage
    this.stageId = randomUUID()
    this.startMonotonicMs = performance.now()
    this.options = { ...options }
    if (options.counters) {
      Object.assign(this.counters, options.counters)
    }

    this.collector.recordEvent({
      stage: this.stage,
      stageId: this.stageId,
      phase: 'queued',
      parentSpanId: this.options.parentSpanId,
      engineVersion: this.options.engineVersion,
      model: this.options.model,
      contentHash: this.options.contentHash,
      requestedProvider: this.options.requestedProvider,
      effectiveProvider: this.options.effectiveProvider ?? undefined,
      fallbackReason: this.options.fallbackReason,
      endpointAlias: this.options.endpointAlias,
      resourceGroup: this.options.resourceGroup,
      workerPid: this.options.workerPid,
      counters: { ...this.counters }
    })
  }

  setPhase(phase: AutoShortStagePhase, error?: string): void {
    if (this.terminal) return
    this.phase = phase
    this.collector.recordEvent({
      stage: this.stage,
      stageId: this.stageId,
      phase,
      parentSpanId: this.options.parentSpanId,
      engineVersion: this.options.engineVersion,
      model: this.options.model,
      contentHash: this.options.contentHash,
      requestedProvider: this.options.requestedProvider,
      effectiveProvider: this.options.effectiveProvider ?? undefined,
      fallbackReason: this.options.fallbackReason,
      endpointAlias: this.options.endpointAlias,
      resourceGroup: this.options.resourceGroup,
      workerPid: this.options.workerPid,
      counters: { ...this.counters },
      requestSpans: this.requestSpans.length ? [...this.requestSpans] : undefined,
      error
    })
  }

  recordResourceWait(waitMs: number): void {
    if (waitMs > 0) this.queueWaitMs += waitMs
  }

  recordActive(activeMs: number): void {
    if (activeMs > 0) this.activeMs += activeMs
  }

  setProvider(requested?: string, effective?: string | null, fallbackReason?: string): void {
    if (requested !== undefined) this.options.requestedProvider = requested
    if (effective !== undefined) this.options.effectiveProvider = effective
    if (fallbackReason !== undefined) this.options.fallbackReason = fallbackReason
  }

  addRequestSpan(span: AutoShortRequestSpan): void {
    this.requestSpans.push(span)
  }

  updateCounters(counters: Record<string, number | null>): void {
    Object.assign(this.counters, counters)
  }

  succeed(counters?: Record<string, number | null>): void {
    if (this.terminal) return
    this.terminal = true
    if (counters) Object.assign(this.counters, counters)
    const elapsed = performance.now() - this.startMonotonicMs
    if (this.activeMs === 0) this.activeMs = Math.max(0, elapsed - this.queueWaitMs)

    this.collector.recordEvent({
      stage: this.stage,
      stageId: this.stageId,
      phase: 'succeeded',
      parentSpanId: this.options.parentSpanId,
      engineVersion: this.options.engineVersion,
      model: this.options.model,
      contentHash: this.options.contentHash,
      requestedProvider: this.options.requestedProvider,
      effectiveProvider: this.options.effectiveProvider ?? undefined,
      fallbackReason: this.options.fallbackReason,
      endpointAlias: this.options.endpointAlias,
      resourceGroup: this.options.resourceGroup,
      workerPid: this.options.workerPid,
      queueWaitMs: Math.round(this.queueWaitMs),
      activeMs: Math.round(this.activeMs),
      totalMs: Math.round(elapsed),
      counters: { ...this.counters },
      requestSpans: this.requestSpans.length ? [...this.requestSpans] : undefined
    })
  }

  fail(error: unknown, counters?: Record<string, number | null>): void {
    if (this.terminal) return
    this.terminal = true
    if (counters) Object.assign(this.counters, counters)
    const elapsed = performance.now() - this.startMonotonicMs
    if (this.activeMs === 0) this.activeMs = Math.max(0, elapsed - this.queueWaitMs)
    const errorMsg = error instanceof Error ? error.message : String(error)

    this.collector.recordEvent({
      stage: this.stage,
      stageId: this.stageId,
      phase: 'failed',
      parentSpanId: this.options.parentSpanId,
      engineVersion: this.options.engineVersion,
      model: this.options.model,
      contentHash: this.options.contentHash,
      requestedProvider: this.options.requestedProvider,
      effectiveProvider: this.options.effectiveProvider ?? undefined,
      fallbackReason: this.options.fallbackReason,
      endpointAlias: this.options.endpointAlias,
      resourceGroup: this.options.resourceGroup,
      workerPid: this.options.workerPid,
      queueWaitMs: Math.round(this.queueWaitMs),
      activeMs: Math.round(this.activeMs),
      totalMs: Math.round(elapsed),
      counters: { ...this.counters },
      requestSpans: this.requestSpans.length ? [...this.requestSpans] : undefined,
      error: errorMsg
    })
  }

  cancel(reason?: string, counters?: Record<string, number | null>): void {
    if (this.terminal) return
    this.terminal = true
    if (counters) Object.assign(this.counters, counters)
    const elapsed = performance.now() - this.startMonotonicMs
    if (this.activeMs === 0) this.activeMs = Math.max(0, elapsed - this.queueWaitMs)

    this.collector.recordEvent({
      stage: this.stage,
      stageId: this.stageId,
      phase: 'cancelled',
      parentSpanId: this.options.parentSpanId,
      engineVersion: this.options.engineVersion,
      model: this.options.model,
      contentHash: this.options.contentHash,
      requestedProvider: this.options.requestedProvider,
      effectiveProvider: this.options.effectiveProvider ?? undefined,
      fallbackReason: this.options.fallbackReason,
      endpointAlias: this.options.endpointAlias,
      resourceGroup: this.options.resourceGroup,
      workerPid: this.options.workerPid,
      queueWaitMs: Math.round(this.queueWaitMs),
      activeMs: Math.round(this.activeMs),
      totalMs: Math.round(elapsed),
      counters: { ...this.counters },
      requestSpans: this.requestSpans.length ? [...this.requestSpans] : undefined,
      error: reason
    })
  }

  isTerminal(): boolean {
    return this.terminal
  }

  getStage(): AutoShortStage {
    return this.stage
  }

  getActiveMs(): number {
    return this.activeMs
  }

  getQueueWaitMs(): number {
    return this.queueWaitMs
  }

  getCounters(): Record<string, number | null> {
    return { ...this.counters }
  }
}

export class AutoShortTelemetryCollector {
  readonly jobId: string
  readonly itemId: string
  readonly attemptId: string
  readonly budget: AutoShortTelemetryJobBudget
  private diagnosticsDir?: string
  private startMonotonicMs: number
  private startedAtUtc: string
  private events: AutoShortStageEventV1[] = []
  private stages: Partial<AutoShortStageSummaryV1['stages']> = {}
  private diagnosticsIncomplete = false
  private lastProgressRecordedAtMs = 0
  private writeQueue: Promise<void> = Promise.resolve()
  private finalizedSummary: AutoShortStageSummaryV1 | null = null
  private finalizePromise: Promise<AutoShortStageSummaryV1> | null = null

  constructor(options: AutoShortTelemetryOptions) {
    this.jobId = options.jobId
    this.itemId = options.itemId
    this.attemptId = options.attemptId || randomUUID()
    this.diagnosticsDir = options.diagnosticsDir
    this.budget = options.budget || new AutoShortTelemetryJobBudget()
    this.startMonotonicMs = performance.now()
    this.startedAtUtc = new Date().toISOString()
  }

  setDiagnosticsDir(dir: string): void {
    this.diagnosticsDir = dir
  }

  startSpan(stage: AutoShortStage, options: SpanStartOptions = {}): AutoShortTelemetrySpan {
    return new AutoShortTelemetrySpan(this, stage, options)
  }

  async withStageSpan<T>(
    stage: AutoShortStage,
    options: SpanStartOptions,
    action: (span: AutoShortTelemetrySpan) => Promise<T>
  ): Promise<T> {
    const span = this.startSpan(stage, options)
    span.setPhase('running')
    try {
      const result = await action(span)
      if (!span.isTerminal()) {
        span.succeed()
      }
      return result
    } catch (err: unknown) {
      if (!span.isTerminal()) {
        const isAbort =
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.includes('abort') || err.message.includes('hủy'))
        if (isAbort) {
          span.cancel(err instanceof Error ? err.message : 'Aborted')
        } else {
          span.fail(err)
        }
      }
      throw err
    }
  }

  recordEvent(
    eventData: Omit<
      AutoShortStageEventV1,
      'schemaVersion' | 'jobId' | 'itemId' | 'attemptId' | 'eventId' | 'timestampUtc' | 'monotonicElapsedMs'
    >
  ): void {
    const now = performance.now()

    // Progress coalesce <= 1Hz per item
    if (eventData.phase === 'progress') {
      if (this.lastProgressRecordedAtMs > 0 && now - this.lastProgressRecordedAtMs < 1000) {
        return
      }
      this.lastProgressRecordedAtMs = now
    }

    const rawEvent: AutoShortStageEventV1 = {
      schemaVersion: 1,
      jobId: this.jobId,
      itemId: this.itemId,
      attemptId: this.attemptId,
      eventId: randomUUID(),
      timestampUtc: new Date().toISOString(),
      monotonicElapsedMs: Math.round(now - this.startMonotonicMs),
      ...eventData
    }

    // Sanitize boundary emitter before storing or writing (does not mutate rawEvent)
    const sanitized = sanitizeTelemetryEvent(rawEvent)

    // Bounded in-memory ring buffer (<= 1,000 events) preserving terminal events
    if (this.events.length >= 1000) {
      const evictIndex = this.events.findIndex((e) => !isTerminalPhase(e.phase))
      if (evictIndex !== -1) {
        this.events.splice(evictIndex, 1)
      } else {
        this.events.shift()
      }
    }
    this.events.push(sanitized)

    // Track stages state
    if (!this.stages[sanitized.stage]) {
      this.stages[sanitized.stage] = {
        status: isTerminalPhase(sanitized.phase) ? (sanitized.phase as 'succeeded' | 'failed' | 'cancelled') : 'running',
        activeMs: sanitized.activeMs || 0,
        resourceWaitMs: sanitized.queueWaitMs || 0,
        counters: sanitized.counters ? { ...sanitized.counters } : undefined,
        error: sanitized.error
      }
    } else {
      const existing = this.stages[sanitized.stage]!
      if (isTerminalPhase(sanitized.phase)) {
        existing.status = sanitized.phase as 'succeeded' | 'failed' | 'cancelled'
      }
      if (sanitized.activeMs) existing.activeMs = Math.max(existing.activeMs, sanitized.activeMs)
      if (sanitized.queueWaitMs) existing.resourceWaitMs = Math.max(existing.resourceWaitMs, sanitized.queueWaitMs)
      if (sanitized.counters) {
        existing.counters = { ...(existing.counters || {}), ...sanitized.counters }
      }
      if (sanitized.error) existing.error = sanitized.error
    }

    if (this.diagnosticsDir) {
      // Reserve the shared job budget before queueing the asynchronous write.
      // This keeps quota state deterministic for callers that emit many events
      // in one turn and prevents queued non-terminal records from racing a
      // terminal summary for the reserved bytes.
      const line = JSON.stringify(sanitized) + '\n'
      const lineBytes = Buffer.byteLength(line, 'utf8')
      if (this.budget.claimWriteBudget(lineBytes, isTerminalPhase(sanitized.phase))) {
        this.enqueueWrite(sanitized, line)
      }
    }
  }

  private enqueueWrite(event: AutoShortStageEventV1, line: string): void {
    this.writeQueue = this.writeQueue
      .then(async () => {
        if (!this.diagnosticsDir) return
        const filePath = join(this.diagnosticsDir, 'events.jsonl')

        try {
          await mkdir(this.diagnosticsDir, { recursive: true })
          await appendFile(filePath, line, 'utf8')
        } catch {
          this.diagnosticsIncomplete = true
          this.budget.markDiagnosticsIncomplete()
        }
      })
      .catch(() => {})
  }

  async finalize(
    status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted',
    error?: string
  ): Promise<AutoShortStageSummaryV1> {
    if (this.finalizedSummary) {
      return this.finalizedSummary
    }
    if (this.finalizePromise) {
      return this.finalizePromise
    }
    this.finalizePromise = this.doFinalize(status, error)
    return this.finalizePromise
  }

  private async doFinalize(
    status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted',
    error?: string
  ): Promise<AutoShortStageSummaryV1> {
    await this.writeQueue

    const completedAtUtc = new Date().toISOString()
    const totalWallMs = Math.round(performance.now() - this.startMonotonicMs)

    // Crash recovery: Any non-terminal stage must not remain 'running' or 'queued'
    const stageRecords: Partial<AutoShortStageSummaryV1['stages']> = {}
    for (const [stageKey, stageData] of Object.entries(this.stages)) {
      if (!stageData) continue
      const stage = stageKey as AutoShortStage
      let stageStatus = stageData.status
      let stageError = stageData.error
      if (stageStatus !== 'succeeded' && stageStatus !== 'failed' && stageStatus !== 'cancelled' && stageStatus !== 'skipped') {
        stageStatus = status === 'cancelled' ? 'cancelled' : 'failed'
        if (!stageError) stageError = error || 'Giai đoạn bị gián đoạn trước khi hoàn tất'
      }
      stageRecords[stage] = {
        status: stageStatus,
        activeMs: stageData.activeMs,
        resourceWaitMs: stageData.resourceWaitMs,
        counters: stageData.counters ? { ...stageData.counters } : undefined,
        error: stageError ? sanitizeTelemetryText(stageError) : undefined
      }
    }

    const isIncomplete = this.diagnosticsIncomplete || this.budget.isDiagnosticsIncomplete()

    const summary: AutoShortStageSummaryV1 = {
      schemaVersion: 1,
      jobId: this.jobId,
      itemId: this.itemId,
      attemptId: this.attemptId,
      startedAtUtc: this.startedAtUtc,
      completedAtUtc,
      status,
      totalWallMs,
      stages: stageRecords,
      error: error ? sanitizeTelemetryText(error) : undefined,
      diagnosticsIncomplete: isIncomplete || undefined
    }

    if (this.diagnosticsDir) {
      try {
        const summaryJson = JSON.stringify(summary, null, 2)
        const summaryBytes = Buffer.byteLength(summaryJson, 'utf8')
        if (this.budget.claimWriteBudget(summaryBytes, true)) {
          await mkdir(this.diagnosticsDir, { recursive: true })
          const summaryPath = join(this.diagnosticsDir, 'summary.json')
          const tempPath = join(this.diagnosticsDir, `summary.${randomUUID()}.tmp`)
          await writeFile(tempPath, summaryJson, 'utf8')
          await rename(tempPath, summaryPath)
        } else {
          summary.diagnosticsIncomplete = true
          this.diagnosticsIncomplete = true
        }
      } catch {
        // Telemetry I/O failure must never break published video
        summary.diagnosticsIncomplete = true
        this.diagnosticsIncomplete = true
        this.budget.markDiagnosticsIncomplete()
      }
    }

    this.finalizedSummary = summary
    return summary
  }

  getEvents(): AutoShortStageEventV1[] {
    return [...this.events]
  }

  getSummary(status: 'succeeded' | 'failed' | 'cancelled' | 'interrupted' = 'succeeded'): AutoShortStageSummaryV1 {
    if (this.finalizedSummary) {
      return { ...this.finalizedSummary }
    }
    const stageRecords: Partial<AutoShortStageSummaryV1['stages']> = {}
    for (const [stageKey, stageData] of Object.entries(this.stages)) {
      if (!stageData) continue
      const stage = stageKey as AutoShortStage
      let stageStatus = stageData.status
      let stageError = stageData.error
      if (stageStatus !== 'succeeded' && stageStatus !== 'failed' && stageStatus !== 'cancelled' && stageStatus !== 'skipped') {
        stageStatus = status === 'cancelled' ? 'cancelled' : 'failed'
        if (!stageError) stageError = 'Giai đoạn bị gián đoạn trước khi hoàn tất'
      }
      stageRecords[stage] = {
        status: stageStatus,
        activeMs: stageData.activeMs,
        resourceWaitMs: stageData.resourceWaitMs,
        counters: stageData.counters ? { ...stageData.counters } : undefined,
        error: stageError ? sanitizeTelemetryText(stageError) : undefined
      }
    }
    return {
      schemaVersion: 1,
      jobId: this.jobId,
      itemId: this.itemId,
      attemptId: this.attemptId,
      startedAtUtc: this.startedAtUtc,
      completedAtUtc: new Date().toISOString(),
      status,
      totalWallMs: Math.round(performance.now() - this.startMonotonicMs),
      stages: stageRecords,
      diagnosticsIncomplete: this.diagnosticsIncomplete || this.budget.isDiagnosticsIncomplete() || undefined
    }
  }
}
