import { spawn, type ChildProcess } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { runtimeKindDir } from './runtimeResolver'
import { probeRuntimeExecutable } from './runtimeProbes'
import { debugRaw, errLabel, logInfo, logWarn } from './logger'
import { terminateProcessTree, trackChildProcess } from './processTree'
import type {
  Video2xDevice,
  Video2xEngineStatus,
  Video2xProgress,
  Video2xRunRequest,
  Video2xRunResult,
  Video2xTaskConfig
} from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

function engineDir(): string {
  return runtimeKindDir('video2x')
}

function enginePath(): string {
  return join(engineDir(), isWin ? 'video2x.exe' : 'video2x')
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve the executable in the canonical managed runtime directory. */
export async function resolveEnginePath(): Promise<string | null> {
  const exeName = isWin ? 'video2x.exe' : 'video2x'
  const candidate = join(engineDir(), exeName)
  return (await exists(candidate)) ? candidate : null
}

export async function video2xEngineStatus(): Promise<Video2xEngineStatus> {
  if (isMac) {
    return { has: false, supported: false, needsUpdate: false }
  }
  const path = await resolveEnginePath()
  const has = Boolean(path)
  if (!path) {
    return { has: false, supported: true, needsUpdate: false, healthy: false, message: 'Chưa cài đặt Video2X runtime.' }
  }
  const probe = await probeRuntimeExecutable('video2x', path)
  const needsUp = !probe.healthy
  return {
    has,
    supported: true,
    healthy: probe.healthy,
    needsUpdate: needsUp,
    message: probe.message
  }
}

export async function installVideo2xEngine(onProgress: (p: number) => void): Promise<void> {
  if (isMac) {
    throw new Error('Video2X chưa hỗ trợ macOS (không có bản native).')
  }
  logInfo('Nâng cấp video: đang tải công cụ Video2X…')
  const { downloadRuntimeEngineFromManifest } = await import('./runtimeInstaller')
  const installed = await downloadRuntimeEngineFromManifest('video2x', (percent) => onProgress(percent))
  if (!installed) throw new Error('Không có asset Video2X phù hợp trong runtime manifest.')
  const path = await resolveEnginePath()
  if (!path) throw new Error('Không tìm thấy Video2X binary sau khi giải nén.')
  logInfo('Nâng cấp video: đã cài xong Video2X.')
}

export async function listVideo2xDevices(): Promise<Video2xDevice[]> {
  if (isMac) return []
  const exe = await resolveEnginePath()
  if (!exe) return []
  return new Promise((resolve) => {
    let p: ChildProcess
    try {
      p = trackChildProcess(spawn(exe, ['-l'], { windowsHide: true, cwd: dirname(exe) }))
    } catch {
      resolve([])
      return
    }
    let out = ''
    p.stdout?.on('data', (d: Buffer) => (out += d.toString()))
    p.stderr?.on('data', (d: Buffer) => (out += d.toString()))
    p.on('error', () => resolve([]))
    p.on('close', () => {
      const devices: Video2xDevice[] = []
      const re = /^(\d+)\.\s+(.+)$/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(out)) !== null) {
        devices.push({ index: Number(m[1]), name: m[2].trim() })
      }
      resolve(devices)
    })
  })
}

export function buildVideo2xArgs(req: Video2xRunRequest): string[] {
  const c = req.config
  const args: string[] = ['-i', req.input, '-o', req.output, '-p', c.processor, '-d', String(c.deviceIndex)]

  if (c.processor === 'rife' || c.mode === 'interpolate') {
    args.push('-m', String(Math.max(2, c.frameRateMul)))
    args.push('-t', String(c.sceneThresh))
    args.push('--rife-model', c.rifeModel || 'rife-v4.26')
  } else if (c.processor === 'libplacebo') {
    if (c.width && c.height) {
      args.push('-w', String(c.width), '-h', String(c.height))
    } else if (c.scalingFactor) {
      args.push('-s', String(c.scalingFactor))
    } else {
      args.push('-w', '3840', '-h', '2160')
    }
    args.push('--libplacebo-shader', c.libplaceboShader || 'anime4k-v4-a')
  } else {
    // realesrgan / realcugan
    if (c.scalingFactor && c.scalingFactor >= 2) {
      args.push('-s', String(c.scalingFactor))
    } else if (c.width && c.height) {
      args.push('-w', String(c.width), '-h', String(c.height))
    } else {
      args.push('-s', '2')
    }
    if (c.noiseLevel >= 0) args.push('-n', String(c.noiseLevel))
    if (c.processor === 'realesrgan') {
      args.push('--realesrgan-model', c.realesrganModel || 'realesr-animevideov3')
    } else {
      args.push('--realcugan-model', c.realcuganModel || 'models-se')
    }
  }

  args.push('-c', c.codec || 'libx264')
  if (!c.copyAudio || !c.copySubtitle) args.push('--no-copy-streams')
  if (c.crf != null && c.crf >= 0) args.push('-e', `crf=${c.crf}`)
  if (c.encoderPreset) args.push('-e', `preset=${c.encoderPreset}`)

  return args
}

function parseElapsed(hms: string): number {
  const p = hms.split(':').map(Number)
  if (p.length !== 3 || p.some((n) => Number.isNaN(n))) return 0
  return p[0] * 3600 + p[1] * 60 + p[2]
}

/** frame=12/100 (12.00%); fps=3.50; elapsed=00:00:10; remaining=00:01:00 */
export function parseVideo2xProgressLine(line: string): Video2xProgress | null {
  const m =
    /frame=(\d+)\/(\d+)\s*\(([\d.]+)%\);\s*fps=([\d.]+);\s*elapsed=(\d+:\d+:\d+);\s*remaining=(\d+:\d+:\d+)/.exec(
      line
    )
  if (!m) return null
  return {
    percent: Number(m[3]),
    frame: Number(m[1]),
    totalFrames: Number(m[2]),
    fps: Number(m[4]),
    elapsedSec: parseElapsed(m[5]),
    remainingSec: parseElapsed(m[6])
  }
}

let activeChild: ChildProcess | null = null
let activeTaskId: string | null = null
let isCancelling = false

export function isVideo2xRunning(): boolean {
  return activeChild !== null
}

export function cancelVideo2x(taskId?: string): boolean {
  if (!activeChild) return false
  if (taskId && activeTaskId && activeTaskId !== taskId) return false
  isCancelling = true
  try {
    terminateProcessTree(activeChild)
  } catch {
    /* ignore */
  }
  activeChild = null
  activeTaskId = null
  return true
}

export async function runVideo2x(
  req: Video2xRunRequest,
  onProgress: (p: Video2xProgress) => void,
  taskId?: string
): Promise<Video2xRunResult> {
  if (isMac) {
    return { ok: false, error: 'Video2X chưa hỗ trợ macOS.' }
  }
  if (activeChild !== null) {
    return { ok: false, error: 'Đang có một tiến trình Video2X khác đang chạy.' }
  }
  const exe = await resolveEnginePath()
  if (!exe) {
    return { ok: false, error: 'Chưa cài Video2X. Hãy tải công cụ trước.' }
  }

  isCancelling = false
  const currentTaskId = taskId || 'singleton'
  const args = buildVideo2xArgs(req)
  logInfo(`Nâng cấp video: ${basename(req.input)} → ${basename(req.output)}…`)
  debugRaw('video2x args', args.join(' '))

  return new Promise((resolve) => {
    let p: ChildProcess
    try {
      p = trackChildProcess(spawn(exe, args, {
        windowsHide: true,
        cwd: dirname(exe),
        env: { ...process.env }
      }))
    } catch (err) {
      resolve({ ok: false, error: errLabel(err) })
      return
    }

    activeChild = p
    activeTaskId = currentTaskId
    let errTail = ''
    let lastPct = 0

    const onChunk = (buf: Buffer): void => {
      const text = buf.toString()
      errTail = (errTail + text).slice(-4000)
      const parts = text.split(/\r|\n/)
      for (const part of parts) {
        const line = part.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim()
        if (!line) continue
        const prog = parseVideo2xProgressLine(line)
        if (prog) {
          lastPct = prog.percent
          onProgress(prog)
        }
      }
    }

    p.stdout?.on('data', onChunk)
    p.stderr?.on('data', onChunk)

    p.on('error', (err) => {
      if (activeChild === p) {
        activeChild = null
        activeTaskId = null
      }
      debugRaw('video2x spawn', err)
      resolve({ ok: false, error: errLabel(err) })
    })

    p.on('close', async (code) => {
      const wasCancelled = isCancelling
      if (activeChild === p) {
        activeChild = null
        activeTaskId = null
        isCancelling = false
      }
      if (wasCancelled) {
        resolve({ ok: false, error: 'Đã huỷ.' })
        return
      }
      if (code === 0) {
        const outputInfo = await stat(req.output).catch(() => null)
        if (!outputInfo || !outputInfo.isFile() || outputInfo.size <= 0) {
          resolve({ ok: false, error: 'Video2X kết thúc nhưng không tạo output hợp lệ.' })
          return
        }
        logInfo(`Nâng cấp video: xong ${basename(req.output)}.`)
        onProgress({
          percent: 100,
          fps: 0,
          frame: 0,
          totalFrames: 0,
          elapsedSec: 0,
          remainingSec: 0
        })
        resolve({ ok: true, output: req.output })
        return
      }
      debugRaw('video2x close', { code, errTail, lastPct })
      resolve({
        ok: false,
        error: errTail.trim().slice(-300) || `Video2X thoát mã ${code ?? '?'}.`
      })
    })
  })
}

export function defaultVideo2xConfig(): Video2xTaskConfig {
  return {
    deviceIndex: 0,
    mode: 'filter',
    processor: 'realesrgan',
    scalingFactor: 2,
    width: null,
    height: null,
    noiseLevel: -1,
    libplaceboShader: 'anime4k-v4-a',
    realesrganModel: 'realesr-animevideov3',
    realcuganModel: 'models-se',
    rifeModel: 'rife-v4.26',
    frameRateMul: 2,
    sceneThresh: 100,
    codec: 'libx264',
    copyAudio: true,
    copySubtitle: true,
    crf: 20,
    encoderPreset: 'medium'
  }
}
