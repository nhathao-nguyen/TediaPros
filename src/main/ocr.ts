import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmod, readFile, writeFile, rm, mkdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { resolveFfmpeg } from './deps'
import { resolveRuntimeExecutable, runtimeKindDir } from './runtimeResolver'
import { probeRuntimeExecutable } from './runtimeProbes'
import { debugRaw, errLabel, logError, logInfo, logWarn } from './logger'
import { terminateProcessTree, trackChildProcess } from './processTree'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import type { CanonicalDisplayGeometry } from './canonicalDisplayGeometry'
import {
  validateOcrVisualTimeline,
  stabilizeSingleSampleGaps,
  projectOcrTimelineToSubtitleCues,
  OCR_VISUAL_MAX_BYTES
} from '../shared/ocrVisualTimeline'
import type {
  AutoShortOcrBlurProfile,
  OcrEngineStatus,
  OcrProgress,
  OcrResult,
  OcrVisualTimeline,
  PixelRegion
} from '../shared/types'
import type { OcrProviderReport, OcrVisualTransport } from '../shared/ocrVisualTimeline'

export { assertContainedRegularFile } from './safeContainedPath'

const isWin = process.platform === 'win32'
async function resolveEnginePath(): Promise<string | null> {
  return resolveRuntimeExecutable('ocr-engine', isWin ? ['ocr-engine.exe'] : ['ocr-engine'])
}

async function probeOcr(path: string): Promise<{ healthy: boolean; version: string | null; protocol: string | null; features: string[]; implementationFingerprint?: string | null; message?: string }> {
  const result = await probeRuntimeExecutable('ocr-engine', path)
  return {
    healthy: result.healthy,
    version: result.version || null,
    protocol: result.protocol || null,
    features: result.features || [],
    implementationFingerprint: result.implementationFingerprint || null,
    message: result.message
  }
}

export interface OcrTransportProbe {
  healthy: boolean
  version?: string | null
  protocol?: string | null
  features?: readonly string[]
  implementationFingerprint?: string | null
  message?: string
}

export interface OcrTransportDecision {
  requested: OcrVisualTransport | undefined
  effective: OcrVisualTransport
  reason?: string
}

/** Choose a visual transport only when the installed binary advertises it. */
export function negotiateOcrVisualTransport(
  requested: OcrVisualTransport | undefined,
  probe: OcrTransportProbe
): OcrTransportDecision {
  if (requested === 'legacy-disk') {
    return { requested, effective: 'legacy-disk' }
  }
  const features = new Set(probe.features || [])
  const wanted = requested || 'stream-full'
  const required = wanted === 'stream-roi' ? 'visual-stream-roi-v1' : 'visual-stream-full-v1'
  if (probe.healthy && features.has(required)) {
    return { requested, effective: wanted }
  }
  return {
    requested,
    effective: 'legacy-disk',
    reason: `OCR runtime không đủ capability ${required}; chuyển sang legacy-disk để giữ chất lượng/profile ${wanted === 'stream-roi' ? 'ROI' : 'đã chọn'}.`
  }
}

export async function ocrEngineStatus(): Promise<OcrEngineStatus> {
  const path = await resolveEnginePath()
  if (!path) return { has: false, healthy: false, needsUpdate: false, features: [], message: 'Chưa cài đặt OCR runtime.' }
  const probe = await probeOcr(path)
  return { has: true, needsUpdate: !probe.healthy, ...probe }
}

export async function installOcrEngine(onProgress: (p: number) => void): Promise<void> {
  logInfo('Dịch màn hình: đang kiểm tra và cài đặt asset OCR…')
  onProgress(10)

  const { downloadRuntimeEngineFromManifest } = await import('./runtimeInstaller')
  const installed = await downloadRuntimeEngineFromManifest('ocr-engine', (p) => onProgress(p))
  if (!installed) throw new Error('Không có asset OCR phù hợp trong runtime manifest.')

  const path = await resolveEnginePath()
  if (!path) throw new Error('Không tìm thấy OCR binary sau khi cài đặt runtime.')
  if (!isWin) {
    await chmod(path, 0o755).catch(() => {})
  }
  const probe = await probeOcr(path)
  if (!probe.healthy) throw new Error(probe.message || 'OCR binary không qua kiểm tra probe.')
  onProgress(100)
  logInfo('Dịch màn hình: đã cài xong công cụ.')
}

let child: ChildProcess | null = null

export function cancelOcr(): void {
  if (!child) return
  terminateProcessTree(child)
  child = null
}

/**
 * Doc chu chay tren video -> .srt.
 * y0/y1 la PIXEL CUA VIDEO GOC (giao dien da quy doi san).
 */
interface SrtCue {
  id: number
  start: string
  end: string
  text: string
}

function parseSrt(content: string): SrtCue[] {
  const blocks = content.trim().split(/\r?\n\r?\n/)
  const cues: SrtCue[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    if (lines.length >= 3) {
      const id = parseInt(lines[0].trim(), 10)
      const timeLine = lines[1].trim()
      const text = lines.slice(2).join('\n').trim()
      const timeParts = timeLine.split(' --> ')
      if (timeParts.length === 2) {
        cues.push({
          id,
          start: timeParts[0],
          end: timeParts[1],
          text
        })
      }
    }
  }
  return cues
}

function convertToVtt(cues: SrtCue[]): string {
  const lines = ['WEBVTT', '']
  for (const cue of cues) {
    const start = cue.start.replace(',', '.')
    const end = cue.end.replace(',', '.')
    lines.push(`${cue.id}`)
    lines.push(`${start} --> ${end}`)
    lines.push(cue.text)
    lines.push('')
  }
  return lines.join('\n')
}

function convertToTxt(cues: SrtCue[]): string {
  return cues.map((c) => c.text).join('\n')
}

function convertToJson(cues: SrtCue[]): string {
  return JSON.stringify(cues, null, 2)
}

/**
 * Doc chu chay tren video -> .srt.
 * y0/y1 la PIXEL CUA VIDEO GOC (giao dien da quy doi san).
 */
export async function ocrVideo(
  input: string,
  outputDir: string,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
  formats: string[],
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal,
  sampleFps = 2
): Promise<OcrResult> {
  if (child) return { ok: false, error: 'Đang xử lý một video khác.' }
  const executable = await resolveEnginePath()
  if (!executable) return { ok: false, error: 'Chưa có OCR asset local có manifest. Hãy import asset trước.' }
  const ready = await probeOcr(executable)
  if (!ready.healthy) return { ok: false, error: ready.message || 'OCR engine chưa qua probe.' }
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const out = join(outputDir, basename(input).replace(/\.[^.]+$/, '') + '.srt')
  const args = [
    '--input', input,
    '--output', out,
    '--y0', String(y0),
    '--y1', String(y1),
    '--x0', String(x0),
    '--x1', String(x1),
    '--fps', String(Math.max(2, Math.min(12, Math.round(sampleFps)))),
    '--ffmpeg', ff
  ]
  logInfo(`Dịch màn hình: bắt đầu đọc ${basename(input)}…`)

  return new Promise<OcrResult>((resolve) => {
    const p = trackChildProcess(spawn(executable, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    }))
    child = p

    const abort = (): void => {
      terminateProcessTree(p)
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })

    let buf = ''
    let errTail = ''
    let doneOut: string | null = null
    let count = 0
    let bandTop: number | null = null
    let bandBot: number | null = null
    let errMsg: string | null = null

    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      for (const line of parts) {
        const t = line.trim()
        if (!t || t[0] !== '{') continue
        try {
          const o = JSON.parse(t) as {
            type?: string
            percent?: number
            text?: string
            message?: string
            output?: string
            count?: number
            band_top?: number | null
            band_bot?: number | null
          }
          if (o.type === 'progress') {
            onProgress({ percent: o.percent ?? 0, text: o.text ?? '' })
          } else if (o.type === 'status') {
            onProgress({ percent: -1, text: o.message ?? '' })
          } else if (o.type === 'done') {
            doneOut = o.output ?? out
            count = o.count ?? 0
            bandTop = o.band_top ?? null
            bandBot = o.band_bot ?? null
          } else if (o.type === 'error') {
            errMsg = o.message ?? null
          }
        } catch {
          /* bo qua dong hong */
        }
      }
    })

    p.stderr.on('data', (d: Buffer) => {
      const last = d.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })

    p.on('error', (err) => {
      signal?.removeEventListener('abort', abort)
      debugRaw('ocr spawn', err)
      child = null
      const nhan = errLabel(err)
      logError(`Dịch màn hình: ${nhan}`)
      resolve({ ok: false, error: nhan })
    })

    p.on('close', async (code) => {
      signal?.removeEventListener('abort', abort)
      child = null
      if (code !== 0 || !doneOut) {
        const raw = errMsg || errTail || `code ${code ?? '?'}`
        debugRaw('ocr close', raw)
        resolve({ ok: false, error: errLabel(raw) })
        return
      }
      if (doneOut) {
        logInfo(`Dịch màn hình: xong ${count} câu.`)

        const outputs: string[] = []
        try {
          const srtContent = await readFile(doneOut, 'utf8')
          const cues = parseSrt(srtContent)
          if (srtContent.trim().length === 0 || cues.length === 0 || count <= 0) {
            throw new Error('OCR không tạo được SRT có cue hợp lệ.')
          }

          const txtPath = doneOut.replace(/\.srt$/i, '.txt')
          const vttPath = doneOut.replace(/\.srt$/i, '.vtt')
          const jsonPath = doneOut.replace(/\.srt$/i, '.json')

          if (formats.includes('.srt')) {
            outputs.push(doneOut)
          }
          if (formats.includes('.txt')) {
            await writeFile(txtPath, convertToTxt(cues), 'utf8')
            outputs.push(txtPath)
          }
          if (formats.includes('.vtt')) {
            await writeFile(vttPath, convertToVtt(cues), 'utf8')
            outputs.push(vttPath)
          }
          if (formats.includes('.json')) {
            await writeFile(jsonPath, convertToJson(cues), 'utf8')
            outputs.push(jsonPath)
          }

          if (!formats.includes('.srt')) {
            await rm(doneOut, { force: true })
          }
        } catch (err) {
          debugRaw('ocr format conversion error', err)
          if (outputs.length === 0) {
            outputs.push(doneOut)
          }
        }

        resolve({ ok: true, output: outputs[0] || doneOut, outputs, count, bandTop, bandBot })
        return
      }
      // Bi huy giua chung -> khong phai loi
      if (code === null) {
        resolve({ ok: false, error: 'Đã huỷ.' })
        return
      }
      const raw = errMsg || errTail || `code ${code}`
      debugRaw('ocr close', raw)
      const nhan = errLabel(raw)
      logError(`Dịch màn hình: ${nhan}`)
      resolve({ ok: false, error: nhan })
    })
  })
}

export interface AutoShortOcrVideoOptions {
  input: string
  outputDir: string
  scanRegion: PixelRegion
  profile: AutoShortOcrBlurProfile
  geometry: CanonicalDisplayGeometry
  videoDurationSeconds: number
  sampleFps: 8
  signal: AbortSignal
  spawnChild?: typeof spawn
  engineExecutable?: string
  ffmpegExecutable?: string
  /** Test hook; production probes the installed executable before selecting transport. */
  engineProbe?: OcrTransportProbe
  modelLoadTimeoutMs?: number
  progressTimeoutMs?: number
  ocrTransport?: OcrVisualTransport
}

export interface AutoShortOcrVideoResult {
  timeline: OcrVisualTimeline
  sourceSrtPath: string
  sidecarPath: string
  engineVersion: string
  engineProtocol: 'ocr-local/1'
  transport?: OcrVisualTransport
  implementationFingerprint?: string
  ocrProvider?: OcrProviderReport
  visualSegmentCount: number
  boxSegmentCount: number
}

function formatSrtFromCues(cues: { id?: string | number; start: number; end: number; text: string }[]): string {
  const formatTime = (secs: number): string => {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = Math.floor(secs % 60)
    const ms = Math.min(999, Math.round((secs - Math.floor(secs)) * 1000))
    const pad = (n: number, z = 2): string => String(n).padStart(z, '0')
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
  }
  return cues
    .map((cue, idx) => `${idx + 1}\n${formatTime(cue.start)} --> ${formatTime(cue.end)}\n${cue.text.trim()}\n`)
    .join('\n') + (cues.length > 0 ? '\n' : '')
}

export async function ocrVideoWithVisualTimeline(
  options: AutoShortOcrVideoOptions,
  onProgress?: (progress: OcrProgress) => void
): Promise<AutoShortOcrVideoResult> {
  if (options.signal?.aborted) {
    throw new Error('Tiến trình OCR đã bị huỷ trước khi bắt đầu.')
  }

  const ocrDir = join(options.outputDir, `ocr-${randomUUID()}`)
  await mkdir(ocrDir, { recursive: true })
  await assertContainedParentDirectory(ocrDir, options.outputDir, 'Thư mục tạm OCR')

  const engineSrtPath = join(ocrDir, 'source.engine.srt')
  const sidecarPath = join(ocrDir, 'visual-cues.json')
  const authoritativeSrtPath = join(ocrDir, 'source.srt')

  const executable = options.engineExecutable || (await resolveEnginePath())
  if (!executable) {
    throw new Error('Chưa có OCR asset local có manifest. Hãy import asset trước.')
  }
  const ready: OcrTransportProbe = options.engineProbe || (options.engineExecutable
    ? { healthy: true, version: 'injected', protocol: 'ocr-local/1', features: ['visual-stream-full-v1', 'visual-stream-roi-v1'] }
    : await probeOcr(executable))
  if (!ready.healthy) {
    throw new Error(ready.message || 'OCR engine chưa qua probe.')
  }
  const transportDecision = negotiateOcrVisualTransport(options.ocrTransport, ready)
  if (transportDecision.reason) logWarn(`[OCR] ${transportDecision.reason}`)
  const ffmpeg = options.ffmpegExecutable || (await resolveFfmpeg())
  if (!ffmpeg) {
    throw new Error('Thiếu ffmpeg. Hãy chạy lại bước cài đặt.')
  }

  const args = [
    '--input', options.input,
    '--output', engineSrtPath,
    '--visual-cues-output', sidecarPath,
    '--scan-profile', options.profile,
    '--display-width', String(options.geometry.displayWidth),
    '--display-height', String(options.geometry.displayHeight),
    '--geometry-fingerprint', options.geometry.fingerprint,
    '--x0', String(options.scanRegion.x0),
    '--y0', String(options.scanRegion.y0),
    '--x1', String(options.scanRegion.x1),
    '--y1', String(options.scanRegion.y1),
    '--fps', '8',
    '--ffmpeg', ffmpeg
  ]
  if (transportDecision.effective === 'legacy-disk') {
    // An old binary may not understand --visual-transport. Send the explicit
    // value only after capability negotiation proved the new contract.
    if ((ready.features || []).some((feature) => feature === 'visual-stream-full-v1' || feature === 'visual-stream-roi-v1')) {
      args.push('--visual-transport', 'legacy-disk')
    }
  } else {
    args.push('--visual-transport', transportDecision.effective)
  }

  const spawnFn = options.spawnChild || spawn

  let doneEvent: {
    type?: string
    output?: string
    visual_cues?: string
    version?: string
    count?: number
    segment_count?: number
    box_count?: number
    transport?: OcrVisualTransport
    implementation_fingerprint?: string
    ocr_provider?: OcrProviderReport
  } | null = null

  let engineError: string | null = null
  let errTail = ''

  await new Promise<void>((resolve, reject) => {
    let p: ChildProcess
    try {
      p = trackChildProcess(spawnFn(executable, args, {
        windowsHide: true,
        shell: false,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      }))
    } catch (err) {
      reject(new Error(`Không thể khởi chạy OCR engine: ${(err as Error).message}`))
      return
    }

    let settled = false
    let isTimingOut = false
    let timeoutReason = ''
    let watchdogTimer: NodeJS.Timeout | null = null
    let hasReceivedFirstProgress = false

    const modelLoadTimeoutMs = options.modelLoadTimeoutMs ?? 180_000
    const progressTimeoutMs = options.progressTimeoutMs ?? 120_000

    const resetWatchdog = (timeoutMs: number, reason: string): void => {
      if (watchdogTimer) clearTimeout(watchdogTimer)
      if (settled) return
      watchdogTimer = setTimeout(() => {
        if (settled) return
        isTimingOut = true
        timeoutReason = reason
        terminateProcessTree(p)
      }, timeoutMs)
    }

    resetWatchdog(modelLoadTimeoutMs, `OCR quá thời gian khởi động mô hình (${Math.round(modelLoadTimeoutMs / 1000)}s)`)

    const abortHandler = (): void => {
      if (watchdogTimer) clearTimeout(watchdogTimer)
      terminateProcessTree(p)
    }

    if (options.signal.aborted) {
      abortHandler()
    } else {
      options.signal.addEventListener('abort', abortHandler, { once: true })
    }

    let buf = ''
    let stdoutBytes = 0

    p.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > 256 * 1024) {
        // limit retained stdout buffer
      }
      buf += chunk.toString('utf8')
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.length > 64 * 1024) continue
        const trimmed = line.trim()
        if (!trimmed || trimmed[0] !== '{') continue
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>
          if (parsed.type === 'progress' && typeof parsed.percent === 'number') {
            hasReceivedFirstProgress = true
            resetWatchdog(progressTimeoutMs, `OCR không có tiến độ mới sau ${Math.round(progressTimeoutMs / 1000)}s`)
            onProgress?.({ percent: parsed.percent, text: '' })
          } else if (parsed.type === 'status') {
            resetWatchdog(
              hasReceivedFirstProgress ? progressTimeoutMs : modelLoadTimeoutMs,
              hasReceivedFirstProgress
                ? `OCR không có tiến độ mới sau ${Math.round(progressTimeoutMs / 1000)}s`
                : `OCR quá thời gian khởi động mô hình (${Math.round(modelLoadTimeoutMs / 1000)}s)`
            )
          } else if (parsed.type === 'done') {
            doneEvent = parsed as typeof doneEvent
          } else if (parsed.type === 'error' && typeof parsed.message === 'string') {
            engineError = parsed.message
          }
        } catch {
          // ignore malformed JSON line
        }
      }
    })

    p.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      errTail = (errTail + text).slice(-8192)
    })

    p.on('error', (err) => {
      if (settled) return
      settled = true
      if (watchdogTimer) clearTimeout(watchdogTimer)
      options.signal.removeEventListener('abort', abortHandler)
      reject(err)
    })

    p.on('close', (code) => {
      if (settled) return
      settled = true
      if (watchdogTimer) clearTimeout(watchdogTimer)
      options.signal.removeEventListener('abort', abortHandler)
      if (options.signal.aborted) {
        reject(new Error('Tiến trình OCR đã bị huỷ.'))
        return
      }
      if (isTimingOut) {
        reject(new Error(`OCR engine bị watchdog dừng: ${timeoutReason}`))
        return
      }
      if (code !== 0) {
        const detail = engineError || errTail.trim().split(/\r?\n/).pop() || `mã thoát ${code ?? '?'}`
        reject(new Error(`OCR engine thất bại: ${errLabel(detail)}`))
        return
      }
      resolve()
    })
  })

  const finalDone = doneEvent as {
    type?: string
    output?: string
    visual_cues?: string
    version?: string
    count?: number
    segment_count?: number
    box_count?: number
    transport?: OcrVisualTransport
    implementation_fingerprint?: string
    ocr_provider?: OcrProviderReport
  } | null

  if (!finalDone) {
    throw new Error('OCR engine không trả về thông tin hoàn thành (done event).')
  }

  // Exact path equality checks
  if (finalDone.output !== engineSrtPath || finalDone.visual_cues !== sidecarPath) {
    throw new Error('Đường dẫn kết quả OCR từ engine không khớp chính xác với đường dẫn mong đợi.')
  }
  if (finalDone.transport && finalDone.transport !== transportDecision.effective) {
    throw new Error(`OCR transport trả về không khớp: mong đợi ${transportDecision.effective}, nhận ${finalDone.transport}.`)
  }

  // Contained regular file check
  await assertContainedRegularFile(sidecarPath, ocrDir, 'Visual timeline')

  // Check file size cap <= 64 MiB
  const sidecarStat = await stat(sidecarPath)
  if (sidecarStat.size > OCR_VISUAL_MAX_BYTES) {
    throw new Error(`File visual cues timeline vượt quá dung lượng tối đa 64MB (${sidecarStat.size} bytes).`)
  }

  const rawJson = await readFile(sidecarPath, 'utf8')
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(rawJson)
  } catch (err) {
    throw new Error(`Nội dung JSON visual cues không hợp lệ: ${(err as Error).message}`)
  }

  const validatedTimeline = validateOcrVisualTimeline(parsedJson, {
    width: options.geometry.displayWidth,
    height: options.geometry.displayHeight,
    durationSeconds: options.videoDurationSeconds,
    sampleFps: 8,
    geometryFingerprint: options.geometry.fingerprint,
    scanRegion: options.scanRegion
  })

  const stabilized = stabilizeSingleSampleGaps(validatedTimeline)

  const effectiveTransport = stabilized.transport || finalDone.transport || transportDecision.effective
  const implementationFingerprint = stabilized.implementationFingerprint || finalDone.implementation_fingerprint || ready.implementationFingerprint || undefined
  const ocrProvider = stabilized.ocrProvider || finalDone.ocr_provider

  if (stabilized.segments.length === 0) {
    throw new Error('Timeline OCR không chứa segment hợp lệ nào.')
  }
  const totalBoxes = stabilized.segments.reduce((acc, s) => acc + s.boxes.length, 0)
  if (totalBoxes === 0) {
    throw new Error('Timeline OCR không chứa bounding box hợp lệ nào.')
  }

  // Authoritative SRT write
  const cues = projectOcrTimelineToSubtitleCues(stabilized)
  const srtContent = formatSrtFromCues(cues)
  await writeFile(authoritativeSrtPath, srtContent, 'utf8')

  // Clean engine SRT
  await rm(engineSrtPath, { force: true }).catch(() => {})

  return {
    timeline: stabilized,
    sourceSrtPath: authoritativeSrtPath,
    sidecarPath,
    engineVersion: typeof finalDone.version === 'string' ? finalDone.version : '1.1.0',
    engineProtocol: 'ocr-local/1',
    transport: effectiveTransport,
    implementationFingerprint,
    ocrProvider,
    visualSegmentCount: stabilized.segments.length,
    boxSegmentCount: totalBoxes
  }
}
