import type { AutoShortItemResult, AutoShortQueueItemInput } from '../shared/types'
import type { DiskReservation } from './autoShortDiskBudget'

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
  ): Promise<AutoShortItemResult>
  onTerminal(result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput, totalCount: number): void | Promise<void>
  shouldRetry?: (result: AutoShortItemResult, item: AutoShortQueueItemInput) => boolean
  onRetryScheduled?: (result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput, totalCount: number) => void | Promise<void>
  sanitizeError?: (item: AutoShortQueueItemInput, error: unknown) => string
  /** Optional admission gate used by experimental multi-item execution. */
  admitItem?: (item: AutoShortQueueItemInput, index: number, totalCount: number, signal: AbortSignal) => Promise<DiskReservation>
  /** Circuit breaker threshold for consecutive throttled provider errors (default: 2). */
  circuitBreakerThreshold?: number
  isThrottledError?: (result: AutoShortItemResult) => boolean
  onCircuitTrip?: (reason: string, consecutiveFailures: number) => void | Promise<void>
}

export async function runAutoShortQueue(input: RunAutoShortQueueInput): Promise<AutoShortItemResult[]> {
  const { items, signal, maxActiveItems, processItem, onTerminal, shouldRetry, onRetryScheduled, sanitizeError, admitItem } = input
  const total = items.length
  const results: AutoShortItemResult[] = new Array(total)
  const terminalIndices = new Set<number>()

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

  const concurrency = Math.min(Math.max(1, maxActiveItems), 2)
  let nextIndex = 0

  const runWorker = async (): Promise<void> => {
    while (!signal.aborted && !circuitTripped) {
      const currentIndex = nextIndex++
      if (currentIndex >= total) break
      const item = items[currentIndex]
      let reservation: DiskReservation | undefined
      try {
        reservation = admitItem ? await admitItem(item, currentIndex, total, signal) : undefined
        const result = await processItem(item, currentIndex, total, reservation, 1)
        results[currentIndex] = result
        await checkCircuit(result)
        if (shouldRetry?.(result, item)) {
          await onRetryScheduled?.(result, currentIndex, item, total)
          continue
        }
        await finalize(result, currentIndex, item)
      } catch (error) {
        const message = sanitizeError ? sanitizeError(item, error) : (error instanceof Error ? error.message : String(error))
        const result: AutoShortItemResult = {
          itemId: item.id,
          filePath: item.filePath,
          status: signal.aborted ? 'cancelled' : 'error',
          error: message || 'Lỗi không xác định khi xử lý video.'
        }
        results[currentIndex] = result
        await finalize(result, currentIndex, item)
      } finally {
        reservation?.release()
      }
    }
  }

  const workers: Promise<void>[] = []
  for (let w = 0; w < concurrency; w++) {
    workers.push(runWorker())
  }
  await Promise.all(workers)

  if (!signal.aborted && !circuitTripped && shouldRetry) {
    for (let index = 0; index < total; index++) {
      if (signal.aborted || circuitTripped) break
      const first = results[index]
      const item = items[index]
      if (!first || !shouldRetry(first, item)) continue
      let reservation: DiskReservation | undefined
      try {
        reservation = admitItem ? await admitItem(item, index, total, signal) : undefined
        results[index] = await processItem(item, index, total, reservation, 2)
      } catch (error) {
        results[index] = {
          itemId: item.id,
          filePath: item.filePath,
          status: signal.aborted ? 'cancelled' : 'error',
          error: sanitizeError ? sanitizeError(item, error) : (error instanceof Error ? error.message : String(error))
        }
      } finally {
        reservation?.release()
      }
      await finalize(results[index], index, item)
    }
  }

  if (circuitTripped) {
    for (let i = 0; i < total; i++) {
      if (!terminalIndices.has(i)) {
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
      if (!terminalIndices.has(i)) {
        const item = items[i]
        const result: AutoShortItemResult = {
          itemId: item.id,
          filePath: item.filePath,
          status: 'cancelled',
          error: 'Đã hủy xử lý theo yêu cầu của người dùng.'
        }
        results[i] = result
        await finalize(result, i, item)
      }
    }
  }

  return results
}
