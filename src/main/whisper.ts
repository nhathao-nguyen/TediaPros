import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { binDir, resolveFfmpeg } from './deps'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import {
  findLocalWhisperModel,
  isCompleteWhisperModel,
  sha256File,
  whisperModelRoots,
  writeWhisperModelManifest,
  type LocalWhisperModel,
  type WhisperModelManifest
} from './modelStore'
import { normalizeWhisperModel, WHISPER_MODEL_CATALOG, type WhisperModelId } from './modelCatalog'
import { isWhisperVersionEvent, parseWhisperVersion, WHISPER_PROTOCOL } from './engineProtocol'
import { copyDirectory, replaceDirectoryAtomic, findFile } from './localAssets'
import { runtimeSearchRoots, runtimeKindDir } from './runtimeResolver'
import type {
  WhisperCudaStatus,
  WhisperEngineStatus,
  WhisperModelStatus,
  WhisperProgress,
  WhisperRequest,
  WhisperResult,
  WhisperWorkerStats
} from '../shared/types'

const WHISPER_CPP_MODEL_REVISION = '5359861c739e955e79d9a303bcbc70fb988958b1'
const WHISPER_CPP_MODEL_BASE_URL =
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_CPP_MODEL_REVISION}`

type WhisperDevice = 'cpu' | 'cuda'

interface WhisperSegmentWord {
  word?: unknown
  start?: unknown
  end?: unknown
  probability?: unknown
}

interface WhisperSegment {
  id?: unknown
  text?: unknown
  start?: unknown
  end?: unknown
  words?: WhisperSegmentWord[]
}

interface WhisperServerResponse {
  task?: unknown
  language?: unknown
  duration?: unknown
  text?: unknown
  segments?: WhisperSegment[]
}

interface WhisperServerWorkerResult {
  response: WhisperServerResponse
  effectiveDevice: WhisperDevice
  engineVersion: string | null
}

interface WhisperEngineBundle {
  dir: string
  server: string
  cli: string
  worker: string
}

interface WhisperWorkerPending {
  id: string
  resolve: (value: WhisperServerWorkerResult) => void
  reject: (error: Error) => void
  onProgress: (percent: number, message: string) => void
}

const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wma'])

function isWin(): boolean {
  return process.platform === 'win32'
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function engineBundleRoots(): string[] {
  return runtimeSearchRoots('whisper-cpp')
}

async function engineBundleCandidates(): Promise<WhisperEngineBundle[]> {
  const serverName = isWin() ? 'whisper-server.exe' : 'whisper-server'
  const cliName = isWin() ? 'whisper-cli.exe' : 'whisper-cli'
  const workerName = isWin() ? 'whisper-local-worker.exe' : 'whisper-local-worker'
  const candidates: WhisperEngineBundle[] = []
  for (const dir of engineBundleRoots()) {
    const server = join(dir, serverName)
    const cli = join(dir, cliName)
    const worker = join(dir, workerName)
    if (await fileExists(server) && await fileExists(cli) && await fileExists(worker)) {
      candidates.push({ dir, server, cli, worker })
    }
  }
  return candidates
}

interface WhisperBundleProbe {
  versionResult: { code: number | null; stdout: string; stderr: string }
  versionEvent: ReturnType<typeof parseWhisperVersion>
  probeResult: { code: number | null; stdout: string; stderr: string }
  probe: Record<string, unknown> | null
  healthy: boolean
}

async function probeWhisperBundle(bundle: WhisperEngineBundle): Promise<WhisperBundleProbe> {
  const versionResult = await runCapture(bundle.worker, ['--version'])
  const versionEvent = parseWhisperVersion(versionResult.stdout)
  const probeResult = versionEvent
    ? await runCapture(bundle.worker, ['--probe', '--device', 'cpu'])
    : { code: -1, stdout: '', stderr: '' }
  const probe = parseJsonRecord(probeResult.stdout)
  const healthy = versionResult.code === 0 && isWhisperVersionEvent(versionEvent) &&
    probeResult.code === 0 && probe?.type === 'probe' && probe.ready === true
  return { versionResult, versionEvent, probeResult, probe, healthy }
}

async function resolveEngineBundle(): Promise<WhisperEngineBundle | null> {
  for (const candidate of await engineBundleCandidates()) {
    if ((await probeWhisperBundle(candidate)).healthy) return candidate
  }
  return null
}

function modelRoots(): string[] {
  return whisperModelRoots(app.getPath('userData'), app.getPath('appData'))
}

function modelSource(model: LocalWhisperModel): 'current' | 'legacy' | 'resources' {
  const current = join(app.getPath('userData'), 'models', 'whisper-cpp').toLowerCase()
  const currentOld = join(app.getPath('userData'), 'whisper-cpp-models').toLowerCase()
  const legacy = join(app.getPath('appData'), 'tediapros', 'whisper-cpp-models').toLowerCase()
  const root = model.root.toLowerCase()
  if (root === current || root === currentOld) return 'current'
  if (root === legacy) return 'legacy'
  return 'resources'
}

async function hasLegacyIncompatibleWhisperCache(): Promise<boolean> {
  const roots = [
    join(app.getPath('userData'), 'whisper-models'),
    join(app.getPath('appData'), 'tediapros', 'whisper-models')
  ]
  for (const root of roots) if (await fileExists(root)) return true
  return false
}

export async function whisperModelStatus(model: string): Promise<WhisperModelStatus> {
  const id = normalizeWhisperModel(model)
  const spec = WHISPER_MODEL_CATALOG[id]
  const found = await findLocalWhisperModel(id, modelRoots())
  const incompatible = !found && await hasLegacyIncompatibleWhisperCache()
  return {
    id,
    repoId: `ggerganov/whisper.cpp@${WHISPER_CPP_MODEL_REVISION}`,
    installed: found !== null,
    complete: found !== null,
    downloadBytes: spec.downloadBytes,
    path: found?.modelPath ?? null,
    message: found
      ? undefined
      : incompatible
        ? `Model ${id} cũ là định dạng Whisper legacy không tương thích; cần tải bản native local mới.`
        : `Model ${id} chưa được tải. Hãy chuẩn bị model trước khi chạy.`,
    backend: 'whisper.cpp',
    format: 'ggml',
    valid: found !== null,
    source: found ? modelSource(found) : 'none',
    sha256: found?.manifest.sha256 ?? null,
    incompatible
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const partial = `${path}.partial`
  await writeFile(partial, content, 'utf8')
  // Windows cannot rename over an existing destination. The partial file is
  // complete before this point, so replacing the old output is safe.
  await rm(path, { force: true })
  await rename(partial, path)
}

const modelInstallLocks = new Map<WhisperModelId, Promise<void>>()

export async function installWhisperModel(
  model: string,
  onProgress: (progress: { percent: number; receivedBytes?: number; totalBytes?: number; message: string }) => void,
  signal?: AbortSignal
): Promise<void> {
  const id = normalizeWhisperModel(model)
  const inFlight = modelInstallLocks.get(id)
  if (inFlight) return inFlight
  const operation = installWhisperModelLocked(id, onProgress, signal)
  modelInstallLocks.set(id, operation)
  try {
    await operation
  } finally {
    if (modelInstallLocks.get(id) === operation) modelInstallLocks.delete(id)
  }
}

async function installWhisperModelLocked(
  id: WhisperModelId,
  onProgress: (progress: { percent: number; receivedBytes?: number; totalBytes?: number; message: string }) => void,
  signal?: AbortSignal
): Promise<void> {
  const existing = await findLocalWhisperModel(id, modelRoots())
  if (existing) {
    onProgress({ percent: 100, receivedBytes: existing.manifest.bytes, totalBytes: existing.manifest.bytes, message: `Đã có model ${id} local.` })
    return
  }

  const root = modelRoots()[0]
  const spec = WHISPER_MODEL_CATALOG[id]
  const targetDir = join(root, id)
  const target = join(targetDir, spec.filename)
  const partial = `${target}.partial`
  await mkdir(targetDir, { recursive: true })
  const partialInfo = await stat(partial).catch(() => null)
  const existingBytes = partialInfo?.isFile() ? partialInfo.size : 0
  const url = `${WHISPER_CPP_MODEL_BASE_URL}/${encodeURIComponent(spec.filename)}?download=true`
  const response = await fetch(url, {
    redirect: 'follow',
    signal,
    headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined
  })
  if (!response.ok || !response.body) throw new Error(`Không tải được model ${id} (${response.status}).`)
  const append = existingBytes > 0 && response.status === 206
  const startingBytes = append ? existingBytes : 0
  const total = Number(response.headers.get('content-length') || 0) + startingBytes
  let received = startingBytes
  const stream = Readable.fromWeb(response.body as unknown as import('stream/web').ReadableStream)
  stream.on('data', (chunk: Buffer) => {
    received += chunk.length
    onProgress({
      percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : -1,
      receivedBytes: received,
      totalBytes: total || spec.downloadBytes,
      message: `Đang tải model ${id}…`
    })
  })
  await pipeline(stream, createWriteStream(partial, { flags: append ? 'a' : 'w' }), { signal })
  await rename(partial, target)

  const info = await stat(target)
  const manifest: WhisperModelManifest = {
    id,
    backend: 'whisper.cpp',
    format: 'ggml',
    filename: spec.filename,
    bytes: info.size,
    sha256: await sha256File(target),
    languageFamily: 'multilingual',
    engineProtocol: WHISPER_PROTOCOL
  }
  await writeWhisperModelManifest(targetDir, manifest)
  if (!(await isCompleteWhisperModel(targetDir, id))) throw new Error(`Model ${id} đã tải nhưng integrity không đạt.`)
  onProgress({ percent: 100, receivedBytes: manifest.bytes, totalBytes: manifest.bytes, message: `Đã tải và kiểm tra model ${id}.` })
}

async function runCapture(command: string, args: string[], timeoutMs = 15_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (value: { code: number | null; stdout: string; stderr: string }): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, { windowsHide: true })
    } catch (error) {
      finish({ code: -1, stdout, stderr: errLabel(error) })
      return
    }
    timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish({ code: -1, stdout, stderr: stderr || 'Process không phản hồi.' })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', (error) => finish({ code: -1, stdout, stderr: errLabel(error) }))
    child.on('close', (code) => finish({ code, stdout, stderr }))
  })
}

function parseJsonRecord(output: string): Record<string, unknown> | null {
  for (const line of output.split(/\r?\n/).reverse()) {
    const text = line.trim()
    if (!text) continue
    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch { /* diagnostics may share stdout */ }
  }
  return null
}

export async function whisperEngineStatus(): Promise<WhisperEngineStatus> {
  const candidates = await engineBundleCandidates()
  if (candidates.length === 0) {
    return { has: false, healthy: false, needsUpdate: false, version: null, protocol: null, engine: null, features: [], message: 'Chưa có Whisper.cpp local bundle.' }
  }
  let last: WhisperBundleProbe | null = null
  for (const bundle of candidates) {
    const checked = await probeWhisperBundle(bundle)
    if (checked.healthy) {
      return {
        has: true,
        healthy: true,
        needsUpdate: false,
        version: checked.versionEvent?.version ?? null,
        protocol: checked.versionEvent?.protocol ?? null,
        engine: checked.versionEvent?.engine ?? null,
        features: checked.versionEvent?.features ?? [],
        message: undefined
      }
    }
    last = checked
  }
  const raw = last
    ? `${last.versionResult.stdout}\n${last.versionResult.stderr}\n${last.probeResult.stdout}\n${last.probeResult.stderr}`
    : ''
  return {
    has: true,
    healthy: false,
    needsUpdate: false,
    version: last?.versionEvent?.version ?? null,
    protocol: last?.versionEvent?.protocol ?? null,
    engine: last?.versionEvent?.engine ?? null,
    features: last?.versionEvent?.features ?? [],
    message: typeof last?.probe?.message === 'string' ? last.probe.message : raw.trim() || 'Whisper worker không trả protocol/version hợp lệ.'
  }
}

async function replaceDirectory(candidate: string, destination: string): Promise<void> {
  const backup = `${destination}.previous`
  await rm(backup, { recursive: true, force: true })
  if (await fileExists(destination)) await rename(destination, backup)
  try {
    await rename(candidate, destination)
    await rm(backup, { recursive: true, force: true })
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => {})
    if (await fileExists(backup)) await rename(backup, destination).catch(() => {})
    throw error
  }
}

export async function installWhisperEngine(onProgress: (percent: number) => void): Promise<void> {
  const destination = runtimeKindDir('whisper-cpp')
  const workerName = isWin() ? 'whisper-local-worker.exe' : 'whisper-local-worker'
  const serverName = isWin() ? 'whisper-server.exe' : 'whisper-server'
  const cliName = isWin() ? 'whisper-cli.exe' : 'whisper-cli'

  const devRoots = runtimeSearchRoots('whisper-cpp')
  let foundCandidate: string | null = null
  for (const root of devRoots) {
    if (root.toLowerCase() === destination.toLowerCase()) continue
    if (
      (await fileExists(join(root, workerName))) &&
      (await fileExists(join(root, serverName))) &&
      (await fileExists(join(root, cliName)))
    ) {
      foundCandidate = root
      break
    }
  }

  if (foundCandidate) {
    const staging = `${destination}.staging`
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    await copyDirectory(foundCandidate, staging)
    onProgress(80)
    await replaceDirectoryAtomic(staging, destination)
  }

  const status = await whisperEngineStatus()
  if (!status.healthy || !status.version || status.protocol !== WHISPER_PROTOCOL) {
    throw new Error(
      status.message || 'Whisper.cpp binary chưa được cài đặt hoặc không qua protocol/version probe.'
    )
  }
  logInfo(`Audio→Text: đã cài Whisper.cpp ${status.version}.`)
}

export async function whisperCudaStatus(): Promise<WhisperCudaStatus> {
  const bundle = await resolveEngineBundle()
  if (!bundle) return { has: false, healthy: false, needsUpdate: false, message: 'Chưa có Whisper.cpp local worker bundle.' }
  const probeResult = await runCapture(bundle.worker, ['--probe', '--device', 'cuda'])
  const probe = parseJsonRecord(probeResult.stdout)
  const has = probeResult.code === 0 && probe?.type === 'probe' && probe.ready === true
  return {
    has,
    healthy: has,
    needsUpdate: false,
    message: has ? undefined : (typeof probe?.message === 'string' ? probe.message : 'Chưa có Whisper.cpp CUDA bundle tương thích.')
  }
}

export async function installCudaPack(onProgress: (percent: number) => void): Promise<void> {
  await installWhisperEngine(onProgress)
  const status = await whisperCudaStatus()
  if (!status.has) throw new Error('Whisper.cpp bundle vừa cài không có CUDA runtime.')
}

class WhisperServerWorker {
  private child: ChildProcess | null = null
  private model: WhisperModelId | null = null
  private device: WhisperDevice | null = null
  private engineVersion: string | null = null
  private stderrTail = ''
  private loadCount = 0
  private stdoutBuffer = ''
  private startupResolve: (() => void) | null = null
  private startupReject: ((error: Error) => void) | null = null
  private pending: WhisperWorkerPending | null = null

  get isRunning(): boolean { return this.child !== null && this.child.exitCode === null }
  get stats(): Pick<WhisperWorkerStats, 'modelLoadCount' | 'currentModel' | 'currentDevice' | 'effectiveDevice'> {
    return { modelLoadCount: this.loadCount, currentModel: this.model, currentDevice: this.device, effectiveDevice: this.device }
  }

  private handleLine(line: string): void {
    let value: unknown
    try { value = JSON.parse(line) as unknown } catch {
      const error = new Error('Whisper worker trả stdout không phải JSON-lines protocol.')
      this.startupReject?.(error)
      if (this.pending) { const pending = this.pending; this.pending = null; pending.reject(error) }
      return
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const event = value as Record<string, unknown>
    if (event.type === 'ready') {
      this.model = event.model === 'base' || event.model === 'small' || event.model === 'medium'
        ? event.model
        : null
      this.device = event.device === 'cuda' || event.device === 'cpu' ? event.device : null
      this.loadCount += 1
      this.startupResolve?.()
      this.startupResolve = null
      this.startupReject = null
      return
    }
    if (event.type === 'progress' && this.pending && event.id === this.pending.id) {
      this.pending.onProgress(
        typeof event.percent === 'number' ? event.percent : -1,
        typeof event.message === 'string' ? event.message : 'Whisper.cpp đang xử lý…'
      )
      return
    }
    if (event.type === 'error') {
      const error = new Error(typeof event.message === 'string' ? event.message : 'Whisper worker báo lỗi.')
      this.startupReject?.(error)
      this.startupResolve = null
      this.startupReject = null
      if (this.pending && (!event.id || event.id === this.pending.id)) {
        const pending = this.pending
        this.pending = null
        pending.reject(error)
      }
      return
    }
    if (event.type === 'done' && this.pending && event.id === this.pending.id) {
      const response = event.response
      if (!response || typeof response !== 'object' || Array.isArray(response)) {
        const pending = this.pending
        this.pending = null
        pending.reject(new Error('Whisper worker trả response không hợp lệ.'))
        return
      }
      const pending = this.pending
      this.pending = null
      pending.onProgress(95, 'Đang ghi phụ đề local…')
      pending.resolve({
        response: response as WhisperServerResponse,
        effectiveDevice: event.effectiveDevice === 'cuda' ? 'cuda' : 'cpu',
        engineVersion: this.engineVersion
      })
    }
  }

  private handleStdout(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString()
    const lines = this.stdoutBuffer.split(/\r?\n/)
    this.stdoutBuffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) this.handleLine(line.trim())
  }

  async start(bundle: WhisperEngineBundle, model: LocalWhisperModel, device: WhisperDevice): Promise<void> {
    await this.stop()
    const versionResult = await runCapture(bundle.worker, ['--version'])
    const version = parseWhisperVersion(versionResult.stdout)
    if (versionResult.code !== 0 || !version) throw new Error('Whisper worker không trả version protocol hợp lệ.')
    this.engineVersion = version.version
    const child = spawn(bundle.worker, ['--daemon', '--model', model.modelPath, '--device', device], {
      cwd: bundle.dir,
      windowsHide: true,
      env: { ...process.env, PATH: bundle.dir + (process.platform === 'win32' ? ';' : ':') + (process.env.PATH ?? '') },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    this.stdoutBuffer = ''
    child.stdout?.on('data', (chunk: Buffer) => this.handleStdout(chunk))
    child.stderr?.on('data', (chunk: Buffer) => { this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-4000) })
    const ready = new Promise<void>((resolve, reject) => { this.startupResolve = resolve; this.startupReject = reject })
    child.on('error', (error) => this.startupReject?.(new Error(errLabel(error))))
    child.on('close', (code) => {
      if (this.child === child) this.child = null
      if (this.startupReject) this.startupReject(new Error('Whisper worker thoát khi load model (code ' + (code ?? '?') + ') ' + this.stderrTail.slice(-500)))
      if (this.pending) {
        const pending = this.pending
        this.pending = null
        pending.reject(new Error('Whisper worker đã dừng.'))
      }
    })
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Whisper worker không ready sau 60 giây.')), 60_000))
    ])
    if (this.model !== model.id || this.device !== device) throw new Error('Whisper worker ready sai model/device.')
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null
    this.model = null
    this.device = null
    if (!child) return
    // EOF lets the Go wrapper run its defer cleanup and terminate the nested
    // whisper-server. A hard kill is only the timeout fallback; otherwise the
    // native server would survive as an orphan on Windows.
    try { child.stdin?.end() } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000)
      child.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    if (child.exitCode === null) {
      try { child.kill() } catch { /* ignore */ }
    }
  }

  async transcribe(
    req: WhisperRequest,
    model: LocalWhisperModel,
    onProgress: (percent: number, message: string) => void,
    signal?: AbortSignal
  ): Promise<WhisperServerWorkerResult> {
    if (!this.isRunning || this.model !== model.id || !this.child?.stdin) throw new Error('Whisper worker chưa sẵn sàng.')
    let wavPath = req.input
    let temporary = false
    try {
      if (!AUDIO_EXTENSIONS.has(extname(req.input).toLowerCase())) {
        const ffmpeg = await resolveFfmpeg()
        if (!ffmpeg) throw new Error('Thiếu ffmpeg để trích xuất audio local từ video.')
        wavPath = join(req.outputDir, '.whisper-' + Date.now() + '.wav')
        await runFfmpegExtract(ffmpeg, req.input, wavPath, signal)
        temporary = true
      }
      const requestId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
      onProgress(10, 'Đang chuyển audio local…')
      const result = await new Promise<WhisperServerWorkerResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (this.pending?.id !== requestId) return
          this.pending = null
          reject(new Error('Whisper worker quá thời gian chờ request.'))
          void this.stop()
        }, 30 * 60 * 1000)
        const abort = (): void => {
          if (this.pending?.id !== requestId) return
          this.pending = null
          clearTimeout(timeout)
          reject(new Error('Đã hủy.'))
          void this.stop()
        }
        if (signal?.aborted) {
          clearTimeout(timeout)
          reject(new Error('Đã hủy.'))
          return
        }
        signal?.addEventListener('abort', abort, { once: true })
        const wrappedResolve = (value: WhisperServerWorkerResult): void => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
          resolve(value)
        }
        const wrappedReject = (error: Error): void => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
          reject(error)
        }
        this.pending = { id: requestId, resolve: wrappedResolve, reject: wrappedReject, onProgress }
        try {
          this.child?.stdin?.write(JSON.stringify({
            type: 'transcribe', id: requestId, input: wavPath,
            language: req.language && req.language !== 'auto' ? req.language : 'auto',
            task: req.task, formats: req.formats, outputDir: req.outputDir, model: model.id
          }) + '\n')
        } catch (error) {
          this.pending = null
          wrappedReject(new Error(errLabel(error)))
        }
      })
      return result
    } finally {
      if (temporary) await rm(wavPath, { force: true }).catch(() => {})
    }
  }

}

async function runFfmpegExtract(ffmpeg: string, input: string, output: string, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output], { windowsHide: true })
    let err = ''
    const abort = (): void => { try { child.kill() } catch { /* ignore */ } }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    child.stderr?.on('data', (chunk) => { err = `${err}${chunk.toString()}`.slice(-1000) })
    child.on('error', (error) => { signal?.removeEventListener('abort', abort); reject(error) })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(new Error('Đã hủy.'))
      else if (code === 0) resolve()
      else reject(new Error(err || `ffmpeg thoát mã ${code ?? '?'}.`))
    })
  })
}

let workerManager: WhisperWorkerManager | null = null

class WhisperWorkerManager {
  private worker: WhisperServerWorker | null = null
  private key = ''
  private queue: Promise<void> = Promise.resolve()
  private starts = 0
  private processed = 0

  private async ensure(model: LocalWhisperModel, device: WhisperDevice): Promise<WhisperServerWorker> {
    const bundle = await resolveEngineBundle()
    if (!bundle) throw new Error('Chưa có Whisper.cpp local bundle.')
    const key = `${model.modelPath}|${device}`
    if (!this.worker || this.key !== key || !this.worker.isRunning) {
      if (this.worker) await this.worker.stop()
      this.worker = new WhisperServerWorker()
      await this.worker.start(bundle, model, device)
      this.key = key
      this.starts += 1
    }
    return this.worker
  }

  enqueue(
    req: WhisperRequest,
    model: LocalWhisperModel,
    onProgress: (percent: number, message: string) => void,
    signal?: AbortSignal
  ): Promise<WhisperServerWorkerResult> {
    const result = this.queue.then(async () => {
      if (signal?.aborted) throw new Error('Đã hủy.')
      const worker = await this.ensure(model, req.device)
      try {
        const value = await worker.transcribe(req, model, onProgress, signal)
        this.processed += 1
        return value
      } catch (error) {
        if (signal?.aborted) await worker.stop()
        else if (!worker.isRunning) {
          // A crashed worker is restarted once for the current request. A
          // second failure is surfaced to the caller instead of looping.
          await worker.stop()
          if (this.worker === worker) {
            this.worker = null
            this.key = ''
          }
          const restarted = await this.ensure(model, req.device)
          const value = await restarted.transcribe(req, model, onProgress, signal)
          this.processed += 1
          return value
        }
        throw error
      }
    })
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  async probe(model: LocalWhisperModel, device: WhisperDevice): Promise<{ ready: boolean; message?: string }> {
    try {
      await this.queue
      await this.ensure(model, device)
      return { ready: true }
    } catch (error) {
      return { ready: false, message: errLabel(error) }
    }
  }

  async stop(): Promise<void> {
    await this.queue.catch(() => {})
    await this.worker?.stop()
    this.worker = null
    this.key = ''
  }

  stats(): WhisperWorkerStats {
    const current = this.worker?.stats
    return {
      workerStartCount: this.starts,
      modelLoadCount: current?.modelLoadCount ?? 0,
      processedRequestCount: this.processed,
      currentModel: current?.currentModel ?? null,
      currentDevice: current?.currentDevice ?? null,
      effectiveDevice: current?.effectiveDevice ?? null
    }
  }
}

function getWorkerManager(): WhisperWorkerManager {
  workerManager ??= new WhisperWorkerManager()
  return workerManager
}

export async function whisperWorkerStats(): Promise<WhisperWorkerStats> {
  return getWorkerManager().stats()
}

export async function stopWhisperWorker(): Promise<void> {
  await workerManager?.stop()
}

export async function whisperRuntimeProbe(model: string, device: WhisperDevice): Promise<{ ready: boolean; message?: string }> {
  const engine = await whisperEngineStatus()
  if (!engine.healthy) return { ready: false, message: engine.message || 'Whisper.cpp engine chưa sẵn sàng.' }
  const status = await whisperModelStatus(model)
  if (!status.complete || !status.path) return { ready: false, message: status.message }
  if (device === 'cuda' && !(await whisperCudaStatus()).has) return { ready: false, message: 'Chưa có CUDA bundle cho Whisper.cpp.' }
  const found = await findLocalWhisperModel(normalizeWhisperModel(model), modelRoots())
  if (!found) return { ready: false, message: 'Không tìm thấy model local sau khi kiểm tra.' }
  return getWorkerManager().probe(found, device)
}

function secondsToSrt(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const millis = Math.round(safe * 1000)
  const ms = millis % 1000
  const total = Math.floor(millis / 1000)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function secondsToVtt(seconds: number): string {
  return secondsToSrt(seconds).replace(',', '.')
}

function segmentValues(segment: WhisperSegment, index: number): { id: number; start: number; end: number; text: string; words: Array<{ text: string; start: number; end: number; probability: number | null }> } {
  const start = Number(segment.start)
  const end = Number(segment.end)
  const text = typeof segment.text === 'string' ? segment.text.trim() : ''
  const words = Array.isArray(segment.words)
    ? segment.words.map((word) => ({
      text: typeof word.word === 'string' ? word.word : '',
      start: Number(word.start),
      end: Number(word.end ?? word.start),
      probability: Number.isFinite(Number(word.probability)) ? Number(word.probability) : null
    })).filter((word) => word.text.trim().length > 0 && Number.isFinite(word.start))
    : []
  return {
    id: Number.isFinite(Number(segment.id)) ? Number(segment.id) + 1 : index + 1,
    start: Number.isFinite(start) ? start : 0,
    end: Number.isFinite(end) && end > start ? end : start + 0.05,
    text,
    words
  }
}

async function writeWhisperOutputs(req: WhisperRequest, response: WhisperServerResponse): Promise<{ outputs: string[]; segments: number; alignmentPath: string; coverage: number | null }> {
  await mkdir(req.outputDir, { recursive: true })
  const segments = (Array.isArray(response.segments) ? response.segments : []).map(segmentValues).filter((segment) => segment.text.length > 0)
  if (segments.length === 0) throw new Error('Whisper.cpp không tạo được cue phụ đề hợp lệ.')
  const base = join(req.outputDir, basename(req.input).replace(/\.[^.]+$/, ''))
  const formats = (req.formats.length ? req.formats : ['srt']).map((format) => format.replace(/^\./, '').toLowerCase())
  const outputs: string[] = []
  const srt = segments.map((segment) => `${segment.id}\n${secondsToSrt(segment.start)} --> ${secondsToSrt(segment.end)}\n${segment.text}\n`).join('\n')
  const vtt = `WEBVTT\n\n${segments.map((segment) => `${secondsToVtt(segment.start)} --> ${secondsToVtt(segment.end)}\n${segment.text}\n`).join('\n')}`
  const txt = segments.map((segment) => segment.text).join('\n') + '\n'
  const alignmentSegments = segments.map((segment) => ({
    id: segment.id,
    start: segment.start,
    end: segment.end,
    text: segment.text,
    words: segment.words
  }))
  const alignment = JSON.stringify({
    engine: 'whisper.cpp',
    model: req.model,
    segments: alignmentSegments,
    cues: alignmentSegments
  }, null, 2) + '\n'
  const alignmentPath = `${base}.alignment.json`
  await writeAtomic(alignmentPath, alignment)
  for (const format of formats) {
    if (format === 'srt') {
      const path = `${base}.srt`
      await writeAtomic(path, srt)
      outputs.push(path)
    } else if (format === 'vtt') {
      const path = `${base}.vtt`
      await writeAtomic(path, vtt)
      outputs.push(path)
    } else if (format === 'txt') {
      const path = `${base}.txt`
      await writeAtomic(path, txt)
      outputs.push(path)
    } else if (format === 'json') {
      const path = `${base}.json`
      await writeAtomic(path, alignment)
      outputs.push(path)
    }
  }
  return {
    outputs,
    segments: segments.length,
    alignmentPath,
    coverage: Number.isFinite(Number(response.duration)) ? Number(response.duration) : segments[segments.length - 1].end
  }
}

function errorResult(id: string, req: WhisperRequest, error: string, effectiveDevice?: WhisperDevice): WhisperResult {
  return { id, ok: false, outputs: [], segments: 0, speakers: 0, error, language: null, requestedDevice: req.device, effectiveDevice }
}

export async function transcribeAudio(
  id: string,
  req: WhisperRequest,
  onProgress: (p: WhisperProgress) => void,
  signal?: AbortSignal
): Promise<WhisperResult> {
  const modelId = normalizeWhisperModel(req.model)
  const normalizedReq: WhisperRequest = { ...req, model: modelId }
  if (req.diarize) return errorResult(id, normalizedReq, 'Whisper.cpp local chưa hỗ trợ diarization; đã dừng để tránh trả kết quả speaker giả.')
  const engine = await whisperEngineStatus()
  if (!engine.healthy) return errorResult(id, normalizedReq, engine.message || 'Chưa có Whisper.cpp local engine.')
  const model = await findLocalWhisperModel(modelId, modelRoots())
  if (!model) {
    const status = await whisperModelStatus(modelId)
    return errorResult(id, normalizedReq, status.message || `Model ${modelId} chưa sẵn sàng.`)
  }
  if (normalizedReq.device === 'cuda' && !(await whisperCudaStatus()).has) {
    return errorResult(id, normalizedReq, 'Chưa có CUDA bundle Whisper.cpp tương thích; không chuyển âm thầm sang CPU.')
  }
  logInfo(`Audio→Text local: bắt đầu ${basename(req.input)} (model ${modelId}, ${req.task}, ${req.device.toUpperCase()})`)
  onProgress({ id, status: 'preparing', percent: -1, language: null, line: `Đang chuẩn bị Whisper.cpp ${modelId}…` })
  try {
    const result = await getWorkerManager().enqueue(normalizedReq, model, (percent, message) => {
      onProgress({ id, status: 'transcribing', percent, language: null, line: message })
    }, signal)
    const output = await writeWhisperOutputs(normalizedReq, result.response)
    if (!output.outputs.length) throw new Error('Không có định dạng đầu ra được tạo.')
    const language = typeof result.response.language === 'string' ? result.response.language : null
    onProgress({ id, status: 'finished', percent: 100, language, line: null })
    logInfo(`Audio→Text local: hoàn tất ${output.segments} cue bằng ${result.effectiveDevice.toUpperCase()}.`)
    return {
      id,
      ok: true,
      outputs: output.outputs,
      segments: output.segments,
      speakers: 0,
      error: null,
      language,
      requestedDevice: req.device,
      effectiveDevice: result.effectiveDevice,
      engineVersion: result.engineVersion,
      alignmentPath: output.alignmentPath,
      coverage: output.coverage
    }
  } catch (error) {
    const message = errLabel(error)
    debugRaw('whisper local inference', error)
    logError(`Audio→Text local: ${message}`)
    onProgress({ id, status: 'error', percent: -1, language: null, line: message })
    return errorResult(id, normalizedReq, message, req.device)
  }
}

export async function whisperCudaProbe(modelId = 'base'): Promise<{ ready: boolean; message?: string }> {
  const status = await whisperCudaStatus()
  if (!status.has) return { ready: false, message: status.message }
  const model = await whisperModelStatus(modelId)
  if (!model.complete) return { ready: false, message: `Cần model ${model.id} để probe CUDA thật.` }
  return whisperRuntimeProbe(model.id, 'cuda')
}

export async function shutdownWhisperRuntime(): Promise<void> {
  await stopWhisperWorker()
}
