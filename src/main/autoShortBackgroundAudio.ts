import { spawn } from 'node:child_process'
import { resolveFfmpeg } from './deps'
import { originalAudioGain } from '../shared/audioMix'
import { sanitizeAutoShortAuditError } from './autoShortAudit'
import { terminateProcessTree, trackChildProcess } from './processTree'

const MAX_FFMPEG_STDERR_TAIL = 8_192

export interface AutoShortBackgroundAudioInput {
  musicPath: string
  narrationPath: string | null
  outputPath: string
  duration: number
  volume: number
  signal?: AbortSignal
}

export interface AutoShortBackgroundFfmpegProcessInput {
  command: string
  args: readonly string[]
  sensitivePaths: readonly (string | null | undefined)[]
  signal?: AbortSignal
}

export function buildAutoShortBackgroundAudioArgs(input: Omit<AutoShortBackgroundAudioInput, 'signal'>): string[] {
  const duration = Math.max(0.1, input.duration).toFixed(3)
  const gain = originalAudioGain(input.volume)
  const args = ['-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-stream_loop', '-1', '-i', input.musicPath]
  if (input.narrationPath) args.push('-i', input.narrationPath)
  const music = `[0:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=${gain}[music]`
  const graph = input.narrationPath
    ? `${music};[1:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=1.0[narr];[music][narr]sidechaincompress=threshold=0.06:ratio=4:attack=15:release=200[ducked_music];[ducked_music][narr]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a_sum];[a_sum]alimiter=limit=-1dB:attack=5:release=50:level=false,apad=whole_dur=${duration},atrim=duration=${duration}[a_mix]`
    : `${music};[music]apad=whole_dur=${duration},atrim=duration=${duration},alimiter=limit=-1dB:attack=5:release=50:level=false[a_mix]`
  args.push('-filter_complex', graph, '-map', '[a_mix]', '-c:a', 'pcm_s16le', '-ac', '2', '-ar', '44100', input.outputPath)
  return args
}

function appendBoundedTail(current: string, chunk: Buffer | string): string {
  const combined = current + chunk.toString()
  return combined.length <= MAX_FFMPEG_STDERR_TAIL
    ? combined
    : combined.slice(-MAX_FFMPEG_STDERR_TAIL)
}

export async function runAutoShortBackgroundFfmpegProcess(
  input: AutoShortBackgroundFfmpegProcessInput
): Promise<void> {
  if (input.signal?.aborted) throw new Error('Đã hủy tác vụ')

  await new Promise<void>((resolve, reject) => {
    const child = trackChildProcess(spawn(input.command, [...input.args], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe']
    }))
    let settled = false
    let stderrTail = ''
    let abortError: Error | undefined
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      input.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve()
    }
    const abort = (): void => {
      abortError = new Error('Đã hủy tác vụ')
      terminateProcessTree(child)
    }
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = appendBoundedTail(stderrTail, chunk)
    })
    if (input.signal?.aborted) abort()
    else input.signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      if (abortError) {
        finish(abortError)
        return
      }
      const diagnostic = sanitizeAutoShortAuditError(error, [input.command, ...input.sensitivePaths])
      finish(new Error(`Không thể khởi động FFmpeg để trộn nhạc background. ${diagnostic}`))
    })
    child.on('close', (code) => {
      if (abortError) {
        finish(abortError)
        return
      }
      if (code === 0) {
        finish()
        return
      }
      const diagnostic = sanitizeAutoShortAuditError(stderrTail.trim(), input.sensitivePaths)
      finish(new Error(
        `Không thể trộn nhạc background với giọng lồng tiếng (FFmpeg thoát mã ${code ?? -1}).` +
        (diagnostic ? ` Chi tiết FFmpeg: ${diagnostic}` : '')
      ))
    })
  })
}

export async function composeAutoShortBackgroundAudio(input: AutoShortBackgroundAudioInput): Promise<void> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg để trộn nhạc background với giọng lồng tiếng.')
  if (input.signal?.aborted) throw new Error('Đã hủy tác vụ')

  const args = buildAutoShortBackgroundAudioArgs(input)
  await runAutoShortBackgroundFfmpegProcess({
    command: ffmpeg,
    args,
    sensitivePaths: [input.musicPath, input.narrationPath, input.outputPath],
    signal: input.signal
  })
}
