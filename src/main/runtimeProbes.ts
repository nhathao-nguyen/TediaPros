import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { runtimeKindDir } from './runtimeResolver'
import { parseWhisperVersion } from './engineProtocol'
import type { RuntimeAssetSpec } from './runtimeManifest'
import type { RuntimeEngineKind } from './runtimeResolver'
import { terminateProcessTree, trackChildProcess } from './processTree'

export interface RuntimeProbeResult {
  healthy: boolean
  version?: string | null
  protocol?: string | null
  message?: string
}

export const WHISPER_CUDA_REQUIRED_FILES = [
  'cudart64_12.dll',
  'cublas64_12.dll',
  'cublasLt64_12.dll',
  'cudnn64_9.dll'
] as const

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function run(command: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    let output = ''
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let child: ReturnType<typeof spawn> | undefined
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ code, output })
    }
    timer = setTimeout(() => {
      terminateProcessTree(child)
      finish(-1)
    }, timeoutMs)
    try {
      child = trackChildProcess(spawn(command, args, { cwd, windowsHide: true }))
    } catch {
      finish(-1)
      return
    }
    child.stdout?.on('data', (data) => { output += data.toString() })
    child.stderr?.on('data', (data) => { output += data.toString() })
    child.on('error', () => finish(-1))
    child.on('close', (code) => finish(code ?? -1))
  })
}

function entrypointPath(root: string, spec: RuntimeAssetSpec): string {
  return join(root, ...spec.entrypoint.split('/'))
}

async function probeWhisper(root: string, spec: RuntimeAssetSpec): Promise<RuntimeProbeResult> {
  const executable = entrypointPath(root, spec)
  const version = await run(executable, ['--version'], root)
  const parsed = parseWhisperVersion(version.output)
  if (version.code !== 0 || !parsed) {
    return { healthy: false, message: 'Faster-Whisper version probe không trả về protocol whisper-engine/1.' }
  }
  const probe = await run(executable, ['--probe', '--device', 'cpu'], root, 120_000)
  const ready = probe.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).some((line) => {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      return value.type === 'probe' && value.ready === true && value.protocol === 'whisper-engine/1' && value.engine === 'faster-whisper'
    } catch {
      return false
    }
  })
  if (spec.version !== 'installed' && parsed.version !== spec.version) {
    return { healthy: false, version: parsed.version, protocol: parsed.protocol, message: `Faster-Whisper version ${parsed.version} không khớp manifest ${spec.version}.` }
  }
  return ready
    ? { healthy: true, version: parsed.version, protocol: parsed.protocol }
    : { healthy: false, version: parsed.version, protocol: parsed.protocol, message: 'Faster-Whisper backend probe thất bại.' }
}

async function probeCuda(root: string): Promise<RuntimeProbeResult> {
  const files = await Promise.all(WHISPER_CUDA_REQUIRED_FILES.map((file) => exists(join(root, file))))
  if (!files.every(Boolean)) return { healthy: false, message: 'Gói CUDA không có đủ DLL CUDA 12/cuDNN 9 bắt buộc.' }
  const engineDir = runtimeKindDir('whisper-engine')
  const executable = join(engineDir, process.platform === 'win32' ? 'whisper-engine.exe' : 'whisper-engine')
  if (!(await exists(executable))) return { healthy: false, message: 'Cần cài Faster-Whisper engine trước khi kiểm tra CUDA.' }
  const probe = await run(executable, ['--probe', '--device', 'cuda', '--cuda-dir', root], engineDir, 120_000)
  const ready = probe.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).some((line) => {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      return value.type === 'probe' && value.ready === true && value.device === 'cuda' &&
        value.protocol === 'whisper-engine/1' && value.engine === 'faster-whisper'
    } catch {
      return false
    }
  })
  return ready ? { healthy: true } : { healthy: false, message: 'Faster-Whisper CUDA probe thất bại; có thể tiếp tục bằng CPU.' }
}

async function probeOcr(root: string, spec: RuntimeAssetSpec): Promise<RuntimeProbeResult> {
  const executable = entrypointPath(root, spec)
  const version = await run(executable, ['--version'], root)
  const versionJson = version.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line) as Record<string, unknown> } catch { return null }
  }).find((value) => value?.type === 'version')
  if (version.code !== 0 || versionJson?.protocol !== 'ocr-local/1' || versionJson.engine !== 'rapidocr') {
    return { healthy: false, message: 'OCR version probe không đúng protocol ocr-local/1.' }
  }
  const probe = await run(executable, ['--probe'], root, 120_000)
  const ready = probe.output.split(/\r?\n/).some((line) => {
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      return value.type === 'probe' && value.ready === true && value.protocol === 'ocr-local/1'
    } catch { return false }
  })
  const reportedVersion = typeof versionJson.version === 'string' ? versionJson.version : null
  if (spec.version !== 'installed' && reportedVersion !== spec.version) return { healthy: false, version: reportedVersion, protocol: 'ocr-local/1', message: `OCR version ${reportedVersion || '(trống)'} không khớp manifest ${spec.version}.` }
  return ready
    ? { healthy: true, version: reportedVersion, protocol: 'ocr-local/1' }
    : { healthy: false, version: reportedVersion, protocol: 'ocr-local/1', message: 'OCR model probe thất bại.' }
}

export async function probeRuntimeAsset(
  kind: RuntimeEngineKind,
  root: string,
  spec: RuntimeAssetSpec
): Promise<RuntimeProbeResult> {
  if (kind === 'whisper-engine') return probeWhisper(root, spec)
  if (kind === 'whisper-cuda') return probeCuda(root)
  const executable = entrypointPath(root, spec)
  if (!(await exists(executable))) return { healthy: false, message: `Thiếu entrypoint ${spec.entrypoint}.` }
  if (kind === 'ocr-engine') return probeOcr(root, spec)
  if (kind === 'ffmpeg') {
    const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
    const ffprobe = join(root, ffprobeName)
    const [ffmpegResult, ffprobeResult] = await Promise.all([
      run(executable, ['-version'], root),
      run(ffprobe, ['-version'], root)
    ])
    return ffmpegResult.code === 0 && ffprobeResult.code === 0
      ? { healthy: true }
      : { healthy: false, message: 'FFmpeg/FFprobe version probe thất bại.' }
  }
  const args = kind === 'video2x' ? ['-l'] : ['--version']
  const result = await run(executable, args, dirname(executable))
  return result.code === 0
    ? { healthy: true }
    : { healthy: false, message: `${basename(executable)} capability probe thất bại.` }
}

/** Probe an already-installed executable when a release manifest is not needed for status. */
export async function probeRuntimeExecutable(
  kind: RuntimeEngineKind,
  executableOrDirectory: string
): Promise<RuntimeProbeResult> {
  if (kind === 'whisper-cuda') return probeCuda(executableOrDirectory)
  const spec = {
    version: 'installed',
    platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
    arch: process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64',
    asset: 'installed',
    sha256: '0'.repeat(64),
    bytes: 1,
    entrypoint: basename(executableOrDirectory),
    capabilities: [],
    files: [basename(executableOrDirectory)]
  } as RuntimeAssetSpec
  return probeRuntimeAsset(kind, dirname(executableOrDirectory), spec)
}
