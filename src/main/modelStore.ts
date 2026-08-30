import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, stat, writeFile, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, relative } from 'node:path'
import { WHISPER_PROTOCOL } from './engineProtocol'
import { isWhisperModelId, WHISPER_MODEL_CATALOG, type WhisperModelId } from './modelCatalog'

export interface WhisperModelFile {
  path: string
  bytes: number
  sha256: string
}

export interface WhisperModelManifest {
  schemaVersion: 1
  id: WhisperModelId
  repoId: string
  revision: string
  backend: 'faster-whisper'
  format: 'ctranslate2'
  files: WhisperModelFile[]
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

const REQUIRED_MODEL_FILES = ['model.bin', 'config.json', 'tokenizer.json'] as const

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

function isSafeModelPath(path: unknown): path is string {
  if (typeof path !== 'string' || !path.trim()) return false
  const normalized = path.replace(/\\/g, '/')
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//u.test(normalized) &&
    normalized.split('/').every((part) => part && part !== '.' && part !== '..')
}

function isModelFile(value: unknown): value is WhisperModelFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return isSafeModelPath(record.path) &&
    typeof record.bytes === 'number' && Number.isSafeInteger(record.bytes) && record.bytes > 0 &&
    typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/iu.test(record.sha256)
}

async function readModelManifest(modelDir: string, model: WhisperModelId): Promise<WhisperModelManifest | null> {
  const manifestPath = join(modelDir, 'manifest.json')
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    if (
      parsed.schemaVersion !== 1 || parsed.id !== model ||
      parsed.backend !== 'faster-whisper' || parsed.format !== 'ctranslate2' ||
      parsed.languageFamily !== 'multilingual' || parsed.engineProtocol !== WHISPER_PROTOCOL ||
      typeof parsed.repoId !== 'string' || parsed.repoId !== WHISPER_MODEL_CATALOG[model].repoId ||
      typeof parsed.revision !== 'string' || parsed.revision.toLowerCase() !== WHISPER_MODEL_CATALOG[model].revision.toLowerCase() ||
      !Array.isArray(parsed.files) || parsed.files.length < REQUIRED_MODEL_FILES.length ||
      !parsed.files.every(isModelFile)
    ) return null

    const files = parsed.files as WhisperModelFile[]
    const names = new Set(files.map((file) => file.path.replace(/\\/g, '/')))
    if (!REQUIRED_MODEL_FILES.every((file) => names.has(file)) || (!names.has('vocabulary.json') && !names.has('vocabulary.txt'))) {
      return null
    }
    return { ...parsed, files: files.map((file) => ({ ...file, path: file.path.replace(/\\/g, '/') })) } as WhisperModelManifest
  } catch {
    return null
  }
}

export async function isCompleteWhisperModel(modelDir: string, model: string): Promise<boolean> {
  if (!isWhisperModelId(model)) return false
  if (!(await fileExists(modelDir))) return false
  const manifest = await readModelManifest(modelDir, model)
  if (!manifest) return false
  for (const file of manifest.files) {
    const path = join(modelDir, file.path)
    if (await fileExists(`${path}.part`) || await fileExists(`${path}.partial`)) return false
    const info = await stat(path).catch(() => null)
    if (!info?.isFile() || info.size !== file.bytes) return false
    if ((await sha256File(path)).toLowerCase() !== file.sha256.toLowerCase()) return false
  }
  return true
}

export async function findLocalWhisperModel(model: string, roots: string[]): Promise<LocalWhisperModel | null> {
  if (!isWhisperModelId(model)) return null
  for (const root of roots) {
    const modelDir = join(root, model)
    if (!(await isCompleteWhisperModel(modelDir, model))) continue
    const manifestPath = join(modelDir, 'manifest.json')
    const manifest = await readModelManifest(modelDir, model)
    if (!manifest) continue
    return { id: model, root, modelDir, modelPath: modelDir, manifestPath, manifest }
  }
  return null
}

/** Only the current user-data profile is a production model root. */
export function whisperModelRoots(userData: string): string[] {
  return [join(userData, 'whisper-models')]
}

export async function writeWhisperModelManifest(
  targetDir: string,
  model: WhisperModelId,
  repoId = WHISPER_MODEL_CATALOG[model].repoId,
  revision = WHISPER_MODEL_CATALOG[model].revision
): Promise<string> {
  await mkdir(targetDir, { recursive: true })
  const names = ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json', 'vocabulary.txt']
  const files: WhisperModelFile[] = []
  for (const name of names) {
    const path = join(targetDir, name)
    const info = await stat(path).catch(() => null)
    if (!info?.isFile() || info.size <= 0) continue
    files.push({ path: relative(targetDir, path).replace(/\\/g, '/'), bytes: info.size, sha256: await sha256File(path) })
  }
  const manifest: WhisperModelManifest = {
    schemaVersion: 1,
    id: model,
    repoId,
    revision,
    backend: 'faster-whisper',
    format: 'ctranslate2',
    files,
    languageFamily: 'multilingual',
    engineProtocol: WHISPER_PROTOCOL
  }
  const manifestPath = join(targetDir, 'manifest.json')
  const partial = `${manifestPath}.partial`
  await writeFile(partial, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await rm(manifestPath, { force: true }).catch(() => {})
  await rename(partial, manifestPath)
  return manifestPath
}
