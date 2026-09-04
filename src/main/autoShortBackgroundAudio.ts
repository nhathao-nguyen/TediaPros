import { resolveFfmpeg } from './deps'
import {
  buildAutoShortNarratedAudioArgs,
  composeAutoShortNarratedAudio,
  runAutoShortNarratedFfmpegProcess,
  type AutoShortNarratedFfmpegProcessInput
} from './autoShortNarratedAudio'

export interface AutoShortBackgroundAudioInput {
  musicPath: string
  narrationPath: string | null
  outputPath: string
  duration: number
  volume: number
  signal?: AbortSignal
}

export type AutoShortBackgroundFfmpegProcessInput = AutoShortNarratedFfmpegProcessInput

export const runAutoShortBackgroundFfmpegProcess = runAutoShortNarratedFfmpegProcess

export function buildAutoShortBackgroundAudioArgs(
  input: Omit<AutoShortBackgroundAudioInput, 'signal'>
): string[] {
  return buildAutoShortNarratedAudioArgs({
    bedPath: input.musicPath,
    narrationPath: input.narrationPath,
    outputPath: input.outputPath,
    durationSeconds: input.duration,
    bedMode: 'looping-music',
    bedVolume: input.volume
  })
}

export async function composeAutoShortBackgroundAudio(
  input: AutoShortBackgroundAudioInput
): Promise<void> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg để trộn nhạc background với giọng lồng tiếng.')
  if (input.signal?.aborted) throw new Error('Đã hủy tác vụ')

  return composeAutoShortNarratedAudio({
    ffmpegPath: ffmpeg,
    narrationPath: input.narrationPath,
    bedPath: input.musicPath,
    outputPath: input.outputPath,
    durationSeconds: input.duration,
    bedMode: 'looping-music',
    bedVolume: input.volume,
    signal: input.signal
  })
}
