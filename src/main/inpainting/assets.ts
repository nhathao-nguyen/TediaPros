import { app } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { AutoShortDependencyProgress, AutoShortDependencyStatus } from '../../shared/types'
import { resolveSttnEngine, readInstalledRuntimeState } from '../runtimeResolver'
import { downloadRuntimeEngineFromManifest } from '../runtimeInstaller'
import { createDistributionFetch, getDistributionConfig } from '../distributionConfig'
import { probeSttnEngine, runSttnCommand } from './runner'

/** Downloaded and hashed from these pinned source bytes, 2026-09-05. */
export const STTN_MODEL = Object.freeze({
  revision: 'f78e985e1ce75c0739bee13ab12226d5e71a958a',
  url: 'https://raw.githubusercontent.com/YaoFANGUK/video-subtitle-remover/f78e985e1ce75c0739bee13ab12226d5e71a958a/backend/models/sttn-det/sttn.pth',
  bytes: 66_252_587,
  sha256: '25b0c2c30042d82efd1893bd42ec726764262d94115393a1718f8d65d2a7817b'
})
type ModelSpec = Pick<typeof STTN_MODEL, 'url' | 'bytes' | 'sha256'>
export function sttnModelPath(): string { return join(app.getPath('userData'), 'models', 'sttn', 'sttn.pth') }

export async function verifySttnModelFile(path: string, spec: ModelSpec = STTN_MODEL): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== spec.bytes) throw new Error('STTN model sai kích thước (size).')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  if (hash.digest('hex') !== spec.sha256) throw new Error('STTN model SHA-256 không khớp.')
}

let modelCache: { key: string; path: string } | undefined
let readinessCache: { key: string; result: Promise<AutoShortDependencyStatus[]> } | undefined

async function fileKey(path: string): Promise<string> {
  const info = await stat(path)
  return `${path}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
}

export async function resolveSttnModel(): Promise<string | null> {
  const path = sttnModelPath()
  try {
    const key = await fileKey(path)
    if (modelCache?.key === key) return modelCache.path
    await verifySttnModelFile(path)
    modelCache = { key, path }
    return path
  } catch { modelCache = undefined; return null }
}

export async function getSttnReadiness(signal?: AbortSignal): Promise<AutoShortDependencyStatus[]> {
  signal?.throwIfAborted()
  const [engine, model, receipts] = await Promise.all([resolveSttnEngine(), resolveSttnModel(), readInstalledRuntimeState()])
  const dependencies: AutoShortDependencyStatus[] = [
    { id: 'sttn-engine', label: 'STTN engine', required: true, ready: false, message: engine ? 'Đang kiểm tra STTN.' : 'Chưa cài STTN engine; cần runtime manifest có gói STTN.' },
    { id: 'sttn-model', label: 'STTN model', required: true, ready: Boolean(model), downloadBytes: STTN_MODEL.bytes, message: model ? undefined : 'Cần tải model STTN (63,2 MiB).' }
  ]
  if (!engine) return dependencies
  const receipt = receipts['sttn-engine']
  const key = `${await fileKey(engine)}:${model ? await fileKey(model) : 'missing'}:${JSON.stringify(receipt)}`
  if (!signal && readinessCache?.key === key) return readinessCache.result
  const result = (async (): Promise<AutoShortDependencyStatus[]> => {
    try {
      const version = await runSttnCommand({ executablePath: engine, args: ['--version'], expectedEvent: 'version', timeoutMs: 30_000, signal })
      if (version.engine !== 'sttn' || !['1.0.0', '1.1.0', '1.1.1'].includes(String(version.version)) || (receipt && receipt.version !== version.version)) throw new Error('STTN engine version không được hỗ trợ hoặc không khớp receipt.')
      dependencies[0].ready = true
      dependencies[0].message = `STTN engine ${version.version}.`
      if (model) {
        const provider = await probeSttnEngine(engine, model, signal)
        dependencies[0].message = `STTN sẵn sàng (${provider.toUpperCase()}).`
      }
    } catch (error) {
      signal?.throwIfAborted()
      dependencies[0].ready = false
      dependencies[0].message = error instanceof Error ? error.message : String(error)
      readinessCache = undefined
    }
    return dependencies
  })()
  if (!signal) readinessCache = { key, result }
  return result
}

export async function installSttnModel(
  onProgress: (progress: AutoShortDependencyProgress) => void,
  signal?: AbortSignal,
  hooks: { targetPath?: string; spec?: ModelSpec; fetch?: (input: string, init?: RequestInit) => Promise<Response> } = {}
): Promise<void> {
  signal?.throwIfAborted()
  const target = hooks.targetPath || sttnModelPath()
  const spec = hooks.spec || STTN_MODEL
  if (await verifySttnModelFile(target, spec).then(() => true, () => false)) {
    onProgress({ id: 'sttn-model', phase: 'done', percent: 100, message: 'STTN model đã sẵn sàng.' })
    return
  }
  await mkdir(dirname(target), { recursive: true })
  const partial = `${target}.${randomUUID()}.partial`
  const deadline = AbortSignal.timeout(15 * 60 * 1000)
  const downloadSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
  try {
    onProgress({ id: 'sttn-model', phase: 'downloading', percent: 0, totalBytes: spec.bytes, receivedBytes: 0, message: 'Đang tải STTN model…' })
    const response = await (hooks.fetch || fetch)(spec.url, { signal: downloadSignal, redirect: 'follow' })
    if (!response.ok || !response.body) throw new Error(`Tải STTN model thất bại (${response.status}).`)
    let received = 0
    let lastPercent = -1
    const count = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > spec.bytes) return callback(new Error('STTN model vượt kích thước download.'))
      const percent = Math.floor(received / spec.bytes * 90)
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress({ id: 'sttn-model', phase: 'downloading', percent, totalBytes: spec.bytes, receivedBytes: received, message: 'Đang tải STTN model…' })
      }
      callback(null, chunk)
    } })
    await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), count, createWriteStream(partial, { flags: 'wx' }), { signal: downloadSignal })
    onProgress({ id: 'sttn-model', phase: 'verifying', percent: 95, message: 'Đang kiểm tra SHA-256 STTN model…' })
    await verifySttnModelFile(partial, spec)
    downloadSignal.throwIfAborted()
    await rename(partial, target)
    modelCache = undefined
    readinessCache = undefined
    onProgress({ id: 'sttn-model', phase: 'done', percent: 100, message: 'STTN model đã sẵn sàng.' })
  } finally { await rm(partial, { force: true }) }
}

let installation: Promise<void> | undefined
export async function installSttnDependencies(onProgress: (progress: AutoShortDependencyProgress) => void, signal?: AbortSignal): Promise<void> {
  if (installation) throw new Error('Đang cài STTN ở tác vụ khác; vui lòng đợi hoàn tất.')
  installation = (async () => {
    signal?.throwIfAborted()
    const deps = await getSttnReadiness(signal)
    signal?.throwIfAborted()
    if (!deps[0].ready) {
      const distributionFetch = createDistributionFetch(getDistributionConfig())
      const deadline = AbortSignal.timeout(30 * 60 * 1000)
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
      const installed = await downloadRuntimeEngineFromManifest('sttn-engine', (percent, message) => {
        combined.throwIfAborted()
        onProgress({ id: 'sttn-engine', phase: percent === 100 ? 'done' : percent >= 85 ? 'verifying' : percent >= 70 ? 'installing' : 'downloading', percent, message })
      }, { fetch: (url, options) => distributionFetch(url, { ...options, signal: options?.signal ? AbortSignal.any([options.signal, combined]) : combined }), probe: async (_kind, root, spec) => {
        const version = await runSttnCommand({ executablePath: join(root, spec.entrypoint), args: ['--version'], expectedEvent: 'version', signal: combined, timeoutMs: 30_000 })
        combined.throwIfAborted()
        return { healthy: version.engine === 'sttn' && version.version === spec.version && version.protocol === 'sttn-engine/1', version: String(version.version), protocol: 'sttn-engine/1' }
      } })
      if (!installed) throw new Error('Chưa có gói STTN engine trong runtime manifest của kênh hiện tại.')
    }
    signal?.throwIfAborted()
    await installSttnModel(onProgress, signal)
    readinessCache = undefined
    const after = await getSttnReadiness(signal)
    signal?.throwIfAborted()
    const failed = after.find(dependency => !dependency.ready)
    if (failed) throw new Error(failed.message || 'STTN chưa sẵn sàng.')
    onProgress({ id: 'sttn-engine', phase: 'done', percent: 100, message: after[0].message || 'STTN đã sẵn sàng.' })
  })()
  try { await installation } finally { installation = undefined }
}
