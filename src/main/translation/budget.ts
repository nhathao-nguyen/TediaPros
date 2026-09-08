import type { TranslationIssueCode } from '../../shared/translation'

export interface TranslationBatchBudgetState {
  normalCharged: boolean
  recoveryUsed: number
  splitDepth: number
  repairSets: string[]
  transportRetries: Record<string, number>
}

export interface TranslationBudgetSnapshot {
  plannedRequests: number
  recoveryLimit: number
  normalUsed: number
  recoveryUsed: number
  activeElapsedMs: number
  activeBudgetMs: number
  perBatch: Record<string, TranslationBatchBudgetState>
}

export interface TranslationBudget {
  readonly plannedRequests: number
  readonly recoveryLimit: number
  charge(kind: 'normal' | 'recovery', batchId: string): void
  claimTransportRetry(batchId: string, requestKey: string): void
  claimFormatRepair(batchId: string, idSetKey: string): void
  recordSplit(batchId: string, depth: number): void
  remainingMs(): number
  canSplit(batchId: string, depth: number): boolean
  snapshot(): TranslationBudgetSnapshot
}

export interface TranslationFailure {
  code: TranslationIssueCode
  retryable: boolean
  retryAfterMs?: number
  status?: number
  message: string
}

export class TranslationBudgetExhaustedError extends Error {
  readonly code = 'budget-exhausted' as const

  constructor(message = 'Translation recovery budget exhausted.') {
    super(message)
    this.name = 'TranslationBudgetExhaustedError'
  }
}

const MAX_RECOVERY_PER_BATCH = 4
const MAX_TRANSPORT_RETRIES = 2
const MAX_FORMAT_REPAIRS = 1
const MAX_SPLIT_DEPTH = 2

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid translation budget ${label}.`)
  }
  return value
}

function cloneBatchState(value?: Partial<TranslationBatchBudgetState>): TranslationBatchBudgetState {
  const normalCharged = value?.normalCharged === true
  const recoveryUsed = Math.floor(finiteNonNegative(value?.recoveryUsed ?? 0, 'recoveryUsed'))
  const splitDepth = Math.floor(finiteNonNegative(value?.splitDepth ?? 0, 'splitDepth'))
  if (recoveryUsed > MAX_RECOVERY_PER_BATCH) throw new Error('Invalid translation budget per-batch recovery quota.')
  if (splitDepth > MAX_SPLIT_DEPTH) throw new Error('Invalid translation budget split depth.')
  const repairSets = [...new Set((value?.repairSets || []).filter((item): item is string => typeof item === 'string' && item.length > 0))]
  if (repairSets.length > MAX_FORMAT_REPAIRS * 1000) throw new Error('Invalid translation budget repair state.')
  const transportRetries: Record<string, number> = {}
  for (const [key, count] of Object.entries(value?.transportRetries || {})) {
    const safeCount = Math.floor(finiteNonNegative(count, 'transportRetries'))
    if (safeCount > MAX_TRANSPORT_RETRIES) throw new Error('Invalid translation budget transport retry state.')
    transportRetries[key] = safeCount
  }
  return { normalCharged, recoveryUsed, splitDepth, repairSets, transportRetries }
}

function assertPlan(plannedRequests: number): { recoveryLimit: number; activeBudgetMs: number } {
  if (!Number.isInteger(plannedRequests) || plannedRequests < 1) throw new Error('plannedRequests must be a positive integer.')
  const recoveryLimit = Math.max(4, Math.ceil(plannedRequests * 0.5))
  return {
    recoveryLimit,
    activeBudgetMs: Math.max(600_000, plannedRequests * 90_000 + recoveryLimit * 60_000)
  }
}

function restoreSnapshot(
  plannedRequests: number,
  maximumRecoveryLimit: number,
  maximumActiveBudgetMs: number,
  restored: TranslationBudgetSnapshot
): TranslationBudgetSnapshot {
  if (!restored || restored.plannedRequests !== plannedRequests) throw new Error('Translation budget plan changed while restoring.')
  const recoveryLimit = Math.floor(finiteNonNegative(restored.recoveryLimit, 'recoveryLimit'))
  const activeBudgetMs = finiteNonNegative(restored.activeBudgetMs, 'activeBudgetMs')
  if (recoveryLimit > maximumRecoveryLimit || activeBudgetMs > maximumActiveBudgetMs) {
    throw new Error('Translation budget quotas cannot increase during restore.')
  }
  const normalUsed = Math.floor(finiteNonNegative(restored.normalUsed, 'normalUsed'))
  const recoveryUsed = Math.floor(finiteNonNegative(restored.recoveryUsed, 'recoveryUsed'))
  const activeElapsedMs = finiteNonNegative(restored.activeElapsedMs, 'activeElapsedMs')
  if (normalUsed > plannedRequests || recoveryUsed > recoveryLimit) throw new Error('Translation budget usage exceeds its plan.')
  const perBatch: Record<string, TranslationBatchBudgetState> = {}
  for (const [batchId, state] of Object.entries(restored.perBatch || {})) perBatch[batchId] = cloneBatchState(state)
  const countedNormal = Object.values(perBatch).filter((state) => state.normalCharged).length
  const countedRecovery = Object.values(perBatch).reduce((sum, state) => sum + state.recoveryUsed, 0)
  if (countedNormal > normalUsed || countedRecovery > recoveryUsed) throw new Error('Translation budget per-batch state is inconsistent.')
  return { plannedRequests, recoveryLimit, normalUsed, recoveryUsed, activeElapsedMs, activeBudgetMs, perBatch }
}

export function createTranslationBudget(
  plannedRequests: number,
  now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  restored?: TranslationBudgetSnapshot
): TranslationBudget {
  assertPlan(plannedRequests)
  // A resumed run may contain fewer pending cues than the original plan. The
  // durable budget is therefore allowed to retain the original (larger) plan,
  // while a plan that grows can never silently increase the remaining quota.
  const effectivePlannedRequests = restored
    ? Math.max(plannedRequests, Math.floor(finiteNonNegative(restored.plannedRequests, 'plannedRequests')))
    : plannedRequests
  if (restored && restored.plannedRequests < plannedRequests) {
    throw new TranslationBudgetExhaustedError('Translation plan grew while restoring its durable budget.')
  }
  const planned = assertPlan(effectivePlannedRequests)
  let state: TranslationBudgetSnapshot = restored
    ? restoreSnapshot(effectivePlannedRequests, planned.recoveryLimit, planned.activeBudgetMs, restored)
    : { plannedRequests: effectivePlannedRequests, recoveryLimit: planned.recoveryLimit, normalUsed: 0, recoveryUsed: 0, activeElapsedMs: 0, activeBudgetMs: planned.activeBudgetMs, perBatch: {} }
  let lastNow = now()
  if (!Number.isFinite(lastNow)) lastNow = 0

  const touch = (): void => {
    const current = now()
    if (!Number.isFinite(current)) return
    if (current > lastNow) state.activeElapsedMs += current - lastNow
    lastNow = Math.max(lastNow, current)
  }

  const batch = (batchId: string): TranslationBatchBudgetState => {
    const id = batchId.trim()
    if (!id) throw new Error('Translation budget requires a batch ID.')
    return state.perBatch[id] || (state.perBatch[id] = cloneBatchState())
  }

  const charge = (kind: 'normal' | 'recovery', batchId: string): void => {
    touch()
    const item = batch(batchId)
    if (kind === 'normal') {
      if (item.normalCharged) return
      if (state.normalUsed >= state.plannedRequests) throw new TranslationBudgetExhaustedError('Normal translation request budget exhausted.')
      item.normalCharged = true
      state.normalUsed++
      return
    }
    if (item.recoveryUsed >= MAX_RECOVERY_PER_BATCH || state.recoveryUsed >= state.recoveryLimit) {
      throw new TranslationBudgetExhaustedError('Translation recovery request budget exhausted.')
    }
    item.recoveryUsed++
    state.recoveryUsed++
  }

  const claimTransportRetry = (batchId: string, requestKey: string): void => {
    const item = batch(batchId)
    const key = requestKey.trim()
    if (!key) throw new Error('Transport retry requires a request key.')
    const used = item.transportRetries[key] || 0
    if (used >= MAX_TRANSPORT_RETRIES) throw new TranslationBudgetExhaustedError('Transport retry limit exhausted for this request.')
    item.transportRetries[key] = used + 1
  }

  const claimFormatRepair = (batchId: string, idSetKey: string): void => {
    const item = batch(batchId)
    const key = idSetKey.trim()
    if (!key) throw new Error('Format repair requires an ID-set key.')
    if (item.repairSets.includes(key)) {
      throw new TranslationBudgetExhaustedError('Format repair limit exhausted for this ID set.')
    }
    item.repairSets.push(key)
  }

  const recordSplit = (batchId: string, depth: number): void => {
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_SPLIT_DEPTH) {
      throw new TranslationBudgetExhaustedError('Translation split depth exhausted.')
    }
    const item = batch(batchId)
    if (depth < item.splitDepth) return
    if (depth > item.splitDepth + 1) throw new TranslationBudgetExhaustedError('Translation split depth must advance one level at a time.')
    item.splitDepth = depth
  }

  return {
    // Expose the durable plan, including a larger plan retained when a
    // resumed run has fewer pending cues than the original attempt.
    plannedRequests: state.plannedRequests,
    recoveryLimit: state.recoveryLimit,
    charge,
    claimTransportRetry,
    claimFormatRepair,
    recordSplit,
    remainingMs: () => {
      touch()
      return Math.max(0, state.activeBudgetMs - state.activeElapsedMs)
    },
    canSplit: (batchId: string, depth: number) => {
      const item = batch(batchId)
      return Number.isInteger(depth) && depth < MAX_SPLIT_DEPTH && depth > item.splitDepth && item.recoveryUsed < MAX_RECOVERY_PER_BATCH && state.recoveryUsed < state.recoveryLimit && state.activeElapsedMs < state.activeBudgetMs
    },
    snapshot: () => {
      touch()
      const perBatch: Record<string, TranslationBatchBudgetState> = {}
      for (const [batchId, item] of Object.entries(state.perBatch)) {
        perBatch[batchId] = {
          normalCharged: item.normalCharged,
          recoveryUsed: item.recoveryUsed,
          splitDepth: item.splitDepth,
          repairSets: [...item.repairSets],
          transportRetries: { ...item.transportRetries }
        }
      }
      state = { ...state, perBatch }
      return {
        plannedRequests: state.plannedRequests,
        recoveryLimit: state.recoveryLimit,
        normalUsed: state.normalUsed,
        recoveryUsed: state.recoveryUsed,
        activeElapsedMs: state.activeElapsedMs,
        activeBudgetMs: state.activeBudgetMs,
        perBatch
      }
    }
  }
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object' ? error as Record<string, unknown> : {}
}

/** Classify provider failures without parsing user-facing message text. */
export function classifyTranslationError(error: unknown): TranslationFailure {
  if (error instanceof TranslationBudgetExhaustedError || errorRecord(error).code === 'budget-exhausted') {
    return { code: 'budget-exhausted', retryable: false, message: error instanceof Error ? error.message : 'Translation budget exhausted.' }
  }
  const record = errorRecord(error)
  const status = typeof record.status === 'number' && Number.isFinite(record.status) ? record.status : undefined
  const providerCode = typeof record.providerCode === 'string' ? record.providerCode.toLowerCase() : typeof record.code === 'string' ? record.code.toLowerCase() : ''
  const name = typeof record.name === 'string' ? record.name : ''
  const message = error instanceof Error ? error.message : typeof record.message === 'string' ? record.message : 'Translation provider failure.'
  const retryAfterMs = typeof record.retryAfterMs === 'number' && Number.isFinite(record.retryAfterMs) ? Math.max(0, record.retryAfterMs) : undefined

  if (name === 'AbortError' || providerCode === 'cancelled' || providerCode === 'aborted') return { code: 'cancelled', retryable: false, ...(status === undefined ? {} : { status }), message }
  if (name === 'TimeoutError' || providerCode === 'timeout' || providerCode === 'request_timeout') return { code: 'provider-transient', retryable: true, ...(status === undefined ? {} : { status }), ...(retryAfterMs === undefined ? {} : { retryAfterMs }), message }
  if (status === 401 || status === 403 || ['invalid_api_key', 'unauthorized', 'forbidden', 'auth'].includes(providerCode)) return { code: 'provider-auth', retryable: false, ...(status === undefined ? {} : { status }), message }
  if (['provider-transient', 'provider_transient', 'transient', 'timeout', 'network'].includes(providerCode)) return { code: 'provider-transient', retryable: true, ...(status === undefined ? {} : { status }), ...(retryAfterMs === undefined ? {} : { retryAfterMs }), message }
  if (['unsupported', 'unsupported_capability', 'invalid_request', 'policy_refusal', 'quota_exhausted'].includes(providerCode)) return { code: 'provider-protocol', retryable: false, ...(status === undefined ? {} : { status }), message }
  if (status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500)) return { code: 'provider-transient', retryable: true, ...(status === undefined ? {} : { status }), ...(retryAfterMs === undefined ? {} : { retryAfterMs }), message }
  return { code: 'provider-protocol', retryable: false, ...(status === undefined ? {} : { status }), message }
}
