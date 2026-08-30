import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rm, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { debugRaw, errLabel, logError, logInfo, logWarn } from './logger'
import {
  findLocalWhisperModel,
  isCompleteWhisperModel,
  whisperModelRoots,
  writeWhisperModelManifest
} from './modelStore'
import { normalizeWhisperModel, WHISPER_MODEL_CATALOG } from './modelCatalog'
import { probeRuntimeExecutable } from './runtimeProbes'
import { replaceDirectoryAtomic } from './localAssets'
import { runtimeKindDir, modelRoot } from './runtimeResolver'
import type {
  WhisperCudaStatus,
  WhisperEngineStatus,
  WhisperModelStatus,
  WhisperProgress,
  WhisperRequest,
  WhisperResult,
  WhisperDevice
} from '../shared/types'

const isWin = process.platform === 'win32'

function engineExe(): string {
  return isWin ? 'whisper-engine.exe' : 'whisper-engine'
}

export function engineDir(): string {
  return runtimeKindDir('whisper-engine')
}

export function enginePath(): string {
  return join(engineDir(), engineExe())
}

export function modelDir(): string {
  return modelRoot()
}

export function cudaDir(): string {
  return runtimeKindDir('whisper-cuda')
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function runProbe(command: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let child: ChildProcess | undefined
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, output })
    }
    try {
      child = spawn(command, args, { windowsHide: true, cwd: dirname(command) })
      timer = setTimeout(() => {
        try { child?.kill() } catch { /* best effort */ }
        finish(-1)
      }, timeoutMs)
      child.stdout?.on('data', (data) => { output += data.toString() })
      child.stderr?.on('data', (data) => { output += data.toString() })
      child.on('error', () => finish(-1))
      child.on('close', (code) => finish(code ?? -1))
    } catch {
      finish(-1)
    }
  })
}

async function probeWhisperModel(modelPath: string, device: WhisperDevice): Promise<{ ready: boolean; message?: string }> {
  const engine = await resolveWhisperEnginePath()
  if (!engine) return { ready: false, message: 'Chưa có Faster-Whisper engine để kiểm tra model.' }
  const args = ['--probe', '--device', device, '--model-path', modelPath]
  if (device === 'cuda') args.push('--cuda-dir', cudaDir())
  const result = await runProbe(engine, args)
  const ready = result.code === 0 && result.output.split(/\r?\n/).some((line) => {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      return value.type === 'probe' && value.ready === true && value.modelLoaded === true && value.device === device
    } catch {
      return false
    }
  })
  return ready ? { ready: true } : { ready: false, message: 'Faster-Whisper không load được model local.' }
}

export async function resolveWhisperEnginePath(): Promise<string | null> {
  const path = enginePath()
  return (await fileExists(path)) ? path : null
}

export async function whisperCudaStatus(): Promise<WhisperCudaStatus> {
  const hasFiles = await fileExists(cudaDir())
  if (!hasFiles) return { has: false, healthy: false, needsUpdate: false, message: 'Chưa có gói tăng tốc CUDA.' }
  const probe = await probeRuntimeExecutable('whisper-cuda', cudaDir())
  return {
    has: true,
    healthy: probe.healthy,
    needsUpdate: false,
    message: probe.message
  }
}

export async function installCudaPack(onProgress: (percent: number) => void): Promise<void> {
  logInfo('Audio→Text: đang tải gói tăng tốc GPU…')
  const { downloadRuntimeEngineFromManifest } = await import('./runtimeInstaller')
  const installed = await downloadRuntimeEngineFromManifest('whisper-cuda', (percent) => onProgress(percent))
  if (!installed) throw new Error('Không có asset CUDA phù hợp trong runtime manifest.')
  logInfo('Audio→Text: đã cài và probe xong gói tăng tốc CUDA.')
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
      features: ['probe', 'vad', 'word_timestamps', 'cuda'],
      message: 'Chưa có Faster-Whisper engine.'
    }
  }
  const probe = await probeRuntimeExecutable('whisper-engine', path)
  return {
    has: true,
    healthy: probe.healthy,
    needsUpdate: false,
    version: probe.version || null,
    protocol: probe.protocol || null,
    engine: 'faster-whisper',
    features: ['probe', 'vad', 'word_timestamps', 'cuda'],
    message: probe.message
  }
}

export async function installWhisperEngine(onProgress: (percent: number) => void): Promise<void> {
  logInfo('Audio→Text: đang tải bộ chuyển giọng nói Faster-Whisper…')
  const { downloadRuntimeEngineFromManifest } = await import('./runtimeInstaller')
  const installed = await downloadRuntimeEngineFromManifest('whisper-engine', (percent) => onProgress(percent))
  if (!installed) throw new Error('Không có asset Faster-Whisper phù hợp trong runtime manifest.')
  logInfo('Audio→Text: đã cài và probe xong Faster-Whisper engine.')
}

export async function whisperModelStatus(rawModel: string): Promise<WhisperModelStatus> {
  const modelId = normalizeWhisperModel(rawModel)
  const spec = WHISPER_MODEL_CATALOG[modelId]
  const localModel = await findLocalWhisperModel(modelId, whisperModelRoots(app.getPath('userData')))
  return localModel
    ? {
        id: modelId,
        repoId: spec.repoId,
        installed: true,
        complete: true,
        valid: true,
        downloadBytes: spec.downloadBytes,
        path: localModel.modelPath,
        sha256: localModel.manifest.files.find((file) => file.path === 'model.bin')?.sha256 || null
      }
    : {
        id: modelId,
        repoId: spec.repoId,
        installed: false,
        complete: false,
        valid: false,
        downloadBytes: spec.downloadBytes,
        path: null
      }
}

async function downloadModelFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`Model file download failed (${response.status}).`)
  const part = `${destination}.part`
  try {
    await pipeline(Readable.fromWeb(response.body as import('stream/web').ReadableStream), createWriteStream(part))
    await rename(part, destination)
  } finally {
    await rm(part, { force: true }).catch(() => {})
  }
}

export async function installWhisperModel(
  rawModel: string,
  onProgress: (progress: { percent: number; message: string }) => void
): Promise<string> {
  const modelId = normalizeWhisperModel(rawModel)
  const spec = WHISPER_MODEL_CATALOG[modelId]
  const targetDir = join(modelDir(), modelId)
  const stagingDir = `${targetDir}.staging`
  await rm(stagingDir, { recursive: true, force: true })
  await mkdir(stagingDir, { recursive: true })
  const requiredFiles = ['model.bin', 'config.json', 'tokenizer.json']
  onProgress({ percent: 5, message: `Đang chuẩn bị model ${modelId}…` })
  try {
    for (let index = 0; index < requiredFiles.length; index++) {
      const filename = requiredFiles[index]
      onProgress({ percent: 10 + Math.round((index / 4) * 65), message: `Đang tải ${filename}…` })
      await downloadModelFile(`https://huggingface.co/${spec.repoId}/resolve/${spec.revision}/${filename}`, join(stagingDir, filename))
    }
    let vocabulary = 'vocabulary.json'
    try {
      await downloadModelFile(`https://huggingface.co/${spec.repoId}/resolve/${spec.revision}/${vocabulary}`, join(stagingDir, vocabulary))
    } catch {
      vocabulary = 'vocabulary.txt'
      await downloadModelFile(`https://huggingface.co/${spec.repoId}/resolve/${spec.revision}/${vocabulary}`, join(stagingDir, vocabulary))
    }
    await writeWhisperModelManifest(stagingDir, modelId, spec.repoId, spec.revision)
    if (!(await isCompleteWhisperModel(stagingDir, modelId))) throw new Error('Model Faster-Whisper chưa đủ file hoặc checksum không hợp lệ.')
    onProgress({ percent: 90, message: 'Đang load thử model bằng Faster-Whisper…' })
    const probe = await probeWhisperModel(stagingDir, 'cpu')
    if (!probe.ready) throw new Error(probe.message || 'Model Faster-Whisper không load được.')
    await replaceDirectoryAtomic(stagingDir, targetDir)
    onProgress({ percent: 100, message: `Hoàn tất tải model ${modelId}.` })
    return targetDir
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function whisperCudaProbe(
  rawModel: string,
  device: WhisperDevice = 'cpu'
): Promise<{ ready: boolean; message?: string }> {
  const model = await whisperModelStatus(rawModel)
  if (!model.complete || !model.path) return { ready: false, message: 'Chưa có model Faster-Whisper hoàn chỉnh.' }
  if (device === 'cuda') {
    const cuda = await whisperCudaStatus()
    if (!cuda.healthy) return { ready: false, message: cuda.message || 'CUDA probe thất bại.' }
  }
  return probeWhisperModel(model.path, device)
}

let runningWhisperProcess: ChildProcess | null = null

export async function shutdownWhisperRuntime(): Promise<void> {
  if (!runningWhisperProcess) return
  try { runningWhisperProcess.kill() } catch { /* best effort */ }
  runningWhisperProcess = null
}

export async function transcribeAudio(
  id: string,
  req: WhisperRequest,
  onProgress: (p: WhisperProgress) => void,
  signal?: AbortSignal
): Promise<WhisperResult> {
  const engine = await resolveWhisperEnginePath()
  if (!engine) return { id, ok: false, outputs: [], segments: 0, speakers: 0, error: 'Chưa có công cụ Faster-Whisper. Vui lòng tải công cụ trước.' }
  const model = await whisperModelStatus(req.model)
  if (!model.complete || !model.path) return { id, ok: false, outputs: [], segments: 0, speakers: 0, error: 'Chưa có model Faster-Whisper hoàn chỉnh. Vui lòng tải model trước.' }
  await mkdir(req.outputDir, { recursive: true })
  const formats = req.formats?.length ? req.formats : ['srt']
  let useCuda = false
  if (req.device === 'cuda') {
    const cuda = await whisperCudaProbe(req.model, 'cuda')
    useCuda = cuda.ready
    if (!useCuda) logWarn(`Audio→Text: CUDA không sẵn sàng, chuyển sang CPU. ${cuda.message || ''}`)
  }
  const effectiveDevice: WhisperDevice = useCuda ? 'cuda' : 'cpu'
  const args = [
    '--input', req.input,
    '--output-dir', req.outputDir,
    '--model-path', model.path,
    '--language', req.language || 'auto',
    '--task', req.task || 'transcribe',
    '--formats', formats.join(','),
    '--device', effectiveDevice
  ]
  if (useCuda) args.push('--cuda-dir', cudaDir())
  if (req.diarize) {
    args.push('--diarize')
    if (req.speakers > 0) args.push('--speakers', String(req.speakers))
  }
  logInfo(`Audio→Text: bắt đầu ${basename(req.input)} (model ${req.model}, ${req.task}, ${effectiveDevice}${req.diarize ? ', nhận diện người nói' : ''})`)

  return new Promise<WhisperResult>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(engine, args, {
        windowsHide: true,
        cwd: engineDir(),
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' }
      })
    } catch (error) {
      resolve({ id, ok: false, outputs: [], segments: 0, speakers: 0, error: errLabel(error), requestedDevice: req.device, effectiveDevice })
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

    if (signal) signal.addEventListener('abort', () => { try { child.kill() } catch { /* best effort */ } }, { once: true })
    onProgress({ id, status: 'preparing', percent: -1, language: null, line: 'Đang chuẩn bị Faster-Whisper…' })

    const handleLine = (line: string): void => {
      const text = line.trim()
      if (!text || !text.startsWith('{')) return
      let object: { type?: string; message?: string; duration?: number; language?: string; seconds?: number; text?: string; outputs?: string[]; alignment?: string; segments?: number; speakers?: number }
      try { object = JSON.parse(text) } catch { return }
      switch (object.type) {
        case 'status': onProgress({ id, status: 'preparing', percent: -1, language, line: object.message ?? null }); break
        case 'info': duration = Number(object.duration) || 0; language = object.language ?? null; onProgress({ id, status: 'transcribing', percent: 0, language, line: null }); break
        case 'progress': {
          const seconds = Number(object.seconds) || 0
          onProgress({ id, status: 'transcribing', percent: duration > 0 ? Math.min(99, Math.round((seconds / duration) * 100)) : -1, language, line: object.text ?? null })
          break
        }
        case 'done': doneOk = true; outputs = object.outputs ?? []; alignmentPath = object.alignment ?? null; segments = object.segments ?? 0; speakers = object.speakers ?? 0; break
        case 'error': errMsg = object.message ?? 'Lỗi không rõ'; break
      }
    }
    const feed = (chunk: string): void => {
      outBuf += chunk
      const parts = outBuf.split(/\r?\n/)
      outBuf = parts.pop() ?? ''
      for (const line of parts) handleLine(line)
    }
    child.stdout?.on('data', (data) => feed(data.toString()))
    child.stderr?.on('data', (data) => { const last = data.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]; if (last) errTail = last })
    child.on('error', (error) => {
      if (runningWhisperProcess === child) runningWhisperProcess = null
      debugRaw('whisper spawn', error)
      const message = errLabel(error)
      logError(`Audio→Text: ${message}`)
      resolve({ id, ok: false, outputs: [], segments: 0, speakers: 0, error: message, requestedDevice: req.device, effectiveDevice })
    })
    child.on('close', (code) => {
      if (runningWhisperProcess === child) runningWhisperProcess = null
      if (outBuf) handleLine(outBuf)
      if (doneOk && !errMsg) {
        onProgress({ id, status: 'finished', percent: 100, language, line: null })
        resolve({ id, ok: true, outputs, alignmentPath: alignmentPath || outputs.find((file) => file.endsWith('.alignment.json')) || null, segments, speakers, language, requestedDevice: req.device, effectiveDevice, error: null })
      } else {
        const message = errMsg || errTail || `Thoát mã ${code}`
        debugRaw('whisper close', message)
        const userMessage = errLabel(message)
        onProgress({ id, status: 'error', percent: -1, language, line: userMessage })
        resolve({ id, ok: false, outputs: [], segments: 0, speakers: 0, error: userMessage, requestedDevice: req.device, effectiveDevice })
      }
    })
  })
}
