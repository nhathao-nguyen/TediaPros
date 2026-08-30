import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { getDistributionConfig } from './distributionConfig'
import { validateRuntimeDistributionManifest, type RuntimeAssetSpec } from './runtimeManifest'
import { extractZip } from './deps'
import { replaceDirectoryAtomic } from './localAssets'
import {
  recordInstalledRuntimeReceipt,
  runtimeKindDir,
  type RuntimeEngineKind
} from './runtimeResolver'
import { logInfo, logWarn, errLabel } from './logger'

const isWin = process.platform === 'win32'

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

export async function fetchRuntimeManifest(): Promise<Record<string, RuntimeAssetSpec> | null> {
  const config = getDistributionConfig()
  if (!config.manifestUrl) return null
  try {
    const res = await fetch(config.manifestUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) return null
    const json = await res.json()
    const validated = validateRuntimeDistributionManifest(json)
    if (!validated.ok) {
      logWarn(`[RuntimeInstaller] Manifest không hợp lệ: ${validated.error}`)
      return null
    }
    return validated.manifest.assets
  } catch (error) {
    logWarn(`[RuntimeInstaller] Không tải được runtime manifest: ${errLabel(error)}`)
    return null
  }
}

export async function downloadRuntimeEngineFromManifest(
  kind: RuntimeEngineKind,
  onProgress: (percent: number, message: string) => void
): Promise<boolean> {
  const assets = await fetchRuntimeManifest()
  if (!assets || !assets[kind]) return false

  const spec = assets[kind]
  const config = getDistributionConfig()
  const assetUrl = config.getAssetUrl(spec.asset)
  if (!assetUrl) return false

  const targetDir = runtimeKindDir(kind)
  const stagingDir = `${targetDir}.staging`
  const zipPath = join(stagingDir, spec.asset)

  await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  await mkdir(stagingDir, { recursive: true })

  try {
    onProgress(10, `Đang tải gói ${kind}… 0%`)
    const res = await fetch(assetUrl, { redirect: 'follow' })
    if (!res.ok || !res.body) {
      throw new Error(`Tải asset ${spec.asset} thất bại (${res.status})`)
    }

    const total = spec.bytes || Number(res.headers.get('content-length') || 0)
    let received = 0
    const out = createWriteStream(zipPath)
    const nodeStream = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)

    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (total > 0) {
        const pct = Math.min(90, Math.round((received / total) * 80) + 10)
        onProgress(pct, `Đang tải ${kind}… ${pct}%`)
      }
    })

    await new Promise<void>((resolve, reject) => {
      nodeStream.pipe(out)
      out.on('finish', resolve)
      out.on('error', reject)
      nodeStream.on('error', reject)
    })

    onProgress(90, `Đang kiểm tra checksum ${kind}…`)
    const actualHash = await sha256File(zipPath)
    if (actualHash.toLowerCase() !== spec.sha256.toLowerCase()) {
      throw new Error(`Checksum SHA-256 của ${kind} không khớp`)
    }

    onProgress(95, `Đang giải nén ${kind}…`)
    const extractDir = join(stagingDir, 'extracted')
    await mkdir(extractDir, { recursive: true })
    await extractZip(zipPath, extractDir)
    await rm(zipPath, { force: true }).catch(() => {})

    await replaceDirectoryAtomic(extractDir, targetDir)

    await recordInstalledRuntimeReceipt(kind, {
      version: spec.version,
      sha256: spec.sha256,
      protocol: spec.protocol,
      installedAt: new Date().toISOString(),
      activePath: join(targetDir, spec.entrypoint)
    })

    logInfo(`[RuntimeInstaller] Đã cài đặt thành công runtime ${kind} (${spec.version}).`)
    return true
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}
