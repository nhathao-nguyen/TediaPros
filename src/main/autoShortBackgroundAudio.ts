import { spawn } from 'node:child_process'
import { resolveFfmpeg } from './deps'
import { originalAudioGain } from '../shared/audioMix'

export interface AutoShortBackgroundAudioInput {
  musicPath: string
  narrationPath: string | null
  outputPath: string
  duration: number
  volume: number
  signal?: AbortSignal
}

export function buildAutoShortBackgroundAudioArgs(input: Omit<AutoShortBackgroundAudioInput, 'signal'>): string[] {
  const duration = Math.max(0.1, input.duration).toFixed(3)
  const gain = originalAudioGain(input.volume)
  const args = ['-y', '-stream_loop', '-1', '-i', input.musicPath]
  if (input.narrationPath) args.push('-i', input.narrationPath)
  const music = `[0:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=${gain}[music]`
  const graph = input.narrationPath
    ? `${music};[1:a]asetpts=PTS-STARTPTS,aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,volume=1.0[narr];[music][narr]sidechaincompress=threshold=0.06:ratio=4:attack=15:release=200[ducked_music];[ducked_music][narr]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[a_sum];[a_sum]alimiter=limit=-1dB:attack=5:release=50,apad=whole_dur=${duration},atrim=duration=${duration}[a_mix]`
    : `${music};[music]apad=whole_dur=${duration},atrim=duration=${duration},alimiter=limit=-1dB:attack=5:release=50[a_mix]`
  args.push('-filter_complex', graph, '-map', '[a_mix]', '-c:a', 'pcm_s16le', '-ac', '2', '-ar', '44100', input.outputPath)
  return args
}

export async function composeAutoShortBackgroundAudio(input: AutoShortBackgroundAudioInput): Promise<void> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg để trộn nhạc background với giọng lồng tiếng.')
  if (input.signal?.aborted) throw new Error('Đã hủy tác vụ')

  const args = buildAutoShortBackgroundAudioArgs(input)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true })
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    const abort = (): void => {
      try { child.kill() } catch { /* ignore */ }
      finish(new Error('Đã hủy tác vụ'))
    }
    if (input.signal?.aborted) abort()
    else input.signal?.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      input.signal?.removeEventListener('abort', abort)
      finish(error)
    })
    child.on('close', (code) => {
      input.signal?.removeEventListener('abort', abort)
      finish(code === 0 ? undefined : new Error('Không thể trộn nhạc background với giọng lồng tiếng.'))
    })
  })
}
