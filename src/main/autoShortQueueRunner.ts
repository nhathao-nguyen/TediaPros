import type { AutoShortItemResult, AutoShortQueueItemInput } from '../shared/types'
import type { DiskReservation } from './autoShortDiskBudget'

export interface RunAutoShortQueueInput {
  items: readonly AutoShortQueueItemInput[]
  signal: AbortSignal
  maxActiveItems: 1 | 2
  processItem(item: AutoShortQueueItemInput, index: number, totalCount: number, reservation?: DiskReservation): Promise<AutoShortItemResult>
  onTerminal(result: AutoShortItemResult, index: number, item: AutoShortQueueItemInput, totalCount: number): void
  sanitizeError?: (item: AutoShortQueueItemInput, error: unknown) => string
  /** Optional admission gate used by experimental multi-item execution. */
  admitItem?: (item: AutoShortQueueItemInput, index: number, totalCount: number, signal: AbortSignal) => Promise<DiskReservation>
}

export async function runAutoShortQueue(input: RunAutoShortQueueInput): Promise<AutoShortItemResult[]> {
  const { items, signal, maxActiveItems, processItem, onTerminal, sanitizeError, admitItem } = input
  const total = items.length
  const results: AutoShortItemResult[] = new Array(total)
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
        const result = await processItem(item, currentIndex, total, reservation)
        results[currentIndex] = result
        onTerminal(result, currentIndex, item, total)
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
        onTerminal(result, currentIndex, item, total)
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

  // Mark unstarted items as cancelled if aborted
  if (signal.aborted) {
    for (let i = 0; i < total; i++) {
      if (!results[i]) {
        const item = items[i]
        const result: AutoShortItemResult = {
          itemId: item.id,
          filePath: item.filePath,
          status: 'cancelled',
          error: 'Đã hủy tác vụ'
        }
        results[i] = result
        onTerminal(result, i, item, total)
      }
    }
  }

  return results
}
