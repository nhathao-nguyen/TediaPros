import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { AutoShortDependencyProgress, SeparatorModelId } from '../../shared/types'
import { getDistributionConfig } from '../distributionConfig'
import { extractZip, validateZipArchive } from '../deps'
import { replaceDirectoryAtomic } from '../localAssets'
import { resolveSeparatorEngine } from '../runtimeResolver'
import {
  validateSeparatorModelReleaseManifest,
  type SeparatorModelReleaseManifest,
  type SeparatorModelReleaseSpec
} from './modelManifest'
import {
  resolveInstalledSeparatorModel,
  separatorModelDir,
  separatorModelRoot,
  type InstalledSeparatorModel
} from './modelStore'
import { probeSeparatorModel } from './runner'
import { logInfo, logWarn, errLabel } from '../logger'

const MIB = 1024 * 1024

export function requiredModelInstallBytes(spec: SeparatorModelReleaseSpec): number {
  const payload = spec.archiveBytes + spec.expandedBytes
  return payload + Math.max(256 * MIB, Math.ceil(payload * 0.10))
}

export interface SeparatorModelInstallerHooks {
  fetch?: typeof fetch
  extract?: (archivePath: string, destination: string) => Promise<void>
  probe?: typeof probeSeparatorModel
  freeBytes?: (path: string) => Promise<number>
  now?: () => string
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex').toLowerCase()
}

export async function fetchSeparatorModelManifest(
  fetchImpl: typeof fetch = fetch
): Promise<SeparatorModelReleaseManifest | null> {
  const config = getDistributionConfig()
  if (!config.separatorModelManifestUrl) return null
  try {
    const response = await fetchImpl(config.separatorModelManifestUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) return null
    const json = await response.json()
    const validated = validateSeparatorModelReleaseManifest(json)
    if (!validated.ok) {
      logWarn(`[SeparatorModelInstaller] Manifest không hợp lệ: ${validated.error}`)
      return null
    }
    return validated.manifest
  } catch (error) {
    logWarn(`[SeparatorModelInstaller] Không tải được separator model manifest: ${errLabel(error)}`)
    return null
  }
}

export async function installSeparatorModel(
  id: SeparatorModelId,
  onProgress: (progress: AutoShortDependencyProgress) => void,
  signal?: AbortSignal,
  hooks: SeparatorModelInstallerHooks = {}
): Promise<InstalledSeparatorModel> {
  // Offline reuse check: if already installed and healthy, return immediately
  const existing = await resolveInstalledSeparatorModel(id)
  if (existing) {
    onProgress({
      id: 'separator-model',
      phase: 'done',
      percent: 100,
      message: `Model ${id} đã cài đặt sẵn.`
    })
    return existing
  }

  const fetchImpl = hooks.fetch || fetch
  const manifest = await fetchSeparatorModelManifest(fetchImpl)
  if (!manifest) {
    throw new Error('Không thể tải manifest separator model.')
  }

  const spec = manifest.models[id]
  if (!spec) {
    throw new Error(`Model ${id} không tồn tại trong release manifest.`)
  }

  if (hooks.freeBytes) {
    const available = await hooks.freeBytes(separatorModelRoot())
    const required = requiredModelInstallBytes(spec)
    if (available < required) {
      throw new Error(
        `Không đủ dung lượng ổ đĩa. Cần tối thiểu ${Math.ceil(required / MIB)} MB, còn trống ${Math.ceil(available / MIB)} MB.`
      )
    }
  }

  const targetDir = separatorModelDir(id)
  const stagingDir = `${targetDir}.staging`
  const archivePath = join(stagingDir, spec.asset)
  const extractDir = join(stagingDir, 'extracted')

  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })

  try {
    if (signal?.aborted) throw new Error('Cài đặt model đã bị hủy.')

    onProgress({
      id: 'separator-model',
      phase: 'downloading',
      percent: 5,
      receivedBytes: 0,
      totalBytes: spec.archiveBytes,
      message: `Đang tải model ${id}…`
    })

    const config = getDistributionConfig()
    const assetUrl = config.getSeparatorModelAssetUrl(spec.asset)
    const response = await fetchImpl(assetUrl, { redirect: 'follow', signal })
    if (!response.ok || !response.body) {
      throw new Error(`Tải model archive ${spec.asset} thất bại (${response.status}).`)
    }

    await pipeline(
      Readable.fromWeb(response.body as import('stream/web').ReadableStream),
      createWriteStream(archivePath),
      { signal }
    )

    const archiveStat = await stat(archivePath)
    if (archiveStat.size !== spec.archiveBytes) {
      throw new Error(`Kích thước archive ${spec.asset} (${archiveStat.size} B) không khớp manifest (${spec.archiveBytes} B).`)
    }

    onProgress({
      id: 'separator-model',
      phase: 'verifying',
      percent: 60,
      receivedBytes: archiveStat.size,
      totalBytes: spec.archiveBytes,
      message: 'Đang kiểm tra checksum…'
    })

    const actualHash = await sha256File(archivePath)
    if (actualHash !== spec.archiveSha256.toLowerCase()) {
      throw new Error(`Checksum SHA-256 của archive ${spec.asset} không khớp.`)
    }

    onProgress({
      id: 'separator-model',
      phase: 'installing',
      percent: 75,
      message: 'Đang giải nén model…'
    })

    if (!hooks.extract) {
      await validateZipArchive(archivePath)
    }
    await (hooks.extract || extractZip)(archivePath, extractDir)

    // Verify model.onnx exists and matches spec
    const modelOnnxPath = join(extractDir, 'model.onnx')
    const modelStat = await stat(modelOnnxPath).catch(() => null)
    if (!modelStat?.isFile() || modelStat.size !== spec.model.bytes) {
      throw new Error('File model.onnx giải nén thiếu hoặc sai kích thước.')
    }
    const modelHash = await sha256File(modelOnnxPath)
    if (modelHash !== spec.model.sha256.toLowerCase()) {
      throw new Error('Checksum SHA-256 của model.onnx không khớp.')
    }

    // Write local manifest.json
    const manifestJsonPath = join(extractDir, 'manifest.json')
    const localManifestContent = {
      id: spec.id,
      version: spec.version,
      installedAt: hooks.now?.() || new Date().toISOString(),
      protocol: 'separator-engine/1',
      spec
    }
    await writeFile(manifestJsonPath, JSON.stringify(localManifestContent, null, 2), 'utf8')

    onProgress({
      id: 'separator-model',
      phase: 'verifying',
      percent: 90,
      message: 'Đang probe kiểm tra model…'
    })

    const engineExecutable = await resolveSeparatorEngine()
    if (engineExecutable) {
      const probeFn = hooks.probe || probeSeparatorModel
      const probeResult = await probeFn({
        executablePath: engineExecutable,
        model: {
          id,
          directory: extractDir,
          modelPath: modelOnnxPath,
          manifestPath: manifestJsonPath,
          spec
        },
        provider: 'cpu',
        signal
      })
      if (!probeResult.ready) {
        throw new Error(probeResult.message || 'Probe model separator thất bại.')
      }
    }

    await replaceDirectoryAtomic(extractDir, targetDir)

    onProgress({
      id: 'separator-model',
      phase: 'done',
      percent: 100,
      message: `Model ${id} đã sẵn sàng.`
    })
    logInfo(`[SeparatorModelInstaller] Đã cài đặt model ${id}.`)

    return {
      id,
      directory: targetDir,
      modelPath: join(targetDir, 'model.onnx'),
      manifestPath: join(targetDir, 'manifest.json'),
      spec
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
