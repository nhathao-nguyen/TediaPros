import { join } from 'node:path'
import { writeFile, statfs, stat } from 'node:fs/promises'
import { assertContainedParentDirectory } from '../safeContainedPath'
import { runAutoShortNarratedFfmpegProcess } from '../autoShortNarratedAudio'
import type { DubbingTimeMap } from './timeMap'
import { getGlobalAutoShortDiskBudget } from '../autoShortDiskBudget'

export function retimedSourceAudioGraph(
  map: DubbingTimeMap,
  inputLabel = '0:a',
  replayMode: 'repeat' | 'silence' = 'repeat'
): string {
  const branches = map.segments.map((_, i) => `[as${i}]`).join('')
  const lines = [`[${inputLabel}]asetpts=PTS-STARTPTS,asplit=${map.segments.length}${branches}`]
  map.segments.forEach((part, i) => {
    const duration = part.outputEnd - part.outputStart
    const tempo = (part.sourceEnd - part.sourceStart) / duration
    // Padding aligns source beds at sample boundaries. Narration is never processed here.
    const silence = part.mode === 'replay' && replayMode === 'silence' ? ',volume=0' : ''
    lines.push(`[as${i}]atrim=start=${part.sourceStart.toFixed(9)}:end=${part.sourceEnd.toFixed(9)},asetpts=PTS-STARTPTS,atempo=${tempo.toFixed(12)}${silence},apad,atrim=duration=${duration.toFixed(9)}[ao${i}]`)
  })
  lines.push(`${map.segments.map((_, i) => `[ao${i}]`).join('')}concat=n=${map.segments.length}:v=0:a=1[aout]`)
  return lines.join(';')
}

/** All output and filter scripts stay inside the job scratch directory. */
export async function retimeDubbingMedia(input: {
  ffmpeg: string; source: string; workDir: string; name: string
  map: DubbingTimeMap; kind: 'video' | 'mask' | 'audio'; hasAudio?: boolean; audioSource?: string
  frameRate?: number; width?: number; height?: number; signal: AbortSignal
}): Promise<string> {
  const output = join(input.workDir, `${input.name}.${input.kind === 'audio' ? 'wav' : 'mkv'}`)
  const script = join(input.workDir, `${input.name}.ffgraph`)
  await assertContainedParentDirectory(output, input.workDir, 'Retimed media')
  await assertContainedParentDirectory(script, input.workDir, 'Retiming filter')
  const disk = getGlobalAutoShortDiskBudget()
  const volume = input.workDir.match(/^([A-Za-z]):/)?.[1]?.toUpperCase()
  const volumePath = volume ? `${volume}:\\` : input.workDir
  const free = await statfs(volumePath)
  // Bound writes explicitly; fail before filling the disk even with an unusual encoder output.
  const bytesPerSecond = input.kind === 'audio' ? 400_000 : input.kind === 'mask'
    ? (input.width || 3840) * (input.height || 2160) * 8 * 2 : 7_000_000
  const maxBytes = Math.ceil(bytesPerSecond * input.map.outputDuration + 1024 * 1024)
  if (Number(free.bavail) * Number(free.bsize) - disk.getReservedBytes(volumePath)
    < maxBytes + disk.getSafetyHeadroomBytes()) throw new Error('Không đủ dung lượng tạm để kéo dài video an toàn.')
  const lines: string[] = []
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', input.source]
  if (input.audioSource && input.hasAudio) args.push('-i', input.audioSource)
  if (input.kind !== 'audio') {
    const fps = input.kind === 'mask' ? 8 : (input.frameRate && input.frameRate > 0 ? input.frameRate : 30)
    const splitLabels = input.map.segments.map((_, index) => `[vs${index}]`).join('')
    lines.push(`[0:v]split=${input.map.segments.length}${splitLabels}`)
    const videoParts = input.map.segments.map((part, index) => {
      const ownerStart = part.mode === 'replay'
        ? input.map.segments.find((candidate) => candidate.mode === 'primary' && candidate.ownerCueId === part.ownerCueId)?.sourceStart
        : undefined
      // A replay shorter than one encoded frame can produce an empty trim.
      // Decode up to two frames from the tail of the same owning cue and
      // compress them to the exact requested replay duration.
      const sourceStart = part.mode === 'replay'
        ? Math.max(ownerStart ?? part.sourceStart, Math.min(part.sourceStart, part.sourceEnd - 2 / fps))
        : part.sourceStart
      const sourceDuration = part.sourceEnd - sourceStart
      const outputDuration = part.outputEnd - part.outputStart
      return `[vs${index}]trim=start=${sourceStart.toFixed(9)}:end=${part.sourceEnd.toFixed(9)},setpts=(PTS-STARTPTS)*${(outputDuration / sourceDuration).toFixed(12)}[v${index}]`
    })
    lines.push(...videoParts)
    lines.push(`${input.map.segments.map((_, index) => `[v${index}]`).join('')}concat=n=${input.map.segments.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=1,trim=duration=${input.map.outputDuration.toFixed(9)},fps=${fps}[vout]`)
  }
  if (input.kind === 'audio' || input.hasAudio) lines.push(retimedSourceAudioGraph(
    input.map,
    input.audioSource && input.hasAudio ? '1:a' : '0:a',
    input.kind === 'audio' ? 'repeat' : 'silence'
  ))
  const filterGraph = lines.join(';')
  await writeFile(script, filterGraph, 'utf8')
  // The managed FFmpeg 9 build used by TediaPros no longer exposes the
  // legacy `-filter_complex_script` option. Keep the graph file as an
  // auditable scratch artifact, but pass the graph through the supported
  // `-filter_complex` option.
  args.push('-filter_complex', filterGraph)
  if (input.kind !== 'audio') {
    args.push('-map', '[vout]')
    if (input.kind === 'mask') args.push('-c:v', 'ffv1', '-pix_fmt', 'gray')
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-maxrate', '40M', '-bufsize', '80M', '-pix_fmt', 'yuv420p', '-fps_mode', 'vfr')
  }
  if (input.kind === 'audio' || input.hasAudio) args.push('-map', '[aout]', '-c:a', 'pcm_s16le', '-ar', '44100')
  else args.push('-an')
  args.push('-t', input.map.outputDuration.toFixed(9), '-fs', String(maxBytes), output)
  await runAutoShortNarratedFfmpegProcess({ command: input.ffmpeg, args,
    sensitivePaths: [input.source, input.audioSource, output, script], signal: input.signal })
  if ((await stat(output)).size >= maxBytes) throw new Error('Retimed media vượt dự trù đĩa; dừng thay vì xuất file thiếu.')
  return output
}
