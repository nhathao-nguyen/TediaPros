import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AutoShortTemporalEdit, AutoShortCutPlan } from '../shared/autoShortTemporalEdit'
import { compileAutoShortCutPlan, MICROSECONDS_PER_SECOND } from '../shared/autoShortTemporalEdit'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { runAutoShortNarratedFfmpegProcess } from './autoShortNarratedAudio'

export interface AutoShortCutMediaResult {
  path: string
  plan: AutoShortCutPlan
}

const seconds = (microseconds: number): string => (microseconds / MICROSECONDS_PER_SECOND).toFixed(6)

export function buildAutoShortCutFilter(plan: AutoShortCutPlan, hasAudio: boolean): string {
  const lines: string[] = []
  const videoOutputs: string[] = []
  const audioOutputs: string[] = []
  for (const [index, part] of plan.keepSegments.entries()) {
    const start = seconds(part.sourceStartUs)
    const end = seconds(part.sourceEndUs)
    const video = `cv${index}`
    lines.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[${video}]`)
    videoOutputs.push(`[${video}]`)
    if (hasAudio) {
      const audio = `ca${index}`
      lines.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[${audio}]`)
      audioOutputs.push(`[${audio}]`)
    }
  }
  lines.push(`${videoOutputs.join('')}concat=n=${videoOutputs.length}:v=1:a=0[vout]`)
  if (hasAudio) lines.push(`${audioOutputs.join('')}concat=n=${audioOutputs.length}:v=0:a=1[aout]`)
  return lines.join(';')
}

export async function cutAutoShortSource(input: {
  ffmpeg: string
  sourcePath: string
  workDir: string
  edit: AutoShortTemporalEdit
  sourceDurationSeconds: number
  hasAudio: boolean
  signal: AbortSignal
}): Promise<AutoShortCutMediaResult> {
  await assertContainedRegularFile(input.sourcePath, dirname(input.sourcePath), 'Video nguồn cắt đoạn')
  const plan = compileAutoShortCutPlan(input.edit, Math.round(input.sourceDurationSeconds * MICROSECONDS_PER_SECOND))
  if (plan.removedRanges.length === 0) return { path: input.sourcePath, plan }
  const output = join(input.workDir, 'source-after-cut.mkv')
  await assertContainedParentDirectory(output, input.workDir, 'Video sau cắt')
  const args = ['-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-i', input.sourcePath,
    '-filter_complex', buildAutoShortCutFilter(plan, input.hasAudio), '-map', '[vout]',
    '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'yuv444p']
  if (input.hasAudio) args.push('-map', '[aout]', '-c:a', 'pcm_s16le')
  else args.push('-an')
  args.push(output)
  await runAutoShortNarratedFfmpegProcess({ command: input.ffmpeg, args,
    sensitivePaths: [input.sourcePath, input.workDir, output], signal: input.signal })
  const info = await stat(output)
  if (!info.isFile() || info.size <= 0) throw new Error('FFmpeg không tạo được video sau cắt.')
  return { path: output, plan }
}
