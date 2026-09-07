import { randomUUID } from 'node:crypto'
import { sanitizeEndpointAlias } from '../src/main/autoShortTelemetry'

export type BenchmarkMode = 'replay' | 'live'
export type BenchmarkQuality = 'pass' | 'fail' | 'unverified'
export type BenchmarkWorkload = 'fixed-output-replay' | 'live-single' | 'live-batch'
export type BenchmarkCacheState = 'cold' | 'warm' | 'cache-hit' | 'unknown'

export interface BenchmarkStageInterval {
  stage: string
  startMs: number
  endMs: number
}

export interface BenchmarkV1 {
  schemaVersion: 1
  caseId: string
  variant: string
  mode: BenchmarkMode
  workload: BenchmarkWorkload
  runId: string
  e2eMs: number
  stageActiveMs: Record<string, number>
  stageWaitMs: Record<string, number>
  peakRamBytes: number | null
  peakVramBytes: number | null
  peakScratchBytes: number
  quality: BenchmarkQuality
  sourceHash?: string
  configHash?: string
  runtimeHash?: string
  cacheState: BenchmarkCacheState
  requestedProvider?: string
  effectiveProvider?: string
  requestCount: number
  retryCount: number
  requestBytes: number
  endpointAlias?: string
}

export interface BenchmarkBuildInput {
  caseId: string
  variant: string
  mode: BenchmarkMode
  workload?: BenchmarkWorkload
  runId?: string
  e2eMs?: number
  stageActiveMs: Record<string, number>
  stageWaitMs: Record<string, number>
  peakRamBytes: number | null
  peakVramBytes: number | null
  peakScratchBytes: number
  quality: BenchmarkQuality
  sourceHash?: string
  configHash?: string
  runtimeHash?: string
  cacheState?: BenchmarkCacheState
  requestedProvider?: string
  effectiveProvider?: string
  requestCount?: number
  retryCount?: number
  requestBytes?: number
  metadata?: { endpoint?: string }
}

function finiteNonNegative(value: unknown, fallback: number | null = null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback
}

function validHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/iu.test(value) ? value.toLowerCase() : undefined
}

function safeProvider(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim().replace(/[^A-Za-z0-9._:-]/gu, '_').slice(0, 64)
  return clean || undefined
}

function sanitizeStageMap(input: Record<string, number>): Record<string, number> {
  const output: Record<string, number> = {}
  for (const [key, value] of Object.entries(input || {})) {
    const cleanKey = key.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64)
    const cleanValue = finiteNonNegative(value)
    if (cleanKey && cleanValue != null) output[cleanKey] = cleanValue
  }
  return output
}

/** Union of stage intervals; overlapping work contributes once to wall time. */
export function calculateCriticalPathMs(intervals: readonly BenchmarkStageInterval[]): number {
  const sorted = intervals
    .filter((item) => Number.isFinite(item.startMs) && Number.isFinite(item.endMs) && item.endMs >= item.startMs)
    .map((item) => ({ startMs: item.startMs, endMs: item.endMs }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  let total = 0
  let start = 0
  let end = 0
  let hasInterval = false
  for (const interval of sorted) {
    if (!hasInterval) {
      start = interval.startMs
      end = interval.endMs
      hasInterval = true
    } else if (interval.startMs <= end) {
      end = Math.max(end, interval.endMs)
    } else {
      total += end - start
      start = interval.startMs
      end = interval.endMs
    }
  }
  return Math.max(0, Math.round(total + (hasInterval ? end - start : 0)))
}

/** Build only the bounded, redacted benchmark schema; never persist raw metadata. */
export function buildBenchmarkV1(input: BenchmarkBuildInput): BenchmarkV1 {
  if (!input.caseId?.trim() || !input.variant?.trim()) throw new Error('Benchmark cần caseId và variant.')
  if (input.mode !== 'replay' && input.mode !== 'live') throw new Error('Benchmark mode không hợp lệ.')
  const workload = input.workload || (input.mode === 'replay' ? 'fixed-output-replay' : 'live-single')
  if (!['fixed-output-replay', 'live-single', 'live-batch'].includes(workload)) throw new Error('Benchmark workload không hợp lệ.')
  const cacheState = input.cacheState || 'unknown'
  if (!['cold', 'warm', 'cache-hit', 'unknown'].includes(cacheState)) throw new Error('Benchmark cache state không hợp lệ.')
  if (!['pass', 'fail', 'unverified'].includes(input.quality)) throw new Error('Benchmark quality không hợp lệ.')
  const record: BenchmarkV1 = {
    schemaVersion: 1,
    caseId: input.caseId.trim().slice(0, 128),
    variant: input.variant.trim().slice(0, 128),
    mode: input.mode,
    workload,
    runId: input.runId?.trim().slice(0, 128) || randomUUID(),
    e2eMs: finiteNonNegative(input.e2eMs, 0) || 0,
    stageActiveMs: sanitizeStageMap(input.stageActiveMs),
    stageWaitMs: sanitizeStageMap(input.stageWaitMs),
    peakRamBytes: finiteNonNegative(input.peakRamBytes),
    peakVramBytes: finiteNonNegative(input.peakVramBytes),
    peakScratchBytes: finiteNonNegative(input.peakScratchBytes, 0) || 0,
    quality: input.quality,
    cacheState,
    requestCount: finiteNonNegative(input.requestCount, 0) || 0,
    retryCount: finiteNonNegative(input.retryCount, 0) || 0,
    requestBytes: finiteNonNegative(input.requestBytes, 0) || 0
  }
  const sourceHash = validHash(input.sourceHash)
  const configHash = validHash(input.configHash)
  const runtimeHash = validHash(input.runtimeHash)
  if (sourceHash) record.sourceHash = sourceHash
  if (configHash) record.configHash = configHash
  if (runtimeHash) record.runtimeHash = runtimeHash
  const requestedProvider = safeProvider(input.requestedProvider)
  const effectiveProvider = safeProvider(input.effectiveProvider)
  if (requestedProvider) record.requestedProvider = requestedProvider
  if (effectiveProvider) record.effectiveProvider = effectiveProvider
  const endpoint = input.metadata?.endpoint
  const endpointAlias = endpoint
    ? sanitizeEndpointAlias(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(endpoint) ? endpoint : `http://${endpoint}`)
    : undefined
  if (endpointAlias) record.endpointAlias = endpointAlias
  return record
}

/** Re-apply the whitelist before writing or exporting a record from another source. */
export function redactBenchmarkRecord(input: BenchmarkV1): BenchmarkV1 {
  const record = buildBenchmarkV1({
    caseId: input.caseId,
    variant: input.variant,
    mode: input.mode,
    workload: input.workload,
    runId: input.runId,
    e2eMs: input.e2eMs,
    stageActiveMs: input.stageActiveMs,
    stageWaitMs: input.stageWaitMs,
    peakRamBytes: input.peakRamBytes,
    peakVramBytes: input.peakVramBytes,
    peakScratchBytes: input.peakScratchBytes,
    quality: input.quality,
    sourceHash: input.sourceHash,
    configHash: input.configHash,
    runtimeHash: input.runtimeHash,
    cacheState: input.cacheState,
    requestedProvider: input.requestedProvider,
    effectiveProvider: input.effectiveProvider,
    requestCount: input.requestCount,
    retryCount: input.retryCount,
    requestBytes: input.requestBytes,
    metadata: { endpoint: input.endpointAlias }
  })
  return record
}
