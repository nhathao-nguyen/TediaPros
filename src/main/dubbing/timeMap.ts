/** User-authorized maximum local video extension; never compound this map. */
export const MAX_DUBBING_VIDEO_EXTENSION = 0.4

export interface DubbingTimeSegment {
  sourceStart: number
  sourceEnd: number
  outputStart: number
  outputEnd: number
}
export interface DubbingTimeMap {
  sourceDuration: number
  outputDuration: number
  segments: DubbingTimeSegment[]
}

export class DubbingVideoExtensionLimitError extends Error {
  constructor(readonly cueId: string, requiredPercent: number, maxTempo: number) {
    super(`Cue ${cueId} vẫn không vừa ở ${maxTempo.toFixed(2)}x: cần kéo dài đoạn hình ${requiredPercent.toFixed(1)}%, vượt giới hạn 40%; không cắt lời.`)
    this.name = 'DubbingVideoExtensionLimitError'
  }
}

export function planDubbingTimeMap(
  sourceDuration: number,
  cues: readonly { id: string; start: number; naturalDuration: number; availableDuration: number }[],
  maxTempo: number
): DubbingTimeMap {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || !Number.isFinite(maxTempo) || maxTempo <= 0) throw new Error('Invalid retiming input.')
  const segments: DubbingTimeSegment[] = []
  let outputStart = 0
  if (cues[0]?.start > 0) {
    segments.push({ sourceStart: 0, sourceEnd: cues[0].start, outputStart: 0, outputEnd: cues[0].start })
    outputStart = cues[0].start
  }
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]
    const end = cues[i + 1]?.start ?? sourceDuration
    const length = end - cue.start
    if (![cue.start, length, cue.naturalDuration, cue.availableDuration].every(Number.isFinite)
      || cue.start < 0 || end > sourceDuration || length <= 0 || cue.naturalDuration <= 0 || cue.availableDuration < 0) throw new Error(`Invalid retiming cue ${cue.id}.`)
    const required = cue.naturalDuration / maxTempo
    // Small DSP guard only when an extension is actually necessary.
    const extension = required > cue.availableDuration + 0.001 ? required - cue.availableDuration + 0.015 : 0
    if (extension > length * MAX_DUBBING_VIDEO_EXTENSION + 0.000001) {
      throw new DubbingVideoExtensionLimitError(cue.id, extension / length * 100, maxTempo)
    }
    segments.push({ sourceStart: cue.start, sourceEnd: end, outputStart, outputEnd: outputStart + length + extension })
    outputStart += length + extension
  }
  if (cues.length === 0) segments.push({ sourceStart: 0, sourceEnd: sourceDuration, outputStart: 0, outputEnd: sourceDuration })
  return { sourceDuration, outputDuration: segments.at(-1)!.outputEnd, segments }
}

export function mapDubbingTime(map: DubbingTimeMap, time: number): number {
  const segment = map.segments.find((part) => time < part.sourceEnd) ?? map.segments.at(-1)!
  return segment.outputStart + (time - segment.sourceStart) * (segment.outputEnd - segment.outputStart) / (segment.sourceEnd - segment.sourceStart)
}

export function dubbingVideoPtsExpression(map: DubbingTimeMap): string {
  const changes = map.segments.flatMap((part) => {
    const length = part.sourceEnd - part.sourceStart
    const extra = part.outputEnd - part.outputStart - length
    return extra > 0.0000001 ? [`${(extra / length).toFixed(12)}*clip(T-${part.sourceStart.toFixed(9)},0,${length.toFixed(9)})`] : []
  })
  return `(${['T', ...changes].join('+')})/TB`
}
