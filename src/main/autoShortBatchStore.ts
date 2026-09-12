import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { isSafeBatchId, validateBatchSnapshot, type BatchSnapshot } from '../shared/autoShortBatchJournal'

interface SnapshotEnvelope {
  schemaVersion: 1
  checksum: string
  snapshot: BatchSnapshot
}

export interface AutoShortBatchStore {
  load(jobId: string): Promise<BatchSnapshot | null>
  loadLatest(): Promise<BatchSnapshot | null>
  save(snapshot: BatchSnapshot, expectedRevision: number | null): Promise<void>
}

function checksum(snapshot: BatchSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function parseEnvelope(content: string): BatchSnapshot {
  const raw = JSON.parse(content) as Partial<SnapshotEnvelope>
  if (raw.schemaVersion !== 1 || typeof raw.checksum !== 'string' || raw.checksum.length !== 64) {
    throw new Error('Batch snapshot envelope schema không hợp lệ.')
  }
  const snapshot = validateBatchSnapshot(raw.snapshot)
  if (checksum(snapshot) !== raw.checksum) throw new Error('Batch snapshot checksum không hợp lệ.')
  return snapshot
}

function contained(candidate: string, root: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function createAutoShortBatchStore(rootDir: string): AutoShortBatchStore {
  const root = resolve(rootDir)
  let writeChain = Promise.resolve()

  async function jobDirectory(jobId: string, create: boolean): Promise<string> {
    if (!isSafeBatchId(jobId)) throw new Error('Batch job ID không hợp lệ.')
    await mkdir(root, { recursive: true })
    const rootReal = await realpath(root)
    const candidate = join(rootReal, jobId)
    try {
      const info = await lstat(candidate)
      if (info.isSymbolicLink()) throw new Error('Batch job directory không được là symbolic link hoặc reparse point.')
      if (!info.isDirectory()) throw new Error('Batch job path không phải thư mục.')
      const candidateReal = await realpath(candidate)
      if (!contained(candidateReal, rootReal)) throw new Error('Batch job directory thoát khỏi storage root.')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      if (create) await mkdir(candidate, { recursive: false })
    }
    return candidate
  }

  async function loadFile(path: string): Promise<BatchSnapshot | null> {
    try {
      return parseEnvelope(await readFile(path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async function load(jobId: string): Promise<BatchSnapshot | null> {
    const dir = await jobDirectory(jobId, false)
    let currentError: unknown
    try {
      const current = await loadFile(join(dir, 'snapshot.json'))
      if (current) return current
    } catch (error) {
      currentError = error
    }
    try {
      const backup = await loadFile(join(dir, 'snapshot.backup.json'))
      if (backup) return backup
    } catch (backupError) {
      throw new AggregateError([currentError, backupError].filter(Boolean), 'Không đọc được batch snapshot hoặc backup.')
    }
    if (currentError) throw currentError
    return null
  }

  async function saveNow(snapshotInput: BatchSnapshot, expectedRevision: number | null): Promise<void> {
    const snapshot = validateBatchSnapshot(snapshotInput)
    const dir = await jobDirectory(snapshot.jobId, true)
    const current = await load(snapshot.jobId)
    const currentRevision = current?.revision ?? null
    if (currentRevision !== expectedRevision) {
      throw new Error(`Batch revision không khớp: expected ${expectedRevision ?? 'none'}, actual ${currentRevision ?? 'none'}.`)
    }
    if (snapshot.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)) {
      throw new Error('Batch revision mới không hợp lệ.')
    }
    const envelope: SnapshotEnvelope = { schemaVersion: 1, checksum: checksum(snapshot), snapshot }
    const currentPath = join(dir, 'snapshot.json')
    const backupPath = join(dir, 'snapshot.backup.json')
    const temporaryPath = join(dir, `snapshot.${process.pid}.${Date.now()}.tmp`)
    await writeFile(temporaryPath, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', flag: 'wx' })
    try {
      await rm(backupPath, { force: true })
      try {
        await rename(currentPath, backupPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await rename(temporaryPath, currentPath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }

  return {
    load,
    async loadLatest() {
      await mkdir(root, { recursive: true })
      const entries = await readdir(root, { withFileTypes: true })
      let latest: BatchSnapshot | null = null
      for (const entry of entries) {
        if (!entry.isDirectory() || !isSafeBatchId(entry.name)) continue
        const candidate = await load(entry.name).catch(() => null)
        if (candidate && (!latest || Date.parse(candidate.updatedAtUtc) > Date.parse(latest.updatedAtUtc))) latest = candidate
      }
      return latest
    },
    save(snapshot, expectedRevision) {
      const operation = writeChain.then(() => saveNow(snapshot, expectedRevision))
      writeChain = operation.catch(() => undefined)
      return operation
    }
  }
}
