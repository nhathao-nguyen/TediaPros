export type BranchOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown }

export interface AutoShortItemScope {
  readonly signal: AbortSignal
  readonly firstError?: unknown
  start<T>(action: (signal: AbortSignal) => Promise<T>): Promise<BranchOutcome<T>>
  abort(reason?: unknown): void
  drain(): Promise<void>
  dispose(): void
}

export function createAutoShortItemScope(parent?: AbortSignal): AutoShortItemScope {
  const controller = new AbortController()
  let isDraining = false
  let isDisposed = false
  let firstError: unknown = undefined
  const pending = new Set<Promise<unknown>>()

  const onParentAbort = (): void => {
    if (!controller.signal.aborted) {
      abort(parent?.reason || new Error('Parent task aborted'))
    }
  }

  if (parent) {
    if (parent.aborted) {
      onParentAbort()
    } else {
      parent.addEventListener('abort', onParentAbort, { once: true })
    }
  }

  function abort(reason?: unknown): void {
    if (firstError === undefined && reason !== undefined) {
      firstError = reason
    }
    if (!controller.signal.aborted) {
      controller.abort(reason)
    }
  }

  function start<T>(action: (signal: AbortSignal) => Promise<T>): Promise<BranchOutcome<T>> {
    if (isDisposed || isDraining) {
      const err = new Error('Cannot start action on a closed or draining scope')
      if (firstError === undefined) firstError = err
      return Promise.resolve({ ok: false, error: err })
    }

    const execution = (async (): Promise<BranchOutcome<T>> => {
      try {
        if (controller.signal.aborted) {
          throw controller.signal.reason || new Error('Scope aborted')
        }
        const value = await action(controller.signal)
        return { ok: true, value }
      } catch (error) {
        if (firstError === undefined) {
          firstError = error
        }
        abort(error)
        return { ok: false, error }
      }
    })()

    pending.add(execution)
    execution.finally(() => {
      pending.delete(execution)
    })

    return execution
  }

  async function drain(): Promise<void> {
    isDraining = true
    while (pending.size > 0) {
      await Promise.allSettled(Array.from(pending))
    }
  }

  function dispose(): void {
    isDisposed = true
    isDraining = true
    if (parent) {
      parent.removeEventListener('abort', onParentAbort)
    }
    if (!controller.signal.aborted) {
      controller.abort()
    }
    pending.clear()
  }

  return {
    get signal() {
      return controller.signal
    },
    get firstError() {
      return firstError
    },
    start,
    abort,
    drain,
    dispose
  }
}
