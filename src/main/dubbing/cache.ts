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

/** Commit a validated cache file without ever exposing a partial destination. */
async function commitCacheAtomically(commitPath: string, targetPath: string): Promise<void> {
  try {
    // POSIX and newer Windows runtimes replace an existing file atomically.
    await rename(commitPath, targetPath)
    return
  } catch (error) {
    // Older Windows implementations reject rename when the destination
    // exists. Move the complete old entry aside, then move the complete new
    // entry into place; restore the old entry if the second move fails.
    if (!['EEXIST', 'EPERM', 'ENOTEMPTY', 'EBUSY'].includes(fsErrorCode(error) || '')) throw error
  }

  const backupPath = `${targetPath}.${randomUUID()}.previous.tmp`
  let movedExisting = false
  try {
    try {
      await rename(targetPath, backupPath)
      movedExisting = true
    } catch (error) {
      if (fsErrorCode(error) !== 'ENOENT') throw error
    }
    try {
      await rename(commitPath, targetPath)
    } catch (error) {
      if (movedExisting) await rename(backupPath, targetPath).catch(() => {})
      throw error
    }
  } finally {
    if (movedExisting) await rm(backupPath, { force: true }).catch(() => {})
  }
}

function waitForAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    const error = new Error('Đã hủy tác vụ')
    error.name = 'AbortError'
    return Promise.reject(error)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      const error = new Error('Đã hủy tác vụ')
      error.name = 'AbortError'
      reject(error)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

/** Filesystem-backed TTS cache with atomic commits and per-key single-flight. */
export class TtsCacheStore {
  private readonly rootDir: string
  private readonly inFlight = new Map<string, InFlightTtsCacheEntry>()

  constructor(rootDir: string) {
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
    if (!options.bypass && await isCompleteCacheFile(targetPath)) {
      return { path: targetPath, fromCache: true }
    }

    let entry = this.inFlight.get(key)
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
        try {
          await mkdir(this.rootDir, { recursive: true })
          const produced = await producer(controller.signal, temporaryPath)
          if (!produced?.path || !(await isCompleteCacheFile(produced.path))) {
            throw new Error('TTS producer không tạo ra file audio hoàn chỉnh.')
          }
          const commitPath = join(this.rootDir, `.${safeCacheSegment(key)}.${randomUUID()}.commit.tmp`)
          try {
            await copyFile(produced.path, commitPath)
            if (!(await isCompleteCacheFile(commitPath))) {
              throw new Error('TTS cache tạm không hợp lệ.')
            }
            await commitCacheAtomically(commitPath, targetPath)
          } finally {
            await rm(commitPath, { force: true }).catch(() => {})
          }
          return { path: targetPath, fromCache: false, voice: produced.voice }
        } finally {
          await rm(temporaryPath, { force: true }).catch(() => {})
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
    try {
      return await waitForAbort(entry.promise, waiterSignal)
    } finally {
      entry.waiters--
      if (entry.waiters === 0 && !entry.settled) entry.controller.abort()
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
