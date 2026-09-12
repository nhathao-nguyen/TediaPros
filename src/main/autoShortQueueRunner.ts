import type { AutoShortItemResult, AutoShortQueueItemInput } from '../shared/types'
import type { DiskReservation } from './autoShortDiskBudget'

export interface RunAutoShortQueueInput {
  items: readonly AutoShortQueueItemInput[]
  signal: AbortSignal
  maxActiveItems: 1 | 2
  processItem(item: AutoShortQueueItemInput, index: number, totalCount: number, reservation?: DiskReservation, attempt?: 1 | 2): Promise<AutoShortItemResult>
  onTerminal(result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput, totalCount: number): void
  shouldRetry?: (result: AutoShortItemResult, item: AutoShortQueueItemInput) => boolean
  onRetryScheduled?: (result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput, totalCount: number) => void
  sanitizeError?: (item: AutoShortQueueItemInput, error: unknown) => string
  /** Optional admission gate used by experimental multi-item execution. */
  admitItem?: (item: AutoShortQueueItemInput, index: number, totalCount: number, signal: AbortSignal) => Promise<DiskReservation>
}

export async function runAutoShortQueue(input: RunAutoShortQueueInput): Promise<AutoShortItemResult[]> {
  const { items, signal, maxActiveItems, processItem, onTerminal, shouldRetry, onRetryScheduled, sanitizeError, admitItem } = input
  const total = items.length
  const results: AutoShortItemResult[] = new Array(total)
  const terminalIndices = new Set<number>()
  const finalize = (result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput): void => {
    if (terminalIndices.has(index)) return
    terminalIndices.add(index)
    onTerminal(result, index, item, total)
  }
  if (total === 0) return results

  const concurrency = Math.min(maxActiveItems, total)
  let nextIndex = 0

  const runWorker = async (): Promise<void> => {
    while (true) {
      if (signal.aborted) {
        break
      }
      const currentIndex = nextIndex++
      if (currentIndex >= total) {
        break
      }
      const item = items[currentIndex]
      let reservation: DiskReservation | undefined
      try {
        reservation = admitItem
          ? await admitItem(item, currentIndex, total, signal)
          : undefined
        const result = await processItem(item, currentIndex, total, reservation, 1)
        results[currentIndex] = result
        if (shouldRetry?.(result, item) && !signal.aborted) onRetryScheduled?.(result, currentIndex, item, total)
        else finalize(result, currentIndex, item)
      } catch (error) {
        const message = sanitizeError
          ? sanitizeError(item, error)
          : (error instanceof Error ? error.message : String(error))
        const result: AutoShortItemResult = {
          itemId: item.id,
          filePath: item.filePath,
          status: signal.aborted ? 'cancelled' : 'error',
          error: message || 'Lỗi không xác định khi xử lý video.'
        }
        results[currentIndex] = result
        finalize(result, currentIndex, item)
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

  if (!signal.aborted && shouldRetry) {
    for (let index = 0; index < total; index++) {
      if (signal.aborted) break
      const first = results[index]
      const item = items[index]
      if (!first || !shouldRetry(first, item)) continue
      let reservation: DiskReservation | undefined
      try {
        reservation = admitItem ? await admitItem(item, index, total, signal) : undefined
        results[index] = await processItem(item, index, total, reservation, 2)
      } catch (error) {
        results[index] = {
          itemId: item.id, filePath: item.filePath,
          status: signal.aborted ? 'cancelled' : 'error',
          error: sanitizeError ? sanitizeError(item, error) : (error instanceof Error ? error.message : String(error))
        }
      } finally {
        reservation?.release()
      }
      finalize(results[index], index, item)
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
          error: 'Đã hủy tác vụ'
        }
        results[i] = result
        finalize(result, i, item)
      }
    }
  }

  return results
}
