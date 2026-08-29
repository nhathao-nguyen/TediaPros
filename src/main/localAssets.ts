import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, relative } from 'node:path'
import { runtimeRoot, runtimeSearchRoots, RuntimeEngineKind } from './runtimeResolver'

export interface LocalAssetManifestEntry {
  path: string
  sha256: string
  bytes?: number
  version?: string
  protocol?: string
}

export interface LocalAssetManifest {
  assetVersion: string
  platform: string
  engines: Record<string, LocalAssetManifestEntry>
}

export type LocalAssetKind = 'ocr' | 'video2x' | 'douyin' | 'ffmpeg' | 'whisper-cpp'

function unique(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Returns candidate roots for local asset development/staging imports.
 * In production, packages do NOT bundle engines.
 */
export function devLocalAssetRoots(): string[] {
  const roots: string[] = []
  const devEnv = process.env.TEDIAPROS_RUNTIME_DIR?.trim()
  if (devEnv) roots.push(devEnv)
  return unique(roots)
}

/** Backward compatibility alias */
export function packagedLocalAssetRoots(): string[] {
  return devLocalAssetRoots()
}

export function managedLocalAssetRoots(): string[] {
  return unique([
    runtimeRoot(),
    join(app.getPath('userData'), 'bin'),
    join(app.getPath('appData'), 'tediapros', 'bin')
  ])
}

function manifestPath(root: string): string {
  return join(root, 'manifest.json')
}

export async function readLocalAssetManifest(root: string): Promise<LocalAssetManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(manifestPath(root), 'utf8')) as Partial<LocalAssetManifest>
    if (typeof parsed.assetVersion !== 'string' || typeof parsed.platform !== 'string' || !parsed.engines) return null
    return parsed as LocalAssetManifest
  } catch {
    return null
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export async function verifyLocalAssetFile(
  root: string,
  filePath: string,
  kind: string
): Promise<{ ok: boolean; message?: string; entry?: LocalAssetManifestEntry }> {
  const manifest = await readLocalAssetManifest(root)
  if (!manifest) return { ok: false, message: 'Thiếu manifest asset local.' }
  const entry = manifest.engines[kind]
  if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
    return { ok: false, message: `Manifest không có hash hợp lệ cho asset ${kind}.` }
  }
  const expected = join(root, entry.path)
  if (expected.toLowerCase() !== filePath.toLowerCase()) {
    return { ok: false, message: `Đường dẫn asset ${kind} không khớp manifest.` }
  }
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return { ok: false, message: `Asset ${kind} không phải file.` }
    if (entry.bytes != null && info.size !== entry.bytes) return { ok: false, message: `Kích thước asset ${kind} không khớp.` }
    const actual = await sha256File(filePath)
    if (actual.toLowerCase() !== entry.sha256.toLowerCase()) return { ok: false, message: `SHA-256 asset ${kind} không khớp.` }
    return { ok: true, entry }
  } catch {
    return { ok: false, message: `Không đọc được asset ${kind}.` }
  }
}

export async function findFile(root: string, names: string[]): Promise<string | null> {
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const candidate = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, names)
      if (nested) return nested
    } else if (wanted.has(entry.name.toLowerCase())) {
      return candidate
    }
  }
  return null
}

export async function copyDirectory(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) await copyDirectory(from, to)
    else await copyFile(from, to)
  }
}

export async function replaceDirectoryAtomic(candidate: string, destination: string): Promise<void> {
  const backup = `${destination}.previous`
  await rm(backup, { recursive: true, force: true }).catch(() => {})
  if (await localFileExists(destination)) {
    await rename(destination, backup)
  }
  try {
    await rename(candidate, destination)
    await rm(backup, { recursive: true, force: true }).catch(() => {})
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => {})
    if (await localFileExists(backup)) {
      await rename(backup, destination).catch(() => {})
    }
    throw error
  }
}

export async function writeLocalAssetManifest(root: string, manifest: LocalAssetManifest): Promise<void> {
  await mkdir(root, { recursive: true })
  const partial = `${manifestPath(root)}.partial`
  await writeFile(partial, JSON.stringify(manifest, null, 2), 'utf8')
  await rm(manifestPath(root), { force: true }).catch(() => {})
  await rename(partial, manifestPath(root))
}

export function relativeAssetPath(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/')
}

export async function localFileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
