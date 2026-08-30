import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { WHISPER_PROTOCOL, LEGACY_WHISPER_PROTOCOL } from './engineProtocol'
import { isWhisperModelId, WHISPER_MODEL_CATALOG, type WhisperModelId } from './modelCatalog'

export interface WhisperModelManifest {
  id: WhisperModelId
  backend: 'faster-whisper' | 'whisper.cpp'
  format: 'ctranslate2' | 'ggml'
  filename: string
  bytes: number
  sha256?: string
  languageFamily: 'multilingual'
  engineProtocol?: string
}

export interface LocalWhisperModel {
  id: WhisperModelId
  root: string
  modelDir: string
  modelPath: string
  manifestPath?: string
  manifest?: WhisperModelManifest
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

export async function isCompleteWhisperModel(modelDir: string, model: string): Promise<boolean> {
  if (!isWhisperModelId(model)) return false
  if (!(await fileExists(modelDir))) return false

  const manifestPath = join(modelDir, 'manifest.json')
  if (await fileExists(manifestPath)) {
    if (await fileExists(`${manifestPath}.partial`)) return false
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
      if (parsed.id !== model || typeof parsed.filename !== 'string') return false
      const binPath = join(modelDir, parsed.filename)
      if (await fileExists(`${binPath}.partial`)) return false
      const s = await stat(binPath).catch(() => null)
      if (!s || !s.isFile() || s.size <= 0) return false
      if (typeof parsed.bytes === 'number' && parsed.bytes > 0 && s.size !== parsed.bytes) return false
      if (parsed.sha256 && typeof parsed.sha256 === 'string') {
        const h = await sha256File(binPath)
        return h.toLowerCase() === parsed.sha256.toLowerCase()
      }
      return true
    } catch {
      return false
    }
  }

  const directBin = join(modelDir, 'model.bin')
  if (await fileExists(directBin)) {
    if (await fileExists(`${directBin}.partial`)) return false
    const s = await stat(directBin).catch(() => null)
    if (s && s.isFile() && s.size > 0) return true
  }

  // Kiem tra thu muc HuggingFace cache con
  try {
    const entries = await readdir(modelDir)
    const hfDirName = `models--Systran--faster-whisper-${model}`
    if (entries.includes(hfDirName)) {
      const snapshotsDir = join(modelDir, hfDirName, 'snapshots')
      if (await fileExists(snapshotsDir)) {
        const snaps = await readdir(snapshotsDir)
        for (const snap of snaps) {
          const target = join(snapshotsDir, snap, 'model.bin')
          const s = await stat(target).catch(() => null)
          if (s && s.isFile() && s.size > 0) return true
        }
      }
    }
  } catch {
    // ignore
  }

  return false
}

export async function findLocalWhisperModel(
  model: string,
  roots: string[]
): Promise<LocalWhisperModel | null> {
  if (!isWhisperModelId(model)) return null
  for (const root of roots) {
    const candidateDirs = [
      join(root, model),
      root
    ]
    for (const modelDir of candidateDirs) {
      if (await isCompleteWhisperModel(modelDir, model)) {
        const directBin = join(modelDir, 'model.bin')
        const manifestPath = join(modelDir, 'manifest.json')
        let manifest: WhisperModelManifest | undefined
        if (await fileExists(manifestPath)) {
          try {
            manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as WhisperModelManifest
          } catch {
            /* ignore */
          }
        }
        return {
          id: model,
          root,
          modelDir,
          modelPath: (await fileExists(directBin)) ? directBin : join(modelDir, `${model}.bin`),
          manifestPath: (await fileExists(manifestPath)) ? manifestPath : undefined,
          manifest
        }
      }
    }
  }
  return null
}

/** Canonical managed model root first, then legacy profile locations. */
export function whisperModelRoots(userData: string, appData: string, devOverrideRoot?: string): string[] {
  const roots: string[] = []
  if (devOverrideRoot) roots.push(devOverrideRoot)
  const envDev = process.env.TEDIAPROS_RUNTIME_DIR?.trim()
  if (envDev) {
    roots.push(join(envDev, 'whisper-models'))
    roots.push(join(envDev, 'models', 'whisper'))
  }

  // Canonical HuggingFace / Faster-Whisper cache dir in userData
  roots.push(join(userData, 'whisper-models'))
  roots.push(join(userData, 'models', 'whisper'))
  roots.push(join(userData, 'models', 'whisper-cpp'))

  // Legacy managed roots for migration / backward-compatibility
  roots.push(join(appData, 'tedia-pros', 'whisper-models'))
  roots.push(join(appData, 'tedia-pros', 'models', 'whisper-cpp'))
  roots.push(join(appData, 'tediapros', 'whisper-models'))

  const seen = new Set<string>()
  return roots.filter((r) => {
    const key = r.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function writeWhisperModelManifest(
  targetDir: string,
  model: WhisperModelId,
  filePath: string,
  sha256?: string
): Promise<string> {
  await mkdir(targetDir, { recursive: true })
  const s = await stat(filePath)
  const manifest: WhisperModelManifest = {
    id: model,
    backend: 'faster-whisper',
    format: 'ctranslate2',
    filename: WHISPER_MODEL_CATALOG[model].filename,
    bytes: s.size,
    sha256: sha256 || (await sha256File(filePath)),
    languageFamily: 'multilingual',
    engineProtocol: WHISPER_PROTOCOL
  }
  const manifestPath = join(targetDir, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  return manifestPath
}
