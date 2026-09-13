import { createHash } from 'node:crypto'
import { copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const DUBBING_TTS_CACHE_SCHEMA_VERSION = 2

export interface TtsCacheKeyInput {
  schemaVersion?: number
  endpoint?: string
  finalSpokenText: string
  language: string
  model: string
  voice?: string | null
  serverSpeed?: number | null
  options?: unknown
  referenceAudio?: unknown
  referenceTranscript?: string | null
  /** Immutable reference bytes; path/mtime alone are insufficient. */
  contentHash?: string | null
  /** Server/model revision when the capability endpoint exposes one. */
  modelRevision?: string | null
}

function stableValue(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`
}

function normalizedCacheInput(input: TtsCacheKeyInput): Record<string, unknown> {
  return {
    schemaVersion: input.schemaVersion ?? DUBBING_TTS_CACHE_SCHEMA_VERSION,
    endpoint: input.endpoint?.trim() || '',
    finalSpokenText: input.finalSpokenText,
    language: input.language.trim().toLowerCase(),
    model: input.model.trim(),
    voice: input.voice?.trim() || null,
    serverSpeed: input.serverSpeed == null ? null : Number(input.serverSpeed),
    options: input.options ?? {},
    referenceAudio: input.referenceAudio ?? null,
    referenceTranscript: input.referenceTranscript ?? null,
    contentHash: input.contentHash ?? null,
    modelRevision: input.modelRevision ?? null
  }
}

export function buildTtsCacheKey(input: TtsCacheKeyInput): string {
  return createHash('sha256')
    .update(stableValue(normalizedCacheInput(input)))
    .digest('hex')
}

export function buildTtsCacheFingerprint(input: TtsCacheKeyInput): string {
  return `tts-${DUBBING_TTS_CACHE_SCHEMA_VERSION}-${buildTtsCacheKey(input)}`
}

export interface TtsCacheValue {
  path: string
  fromCache: boolean
  voice?: string
}

export type TtsCacheProducer = (
  signal: AbortSignal,
  temporaryPath: string
) => Promise<{ path: string; voice?: string }>

interface InFlightTtsCacheEntry {
  promise: Promise<TtsCacheValue>
  controller: AbortController
  waiters: number
  settled: boolean
}

function safeCacheSegment(key: string): string {
  const safe = key.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe || `cache-${randomUUID()}`
}

async function readAudioHeader(path: string): Promise<Buffer | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const header = Buffer.alloc(16)
    const result = await handle.read(header, 0, header.length, 0)
    return header.subarray(0, result.bytesRead)
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

function isKnownAudioContainer(header: Buffer, size: number): boolean {
  if (size <= 0 || header.length < 4) return false
  const fourcc = header.toString('ascii', 0, 4)
  if ((fourcc === 'RIFF' || fourcc === 'RIFX') && header.length >= 12) {
    return header.toString('ascii', 8, 12) === 'WAVE' && size >= 44
  }
  if (fourcc === 'FORM' && header.length >= 12) {
    const kind = header.toString('ascii', 8, 12)
    return kind === 'AIFF' || kind === 'AIFC'
  }
  if (fourcc === 'OggS' || fourcc === 'fLaC' || fourcc === 'ID3') return true
  if (header.length >= 4 && header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) return true
  if (header.length >= 8 && header.toString('ascii', 4, 8) === 'ftyp') return true
  // MPEG audio frames may have no ID3 tag. This is intentionally only a
  // container signature check; codec/duration probing remains FFmpeg's job.
  return header[0] === 0xff && (header[1] & 0xe0) === 0xe0
}

async function isCompleteCacheFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size <= 0) return false
    const header = await readAudioHeader(path)
    return header ? isKnownAudioContainer(header, info.size) : false
  } catch {
    return false
  }
}

function fsErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

interface CacheCommitTransaction {
  rollback(): Promise<void>
  finalize(): void
}

/** Commit a validated cache file while retaining the previous entry until cancellation can no longer win. */
async function commitCacheAtomically(commitPath: string, targetPath: string): Promise<CacheCommitTransaction> {
  const backupPath = `${targetPath}.${randomUUID()}.previous.tmp`
  let movedExisting = false
  try {
    try {
      await rename(targetPath, backupPath)
      movedExisting = true
    } catch (error) {
      if (fsErrorCode(error) !== 'ENOENT') throw error
    }
    await rename(commitPath, targetPath)
  } catch (error) {
    if (movedExisting) await rename(backupPath, targetPath).catch(() => {})
    throw error
  }

  let closed = false
  return {
    async rollback(): Promise<void> {
      if (closed) return
      closed = true
      await rm(targetPath, { force: true }).catch(() => {})
      if (movedExisting) await rename(backupPath, targetPath)
    },
    finalize(): void {
      if (closed) return
      closed = true
      if (movedExisting) void rm(backupPath, { force: true }).catch(() => {})
    }
  }
}

function cacheAbortError(): Error {
  const error = new Error('Đã hủy tác vụ')
  error.name = 'AbortError'
  return error
}

function waitForAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  releaseOnAbort?: () => void | Promise<void>
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.resolve(releaseOnAbort?.()).then(
      () => Promise.reject(cacheAbortError()),
      () => Promise.reject(cacheAbortError())
    )
  }
  return new Promise<T>((resolve, reject) => {
    let aborted = false
    const onAbort = (): void => {
      aborted = true
      signal.removeEventListener('abort', onAbort)
      Promise.resolve(releaseOnAbort?.()).then(
        () => reject(cacheAbortError()),
        () => reject(cacheAbortError())
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        if (aborted) return
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        if (aborted) return
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function throwIfCacheAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Đã hủy tác vụ')
  error.name = 'AbortError'
  throw error
}

/** Filesystem-backed TTS cache with atomic commits and per-key single-flight. */
export class TtsCacheStore {
  private readonly rootDir: string
  private readonly inFlight = new Map<string, InFlightTtsCacheEntry>()
  private readonly pendingWaiters = new Map<string, number>()

  constructor(rootDir: string, private readonly hooks: { afterCommit?: () => void | Promise<void> } = {}) {
    this.rootDir = rootDir
  }

  cachePath(key: string): string {
    return join(this.rootDir, `${safeCacheSegment(key)}.wav`)
  }

  async getOrCreate(
    key: string,
    waiterSignal: AbortSignal | undefined,
    producer: TtsCacheProducer,
    options: { bypass?: boolean } = {}
  ): Promise<TtsCacheValue> {
    const targetPath = this.cachePath(key)
    this.pendingWaiters.set(key, (this.pendingWaiters.get(key) || 0) + 1)

    let entry: InFlightTtsCacheEntry | undefined
    try {
      if (!options.bypass && await isCompleteCacheFile(targetPath)) {
        return { path: targetPath, fromCache: true }
      }

      entry = this.inFlight.get(key)
      if (!entry) {
        const controller = new AbortController()
        const temporaryPath = join(this.rootDir, `.${safeCacheSegment(key)}.${randomUUID()}.producer.tmp`)
        const created: InFlightTtsCacheEntry = {
          promise: Promise.resolve({ path: targetPath, fromCache: false }),
          controller,
          waiters: 0,
          settled: false
        }
        created.promise = (async (): Promise<TtsCacheValue> => {
          let transaction: CacheCommitTransaction | undefined
          let voice: string | undefined
          try {
            try {
              await mkdir(this.rootDir, { recursive: true })
              const produced = await producer(controller.signal, temporaryPath)
              voice = produced.voice
              throwIfCacheAborted(controller.signal)
              if (!produced?.path || !(await isCompleteCacheFile(produced.path))) {
                throw new Error('TTS producer không tạo ra file audio hoàn chỉnh.')
              }
              const commitPath = join(this.rootDir, `.${safeCacheSegment(key)}.${randomUUID()}.commit.tmp`)
              try {
                await copyFile(produced.path, commitPath)
                throwIfCacheAborted(controller.signal)
                if (!(await isCompleteCacheFile(commitPath))) {
                  throw new Error('TTS cache tạm không hợp lệ.')
                }
                throwIfCacheAborted(controller.signal)
                transaction = await commitCacheAtomically(commitPath, targetPath)
                await this.hooks.afterCommit?.()
                throwIfCacheAborted(controller.signal)
              } finally {
                await rm(commitPath, { force: true }).catch(() => {})
              }
            } finally {
              await rm(temporaryPath, { force: true }).catch(() => {})
            }
            throwIfCacheAborted(controller.signal)
            transaction?.finalize()
            return { path: targetPath, fromCache: false, voice }
          } catch (error) {
            await transaction?.rollback()
            throw error
          }
        })()
        created.promise.finally(() => {
          created.settled = true
          if (this.inFlight.get(key) === created) this.inFlight.delete(key)
        }).catch(() => {})
        this.inFlight.set(key, created)
        entry = created
      }

      entry.waiters++
    } finally {
      const pending = (this.pendingWaiters.get(key) || 1) - 1
      if (pending > 0) this.pendingWaiters.set(key, pending)
      else this.pendingWaiters.delete(key)
      const current = this.inFlight.get(key)
      if (pending === 0 && current?.waiters === 0 && !current.settled) current.controller.abort()
    }

    let waiterReleased = false
    const releaseWaiter = (): Promise<void> | undefined => {
      if (waiterReleased) return undefined
      waiterReleased = true
      entry!.waiters--
      if (entry!.waiters !== 0 || entry!.settled || (this.pendingWaiters.get(key) || 0) !== 0) return undefined
      entry!.controller.abort()
      return entry!.promise.then(() => undefined, () => undefined)
    }

    try {
      return await waitForAbort(entry!.promise, waiterSignal, releaseWaiter)
    } finally {
      await releaseWaiter()
    }
  }
}

const globalTtsCacheStores = new Map<string, TtsCacheStore>()

export function getTtsCacheStore(rootDir: string): TtsCacheStore {
  const existing = globalTtsCacheStores.get(rootDir)
  if (existing) return existing
  const created = new TtsCacheStore(rootDir)
  globalTtsCacheStores.set(rootDir, created)
  return created
}
