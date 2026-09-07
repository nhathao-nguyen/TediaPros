import { randomUUID } from 'node:crypto'

export type AutoShortResourceType =
  | 'local-gpu-heavy'
  | 'local-cpu-heavy'
  | 'local-audio-dsp'
  | 'server-inference'
  | 'external-title'

export interface ResourceLease {
  readonly id: string
  readonly resources: readonly AutoShortResourceType[]
  readonly waitMs?: number
  release(): void
}

interface QueuedRequest {
  readonly id: string
  readonly resources: AutoShortResourceType[]
  readonly resolve: (lease: ResourceLease) => void
  readonly reject: (error: Error) => void
  readonly signal?: AbortSignal
  readonly createdAt: number
}

export class AutoShortResourceManager {
  private capacities: Map<AutoShortResourceType, number>
  private allocated: Map<AutoShortResourceType, number>
  private queue: QueuedRequest[] = []

  constructor(customCapacities: Partial<Record<AutoShortResourceType, number>> = {}) {
    const parseCap = (val: unknown, fallback = 1): number => {
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) return Math.floor(val)
      return fallback
    }
    this.capacities = new Map<AutoShortResourceType, number>([
      ['local-gpu-heavy', parseCap(customCapacities['local-gpu-heavy'], 1)],
      ['local-cpu-heavy', parseCap(customCapacities['local-cpu-heavy'], 1)],
      ['local-audio-dsp', parseCap(customCapacities['local-audio-dsp'], 1)],
      ['server-inference', parseCap(customCapacities['server-inference'], 1)],
      ['external-title', parseCap(customCapacities['external-title'], 1)]
    ])
    this.allocated = new Map<AutoShortResourceType, number>()
  }

  getCapacity(resource: AutoShortResourceType): number {
    return this.capacities.get(resource) ?? 1
  }

  getAllocated(resource: AutoShortResourceType): number {
    return this.allocated.get(resource) ?? 0
  }

  async acquire(
    resources: AutoShortResourceType[],
    signal?: AbortSignal
  ): Promise<ResourceLease> {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error('Đã hủy yêu cầu tài nguyên')
    }

    // Deduplicate and canonicalize order
    const requested = Array.from(new Set(resources)).sort()
    for (const r of requested) {
      const cap = this.capacities.get(r) ?? 0
      if (cap <= 0) {
        throw new Error(`Tài nguyên không khả dụng: ${r} (capacity = ${cap})`)
      }
    }

    // Try immediate allocation if queue is empty
    if (this.queue.length === 0 && this.canAllocate(requested)) {
      return this.allocate(requested, 0)
    }

    // Otherwise, enqueue and wait
    return new Promise<ResourceLease>((resolve, reject) => {
      const id = randomUUID()
      let onAbort: (() => void) | undefined

      if (signal) {
        onAbort = () => {
          this.removeFromQueue(id)
          reject(signal.reason instanceof Error ? signal.reason : new Error('Đã hủy yêu cầu tài nguyên'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      const request: QueuedRequest = {
        id,
        resources: requested,
        resolve: (lease) => {
          if (signal && onAbort) signal.removeEventListener('abort', onAbort)
          resolve(lease)
        },
        reject: (err) => {
          if (signal && onAbort) signal.removeEventListener('abort', onAbort)
          reject(err)
        },
        signal,
        createdAt: performance.now()
      }

      this.queue.push(request)
      this.drainQueue()
    })
  }

  async withLease<T>(
    resources: AutoShortResourceType[],
    signal: AbortSignal | undefined,
    action: (lease: ResourceLease) => Promise<T>
  ): Promise<T> {
    const lease = await this.acquire(resources, signal)
    // Cancellation is the ownership fence for a resource. Release the slot
    // immediately when an uncooperative provider ignores AbortSignal; the
    // action still settles in its own promise, while later work is no longer
    // deadlocked behind a leaked lease.
    const releaseOnAbort = (): void => lease.release()
    signal?.addEventListener('abort', releaseOnAbort, { once: true })
    try {
      return await action(lease)
    } finally {
      signal?.removeEventListener('abort', releaseOnAbort)
      lease.release()
    }
  }

  private canAllocate(resources: AutoShortResourceType[]): boolean {
    for (const r of resources) {
      const cap = this.capacities.get(r) ?? 0
      const curr = this.allocated.get(r) ?? 0
      if (curr >= cap) return false
    }
    return true
  }

  private allocate(resources: AutoShortResourceType[], waitMs = 0): ResourceLease {
    for (const r of resources) {
      this.allocated.set(r, (this.allocated.get(r) ?? 0) + 1)
    }

    let released = false
    const leaseId = randomUUID()

    const release = (): void => {
      if (released) return
      released = true
      for (const r of resources) {
        const curr = this.allocated.get(r) ?? 0
        if (curr > 0) {
          this.allocated.set(r, curr - 1)
        }
      }
      this.drainQueue()
    }

    return {
      id: leaseId,
      resources: Object.freeze([...resources]),
      waitMs,
      release
    }
  }

  private removeFromQueue(id: string): void {
    const idx = this.queue.findIndex((q) => q.id === id)
    if (idx !== -1) {
      this.queue.splice(idx, 1)
      this.drainQueue()
    }
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0]
      if (head.signal?.aborted) {
        this.queue.shift()
        continue
      }

      if (!this.canAllocate(head.resources)) {
        // Strict FIFO: Head cannot be satisfied yet. Stop to prevent starvation.
        break
      }

      this.queue.shift()
      const waitMs = Math.round(performance.now() - head.createdAt)
      const lease = this.allocate(head.resources, waitMs)
      head.resolve(lease)
    }
  }
}

let defaultGlobalResourceManager: AutoShortResourceManager | null = null

export function getGlobalResourceManager(): AutoShortResourceManager {
  if (!defaultGlobalResourceManager) {
    defaultGlobalResourceManager = new AutoShortResourceManager()
  }
  return defaultGlobalResourceManager
}

export function setGlobalResourceManager(manager: AutoShortResourceManager | null): void {
  defaultGlobalResourceManager = manager
}
