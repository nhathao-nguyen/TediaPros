import { rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AutoShortTemporalEdit, AutoShortCutPlan } from '../shared/autoShortTemporalEdit'
import { compileAutoShortCutPlan, MICROSECONDS_PER_SECOND } from '../shared/autoShortTemporalEdit'
import type { CutExecutionPlan } from '../shared/autoShortCutPlan'
import { boundaryTime, cutTimeToDecimal, subtractCutTime } from '../shared/autoShortCutPlan'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { runAutoShortNarratedFfmpegProcess } from './autoShortNarratedAudio'
import { buildCutChunks } from './autoShortCutPreparation'

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
      const duration = seconds(part.sourceEndUs - part.sourceStartUs)
      lines.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-${start}/TB,aresample=async=1:first_pts=0,apad,atrim=duration=${duration}[${audio}]`)
      audioOutputs.push(`[${audio}]`)
    }
  }
  lines.push(`${videoOutputs.join('')}concat=n=${videoOutputs.length}:v=1:a=0[vout]`)
  if (hasAudio) lines.push(`${audioOutputs.join('')}concat=n=${audioOutputs.length}:v=0:a=1[aout]`)
  return lines.join(';')
}

export function buildAutoShortCutMediaArgs(input: {
  sourcePath: string
  outputPath: string
  filterPath: string
  hasAudio: boolean
  audioCodec?: 'pcm_u8' | 'pcm_s16le' | 'pcm_s24le' | 'pcm_s32le' | 'pcm_f32le' | 'pcm_f64le'
}): string[] {
  const args = ['-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-i', input.sourcePath,
    '-/filter_complex', input.filterPath, '-map', '[vout]', '-fps_mode', 'passthrough', '-c:v', 'ffv1', '-level', '3']
  if (input.hasAudio) args.push('-map', '[aout]', '-c:a', input.audioCodec || 'pcm_s16le')
  else args.push('-an')
  args.push(input.outputPath)
  return args
}

export function buildFrameCutFilter(plan: CutExecutionPlan, hasAudio: boolean): string {
  const lines: string[] = []
  const videoOutputs: string[] = []
  const audioOutputs: string[] = []
  for (const [index, part] of plan.keepSegments.entries()) {
    const video = `cv${index}`
    lines.push(`[0:v]trim=start_pts=${part.sourceStart.ptsTicks}:end_pts=${part.sourceEnd.ptsTicks},setpts=PTS-(${part.sourceStart.ptsTicks})[${video}]`)
    videoOutputs.push(`[${video}]`)
    if (hasAudio) {
      const audio = `ca${index}`
      const sourceStart = cutTimeToDecimal(boundaryTime(part.sourceStart))
      const sourceEnd = cutTimeToDecimal(boundaryTime(part.sourceEnd))
      const duration = cutTimeToDecimal(subtractCutTime(part.editedEnd, part.editedStart))
      lines.push(`[0:a]atrim=start=${sourceStart}:end=${sourceEnd},asetpts=PTS-(${sourceStart})/TB,aresample=async=1:first_pts=0,apad,atrim=duration=${duration}[${audio}]`)
      audioOutputs.push(`[${audio}]`)
    }
  }
  lines.push(`${videoOutputs.join('')}concat=n=${videoOutputs.length}:v=1:a=0[vout]`)
  if (hasAudio) lines.push(`${audioOutputs.join('')}concat=n=${audioOutputs.length}:v=0:a=1[aout]`)
  return lines.join(';')
}

function buildChunkJoinFilter(chunkCount: number, hasAudio: boolean): string {
  const lines = [`${Array.from({ length: chunkCount }, (_, index) => `[${index}:v]`).join('')}concat=n=${chunkCount}:v=1:a=0[vout]`]
  if (hasAudio) lines.push(`${Array.from({ length: chunkCount }, (_, index) => `[${index}:a]`).join('')}concat=n=${chunkCount}:v=0:a=1[aout]`)
  return lines.join(';')
}

async function runFrameGraph(input: {
  ffmpeg: string
  sourcePaths: string[]
  outputPath: string
  filterPath: string
  filter: string
  hasAudio: boolean
  audioCodec?: NonNullable<CutExecutionPlan['audio']>['pcmCodec']
  signal: AbortSignal
  sensitivePaths: string[]
}): Promise<void> {
  await writeFile(input.filterPath, input.filter, 'utf8')
  const args = ['-y', '-hide_banner', '-nostats', '-loglevel', 'error']
  for (const sourcePath of input.sourcePaths) args.push('-i', sourcePath)
  args.push('-/filter_complex', input.filterPath, '-map', '[vout]', '-fps_mode', 'passthrough', '-c:v', 'ffv1', '-level', '3')
  if (input.hasAudio) args.push('-map', '[aout]', '-c:a', input.audioCodec || 'pcm_s32le')
  else args.push('-an')
  args.push(input.outputPath)
  await runAutoShortNarratedFfmpegProcess({
    command: input.ffmpeg,
    args,
    sensitivePaths: input.sensitivePaths,
    signal: input.signal
  })
  const info = await stat(input.outputPath)
  if (!info.isFile() || info.size <= 0) throw new Error('FFmpeg không tạo được video sau cắt.')
}

export async function cutAutoShortSourceByFramePlan(input: {
  ffmpeg: string
  sourcePath: string
  workDir: string
  plan: CutExecutionPlan
  hasAudio: boolean
  signal: AbortSignal
}): Promise<{ path: string; plan: CutExecutionPlan; chunkCount: number }> {
  await assertContainedRegularFile(input.sourcePath, dirname(input.sourcePath), 'Video nguồn cắt đoạn')
  if (input.plan.keepSegments.length === 0) throw new Error('CUT_INVALID_RANGE')
  const output = join(input.workDir, 'source-after-cut.mkv')
  const incompleteOutput = join(input.workDir, 'source-after-cut.incomplete.mkv')
  const filterPath = join(input.workDir, 'source-after-cut.ffgraph')
  const chunks = buildCutChunks(input.plan, 64)
  const chunkPaths = chunks.map((_, index) => join(input.workDir, `source-after-cut.chunk-${String(index).padStart(4, '0')}.mkv`))
  const chunkIncompletePaths = chunks.map((_, index) => join(input.workDir, `source-after-cut.chunk-${String(index).padStart(4, '0')}.incomplete.mkv`))
  const chunkFilterPaths = chunks.map((_, index) => join(input.workDir, `source-after-cut.chunk-${String(index).padStart(4, '0')}.ffgraph`))
  await assertContainedParentDirectory(output, input.workDir, 'Video sau cắt')
  await assertContainedParentDirectory(incompleteOutput, input.workDir, 'Video sau cắt chưa hoàn tất')
  await assertContainedParentDirectory(filterPath, input.workDir, 'Filter graph cắt đoạn')
  for (const path of [...chunkPaths, ...chunkIncompletePaths, ...chunkFilterPaths]) {
    await assertContainedParentDirectory(path, input.workDir, 'Chunk cắt đoạn')
  }
  try {
    if (chunks.length === 1) {
      await runFrameGraph({
        ffmpeg: input.ffmpeg,
        sourcePaths: [input.sourcePath],
        outputPath: incompleteOutput,
        filterPath,
        filter: buildFrameCutFilter(input.plan, input.hasAudio),
        hasAudio: input.hasAudio,
        audioCodec: input.plan.audio?.pcmCodec,
        signal: input.signal,
        sensitivePaths: [input.sourcePath, input.workDir, output, incompleteOutput, filterPath]
      })
    } else {
      for (let index = 0; index < chunks.length; index += 1) {
        const chunkPlan = { ...input.plan, keepSegments: chunks[index] }
        await runFrameGraph({
          ffmpeg: input.ffmpeg,
          sourcePaths: [input.sourcePath],
          outputPath: chunkIncompletePaths[index],
          filterPath: chunkFilterPaths[index],
          filter: buildFrameCutFilter(chunkPlan, input.hasAudio),
          hasAudio: input.hasAudio,
          audioCodec: input.plan.audio?.pcmCodec,
          signal: input.signal,
          sensitivePaths: [input.sourcePath, input.workDir, chunkPaths[index], chunkIncompletePaths[index], chunkFilterPaths[index]]
        })
        await rename(chunkIncompletePaths[index], chunkPaths[index])
      }
      await runFrameGraph({
        ffmpeg: input.ffmpeg,
        sourcePaths: chunkPaths,
        outputPath: incompleteOutput,
        filterPath,
        filter: buildChunkJoinFilter(chunks.length, input.hasAudio),
        hasAudio: input.hasAudio,
        audioCodec: input.plan.audio?.pcmCodec,
        signal: input.signal,
        sensitivePaths: [input.sourcePath, input.workDir, output, incompleteOutput, filterPath, ...chunkPaths]
      })
    }
    await rename(incompleteOutput, output)
  } finally {
    for (const path of [filterPath, incompleteOutput, ...chunkPaths, ...chunkIncompletePaths, ...chunkFilterPaths]) {
      await rm(path, { force: true }).catch(() => {})
    }
  }
  return { path: output, plan: input.plan, chunkCount: chunks.length }
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
  const incompleteOutput = join(input.workDir, 'source-after-cut.incomplete.mkv')
  const filterPath = join(input.workDir, 'source-after-cut.ffgraph')
  await assertContainedParentDirectory(output, input.workDir, 'Video sau cắt')
  await assertContainedParentDirectory(incompleteOutput, input.workDir, 'Video sau cắt chưa hoàn tất')
  await assertContainedParentDirectory(filterPath, input.workDir, 'Filter graph cắt đoạn')
  await writeFile(filterPath, buildAutoShortCutFilter(plan, input.hasAudio), 'utf8')
  try {
    await runAutoShortNarratedFfmpegProcess({
      command: input.ffmpeg,
      args: buildAutoShortCutMediaArgs({ sourcePath: input.sourcePath, outputPath: incompleteOutput, filterPath, hasAudio: input.hasAudio }),
      sensitivePaths: [input.sourcePath, input.workDir, output, incompleteOutput, filterPath],
      signal: input.signal
    })
    const incompleteInfo = await stat(incompleteOutput)
    if (!incompleteInfo.isFile() || incompleteInfo.size <= 0) throw new Error('FFmpeg không tạo được video sau cắt.')
    await rename(incompleteOutput, output)
  } finally {
    await rm(filterPath, { force: true }).catch(() => {})
    await rm(incompleteOutput, { force: true }).catch(() => {})
  }
  const info = await stat(output)
  if (!info.isFile() || info.size <= 0) throw new Error('FFmpeg không tạo được video sau cắt.')
  return { path: output, plan }
}
