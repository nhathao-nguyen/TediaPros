import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { WHISPER_PROTOCOL } from './engineProtocol'
import { isWhisperModelId, WHISPER_MODEL_CATALOG, type WhisperModelId } from './modelCatalog'

export interface WhisperModelManifest {
  id: WhisperModelId
  backend: 'whisper.cpp'
  format: 'ggml'
  filename: string
  bytes: number
  sha256: string
  languageFamily: 'multilingual'
  engineProtocol: typeof WHISPER_PROTOCOL
}

export interface LocalWhisperModel {
  id: WhisperModelId
  root: string
  modelDir: string
  modelPath: string
  manifestPath: string
  manifest: WhisperModelManifest
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

function isManifest(value: unknown, id: WhisperModelId): value is WhisperModelManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return item.id === id && item.backend === 'whisper.cpp' && item.format === 'ggml' &&
    item.languageFamily === 'multilingual' && item.engineProtocol === WHISPER_PROTOCOL &&
    typeof item.filename === 'string' && item.filename === WHISPER_MODEL_CATALOG[id].filename &&
    typeof item.bytes === 'number' && Number.isSafeInteger(item.bytes) && item.bytes > 0 &&
    typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(item.sha256)
}

export async function isCompleteWhisperModel(modelDir: string, model: string): Promise<boolean> {
  if (!isWhisperModelId(model)) return false
  const manifestPath = join(modelDir, 'manifest.json')
  if (!(await fileExists(manifestPath))) return false
  if (await fileExists(`${manifestPath}.partial`)) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
  } catch {
    return false
  }
  if (!isManifest(parsed, model)) return false
  const modelPath = join(modelDir, parsed.filename)
  if (await fileExists(`${modelPath}.partial`)) return false
  const info = await stat(modelPath).catch(() => null)
  if (!info?.isFile() || info.size !== parsed.bytes) return false
  return (await sha256File(modelPath)) === parsed.sha256.toLowerCase()
}

export async function findLocalWhisperModel(
  model: string,
  roots: string[]
): Promise<LocalWhisperModel | null> {
  if (!isWhisperModelId(model)) return null
  for (const root of roots) {
    const modelDir = join(root, model)
    if (!(await isCompleteWhisperModel(modelDir, model))) continue
    const manifestPath = join(modelDir, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as WhisperModelManifest
    return {
      id: model,
      root,
      modelDir,
      modelPath: join(modelDir, manifest.filename),
      manifestPath,
      manifest
    }
  }
  return null
}

/** Current profile first, then the old %APPDATA%\\tediapros profile. */
export function whisperModelRoots(userData: string, appData: string, resourcesPath?: string): string[] {
  const roots = [
    join(userData, 'whisper-cpp-models'),
    join(appData, 'tediapros', 'whisper-cpp-models')
  ]
  if (resourcesPath) roots.push(join(resourcesPath, 'models', 'whisper-cpp'))
  const seen = new Set<string>()
  return roots.filter((root) => {
    const key = root.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function writeWhisperModelManifest(
  modelDir: string,
  manifest: WhisperModelManifest
): Promise<void> {
  await mkdir(modelDir, { recursive: true })
  const target = join(modelDir, 'manifest.json')
  const partial = `${target}.partial`
  await writeFile(partial, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rm(target, { force: true })
  await rename(partial, target)
}
