import type { AutoShortItemResult, AutoShortQueueItemInput } from '../shared/types'
import type { DiskReservation } from './autoShortDiskBudget'
import {
  calculateProviderWaitRemainingMs,
  type ProviderWaitState
} from './autoShortProviderWait'

export type QueueItemOutcome =
  | { kind: 'terminal'; result: AutoShortItemResult }
  | { kind: 'deferred'; wait: ProviderWaitState; cancelOperation?: () => Promise<void> }

export interface RunAutoShortQueueInput {
  items: readonly AutoShortQueueItemInput[]
  signal: AbortSignal
  maxActiveItems: 1 | 2
  processItem(
    item: AutoShortQueueItemInput,
    index: number,
    totalCount: number,
    reservation?: DiskReservation,
    attempt?: 1 | 2
  ): Promise<AutoShortItemResult | QueueItemOutcome>
  onTerminal(result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput, totalCount: number): void | Promise<void>
  onDeferred?: (wait: ProviderWaitState, index: number, item: AutoShortQueueItemInput, totalCount: number) => void | Promise<void>
  shouldRetry?: (result: AutoShortItemResult, item: AutoShortQueueItemInput) => boolean
  onRetryScheduled?: (result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput, totalCount: number) => void | Promise<void>
  sanitizeError?: (item: AutoShortQueueItemInput, error: unknown) => string
  /** Optional admission gate used by experimental multi-item execution. */
  admitItem?: (item: AutoShortQueueItemInput, index: number, totalCount: number, signal: AbortSignal) => Promise<DiskReservation>
  /** Circuit breaker threshold for consecutive throttled provider errors (default: 2). */
  circuitBreakerThreshold?: number
  isThrottledError?: (result: AutoShortItemResult) => boolean
  onCircuitTrip?: (reason: string, consecutiveFailures: number) => void | Promise<void>
  /** Optional clock provider for simulated tests or synchronization */
  getNowMs?: () => number
  /** Pause queue runner pass when an item is deferred, preserving remaining pending items for resume */
  pauseOnDeferred?: boolean | ((wait: ProviderWaitState) => boolean)
  /** Controlled provider-wait hook. Production uses an abortable timer; tests advance a fake clock. */
  waitForProviderWait?: (wait: ProviderWaitState, signal: AbortSignal) => Promise<void>
}

function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort)
  })
}

export async function runAutoShortQueue(input: RunAutoShortQueueInput): Promise<AutoShortItemResult[]> {
  const { items, signal, maxActiveItems, processItem, onTerminal, onDeferred, shouldRetry, onRetryScheduled, sanitizeError, admitItem } = input
  const total = items.length
  const results: AutoShortItemResult[] = new Array(total)
  const terminalIndices = new Set<number>()
  const retryIndices = new Set<number>()

  interface DeferredItem {
    index: number
    attempt: 1 | 2
    wait: ProviderWaitState
    cancelOperation?: () => Promise<void>
  }

  type AttemptOutcome =
    | { kind: 'terminal'; index: number; attempt: 1 | 2; result: AutoShortItemResult }
    | { kind: 'deferred'; index: number; attempt: 1 | 2; wait: ProviderWaitState; cancelOperation?: () => Promise<void> }

  const deferred = new Map<number, DeferredItem>()
  const cancelledOperationIds = new Set<string>()

  const finalize = async (result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput): Promise<void> => {
    if (terminalIndices.has(index)) return
    terminalIndices.add(index)
    await onTerminal(result, index, item, total)
  }
  if (total === 0) return results

  const threshold = input.circuitBreakerThreshold ?? 2
  let consecutiveThrottled = 0
  let circuitTripped = false
  let circuitReason = ''
  let queuePaused = false

  const waitForProvider = async (wait: ProviderWaitState): Promise<void> => {
    if (input.waitForProviderWait) {
      await input.waitForProviderWait(wait, signal)
      return
    }
    const nowMs = input.getNowMs ? input.getNowMs() : Date.now()
    const remaining = calculateProviderWaitRemainingMs(wait, nowMs)
    // A null deadline means the durable operation must be polled again. Keep
    // a bounded cadence without fabricating a provider eligibility time.
    const delayMs = wait.nextEligibleAtUtc === null ? 5_000 : Math.max(0, remaining)
    if (delayMs > 0) await delayWithSignal(delayMs, signal)
  }

  const checkCircuit = async (res: AutoShortItemResult): Promise<void> => {
    if (res.status === 'done') {
      consecutiveThrottled = 0
      return
    }
    if (input.isThrottledError?.(res)) {
      consecutiveThrottled++
      if (consecutiveThrottled >= threshold && !circuitTripped) {
        circuitTripped = true
        circuitReason = `Hàng đợi tự động ngắt mạch (Circuit Breaker): Google Gemini Web liên tục từ chối/giới hạn tần suất (${consecutiveThrottled} lỗi). Đã tạm dừng batch để bảo vệ IP và tránh lãng phí ASR.`
        await input.onCircuitTrip?.(circuitReason, consecutiveThrottled)
      }
    }
  }

  const concurrency = Math.min(maxActiveItems, total)
  let nextIndex = 0

  const runAttempt = async (index: number, attempt: 1 | 2): Promise<AttemptOutcome> => {
    const item = items[index]
    let reservation: DiskReservation | undefined
    try {
      reservation = admitItem
        ? await admitItem(item, index, total, signal)
        : undefined
      const rawOutcome = await processItem(item, index, total, reservation, attempt)
      if ('kind' in rawOutcome && rawOutcome.kind === 'deferred') {
        return {
          kind: 'deferred',
          index,
          attempt,
          wait: rawOutcome.wait,
          ...(rawOutcome.cancelOperation ? { cancelOperation: rawOutcome.cancelOperation } : {})
        }
      }
      return {
        kind: 'terminal',
        index,
        attempt,
        result: 'kind' in rawOutcome ? rawOutcome.result : rawOutcome
      }
    } catch (error) {
      const message = sanitizeError
        ? sanitizeError(item, error)
        : (error instanceof Error ? error.message : String(error))
      return {
        kind: 'terminal',
        index,
        attempt,
        result: {
          itemId: item.id,
          filePath: item.filePath,
          status: signal.aborted ? 'cancelled' : 'error',
          error: message || 'Lỗi không xác định khi xử lý video.'
        }
      }
    } finally {
      // A provider wait never owns disk admission. The durable operation lease
      // is elsewhere, so its cooldown cannot reserve scratch capacity.
      reservation?.release()
    }
  }

  const settleTerminal = async (outcome: Extract<AttemptOutcome, { kind: 'terminal' }>): Promise<void> => {
    const { index, attempt, result } = outcome
    const item = items[index]
    deferred.delete(index)
    results[index] = result
    await checkCircuit(result)
    if (attempt === 1 && shouldRetry?.(result, item) && !signal.aborted && !circuitTripped && !queuePaused) {
      retryIndices.add(index)
      await onRetryScheduled?.(result, index, item, total)
      return
    }
    await finalize(result, index, item)
  }

  const settleDeferred = async (outcome: Extract<AttemptOutcome, { kind: 'deferred' }>): Promise<void> => {
    const { index, attempt, wait, cancelOperation } = outcome
    const item = items[index]
    deferred.set(index, { index, attempt, wait, ...(cancelOperation ? { cancelOperation } : {}) })
    results[index] = {
      itemId: item.id,
      filePath: item.filePath,
      status: 'waiting_provider',
      error: wait.reason,
      providerWait: wait
    }
    await onDeferred?.(wait, index, item, total)
    const shouldPause = typeof input.pauseOnDeferred === 'function'
      ? input.pauseOnDeferred(wait)
      : Boolean(input.pauseOnDeferred)
    if (shouldPause) queuePaused = true
  }

  const settleAttempt = async (outcome: AttemptOutcome): Promise<void> => {
    if (outcome.kind === 'deferred') await settleDeferred(outcome)
    else await settleTerminal(outcome)
  }

  // The initial pass may start up to two local video jobs. Once either one
  // reaches provider cooldown, all new admissions stop. Existing work is
  // allowed to settle, then deferred operations resume by original queue index
  // before the runner admits another video. This preserves FIFO and avoids a
  // race where one worker cleared another worker's provider barrier.
  const active = new Map<number, Promise<AttemptOutcome>>()
  const startAttempt = (index: number, attempt: 1 | 2): void => {
    active.set(index, runAttempt(index, attempt))
  }
  const settleOneActive = async (): Promise<void> => {
    const outcome = await Promise.race([...active.values()])
    active.delete(outcome.index)
    await settleAttempt(outcome)
  }
  const drainActive = async (): Promise<void> => {
    while (active.size > 0) await settleOneActive()
  }
  const oldestDeferred = (): DeferredItem | undefined => {
    let oldest: DeferredItem | undefined
    for (const entry of deferred.values()) {
      if (!oldest || entry.index < oldest.index) oldest = entry
    }
    return oldest
  }
  const cancelDeferredOperation = async (entry: DeferredItem): Promise<void> => {
    if (!entry.cancelOperation || cancelledOperationIds.has(entry.wait.operationId)) return
    cancelledOperationIds.add(entry.wait.operationId)
    await entry.cancelOperation().catch(() => {})
  }
  const cancelDeferredOperations = async (): Promise<void> => {
    for (const entry of deferred.values()) {
      await cancelDeferredOperation(entry)
    }
  }
  const resumeOldestDeferred = async (): Promise<void> => {
    const entry = oldestDeferred()
    if (!entry || queuePaused || signal.aborted || circuitTripped) return
    try {
      await waitForProvider(entry.wait)
    } catch (error) {
      deferred.delete(entry.index)
      const item = items[entry.index]
      await settleTerminal({
        kind: 'terminal',
        index: entry.index,
        attempt: entry.attempt,
        result: {
          itemId: item.id,
          filePath: item.filePath,
          status: signal.aborted ? 'cancelled' : 'error',
          error: sanitizeError
            ? sanitizeError(item, error)
            : (error instanceof Error ? error.message : String(error))
        }
      })
      return
    }
    if (signal.aborted) {
      await cancelDeferredOperation(entry)
      return
    }
    // The same index remains in `deferred` until its operation reaches a
    // terminal result. That keeps the admission gate closed through a second
    // waiting-provider receipt for the same durable operation.
    startAttempt(entry.index, entry.attempt)
  }

  while (!signal.aborted && !circuitTripped && !queuePaused) {
    if (deferred.size > 0) {
      if (active.size > 0) {
        await settleOneActive()
      } else {
        await resumeOldestDeferred()
      }
      continue
    }
    while (active.size < concurrency && nextIndex < total && !signal.aborted && !circuitTripped && !queuePaused) {
      startAttempt(nextIndex++, 1)
    }
    if (active.size === 0) break
    await settleOneActive()
  }

  // Do not abandon already admitted local work. It can return a terminal
  // result or a durable wait record, but it cannot authorize a new admission.
  await drainActive()
  if (signal.aborted) await cancelDeferredOperations()

  if (!queuePaused && !signal.aborted && !circuitTripped && shouldRetry) {
    for (const index of [...retryIndices].sort((left, right) => left - right)) {
      while (!signal.aborted && !circuitTripped && !queuePaused) {
        if (deferred.size > 0) {
          await resumeOldestDeferred()
          // A deferred retry is always consumed before another retry index is
          // considered. If it reports waiting-provider again, the next loop
          // waits again instead of submitting a duplicate operation.
          if (active.size > 0) await settleOneActive()
          if (terminalIndices.has(index)) break
          continue
        }
        const outcome = await runAttempt(index, 2)
        await settleAttempt(outcome)
        if (outcome.kind === 'terminal') break
      }
      if (signal.aborted) await cancelDeferredOperations()
      if (signal.aborted || circuitTripped || queuePaused) break
    }
  }

  if (circuitTripped) {
    for (let i = 0; i < total; i++) {
      if (!terminalIndices.has(i) && !deferred.has(i)) {
        const item = items[i]
        const result: AutoShortItemResult = {
          itemId: item.id,
          filePath: item.filePath,
          status: 'error',
          error: circuitReason
        }
        results[i] = result
        await finalize(result, i, item)
      }
    }
  }

  // Mark unstarted items as cancelled if aborted
  if (signal.aborted) {
    for (let i = 0; i < total; i++) {
      if (!terminalIndices.has(i) && !deferred.has(i)) {
        const item = items[i]
        const result: AutoShortItemResult = {
          itemId: item.id,
          filePath: item.filePath,
          status: 'cancelled',
          error: 'Đã hủy tác vụ'
        }
        results[i] = result
        await finalize(result, i, item)
      }
    }
  }

  return results
}
