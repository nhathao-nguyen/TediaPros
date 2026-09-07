import type { AutoShortEvent } from '../../../shared/types'

export interface AutoShortProgressCoalescer {
  push(event: AutoShortEvent): void
  flush(): void
  dispose(): void
}

/**
 * Bound renderer updates while preserving the newest progress event for each
 * item. Terminal events flush synchronously so completion/error/cancel is
 * never hidden behind the throttle window.
 */
export function createAutoShortProgressCoalescer(
  onEvent: (event: AutoShortEvent) => void,
  maxEventsPerSecond = 10
): AutoShortProgressCoalescer {
  const intervalMs = Math.max(1, Math.round(1000 / Math.max(1, maxEventsPerSecond)))
  const pending = new Map<string, AutoShortEvent>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (disposed && pending.size === 0) return
    const events = Array.from(pending.values())
    pending.clear()
    for (const event of events) onEvent(event)
  }

  const schedule = (): void => {
    if (!timer && !disposed) timer = setTimeout(flush, intervalMs)
  }

  return {
    push(event: AutoShortEvent): void {
      if (disposed) return
      if (event.type !== 'item-progress') {
        flush()
        onEvent(event)
        return
      }
      pending.set(event.itemId, event)
      schedule()
    },
    flush,
    dispose(): void {
      if (disposed) return
      flush()
      disposed = true
    }
  }
}
