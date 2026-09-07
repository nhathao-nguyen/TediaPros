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
  features?: string[]
  implementationFingerprint?: string | null
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
      const isCmd = process.platform === 'win32' && (command.endsWith('.cmd') || command.endsWith('.bat'))
      if (isCmd) {
        const comSpec = process.env.ComSpec || 'cmd.exe'
        child = trackChildProcess(spawn(comSpec, ['/d', '/s', '/c', command, ...args], { cwd, windowsHide: true }))
      } else {
        child = trackChildProcess(spawn(command, args, { cwd, windowsHide: true }))
      }
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

  const rawVersionFeatures = Array.isArray(versionJson.features)
    ? versionJson.features.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : []

  const probe = await run(executable, ['--probe'], root, 120_000)
  let probeJson: Record<string, unknown> | null = null
  for (const line of probe.output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      if (parsed?.type === 'probe' && parsed?.protocol === 'ocr-local/1') {
        probeJson = parsed
        break
      }
    } catch {
      /* continue */
    }
  }

  const ready = probeJson?.ready === true
  const rawProbeFeatures = Array.isArray(probeJson?.features)
    ? (probeJson.features as unknown[]).filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : []

  const verifiedFeatures = [...new Set(rawVersionFeatures)]
    .filter((feature) => rawProbeFeatures.includes(feature))
    .sort()

  const reportedVersion = typeof versionJson.version === 'string' ? versionJson.version : null
  const versionFingerprint = typeof versionJson.implementation_fingerprint === 'string'
    ? versionJson.implementation_fingerprint
    : null

  if (probe.code !== 0 || !ready) {
    return {
      healthy: false,
      version: reportedVersion,
      protocol: 'ocr-local/1',
      features: verifiedFeatures,
      implementationFingerprint: versionFingerprint,
      message: 'OCR model probe thất bại.'
    }
  }

  if (Array.isArray(spec.capabilities) && spec.capabilities.length > 0) {
    const missing = spec.capabilities.filter((c) => !verifiedFeatures.includes(c))
    if (missing.length > 0) {
      return {
        healthy: false,
        version: reportedVersion,
        protocol: 'ocr-local/1',
        features: verifiedFeatures,
        implementationFingerprint: versionFingerprint,
        message: `OCR thiếu capabilities bắt buộc từ manifest: ${missing.join(', ')}.`
      }
    }
  }

  if (spec.version !== 'installed' && reportedVersion !== spec.version) {
    return {
      healthy: false,
      version: reportedVersion,
      protocol: 'ocr-local/1',
      features: verifiedFeatures,
      implementationFingerprint: versionFingerprint,
      message: `OCR version ${reportedVersion || '(trống)'} không khớp manifest ${spec.version}.`
    }
  }

  if (spec.implementationFingerprint && versionFingerprint !== spec.implementationFingerprint) {
    return {
      healthy: false,
      version: reportedVersion,
      protocol: 'ocr-local/1',
      features: verifiedFeatures,
      implementationFingerprint: versionFingerprint,
      message: 'OCR implementation fingerprint không khớp manifest.'
    }
  }

  return {
    healthy: true,
    version: reportedVersion,
    protocol: 'ocr-local/1',
    features: verifiedFeatures,
    implementationFingerprint: versionFingerprint
  }
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
  if (kind === 'sttn-engine') {
    const { runSttnCommand } = await import('./inpainting/runner')
    try {
      const version = await runSttnCommand({ executablePath: executable, args: ['--version'], expectedEvent: 'version', timeoutMs: 30_000 })
      const healthy = version.engine === 'sttn' && typeof version.version === 'string' &&
        (spec.version === 'installed' || version.version === spec.version) &&
        (!spec.protocol || spec.protocol === 'sttn-engine/1') &&
        spec.capabilities.every(feature => Array.isArray(version.features) && version.features.includes(feature))
      return { healthy, version: typeof version.version === 'string' ? version.version : undefined, protocol: 'sttn-engine/1', message: healthy ? undefined : 'STTN version/capabilities không khớp manifest.' }
    } catch (error) { return { healthy: false, message: error instanceof Error ? error.message : String(error) } }
  }
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
  if (kind === 'separator-engine') {
    const result = await run(executable, ['--version'], dirname(executable), 30_000)
    if (result.code !== 0) {
      return { healthy: false, message: 'Separator engine version probe thất bại.' }
    }
    try {
      const line = result.output.trim().split('\n').pop() || ''
      const parsed = JSON.parse(line)
      if (
        parsed.type === 'version' &&
        parsed.protocol === 'separator-engine/1' &&
        parsed.engine === 'mdx-onnx' &&
        Array.isArray(parsed.features) &&
        parsed.features.includes('directml') &&
        parsed.features.includes('cpu')
      ) {
        return { healthy: true, version: parsed.version, protocol: parsed.protocol }
      }
      return { healthy: false, message: 'Separator engine protocol không hợp lệ.' }
    } catch {
      return { healthy: false, message: 'Không thể đọc output version từ separator engine.' }
    }
  }
  const args = kind === 'video2x' ? ['-l'] : ['--version']
  const result = await run(executable, args, dirname(executable))
  return result.code === 0
    ? { healthy: true }
    : { healthy: false, message: `${basename(executable)} capability probe thất bại.` }
}

export async function probeRuntimeExecutable(
  kind: RuntimeEngineKind,
  executableOrDirectory: string,
  options?: { capabilities?: string[] }
): Promise<RuntimeProbeResult> {
  if (kind === 'whisper-cuda') return probeCuda(executableOrDirectory)
  if (kind === 'ffmpeg' && options?.capabilities?.includes('ocr-mask-v1')) {
    const { probeFfmpegOcrMaskCapability } = await import('./ffmpegOcrMaskProbe')
    const maskProbe = await probeFfmpegOcrMaskCapability(executableOrDirectory)
    if (!maskProbe.healthy || !maskProbe.features.includes('ocr-mask-v1')) {
      return {
        healthy: false,
        message: maskProbe.message || 'FFmpeg hiện tại chưa qua kiểm tra mặt nạ OCR.'
      }
    }
  }
  const spec = {
    version: 'installed',
    platform: process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux',
    arch: process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64',
    asset: 'installed',
    sha256: '0'.repeat(64),
    bytes: 1,
    entrypoint: basename(executableOrDirectory),
    capabilities: options?.capabilities || [],
    files: [basename(executableOrDirectory)]
  } as RuntimeAssetSpec
  return probeRuntimeAsset(kind, dirname(executableOrDirectory), spec)
}
