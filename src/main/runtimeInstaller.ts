import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, constants } from 'node:fs'
import { access, mkdir, rm, chmod, stat } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getDistributionConfig } from './distributionConfig'
import { validateRuntimeDistributionManifest, type RuntimeAssetSpec, type RuntimeDistributionManifest } from './runtimeManifest'
import { extractZip, validateZipArchive, isSafeRuntimeArchiveEntryPath } from './deps'
import { findFile, replaceDirectoryAtomic } from './localAssets'
import { recordInstalledRuntimeReceipt, runtimeKindDir, type RuntimeEngineKind } from './runtimeResolver'
import { probeRuntimeAsset, type RuntimeProbeResult } from './runtimeProbes'
import { logInfo, logWarn, errLabel } from './logger'

export interface RuntimeInstallerHooks {
  fetch?: typeof fetch
  extract?: (archive: string, destination: string) => Promise<void>
  probe?: (kind: RuntimeEngineKind, root: string, spec: RuntimeAssetSpec) => Promise<RuntimeProbeResult>
  now?: () => string
}

const isWin = process.platform === 'win32'

export { isSafeRuntimeArchiveEntryPath }

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function fileBytes(path: string): Promise<number> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`Không phải file: ${path}`)
  return info.size
}

function platform(): 'win32' | 'darwin' | 'linux' {
  return process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux'
}

function arch(): 'x64' | 'arm64' | 'ia32' {
  return process.arch === 'arm64' || process.arch === 'ia32' ? process.arch : 'x64'
}

export async function fetchRuntimeManifest(fetchImpl: typeof fetch = fetch): Promise<RuntimeDistributionManifest | null> {
  const config = getDistributionConfig()
  if (!config.manifestUrl) return null
  try {
    const response = await fetchImpl(config.manifestUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!response.ok) return null
    const validated = validateRuntimeDistributionManifest(await response.json())
    if (!validated.ok) {
      logWarn(`[RuntimeInstaller] Manifest không hợp lệ: ${validated.error}`)
      return null
    }
    if (validated.manifest.platform !== platform() || validated.manifest.arch !== arch()) {
      logWarn('[RuntimeInstaller] Manifest không đúng platform/architecture của máy.')
      return null
    }
    return validated.manifest
  } catch (error) {
    logWarn(`[RuntimeInstaller] Không tải được runtime manifest: ${errLabel(error)}`)
    return null
  }
}

async function findArchiveRoot(extracted: string, spec: RuntimeAssetSpec): Promise<string> {
  const direct = join(extracted, ...spec.entrypoint.split('/'))
  if (await access(direct, constants.F_OK).then(() => true).catch(() => false)) return extracted
  const found = await findFile(extracted, [basename(spec.entrypoint)])
  if (!found) throw new Error(`Archive thiếu entrypoint ${spec.entrypoint}.`)
  return dirname(found)
}

async function verifyFiles(root: string, spec: RuntimeAssetSpec): Promise<void> {
  for (const file of spec.files) {
    const path = join(root, ...file.split('/'))
    const info = await stat(path).catch(() => null)
    if (!info?.isFile() || info.size <= 0) throw new Error(`Archive thiếu file bắt buộc ${file}.`)
  }
  const entrypoint = join(root, ...spec.entrypoint.split('/'))
  if (!(await access(entrypoint, constants.F_OK).then(() => true).catch(() => false))) {
    throw new Error(`Archive thiếu entrypoint ${spec.entrypoint}.`)
  }
}

export async function downloadRuntimeEngineFromManifest(
  kind: RuntimeEngineKind,
  onProgress: (percent: number, message: string) => void,
  hooks: RuntimeInstallerHooks = {}
): Promise<boolean> {
  const fetchImpl = hooks.fetch || fetch
  const manifest = await fetchRuntimeManifest(fetchImpl)
  const spec = manifest?.assets[kind]
  if (!manifest || !spec) return false

  const config = getDistributionConfig()
  const assetUrl = config.getAssetUrl(spec.asset)
  if (!assetUrl) return false
  const targetDir = runtimeKindDir(kind)
  const stagingDir = `${targetDir}.staging`
  const archivePath = join(stagingDir, spec.asset)
  const extractDir = join(stagingDir, 'extracted')

  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })
  try {
    onProgress(5, `Đang tải gói ${kind}…`)
    const response = await fetchImpl(assetUrl, { redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Tải asset ${spec.asset} thất bại (${response.status}).`)
    await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), createWriteStream(archivePath))
    const bytes = await fileBytes(archivePath)
    if (bytes !== spec.bytes) throw new Error(`Kích thước archive ${kind} không khớp manifest.`)
    onProgress(55, `Đang kiểm tra checksum ${kind}…`)
    if ((await sha256File(archivePath)).toLowerCase() !== spec.sha256.toLowerCase()) {
      throw new Error(`Checksum SHA-256 của ${kind} không khớp.`)
    }
    onProgress(70, `Đang giải nén ${kind}…`)
    if (!hooks.extract) await validateZipArchive(archivePath)
    await (hooks.extract || extractZip)(archivePath, extractDir)
    const sourceDir = await findArchiveRoot(extractDir, spec)
    await verifyFiles(sourceDir, spec)
    onProgress(85, `Đang probe ${kind}…`)
    const probe = await (hooks.probe || probeRuntimeAsset)(kind, sourceDir, spec)
    if (!probe.healthy) throw new Error(probe.message || `Runtime ${kind} không vượt qua capability probe.`)

    await replaceDirectoryAtomic(sourceDir, targetDir)
    if (!isWin) await chmod(join(targetDir, ...spec.entrypoint.split('/')), 0o755).catch(() => {})
    await recordInstalledRuntimeReceipt(kind, {
      version: spec.version,
      sha256: spec.sha256,
      protocol: spec.protocol || probe.protocol || undefined,
      installedAt: hooks.now?.() || new Date().toISOString(),
      activePath: join(targetDir, ...spec.entrypoint.split('/'))
    })
    onProgress(100, `${kind} đã sẵn sàng.`)
    logInfo(`[RuntimeInstaller] Đã cài đặt ${kind} (${spec.version}).`)
    return true
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
