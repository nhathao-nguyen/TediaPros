import { existsSync, renameSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

export const DEFAULT_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_LOG_MAX_BYTES = 100 * 1024 * 1024

function normalizedPath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function assertDirectChild(rootDir: string, filePath: string): void {
  if (normalizedPath(dirname(filePath)) !== normalizedPath(rootDir)) {
    throw new Error(`Log path nằm ngoài thư mục session: ${basename(filePath)}`)
  }
}

export function archiveSessionLogSync(input: {
  rootDir: string
  activePath: string
  sessionId: string
}): string {
  const rootDir = resolve(input.rootDir)
  const activePath = resolve(input.activePath)
  assertDirectChild(rootDir, activePath)
  const safeSessionId = input.sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
  if (!safeSessionId) throw new Error('Session log ID không hợp lệ.')
  let archivePath = join(rootDir, `tblao-session-${safeSessionId}.log`)
  let suffix = 2
  while (existsSync(archivePath)) {
    archivePath = join(rootDir, `tblao-session-${safeSessionId}-${suffix}.log`)
    suffix += 1
  }
  if (existsSync(activePath)) renameSync(activePath, archivePath)
  return archivePath
}

export async function pruneSessionLogs(input: {
  rootDir: string
  activeFiles: readonly string[]
  nowMs: number
  maxAgeMs: number
  maxBytes: number
}): Promise<{ removedFiles: number; removedBytes: number }> {
  const rootDir = resolve(input.rootDir)
  const activeFiles = new Set(input.activeFiles.map(normalizedPath))
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => [])
  const files: Array<{ path: string; bytes: number; mtimeMs: number; active: boolean }> = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.log')) continue
    const path = join(rootDir, entry.name)
    const metadata = await stat(path).catch(() => null)
    if (!metadata) continue
    files.push({ path, bytes: metadata.size, mtimeMs: metadata.mtimeMs, active: activeFiles.has(normalizedPath(path)) })
  }

  let totalBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  let removedFiles = 0
  let removedBytes = 0
  const removeFile = async (file: typeof files[number]): Promise<void> => {
    await rm(file.path, { force: true })
    totalBytes -= file.bytes
    removedFiles += 1
    removedBytes += file.bytes
  }

  const archives = files.filter(file => !file.active).sort((left, right) => left.mtimeMs - right.mtimeMs)
  const removed = new Set<string>()
  for (const file of archives) {
    if (input.nowMs - file.mtimeMs <= input.maxAgeMs) continue
    await removeFile(file)
    removed.add(file.path)
  }
  for (const file of archives) {
    if (totalBytes <= input.maxBytes) break
    if (removed.has(file.path)) continue
    await removeFile(file)
  }

  return { removedFiles, removedBytes }
}
