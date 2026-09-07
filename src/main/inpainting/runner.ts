import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { lstat, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { trackChildProcess, terminateProcessTree } from '../processTree'
import { resolveSttnEngine } from '../runtimeResolver'
import { assertContainedRegularFile } from '../safeContainedPath'
import { parseCanonicalMediaMetadata } from '../canonicalDisplayGeometry'
import { validateOcrVisualTimeline, type OcrVisualTimeline } from '../../shared/ocrVisualTimeline'

const MAX_LINE = 64 * 1024
const MAX_DIAGNOSTICS = 16 * 1024
const PROTOCOL = 'sttn-engine/1'

function diagnostic(text: string): string {
  return text.slice(-MAX_DIAGNOSTICS).replace(/[A-Za-z]:[\\/][^\r\n"<>]+/g, '<path>')
}

/** JSONL transport: never settle cancellation/failure while the process still owns its files. */
export function runSttnCommand(input: {
  executablePath: string
  args: string[]
  expectedEvent: 'version' | 'probe' | 'done' | 'media'
  signal?: AbortSignal
  timeoutMs?: number
  onProgress?: (percent: number, message: string) => void
  spawnChild?: typeof spawn
}): Promise<Record<string, unknown>> {
  return new Promise((resolveResult, reject) => {
    if (input.signal?.aborted) return reject(new Error('Đã hủy STTN.'))
    let child: ChildProcess | undefined
    let buffer = ''
    let stderr = ''
    let failure: Error | undefined
    let terminal: Record<string, unknown> | undefined
    let lastPercent = -1
    let settled = false
    const decoder = new StringDecoder('utf8')
    let timer: NodeJS.Timeout | undefined
    const stop = (error: Error): void => {
      failure ||= error
      terminateProcessTree(child)
    }
    const abort = (): void => stop(new Error('Đã hủy STTN.'))
    const finish = (code: number | null, spawnError?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      input.signal?.removeEventListener('abort', abort)
      if (!failure && !spawnError) {
        buffer += decoder.end()
        if (input.expectedEvent === 'media') {
          try { terminal = JSON.parse(buffer) as Record<string, unknown> } catch { failure = new Error('FFprobe JSON không hợp lệ.') }
        } else if (buffer.trim()) parseLine(buffer)
      }
      if (failure || spawnError) return reject(failure || spawnError)
      if (code !== 0) return reject(new Error(`STTN process failed (exit ${code}): ${diagnostic(stderr)}`))
      if (!terminal) return reject(new Error(`STTN thiếu sự kiện ${input.expectedEvent}.`))
      resolveResult(terminal)
    }
    const parseLine = (line: string): void => {
      if (!line.trim() || failure) return
      if (line.length > MAX_LINE) return stop(new Error('STTN JSON vượt giới hạn output limit.'))
      if (terminal) return stop(new Error('STTN phát dữ liệu sau sự kiện kết thúc.'))
      let event: Record<string, unknown>
      try {
        const parsed = JSON.parse(line) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required')
        event = parsed as Record<string, unknown>
      } catch { return stop(new Error('STTN JSON không hợp lệ.')) }
      if (event.protocol !== undefined && event.protocol !== PROTOCOL) return stop(new Error('STTN protocol không hợp lệ.'))
      if (event.type === 'error') return stop(new Error(diagnostic(String(event.message || event.code || 'STTN error'))))
      if (event.type === 'progress') {
        const percent = event.percent
        if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < lastPercent || percent < 0 || percent > 100) {
          return stop(new Error('STTN progress không hợp lệ.'))
        }
        lastPercent = percent
        try { input.onProgress?.(percent, diagnostic(String(event.message || event.phase || 'Đang xóa phụ đề…'))) } catch (error) { stop(error instanceof Error ? error : new Error(String(error))) }
      } else if (event.type === input.expectedEvent) {
        if ((event.type === 'version' || event.type === 'probe') && event.protocol !== PROTOCOL) return stop(new Error('STTN protocol không hợp lệ.'))
        terminal = event
      } else { stop(new Error(`STTN sự kiện không hợp lệ: ${String(event.type)}`)) }
    }
    try {
      child = trackChildProcess((input.spawnChild || spawn)(input.executablePath, input.args, { cwd: dirname(input.executablePath), windowsHide: true, shell: false }))
      input.signal?.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => stop(new Error('STTN process timeout.')), input.timeoutMs ?? 120_000)
      child.stdout?.on('data', (chunk: Buffer) => {
        if (failure) return
        buffer += decoder.write(chunk)
        if (input.expectedEvent !== 'media') {
          let end: number
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end)
            buffer = buffer.slice(end + 1)
            parseLine(line)
            if (failure) { buffer = ''; return }
          }
        }
        if (buffer.length > MAX_LINE) { buffer = ''; stop(new Error('STTN JSON vượt giới hạn output limit.')) }
      })
      child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-MAX_DIAGNOSTICS) })
      child.once('error', error => {
        if (!child?.pid) finish(null, error)
        else stop(error)
      })
      child.once('close', code => finish(code))
      if (input.signal?.aborted) abort()
    } catch (error) { finish(null, error instanceof Error ? error : new Error(String(error))) }
  })
}

export async function probeSttnEngine(executablePath: string, modelPath: string, signal?: AbortSignal): Promise<'cuda' | 'cpu'> {
  const event = await runSttnCommand({ executablePath, args: ['--probe', '--model', modelPath, '--provider', 'auto'], expectedEvent: 'probe', signal, timeoutMs: 180_000 })
  if (event.ready !== true || (event.provider !== 'cuda' && event.provider !== 'cpu')) throw new Error(String(event.message || 'STTN model probe thất bại.'))
  return event.provider
}

export async function runSttnRemoval(input: {
  videoPath: string
  timeline: OcrVisualTimeline
  outputPath: string
  ffmpegPath: string
  ffprobePath: string
  signal: AbortSignal
  onProgress?: (percent: number, message: string) => void
  previewSeconds?: number
}, hooks: {
  resolveEngine?: typeof resolveSttnEngine
  resolveModel?: () => Promise<string | null>
  command?: typeof runSttnCommand
} = {}): Promise<{ outputPath: string; provider: 'cuda' | 'cpu'; elapsedMs: number }> {
  input.signal.throwIfAborted()
  if (!isAbsolute(input.outputPath) || resolve(input.outputPath) === resolve(input.videoPath)) throw new Error('STTN cần đường dẫn output mới và tuyệt đối.')
  if (input.previewSeconds !== undefined && (!Number.isFinite(input.previewSeconds) || input.previewSeconds <= 0 || input.previewSeconds > 10)) throw new Error('STTN preview phải từ 0 đến 10 giây.')
  if (await lstat(input.outputPath).then(() => true, () => false)) throw new Error('STTN không ghi đè output đã tồn tại.')
  const executablePath = await (hooks.resolveEngine || resolveSttnEngine)()
  if (!executablePath) throw new Error('Chưa cài STTN engine.')
  const { resolveSttnModel } = await import('./assets')
  const modelPath = await (hooks.resolveModel || resolveSttnModel)()
  if (!modelPath) throw new Error('Chưa cài model STTN hợp lệ.')
  const command = hooks.command || runSttnCommand
  const metadata = parseCanonicalMediaMetadata(await command({ executablePath: input.ffprobePath, args: ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input.videoPath], expectedEvent: 'media', signal: input.signal, timeoutMs: 30_000 }))
  if (!metadata.geometry || !metadata.videoDurationSeconds) throw new Error('Không đọc được geometry video STTN.')
  const timeline = validateOcrVisualTimeline(input.timeline, { width: metadata.geometry.displayWidth, height: metadata.geometry.displayHeight, durationSeconds: metadata.videoDurationSeconds, sampleFps: 8, geometryFingerprint: metadata.geometry.fingerprint, scanRegion: input.timeline.scanRegion })
  const outputPath = resolve(input.outputPath)
  await mkdir(dirname(outputPath), { recursive: true })
  const workDir = await mkdtemp(join(dirname(outputPath), '.sttn-'))
  // Worker owns this private output; only promote it after all protocol/file checks pass.
  const temporaryOutput = join(workDir, 'cleaned.mkv')
  try {
    const timelinePath = join(workDir, 'timeline.json')
    const requestPath = join(workDir, 'request.json')
    await writeFile(timelinePath, JSON.stringify(timeline), 'utf8')
    await writeFile(requestPath, JSON.stringify({ inputPath: resolve(input.videoPath), outputPath: temporaryOutput, timelinePath, modelPath, ffmpegPath: input.ffmpegPath, ffprobePath: input.ffprobePath, provider: 'auto', maxFrames: 12, ...(input.previewSeconds !== undefined ? { previewSeconds: input.previewSeconds } : {}) }), 'utf8')
    const event = await command({ executablePath, args: ['--run', '--request', requestPath], expectedEvent: 'done', signal: input.signal, timeoutMs: 24 * 60 * 60 * 1000, onProgress: input.onProgress })
    if (typeof event.outputPath !== 'string' || !isAbsolute(event.outputPath) || resolve(event.outputPath) !== temporaryOutput || (event.provider !== 'cuda' && event.provider !== 'cpu') || typeof event.elapsedMs !== 'number' || !Number.isFinite(event.elapsedMs) || event.elapsedMs < 0) throw new Error('STTN kết quả output/provider/elapsedMs không hợp lệ.')
    await assertContainedRegularFile(event.outputPath, workDir, 'STTN output')
    if ((await stat(event.outputPath)).size === 0) throw new Error('STTN output trống.')
    input.signal.throwIfAborted()
    const { link } = await import('node:fs/promises')
    // Hard link is atomic, refuses existing output, and stays on the same volume.
    await link(temporaryOutput, outputPath)
    return { outputPath, provider: event.provider, elapsedMs: event.elapsedMs }
  } finally { await rm(workDir, { recursive: true, force: true }) }
}
