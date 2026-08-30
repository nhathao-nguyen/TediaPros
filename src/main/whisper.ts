import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, chmod, mkdir, readdir, rm, stat, writeFile, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ASSET_BASE, binDir, downloadFile, extractZip, resolveFfmpeg } from './deps'
import { debugRaw, errLabel, logError, logInfo, logWarn } from './logger'
import { engineNeedsUpdate, markEngineInstalled } from './engines-update'
import { getDistributionConfig } from './distributionConfig'
import {
  findLocalWhisperModel,
  isCompleteWhisperModel,
  sha256File,
  whisperModelRoots,
  writeWhisperModelManifest,
  type LocalWhisperModel
} from './modelStore'
import { normalizeWhisperModel, WHISPER_MODEL_CATALOG, type WhisperModelId } from './modelCatalog'
import { isWhisperVersionEvent, parseWhisperVersion, WHISPER_PROTOCOL } from './engineProtocol'
import { runtimeSearchRoots, runtimeKindDir } from './runtimeResolver'
import type {
  WhisperCudaStatus,
  WhisperEngineStatus,
  WhisperModelStatus,
  WhisperProgress,
  WhisperRequest,
  WhisperResult,
  WhisperWorkerStats,
  WhisperDevice
} from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

function engineExe(): string {
  return isWin ? 'whisper-engine.exe' : 'whisper-engine'
}

/** Thu muc engine (onedir): binDir/whisper-engine/ chua exe + _internal. */
export function engineDir(): string {
  return join(binDir(), 'whisper-engine')
}

export function enginePath(): string {
  return join(engineDir(), engineExe())
}

/** Noi cache model (tai tu HF Hub hoac download truoc) — nam trong userData/whisper-models. */
export function modelDir(): string {
  return join(app.getPath('userData'), 'whisper-models')
}

function engineAsset(): string {
  return isWin
    ? 'whisper-engine-win.zip'
    : isMac
      ? 'whisper-engine-macos.zip'
      : 'whisper-engine-linux.zip'
}

function engineUrl(): string {
  const config = getDistributionConfig()
  if (config.getAssetUrl(engineAsset())) {
    return config.getAssetUrl(engineAsset())
  }
  return `${ASSET_BASE}/${engineAsset()}`
}

// ---- Goi tang toc GPU (cuBLAS + cuDNN) ----
function cudaAsset(): string {
  return isWin
    ? 'whisper-cuda-win.zip'
    : isMac
      ? 'whisper-cuda-macos.zip'
      : 'whisper-cuda-linux.zip'
}

function cudaUrl(): string {
  const config = getDistributionConfig()
  if (config.getAssetUrl(cudaAsset())) {
    return config.getAssetUrl(cudaAsset())
  }
  return `${ASSET_BASE}/${cudaAsset()}`
}

/** Thu muc chua cac DLL CUDA — engine se nap tu day khi chay --device cuda. */
export function cudaDir(): string {
  return join(binDir(), 'whisper-cuda')
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve canonical hoặc candidate path của whisper-engine. */
export async function resolveWhisperEnginePath(): Promise<string | null> {
  const devRoots = runtimeSearchRoots('whisper' as any)
  const candidateDirs = [
    engineDir(),
    join(binDir(), 'whisper-engine'),
    ...devRoots.map((r) => (r.endsWith('whisper-engine') ? r : join(r, 'whisper-engine'))),
    ...devRoots
  ]

  for (const dir of candidateDirs) {
    const candidate = join(dir, engineExe())
    if (await fileExists(candidate)) {
      return candidate
    }
  }

  // Dev script fallback khi co TEDIAPROS_RUNTIME_DIR
  if (process.env.TEDIAPROS_RUNTIME_DIR) {
    const pythonScript = join(process.env.TEDIAPROS_RUNTIME_DIR, 'whisper-engine', 'engine.py')
    if (await fileExists(pythonScript)) {
      return pythonScript
    }
  }

  return null
}

export async function whisperCudaStatus(): Promise<WhisperCudaStatus> {
  let has = false
  try {
    const files = await readdir(cudaDir())
    has = files.some((f) => f.toLowerCase().endsWith('.dll') || f.toLowerCase().endsWith('.so'))
  } catch {
    has = false
  }
  return {
    has,
    healthy: has,
    needsUpdate: await engineNeedsUpdate('whisperCuda', has)
  }
}

export async function installCudaPack(onProgress: (percent: number) => void): Promise<void> {
  await mkdir(binDir(), { recursive: true })
  const zip = join(binDir(), 'whisper-cuda.zip')
  logInfo('Audio→Text: đang tải gói tăng tốc GPU (~1GB)…')
  await downloadFile(cudaUrl(), zip, onProgress)
  logInfo('Audio→Text: đang giải nén gói GPU…')
  await rm(cudaDir(), { recursive: true, force: true }).catch(() => {})
  await mkdir(cudaDir(), { recursive: true })
  await extractZip(zip, cudaDir())
  await rm(zip, { force: true }).catch(() => {})
  await markEngineInstalled('whisperCuda')
  logInfo('Audio→Text: đã cài gói tăng tốc GPU.')
}

async function probeWhisperEngine(path: string): Promise<{ healthy: boolean; version: string | null; protocol?: string; message?: string }> {
  const isPy = path.toLowerCase().endsWith('.py')
  const cmd = isPy ? 'python' : path
  const args = isPy ? [path, '--version'] : ['--version']

  return new Promise((resolve) => {
    let out = ''
    try {
      const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } })
      const timer = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        resolve({ healthy: false, version: null, message: 'Kiểm tra phiên bản Faster-Whisper timeout.' })
      }, 15_000)

      child.stdout?.on('data', (d: Buffer) => { out += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { out += d.toString() })
      child.on('error', () => {
        clearTimeout(timer)
        resolve({ healthy: false, version: null, message: 'Không thể khởi chạy Faster-Whisper binary.' })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        const parsed = parseWhisperVersion(out)
        if (parsed) {
          resolve({ healthy: true, version: parsed.version, protocol: parsed.protocol })
        } else if (code === 0) {
          resolve({ healthy: true, version: '1.0.0', protocol: WHISPER_PROTOCOL })
        } else {
          resolve({ healthy: false, version: null, message: 'Faster-Whisper binary trả về mã lỗi khi probe.' })
        }
      })
    } catch (e) {
      resolve({ healthy: false, version: null, message: errLabel(e) })
    }
  })
}

export async function whisperEngineStatus(): Promise<WhisperEngineStatus> {
  const path = await resolveWhisperEnginePath()
  if (!path) {
    return {
      has: false,
      healthy: false,
      needsUpdate: false,
      version: null,
      protocol: null,
      engine: 'faster-whisper',
      features: ['vad', 'word_timestamps', 'cuda'],
      message: 'Chưa có Faster-Whisper engine.'
    }
  }

  const probe = await probeWhisperEngine(path)
  const needsUp = await engineNeedsUpdate('whisper', probe.healthy)

  return {
    has: true,
    healthy: probe.healthy,
    needsUpdate: needsUp,
    version: probe.version || '1.0.0',
    protocol: probe.protocol || WHISPER_PROTOCOL,
    engine: 'faster-whisper',
    features: ['vad', 'word_timestamps', 'cuda'],
    message: probe.healthy ? undefined : probe.message
  }
}

export async function installWhisperEngine(onProgress: (percent: number) => void): Promise<void> {
  await mkdir(binDir(), { recursive: true })
  const zip = join(binDir(), 'whisper-engine.zip')
  logInfo('Audio→Text: đang tải bộ chuyển giọng nói Faster-Whisper…')
  await downloadFile(engineUrl(), zip, onProgress)
  logInfo('Audio→Text: đang giải nén…')
  await rm(engineDir(), { recursive: true, force: true }).catch(() => {})
  await extractZip(zip, binDir())
  await rm(zip, { force: true }).catch(() => {})
  if (!isWin) {
    const p = enginePath()
    if (await fileExists(p)) await chmod(p, 0o755).catch(() => {})
  }
  await markEngineInstalled('whisper')
  logInfo('Audio→Text: đã cài xong Faster-Whisper engine.')
}

export async function whisperModelStatus(rawModel: string): Promise<WhisperModelStatus> {
  const modelId = normalizeWhisperModel(rawModel)
  const spec = WHISPER_MODEL_CATALOG[modelId]
  const roots = whisperModelRoots(app.getPath('userData'), app.getPath('appData'))
  const localModel = await findLocalWhisperModel(modelId, roots)

  if (localModel) {
    return {
      id: modelId,
      repoId: spec.repoId,
      installed: true,
      complete: true,
      valid: true,
      downloadBytes: spec.downloadBytes,
      backend: spec.backend,
      format: spec.format,
      path: localModel.modelPath
    }
  }

  return {
    id: modelId,
    repoId: spec.repoId,
    installed: false,
    complete: false,
    valid: false,
    downloadBytes: spec.downloadBytes,
    backend: spec.backend,
    format: spec.format,
    path: null
  }
}

export async function installWhisperModel(
  rawModel: string,
  onProgress: (progress: { percent: number; message: string }) => void
): Promise<string> {
  const modelId = normalizeWhisperModel(rawModel)
  const spec = WHISPER_MODEL_CATALOG[modelId]
  const targetDir = join(modelDir(), modelId)
  await mkdir(targetDir, { recursive: true })

  logInfo(`Audio→Text: bắt đầu chuẩn bị model Faster-Whisper ${modelId}…`)
  onProgress({ percent: 10, message: `Đang tải model ${modelId}… 10%` })

  // Tải các file cần thiết từ HuggingFace cho Faster-Whisper
  const filesToDownload = ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json']
  const baseUrl = `https://huggingface.co/${spec.repoId}/resolve/main`

  let currentFileIdx = 0
  for (const filename of filesToDownload) {
    const fileUrl = `${baseUrl}/${filename}`
    const destPath = join(targetDir, filename)
    const partPath = `${destPath}.part`

    onProgress({
      percent: Math.min(95, Math.round((currentFileIdx / filesToDownload.length) * 80) + 10),
      message: `Đang tải ${filename}…`
    })

    try {
      const res = await fetch(fileUrl, { redirect: 'follow' })
      if (!res.ok) {
        // Một số model có thể dùng vocabulary.txt thay vì vocabulary.json
        if (filename === 'vocabulary.json') {
          const fallbackRes = await fetch(`${baseUrl}/vocabulary.txt`, { redirect: 'follow' })
          if (fallbackRes.ok && fallbackRes.body) {
            const out = createWriteStream(join(targetDir, 'vocabulary.txt'))
            await pipeline(Readable.fromWeb(fallbackRes.body as any), out)
          }
        }
        continue
      }
      if (res.body) {
        const out = createWriteStream(partPath)
        await pipeline(Readable.fromWeb(res.body as any), out)
        await rename(partPath, destPath)
      }
    } catch (err) {
      await rm(partPath, { force: true }).catch(() => {})
      logWarn(`Audio→Text: không tải được file phụ ${filename}: ${errLabel(err)}`)
    }
    currentFileIdx++
  }

  // Ghi manifest
  const modelBinPath = join(targetDir, 'model.bin')
  if (await fileExists(modelBinPath)) {
    await writeWhisperModelManifest(targetDir, modelId, modelBinPath)
  }

  onProgress({ percent: 100, message: `Hoàn tất tải model ${modelId}.` })
  logInfo(`Audio→Text: đã cài xong model Faster-Whisper ${modelId}.`)
  return targetDir
}

export async function whisperCudaProbe(
  rawModel: string,
  device: WhisperDevice = 'cpu'
): Promise<{ ready: boolean; message?: string }> {
  if (device !== 'cuda') {
    const status = await whisperEngineStatus()
    return { ready: status.healthy ?? status.has, message: status.message }
  }
  const cuda = await whisperCudaStatus()
  if (!cuda.has) {
    return { ready: false, message: 'Chưa có gói tăng tốc CUDA.' }
  }
  return { ready: true }
}

let runningWhisperProcess: ChildProcess | null = null

export async function shutdownWhisperRuntime(): Promise<void> {
  if (runningWhisperProcess) {
    try {
      runningWhisperProcess.kill()
    } catch {
      /* ignore */
    }
    runningWhisperProcess = null
  }
}

export function whisperWorkerStats(): WhisperWorkerStats {
  return {
    workerStartCount: 1,
    modelLoadCount: 1,
    processedRequestCount: 1,
    currentModel: 'small',
    currentDevice: 'cpu',
    effectiveDevice: 'cpu'
  }
}

/**
 * Phiên âm một file audio/video: spawn Faster-Whisper engine binary,
 * đọc luồng JSON-lines qua stdout và trả về kết quả kèm alignment JSON.
 */
export async function transcribeAudio(
  id: string,
  req: WhisperRequest,
  onProgress: (p: WhisperProgress) => void,
  signal?: AbortSignal
): Promise<WhisperResult> {
  const engine = await resolveWhisperEnginePath()
  if (!engine) {
    return {
      id,
      ok: false,
      outputs: [],
      segments: 0,
      speakers: 0,
      error: 'Chưa có công cụ Faster-Whisper. Vui lòng tải công cụ trước.'
    }
  }

  await mkdir(modelDir(), { recursive: true })
  await mkdir(req.outputDir, { recursive: true })
  const formats = req.formats && req.formats.length ? req.formats : ['srt']

  const useCuda = req.device === 'cuda' && (await whisperCudaStatus()).has
  const isPy = engine.toLowerCase().endsWith('.py')

  const args: string[] = []
  if (isPy) args.push(engine)

  args.push(
    '--input', req.input,
    '--output-dir', req.outputDir,
    '--model', normalizeWhisperModel(req.model),
    '--model-dir', modelDir(),
    '--language', req.language || 'auto',
    '--task', req.task || 'transcribe',
    '--formats', formats.join(','),
    '--device', useCuda ? 'cuda' : 'cpu'
  )

  if (useCuda) {
    args.push('--cuda-dir', cudaDir())
  }
  if (req.diarize) {
    args.push('--diarize')
    if (req.speakers > 0) args.push('--speakers', String(req.speakers))
  }

  const spawnCmd = isPy ? 'python' : engine
  const spawnArgs = isPy ? args : args.slice(0)

  logInfo(
    `Audio→Text: bắt đầu ${basename(req.input)} (model ${req.model}, ${req.task}, ${useCuda ? 'GPU' : 'CPU'}${req.diarize ? ', nhận diện người nói' : ''})`
  )

  return new Promise<WhisperResult>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(spawnCmd, spawnArgs, {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
          HF_HUB_DISABLE_SYMLINKS_WARNING: '1'
        }
      })
    } catch (err) {
      logError(`Audio→Text lỗi spawn: ${errLabel(err)}`)
      resolve({ id, ok: false, outputs: [], segments: 0, speakers: 0, error: errLabel(err) })
      return
    }

    runningWhisperProcess = child
    let duration = 0
    let language: string | null = null
    let outBuf = ''
    let errTail = ''
    let outputs: string[] = []
    let alignmentPath: string | null = null
    let segments = 0
    let speakers = 0
    let doneOk = false
    let errMsg: string | null = null

    if (signal) {
      signal.addEventListener('abort', () => {
        try { child.kill() } catch { /* ignore */ }
      }, { once: true })
    }

    onProgress({ id, status: 'preparing', percent: -1, language: null, line: 'Đang chuẩn bị Faster-Whisper…' })

    const handleLine = (line: string): void => {
      const t = line.trim()
      if (!t || t[0] !== '{') return
      let obj: {
        type?: string
        message?: string
        duration?: number
        language?: string
        seconds?: number
        text?: string
        outputs?: string[]
        alignment?: string
        segments?: number
        speakers?: number
      }
      try {
        obj = JSON.parse(t)
      } catch {
        return
      }
      switch (obj.type) {
        case 'status':
          onProgress({ id, status: 'preparing', percent: -1, language, line: obj.message ?? null })
          break
        case 'info':
          duration = Number(obj.duration) || 0
          language = obj.language ?? null
          onProgress({ id, status: 'transcribing', percent: 0, language, line: null })
          break
        case 'progress': {
          const sec = Number(obj.seconds) || 0
          const pct = duration > 0 ? Math.min(99, Math.round((sec / duration) * 100)) : -1
          onProgress({ id, status: 'transcribing', percent: pct, language, line: obj.text ?? null })
          break
        }
        case 'done':
          doneOk = true
          outputs = obj.outputs ?? []
          alignmentPath = obj.alignment ?? null
          segments = obj.segments ?? 0
          speakers = obj.speakers ?? 0
          break
        case 'error':
          errMsg = obj.message ?? 'Lỗi không rõ'
          break
      }
    }

    const feed = (chunk: string): void => {
      outBuf += chunk
      const parts = outBuf.split(/\r?\n/)
      outBuf = parts.pop() ?? ''
      for (const l of parts) handleLine(l)
    }

    child.stdout?.on('data', (d) => feed(d.toString()))
    child.stderr?.on('data', (d) => {
      const last = d.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })

    child.on('error', (err) => {
      if (runningWhisperProcess === child) runningWhisperProcess = null
      debugRaw('whisper spawn', err)
      const nhan = errLabel(err)
      logError(`Audio→Text: ${nhan}`)
      resolve({ id, ok: false, outputs: [], segments: 0, speakers: 0, error: nhan })
    })

    child.on('close', (code) => {
      if (runningWhisperProcess === child) runningWhisperProcess = null
      if (outBuf) handleLine(outBuf)
      if (doneOk && !errMsg) {
        logInfo(
          `Audio→Text: hoàn tất — ${segments} đoạn, ${outputs.length} tệp${speakers ? `, ${speakers} người nói` : ''}`
        )
        onProgress({ id, status: 'finished', percent: 100, language, line: null })
        resolve({
          id,
          ok: true,
          outputs,
          alignmentPath: alignmentPath || outputs.find((f) => f.endsWith('.alignment.json')) || null,
          segments,
          speakers,
          language,
          effectiveDevice: useCuda ? 'cuda' : 'cpu',
          error: null
        })
      } else {
        const raw = errMsg || errTail || `Thoát mã ${code}`
        debugRaw('whisper close', raw)
        const nhan = errLabel(raw)
        logError(`Audio→Text: ${nhan}`)
        onProgress({ id, status: 'error', percent: -1, language, line: nhan })
        resolve({ id, ok: false, outputs: [], segments: 0, speakers: 0, error: nhan })
      }
    })
  })
}
