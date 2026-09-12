/** User-authorized maximum local video extension; never compound this map. */
export const MAX_DUBBING_VIDEO_EXTENSION = 0.6
/** Keep motion readable before filling the remaining time with source replay. */
export const MAX_DUBBING_VIDEO_SLOWDOWN_EXTENSION = 0.2

export interface DubbingTimeSegment {
  mode: 'primary' | 'replay'
  ownerCueId?: string
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
  readonly requiredPercent: number
  readonly maxPercent: number
  constructor(
    readonly cueId: string,
    requiredPercent: number,
    maxTempo: number,
    readonly requiredExtensionSeconds?: number
  ) {
    super(`Cue ${cueId} vẫn không vừa ở ${maxTempo.toFixed(2)}x: cần kéo dài đoạn hình ${requiredPercent.toFixed(1)}%, vượt giới hạn 60%; không cắt lời.`)
    this.name = 'DubbingVideoExtensionLimitError'
    this.requiredPercent = requiredPercent
    this.maxPercent = MAX_DUBBING_VIDEO_EXTENSION * 100
  }
}

export function planDubbingTimeMap(
  sourceDuration: number,
  cues: readonly { id: string; start: number; sourceEnd: number; naturalDuration: number; availableDuration: number }[],
  maxTempo: number
): DubbingTimeMap {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0 || !Number.isFinite(maxTempo) || maxTempo <= 0) throw new Error('Invalid retiming input.')
  const segments: DubbingTimeSegment[] = []
  let outputStart = 0
  let sourceCursor = 0
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]
    const length = cue.sourceEnd - cue.start
    if (![cue.start, cue.sourceEnd, length, cue.naturalDuration, cue.availableDuration].every(Number.isFinite)
      || cue.start < sourceCursor || cue.sourceEnd > sourceDuration || length <= 0
      || cue.naturalDuration <= 0 || cue.availableDuration < 0) throw new Error(`Invalid retiming cue ${cue.id}.`)
    if (cue.start > sourceCursor) {
      const gapDuration = cue.start - sourceCursor
      segments.push({ mode: 'primary', sourceStart: sourceCursor, sourceEnd: cue.start,
        outputStart, outputEnd: outputStart + gapDuration })
      outputStart += gapDuration
    }
    const required = cue.naturalDuration / maxTempo
    // Small DSP guard only when an extension is actually necessary.
    const extension = required > cue.availableDuration + 0.001 ? required - cue.availableDuration + 0.015 : 0
    if (extension > length * MAX_DUBBING_VIDEO_EXTENSION + 0.000001) {
      throw new DubbingVideoExtensionLimitError(cue.id, extension / length * 100, maxTempo, extension)
    }
    // A tiny replay branch can be empty after frame quantization. When replay
    // is needed, reserve up to one 8fps mask frame for it while keeping
    // slowdown strictly inside the user-authorized 20% ceiling.
    const slowdownCap = length * MAX_DUBBING_VIDEO_SLOWDOWN_EXTENSION
    const rawReplayDuration = Math.max(0, extension - slowdownCap)
    const replayDuration = rawReplayDuration > 0.0000001
      ? Math.max(rawReplayDuration, Math.min(extension, 0.125))
      : 0
    const slowdownExtension = extension - replayDuration
    const primaryEnd = outputStart + length + slowdownExtension
    segments.push({ mode: 'primary', ownerCueId: cue.id,
      sourceStart: cue.start, sourceEnd: cue.sourceEnd, outputStart, outputEnd: primaryEnd })
    outputStart = primaryEnd
    if (replayDuration > 0.0000001) {
      segments.push({ mode: 'replay', ownerCueId: cue.id,
        sourceStart: Math.max(cue.start, cue.sourceEnd - replayDuration), sourceEnd: cue.sourceEnd,
        outputStart, outputEnd: outputStart + replayDuration })
      outputStart += replayDuration
    }
    sourceCursor = cue.sourceEnd
  }
  if (sourceCursor < sourceDuration) {
    const trailingDuration = sourceDuration - sourceCursor
    segments.push({ mode: 'primary', sourceStart: sourceCursor, sourceEnd: sourceDuration,
      outputStart, outputEnd: outputStart + trailingDuration })
    outputStart += trailingDuration
  }
  return { sourceDuration, outputDuration: segments.at(-1)!.outputEnd, segments }
}

export function mapDubbingTime(map: DubbingTimeMap, time: number): number {
  if (time >= map.sourceDuration) return map.outputDuration
  const primary = map.segments.filter((part) => part.mode !== 'replay')
  const segment = primary.find((part) => time < part.sourceEnd) ?? primary.at(-1)!
  return segment.outputStart + (time - segment.sourceStart) * (segment.outputEnd - segment.outputStart) / (segment.sourceEnd - segment.sourceStart)
}

export function dubbingVideoPtsExpression(map: DubbingTimeMap): string {
  const changes = map.segments.filter((part) => part.mode !== 'replay').flatMap((part) => {
    const length = part.sourceEnd - part.sourceStart
    const extra = part.outputEnd - part.outputStart - length
    return extra > 0.0000001 ? [`${(extra / length).toFixed(12)}*clip(T-${part.sourceStart.toFixed(9)},0,${length.toFixed(9)})`] : []
  })
  return `(${['T', ...changes].join('+')})/TB`
}
