import { statfs } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

/** Rolling STTN workspace reserve. This is headroom, not the size of a video. */
export const STTN_ROLLING_RESERVE_BYTES = Math.round(0.685 * 1024 ** 3)

export interface DiskReservation {
  update(remainingBytesToWrite: number): void
  release(): void
}

export interface AutoShortDiskBudget {
  reserve(volume: string, remainingBytesToWrite: number, signal: AbortSignal): Promise<DiskReservation>
}

export interface AutoShortDiskBudgetOptions {
  safetyHeadroomBytes?: number
  getFreeBytes?: (volume: string) => Promise<number> | number
}

export class AutoShortDiskBudgetError extends Error {
  readonly code: 'ENOSPC' | 'ABORT_ERR'
  readonly volume: string
  readonly requiredBytes: number
  readonly freeBytes?: number

  constructor(
    code: 'ENOSPC' | 'ABORT_ERR',
    volume: string,
    requiredBytes: number,
    freeBytes?: number
  ) {
    const message = code === 'ENOSPC'
      ? `Không đủ dung lượng tạm trên ${volume}: cần thêm ít nhất ${requiredBytes} byte (đã gồm headroom).`
      : 'Đã hủy chờ dung lượng đĩa.'
    super(message)
    this.name = code === 'ENOSPC' ? 'AutoShortDiskBudgetError' : 'AbortError'
    this.code = code
    this.volume = volume
    this.requiredBytes = requiredBytes
    this.freeBytes = freeBytes
  }
}

interface ActiveReservation {
  readonly id: string
  readonly volume: string
  remainingBytes: number
  released: boolean
}

interface PendingReservation {
  readonly id: string
  readonly volume: string
  readonly remainingBytes: number
  readonly signal: AbortSignal
  readonly resolve: (reservation: DiskReservation) => void
  readonly reject: (error: Error) => void
  onAbort?: () => void
}

function normalizeVolume(volume: string): string {
  const value = volume.trim()
  if (!value) throw new Error('Thiếu volume để dự trù dung lượng đĩa.')
  // Windows drive letters are case-insensitive; preserving the rest keeps
  // UNC and POSIX paths usable in tests and on non-Windows development hosts.
  return /^[A-Za-z]:$/.test(value) ? value.toUpperCase() : value
}

function normalizeBytes(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('remainingBytesToWrite phải là số không âm.')
  return Math.floor(value)
}

async function defaultFreeBytes(volume: string): Promise<number> {
  const info = await statfs(volume)
  const available = Number(info.bavail) * Number(info.bsize)
  if (!Number.isFinite(available) || available < 0) throw new Error(`Không thể đọc dung lượng trống trên ${volume}.`)
  return Math.floor(available)
}

/**
 * FIFO per volume ledger for future writes. Callers reserve only bytes that
 * have not been written yet; existing files are intentionally excluded.
 */
export class AutoShortDiskBudgetLedger implements AutoShortDiskBudget {
  private readonly safetyHeadroomBytes: number
  private readonly getFreeBytesFn: (volume: string) => Promise<number>
  private readonly active = new Map<string, Map<string, ActiveReservation>>()
  private pending: PendingReservation[] = []
  private draining = false
  private drainAgain = false

  constructor(options: AutoShortDiskBudgetOptions = {}) {
    const headroom = options.safetyHeadroomBytes ?? STTN_ROLLING_RESERVE_BYTES
    if (!Number.isFinite(headroom) || headroom < 0) throw new RangeError('safetyHeadroomBytes phải là số không âm.')
    this.safetyHeadroomBytes = Math.floor(headroom)
    this.getFreeBytesFn = async (volume) => {
      const free = await (options.getFreeBytes ? options.getFreeBytes(volume) : defaultFreeBytes(volume))
      if (!Number.isFinite(free) || free < 0) throw new Error(`Không thể đọc dung lượng trống trên ${volume}.`)
      return Math.floor(free)
    }
  }

  getReservedBytes(volume: string): number {
    const normalized = normalizeVolume(volume)
    let total = 0
    for (const reservation of this.active.get(normalized)?.values() || []) {
      if (!reservation.released) total += reservation.remainingBytes
    }
    return total
  }

  getSafetyHeadroomBytes(): number {
    return this.safetyHeadroomBytes
  }

  async reserve(volume: string, remainingBytesToWrite: number, signal: AbortSignal): Promise<DiskReservation> {
    const normalizedVolume = normalizeVolume(volume)
    const bytes = normalizeBytes(remainingBytesToWrite)
    if (signal.aborted) throw new AutoShortDiskBudgetError('ABORT_ERR', normalizedVolume, bytes)

    return new Promise<DiskReservation>((resolve, reject) => {
      const pending: PendingReservation = {
        id: randomUUID(),
        volume: normalizedVolume,
        remainingBytes: bytes,
        signal,
        resolve,
        reject
      }
      pending.onAbort = () => {
        this.removePending(pending.id)
        reject(new AutoShortDiskBudgetError('ABORT_ERR', normalizedVolume, bytes))
        this.scheduleDrain()
      }
      signal.addEventListener('abort', pending.onAbort, { once: true })
      if (signal.aborted) {
        pending.onAbort()
        return
      }
      this.pending.push(pending)
      this.scheduleDrain()
    })
  }

  private removePending(id: string): void {
    const index = this.pending.findIndex((entry) => entry.id === id)
    if (index !== -1) this.pending.splice(index, 1)
  }

  private scheduleDrain(): void {
    if (this.draining) {
      this.drainAgain = true
      return
    }
    this.draining = true
    void this.drain().finally(() => {
      this.draining = false
      if (this.drainAgain) {
        this.drainAgain = false
        this.scheduleDrain()
      }
    }).catch(() => {
      // Individual pending entries are rejected by drain; never leak a
      // rejected promise from the scheduler itself.
    })
  }

  private async drain(): Promise<void> {
    const blockedVolumes = new Set<string>()
    let progressed = true
    while (progressed && this.pending.length > 0) {
      progressed = false
      for (let index = 0; index < this.pending.length; index++) {
        const entry = this.pending[index]
        if (entry.signal.aborted) {
          this.pending.splice(index, 1)
          index--
          continue
        }
        if (blockedVolumes.has(entry.volume)) continue

        let freeBytes: number
        try {
          freeBytes = await this.getFreeBytesFn(entry.volume)
        } catch (error) {
          this.pending.splice(index, 1)
          if (entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort)
          entry.reject(error instanceof Error ? error : new Error(String(error)))
          index--
          progressed = true
          continue
        }

        // The free-space probe yields to abort handlers and other waiters.
        // Re-find the entry by its stable ID before mutating the queue; an
        // earlier cancellation may have removed it or shifted another waiter
        // into the old index.
        const currentIndex = this.pending.findIndex((candidate) => candidate.id === entry.id)
        if (currentIndex === -1 || entry.signal.aborted) {
          index--
          continue
        }
        if (currentIndex !== index) {
          index = currentIndex - 1
          continue
        }

        const otherReserved = this.getReservedBytes(entry.volume)
        const requiredBytes = entry.remainingBytes + this.safetyHeadroomBytes
        if (freeBytes - otherReserved >= requiredBytes) {
          this.pending.splice(index, 1)
          if (entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort)
          const active: ActiveReservation = {
            id: entry.id,
            volume: entry.volume,
            remainingBytes: entry.remainingBytes,
            released: false
          }
          let volumeReservations = this.active.get(entry.volume)
          if (!volumeReservations) {
            volumeReservations = new Map()
            this.active.set(entry.volume, volumeReservations)
          }
          volumeReservations.set(active.id, active)
          entry.resolve(this.createReservation(active))
          progressed = true
          index--
          continue
        }

        // If no active reservation is consuming the volume, this request can
        // never fit without an external free-space change; report ENOSPC
        // immediately instead of leaving a permanently pending queue item.
        if (otherReserved === 0 && freeBytes < requiredBytes) {
          this.pending.splice(index, 1)
          if (entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort)
          entry.reject(new AutoShortDiskBudgetError('ENOSPC', entry.volume, requiredBytes, freeBytes))
          index--
          progressed = true
          continue
        }
        blockedVolumes.add(entry.volume)
      }
    }
  }

  private createReservation(active: ActiveReservation): DiskReservation {
    return {
      update: (remainingBytesToWrite: number) => {
        if (active.released) return
        active.remainingBytes = normalizeBytes(remainingBytesToWrite)
        this.scheduleDrain()
      },
      release: () => {
        if (active.released) return
        active.released = true
        const volumeReservations = this.active.get(active.volume)
        volumeReservations?.delete(active.id)
        if (volumeReservations && volumeReservations.size === 0) this.active.delete(active.volume)
        this.scheduleDrain()
      }
    }
  }
}

let defaultLedger: AutoShortDiskBudgetLedger | null = null

export function getGlobalAutoShortDiskBudget(): AutoShortDiskBudgetLedger {
  if (!defaultLedger) defaultLedger = new AutoShortDiskBudgetLedger()
  return defaultLedger
}

export function setGlobalAutoShortDiskBudget(ledger: AutoShortDiskBudgetLedger | null): void {
  defaultLedger = ledger
}
