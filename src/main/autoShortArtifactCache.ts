import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'

/** Immutable artifacts that may be reused by AutoShort stages. */
export type ArtifactStage = 'asr' | 'translation' | 'visual-ocr' | 'sttn' | 'trim-pcm'

export type ArtifactLease = {
  readonly path: string
  release(): void
}

export interface ArtifactCache {
  get(stage: ArtifactStage, key: string, signal: AbortSignal): Promise<ArtifactLease | null>
  put(stage: ArtifactStage, key: string, sourcePath: string, signal: AbortSignal): Promise<void>
  prune(signal: AbortSignal): Promise<{ removedBytes: number }>
  clear(signal?: AbortSignal): Promise<void>
}

export interface AutoShortArtifactCacheOptions {
  /** A dedicated cache root. It must not be the source/output/scratch root. */
  rootDir: string
  quotaBytes?: number
  stageQuotas?: Partial<Record<ArtifactStage, number>>
  ttlMs?: number
  stageTtlMs?: Partial<Record<ArtifactStage, number>>
  now?: () => number
}

interface ArtifactManifest {
  schemaVersion: 1
  stage: ArtifactStage
  key: string
  digest: string
  bytes: number
  createdAt: number
  lastAccessAt: number
}

interface CachedEntry {
  manifest: ArtifactManifest
  entryDir: string
  artifactPath: string
}

const CACHE_SCHEMA_VERSION = 1 as const
const DEFAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000
const STAGES = new Set<ArtifactStage>(['asr', 'translation', 'visual-ocr', 'sttn', 'trim-pcm'])

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Đã hủy thao tác cache.')
  }
}

function waitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  throwIfAborted(signal)
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = (): void => {
      if (settled) return
      settled = true
      reject(signal.reason instanceof Error ? signal.reason : new Error('Đã hủy thao tác cache.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

function validStage(stage: ArtifactStage): void {
  if (!STAGES.has(stage)) throw new Error(`Artifact stage không hợp lệ: ${String(stage)}.`)
}

function validKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(key)) {
    throw new Error('Artifact cache key không hợp lệ hoặc có thể vượt scope đường dẫn.')
  }
}

async function digestFile(path: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal)
      hash.update(chunk as Buffer)
    }
  } finally {
    stream.destroy()
  }
  return hash.digest('hex')
}

function isManifest(value: unknown): value is ArtifactManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  return raw.schemaVersion === CACHE_SCHEMA_VERSION &&
    typeof raw.stage === 'string' && STAGES.has(raw.stage as ArtifactStage) &&
    typeof raw.key === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(raw.key) &&
    typeof raw.digest === 'string' && /^[a-f0-9]{64}$/iu.test(raw.digest) &&
    typeof raw.bytes === 'number' && Number.isSafeInteger(raw.bytes) && raw.bytes > 0 &&
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) &&
    typeof raw.lastAccessAt === 'number' && Number.isFinite(raw.lastAccessAt)
}

/**
 * Content-addressed-ish stage cache. The caller supplies a canonical key; the
 * cache verifies the copied bytes and publishes the manifest last, so a crash
 * cannot make a partial file look reusable.
 */
export class AutoShortArtifactCache implements ArtifactCache {
  private readonly rootDir: string
  private readonly quotaBytes: number
  private readonly stageQuotas: Partial<Record<ArtifactStage, number>>
  private readonly ttlMs: number
  private readonly stageTtlMs: Partial<Record<ArtifactStage, number>>
  private readonly now: () => number
  private readonly inFlight = new Map<string, Promise<void>>()
  private readonly pins = new Map<string, number>()

  constructor(options: AutoShortArtifactCacheOptions) {
    if (!isAbsolute(options.rootDir)) throw new Error('Artifact cache root phải là đường dẫn tuyệt đối.')
    this.rootDir = options.rootDir
    this.quotaBytes = Number.isSafeInteger(options.quotaBytes) && (options.quotaBytes as number) > 0
      ? options.quotaBytes as number
      : DEFAULT_QUOTA_BYTES
    this.stageQuotas = { ...(options.stageQuotas || {}) }
    this.ttlMs = Number.isFinite(options.ttlMs) && (options.ttlMs as number) >= 0 ? options.ttlMs as number : DEFAULT_TTL_MS
    this.stageTtlMs = { ...(options.stageTtlMs || {}) }
    this.now = options.now || (() => Date.now())
  }

  async get(stage: ArtifactStage, key: string, signal: AbortSignal): Promise<ArtifactLease | null> {
    validStage(stage)
    validKey(key)
    throwIfAborted(signal)
    const entry = await this.readValidEntry(stage, key, signal)
    if (!entry) return null

    const id = this.entryId(stage, key)
    this.pins.set(id, (this.pins.get(id) || 0) + 1)
    const lastAccessAt = this.now()
    entry.manifest.lastAccessAt = lastAccessAt
    void this.persistManifest(entry).catch(() => undefined)

    let released = false
    return {
      path: entry.artifactPath,
      release: (): void => {
        if (released) return
        released = true
        const current = this.pins.get(id) || 0
        if (current <= 1) this.pins.delete(id)
        else this.pins.set(id, current - 1)
      }
    }
  }

  async put(stage: ArtifactStage, key: string, sourcePath: string, signal: AbortSignal): Promise<void> {
    validStage(stage)
    validKey(key)
    if (!isAbsolute(sourcePath)) throw new Error('Artifact cache source phải là đường dẫn tuyệt đối.')
    throwIfAborted(signal)
    const id = this.entryId(stage, key)
    let operation = this.inFlight.get(id)
    if (!operation) {
      // Once a writer has started, an individual waiter's abort must not abort
      // the shared copy for another waiter. The caller still stops waiting.
      operation = this.publish(stage, key, sourcePath)
        .finally(() => this.inFlight.delete(id))
      this.inFlight.set(id, operation)
    }
    await waitWithAbort(operation, signal)
  }

  async prune(signal: AbortSignal): Promise<{ removedBytes: number }> {
    throwIfAborted(signal)
    await mkdir(this.rootDir, { recursive: true })
    const entries = await this.listEntries(signal)
    const now = this.now()
    const expired: CachedEntry[] = []
    const byStage = new Map<ArtifactStage, CachedEntry[]>()
    for (const entry of entries) {
      const ttl = this.stageTtlMs[entry.manifest.stage] ?? this.ttlMs
      if (ttl >= 0 && now - entry.manifest.lastAccessAt > ttl && !this.isPinned(entry)) expired.push(entry)
      const list = byStage.get(entry.manifest.stage) || []
      list.push(entry)
      byStage.set(entry.manifest.stage, list)
    }

    let removedBytes = 0
    const removed = new Set<string>()
    const remove = async (entry: CachedEntry): Promise<void> => {
      const id = this.entryId(entry.manifest.stage, entry.manifest.key)
      if (removed.has(id) || this.isPinned(entry)) return
      removed.add(id)
      await rm(entry.entryDir, { recursive: true, force: true }).catch(() => undefined)
      removedBytes += entry.manifest.bytes
    }
    for (const entry of expired) await remove(entry)

    const remaining = entries.filter((entry) => !removed.has(this.entryId(entry.manifest.stage, entry.manifest.key)))
    let total = remaining.reduce((sum, entry) => sum + entry.manifest.bytes, 0)
    const lru = [...remaining].sort((a, b) => a.manifest.lastAccessAt - b.manifest.lastAccessAt)
    for (const entry of lru) {
      throwIfAborted(signal)
      if (total <= this.quotaBytes) break
      if (this.isPinned(entry)) continue
      await remove(entry)
      total -= entry.manifest.bytes
    }

    for (const [stage, quota] of Object.entries(this.stageQuotas) as Array<[ArtifactStage, number]>) {
      if (!Number.isSafeInteger(quota) || quota <= 0) continue
      const stageEntries = (byStage.get(stage) || []).filter((entry) => !removed.has(this.entryId(entry.manifest.stage, entry.manifest.key)))
      let stageTotal = stageEntries.reduce((sum, entry) => sum + entry.manifest.bytes, 0)
      for (const entry of [...stageEntries].sort((a, b) => a.manifest.lastAccessAt - b.manifest.lastAccessAt)) {
        if (stageTotal <= quota) break
        if (this.isPinned(entry)) continue
        await remove(entry)
        stageTotal -= entry.manifest.bytes
      }
    }
    return { removedBytes }
  }

  /** Remove only cache entries; source, output and active scratch paths are untouched. */
  async clear(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    // A clear request must not remove an artifact that an active stage is
    // reading. Pinned entries stay until their leases release; the next
    // explicit prune/clear can remove them.
    const entries = await this.listEntries(signal)
    for (const entry of entries) {
      throwIfAborted(signal)
      if (!this.isPinned(entry)) {
        await rm(entry.entryDir, { recursive: true, force: true }).catch(() => undefined)
      }
    }
    const remaining = await this.listEntries(signal)
    if (remaining.length === 0) await rm(this.rootDir, { recursive: true, force: true }).catch(() => undefined)
  }

  private entryId(stage: ArtifactStage, key: string): string {
    return `${stage}/${key}`
  }

  private entryDir(stage: ArtifactStage, key: string): string {
    validStage(stage)
    validKey(key)
    return join(this.rootDir, stage, key)
  }

  private isPinned(entry: CachedEntry): boolean {
    return (this.pins.get(this.entryId(entry.manifest.stage, entry.manifest.key)) || 0) > 0
  }

  private async publish(stage: ArtifactStage, key: string, sourcePath: string): Promise<void> {
    const sourceStat = await lstat(sourcePath)
    if (sourceStat.isSymbolicLink()) throw new Error('Không chấp nhận source artifact là symbolic link.')
    const sourceInfo = await stat(sourcePath)
    if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error('Source artifact không phải file có dữ liệu.')

    await mkdir(this.rootDir, { recursive: true })
    const entryDir = this.entryDir(stage, key)
    await assertContainedParentDirectory(entryDir, this.rootDir, 'Artifact cache')

    const existing = await this.readValidEntry(stage, key)
    if (existing) return
    await rm(entryDir, { recursive: true, force: true }).catch(() => undefined)
    await mkdir(entryDir, { recursive: true })

    // Prune before copying so an over-quota cache never consumes scratch space.
    await this.prune(new AbortController().signal)
    const currentBytes = await this.totalBytes()
    if (currentBytes + sourceInfo.size > this.quotaBytes) {
      await rm(entryDir, { recursive: true, force: true }).catch(() => undefined)
      return
    }
    const stageQuota = this.stageQuotas[stage]
    if (stageQuota && (await this.stageBytes(stage)) + sourceInfo.size > stageQuota) {
      await rm(entryDir, { recursive: true, force: true }).catch(() => undefined)
      return
    }

    const artifactPath = join(entryDir, 'artifact.bin')
    const tempArtifact = join(entryDir, `.artifact-${randomUUID()}.tmp`)
    const tempManifest = join(entryDir, `.manifest-${randomUUID()}.tmp`)
    try {
      await copyFile(sourcePath, tempArtifact)
      const copiedInfo = await stat(tempArtifact)
      if (!copiedInfo.isFile() || copiedInfo.size <= 0) throw new Error('Artifact copy không hợp lệ.')
      const digest = await digestFile(tempArtifact)
      const now = this.now()
      const manifest: ArtifactManifest = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        stage,
        key,
        digest,
        bytes: copiedInfo.size,
        createdAt: now,
        lastAccessAt: now
      }
      await writeFile(tempManifest, JSON.stringify(manifest, null, 2), 'utf8')
      await rename(tempArtifact, artifactPath)
      await chmod(artifactPath, 0o444).catch(() => undefined)
      // Publish the manifest last. A process crash before this point is a
      // cache miss, never a partially trusted artifact.
      await rename(tempManifest, join(entryDir, 'manifest.json'))
    } finally {
      await rm(tempArtifact, { force: true }).catch(() => undefined)
      await rm(tempManifest, { force: true }).catch(() => undefined)
    }
  }

  private async readValidEntry(stage: ArtifactStage, key: string, signal?: AbortSignal): Promise<CachedEntry | null> {
    throwIfAborted(signal)
    const entryDir = this.entryDir(stage, key)
    const manifestPath = join(entryDir, 'manifest.json')
    const artifactPath = join(entryDir, 'artifact.bin')
    let raw: string
    try {
      const manifestStat = await lstat(manifestPath)
      if (manifestStat.isSymbolicLink()) return null
      raw = await readFile(manifestPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      return null
    }
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      return null
    }
    if (!isManifest(value) || value.stage !== stage || value.key !== key) return null
    let contained: string
    try {
      contained = await assertContainedRegularFile(artifactPath, entryDir, 'Artifact cache')
    } catch {
      return null
    }
    throwIfAborted(signal)
    const info = await stat(contained).catch(() => null)
    if (!info || info.size !== value.bytes || info.size <= 0) return null
    const digest = await digestFile(contained, signal).catch(() => null)
    if (!digest || digest.toLowerCase() !== value.digest.toLowerCase()) return null
    return { manifest: value, entryDir, artifactPath: contained }
  }

  private async persistManifest(entry: CachedEntry): Promise<void> {
    const target = join(entry.entryDir, 'manifest.json')
    const temp = join(entry.entryDir, `.manifest-${randomUUID()}.tmp`)
    await writeFile(temp, JSON.stringify(entry.manifest, null, 2), 'utf8')
    await rename(temp, target).catch(async (error) => {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    })
  }

  private async listEntries(signal?: AbortSignal): Promise<CachedEntry[]> {
    const entries: CachedEntry[] = []
    let stages: string[]
    try {
      stages = await readdir(this.rootDir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return entries
      throw error
    }
    for (const stage of stages) {
      if (!STAGES.has(stage as ArtifactStage)) continue
      let keys: string[]
      try {
        keys = await readdir(join(this.rootDir, stage))
      } catch {
        continue
      }
      for (const key of keys) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(key)) continue
        throwIfAborted(signal)
        const entry = await this.readValidEntry(stage as ArtifactStage, key, signal)
        if (entry) entries.push(entry)
      }
    }
    return entries
  }

  private async totalBytes(): Promise<number> {
    const entries = await this.listEntries()
    return entries.reduce((sum, entry) => sum + entry.manifest.bytes, 0)
  }

  private async stageBytes(stage: ArtifactStage): Promise<number> {
    const entries = await this.listEntries()
    return entries.filter((entry) => entry.manifest.stage === stage).reduce((sum, entry) => sum + entry.manifest.bytes, 0)
  }
}

export function createAutoShortArtifactCache(options: AutoShortArtifactCacheOptions): ArtifactCache {
  return new AutoShortArtifactCache(options)
}
