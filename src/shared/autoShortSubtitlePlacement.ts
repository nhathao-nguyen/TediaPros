import type { AutoShortNormalizedRegion, AutoShortSubtitlePlacementMode, PixelRegion } from './types'
import type { OcrVisualTimeline } from './ocrVisualTimeline'

export type SubtitlePlacementReason =
  | 'manual'
  | 'selected'
  | 'no-candidate'
  | 'criteria-conflict'
  | 'ambiguous'
  | 'region-too-small'
  | 'too-many-candidates'

export interface SubtitlePlacementDecision {
  version: 1
  mode: AutoShortSubtitlePlacementMode
  reason: SubtitlePlacementReason
  region: AutoShortNormalizedRegion | null
  candidateCount: number
  coverage?: number
  typicalLineHeight?: number
}

interface Observation {
  region: PixelRegion
  text: string
  duration: number
  confidence: number
  lineHeight: number
  startFrame: number
  endFrameExclusive: number
}

interface Track {
  observations: Observation[]
}

interface Candidate {
  track: Track
  coverage: number
  typicalLineHeight: number
  confidence: number
}

const MAX_TRACKS = 128
const MIN_COVERAGE = 0.25
const MIN_CONFIDENCE = 0.75
const MIN_TEXT_STATE_SECONDS = 0.5
const WINNER_TOLERANCE = 0.9

export function effectiveAutoShortSubtitlePlacementMode(
  preferred: AutoShortSubtitlePlacementMode,
  automaticProcessing: boolean
): AutoShortSubtitlePlacementMode {
  return automaticProcessing && preferred === 'ocr-dominant' ? 'ocr-dominant' : 'manual'
}

function overlapLength(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function combineRegions(regions: readonly PixelRegion[]): PixelRegion {
  return {
    x0: Math.min(...regions.map((region) => region.x0)),
    y0: Math.min(...regions.map((region) => region.y0)),
    x1: Math.max(...regions.map((region) => region.x1)),
    y1: Math.max(...regions.map((region) => region.y1))
  }
}

function clipToRegion(region: PixelRegion, bounds: PixelRegion): PixelRegion | null {
  const clipped = {
    x0: Math.max(region.x0, bounds.x0),
    y0: Math.max(region.y0, bounds.y0),
    x1: Math.min(region.x1, bounds.x1),
    y1: Math.min(region.y1, bounds.y1)
  }
  return clipped.x1 > clipped.x0 && clipped.y1 > clipped.y0 ? clipped : null
}

function weightedQuantile(values: Array<{ value: number; weight: number }>, quantile: number): number {
  const sorted = [...values].sort((left, right) => left.value - right.value)
  const total = sorted.reduce((sum, item) => sum + item.weight, 0)
  if (sorted.length === 0 || total <= 0) return 0
  const target = total * quantile
  let seen = 0
  for (const item of sorted) {
    seen += item.weight
    if (seen >= target) return item.value
  }
  return sorted[sorted.length - 1].value
}

function normalizedText(value: string): string {
  return Array.from(value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, ''))
    .slice(0, 256)
    .join('')
}

function normalizedEditDistance(left: string, right: string): number {
  if (left === right) return 0
  if (!left || !right) return 1
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = new Array<number>(right.length + 1)
  for (let i = 1; i <= left.length; i++) {
    current[0] = i
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      )
    }
    for (let j = 0; j <= right.length; j++) previous[j] = current[j]
  }
  return previous[right.length] / Math.max(left.length, right.length)
}

function blocksForSegment(
  boxes: OcrVisualTimeline['segments'][number]['boxes'],
  scanRegion: PixelRegion
): Array<{ region: PixelRegion; text: string; confidence: number; lineHeight: number }> {
  const clipped = boxes.flatMap((box) => {
    const region = clipToRegion(box, scanRegion)
    return region ? [{ region, text: box.text, confidence: box.confidence }] : []
  }).sort((left, right) => left.region.y0 - right.region.y0 || left.region.x0 - right.region.x0)

  const lines: typeof clipped = []
  for (const item of clipped) {
    const match = lines.findIndex((line) => {
      const minHeight = Math.min(line.region.y1 - line.region.y0, item.region.y1 - item.region.y0)
      return overlapLength(line.region.y0, line.region.y1, item.region.y0, item.region.y1) >= minHeight * 0.5
    })
    if (match < 0) {
      lines.push({ ...item })
    } else {
      const line = lines[match]
      const ordered = line.region.x0 <= item.region.x0
        ? [line.text, item.text]
        : [item.text, line.text]
      lines[match] = {
        region: combineRegions([line.region, item.region]),
        text: ordered.filter(Boolean).join(' '),
        confidence: Math.min(line.confidence, item.confidence)
      }
    }
  }

  lines.sort((left, right) => left.region.y0 - right.region.y0 || left.region.x0 - right.region.x0)
  const blocks: Array<{ region: PixelRegion; text: string; confidence: number; lineHeight: number }> = []
  for (let index = 0; index < lines.length; index++) {
    const first = lines[index]
    const firstHeight = first.region.y1 - first.region.y0
    const next = lines[index + 1]
    if (next) {
      const nextHeight = next.region.y1 - next.region.y0
      const gap = next.region.y0 - first.region.y1
      const horizontalOverlap = overlapLength(first.region.x0, first.region.x1, next.region.x0, next.region.x1)
      const minWidth = Math.min(first.region.x1 - first.region.x0, next.region.x1 - next.region.x0)
      if (gap >= 0 && gap <= Math.min(firstHeight, nextHeight) * 0.8 && horizontalOverlap >= minWidth * 0.5) {
        blocks.push({
          region: combineRegions([first.region, next.region]),
          text: `${first.text} ${next.text}`.trim(),
          confidence: Math.min(first.confidence, next.confidence),
          lineHeight: (firstHeight + nextHeight) / 2
        })
        index++
        continue
      }
    }
    blocks.push({ region: first.region, text: first.text, confidence: first.confidence, lineHeight: firstHeight })
  }
  return blocks
}

function trackMatches(track: Track, observation: Observation): boolean {
  const previous = track.observations[track.observations.length - 1]
  if (!previous || previous.endFrameExclusive > observation.startFrame) return false
  const heightRatio = observation.lineHeight / previous.lineHeight
  if (heightRatio < 0.67 || heightRatio > 1.5) return false
  const height = Math.min(observation.lineHeight, previous.lineHeight)
  const bottomDifference = Math.abs(observation.region.y1 - previous.region.y1)
  const centerDifference = Math.abs(
    (observation.region.x0 + observation.region.x1) / 2 -
    (previous.region.x0 + previous.region.x1) / 2
  )
  return bottomDifference <= height * 0.75 && centerDifference <= height * 1.5
}

function distinctTextStateCount(observations: readonly Observation[]): number {
  const states: Array<{ representative: string; seconds: number }> = []
  for (const observation of observations) {
    const text = normalizedText(observation.text)
    if (!text) continue
    const state = states.find((item) => normalizedEditDistance(item.representative, text) <= 0.2)
    if (state) {
      state.seconds += observation.duration
    } else if (states.length < 32) {
      states.push({ representative: text, seconds: observation.duration })
    }
  }
  return states.filter((state) => state.seconds >= MIN_TEXT_STATE_SECONDS).length
}

function buildCandidates(timeline: OcrVisualTimeline): { candidates: Candidate[]; tooMany: boolean } {
  const tracks: Track[] = []
  for (const segment of timeline.segments) {
    const duration = Math.max(0, segment.end - segment.start)
    const blocks = blocksForSegment(segment.boxes, timeline.scanRegion)
    const usedTracks = new Set<Track>()
    for (const block of blocks) {
      const observation: Observation = {
        ...block,
        duration,
        startFrame: segment.startFrame,
        endFrameExclusive: segment.endFrameExclusive
      }
      const matching = tracks
        .filter((track) => !usedTracks.has(track) && trackMatches(track, observation))
        .sort((left, right) => {
          const leftPrevious = left.observations[left.observations.length - 1]
          const rightPrevious = right.observations[right.observations.length - 1]
          return Math.abs(leftPrevious.region.y1 - observation.region.y1) - Math.abs(rightPrevious.region.y1 - observation.region.y1)
        })[0]
      const track = matching ?? { observations: [] }
      if (!matching) {
        tracks.push(track)
        if (tracks.length > MAX_TRACKS) return { candidates: [], tooMany: true }
      }
      track.observations.push(observation)
      usedTracks.add(track)
    }
  }

  const candidates = tracks.flatMap((track): Candidate[] => {
    const visibleSeconds = track.observations.reduce((sum, observation) => sum + observation.duration, 0)
    const coverage = Math.min(1, visibleSeconds / timeline.video.durationSeconds)
    const typicalLineHeight = weightedQuantile(
      track.observations.map((observation) => ({ value: observation.lineHeight, weight: observation.duration })),
      0.5
    ) / timeline.video.height
    const confidence = visibleSeconds > 0
      ? track.observations.reduce((sum, observation) => sum + observation.confidence * observation.duration, 0) / visibleSeconds
      : 0
    if (
      coverage < MIN_COVERAGE ||
      confidence < MIN_CONFIDENCE ||
      distinctTextStateCount(track.observations) < 2
    ) return []
    return [{ track, coverage, typicalLineHeight, confidence }]
  })
  return { candidates, tooMany: false }
}

function selectedRegion(
  candidate: Candidate,
  timeline: OcrVisualTimeline,
  fallback: AutoShortNormalizedRegion
): AutoShortNormalizedRegion | null {
  const observations = candidate.track.observations
  const weighted = (key: keyof PixelRegion, quantile: number) => weightedQuantile(
    observations.map((observation) => ({ value: observation.region[key], weight: observation.duration })),
    quantile
  )
  const envelope = {
    x0: weighted('x0', 0.05),
    y0: weighted('y0', 0.05),
    x1: weighted('x1', 0.95),
    y1: weighted('y1', 0.95)
  }
  const typicalLineHeightPx = candidate.typicalLineHeight * timeline.video.height
  const padding = typicalLineHeightPx * 0.5
  const fallbackWidth = (fallback.x1 - fallback.x0) * timeline.video.width
  const fallbackHeight = (fallback.y1 - fallback.y0) * timeline.video.height
  const desiredWidth = Math.max(envelope.x1 - envelope.x0 + padding * 2, fallbackWidth)
  const desiredHeight = Math.max(envelope.y1 - envelope.y0 + padding * 2, fallbackHeight)
  const scanWidth = timeline.scanRegion.x1 - timeline.scanRegion.x0
  const scanHeight = timeline.scanRegion.y1 - timeline.scanRegion.y0
  if (scanWidth < desiredWidth * 0.8 || scanHeight < desiredHeight * 0.8) return null

  const width = Math.min(scanWidth, desiredWidth)
  const height = Math.min(scanHeight, desiredHeight)
  const centerX = weightedQuantile(observations.map((observation) => ({
    value: (observation.region.x0 + observation.region.x1) / 2,
    weight: observation.duration
  })), 0.5)
  const centerY = weightedQuantile(observations.map((observation) => ({
    value: (observation.region.y0 + observation.region.y1) / 2,
    weight: observation.duration
  })), 0.5)
  const x0 = Math.max(timeline.scanRegion.x0, Math.min(timeline.scanRegion.x1 - width, centerX - width / 2))
  const y0 = Math.max(timeline.scanRegion.y0, Math.min(timeline.scanRegion.y1 - height, centerY - height / 2))
  return {
    x0: x0 / timeline.video.width,
    y0: y0 / timeline.video.height,
    x1: (x0 + width) / timeline.video.width,
    y1: (y0 + height) / timeline.video.height
  }
}

function fallbackDecision(
  reason: Exclude<SubtitlePlacementReason, 'manual' | 'selected'>,
  fallbackRegion: AutoShortNormalizedRegion | null,
  candidateCount: number
): SubtitlePlacementDecision {
  return { version: 1, mode: 'ocr-dominant', reason, region: fallbackRegion, candidateCount }
}

export function resolveAutoShortSubtitlePlacement(input: {
  mode: AutoShortSubtitlePlacementMode
  timeline: OcrVisualTimeline | null
  fallbackRegion: AutoShortNormalizedRegion | null
}): SubtitlePlacementDecision {
  if (input.mode === 'manual') {
    return { version: 1, mode: 'manual', reason: 'manual', region: input.fallbackRegion, candidateCount: 0 }
  }
  if (!input.timeline || !input.fallbackRegion || input.timeline.video.durationSeconds <= 0) {
    return fallbackDecision('no-candidate', input.fallbackRegion, 0)
  }
  const { candidates, tooMany } = buildCandidates(input.timeline)
  if (tooMany) return fallbackDecision('too-many-candidates', input.fallbackRegion, 0)
  if (candidates.length === 0) return fallbackDecision('no-candidate', input.fallbackRegion, 0)

  const maxCoverage = Math.max(...candidates.map((candidate) => candidate.coverage))
  const maxHeight = Math.max(...candidates.map((candidate) => candidate.typicalLineHeight))
  const winners = candidates.filter((candidate) =>
    candidate.coverage >= WINNER_TOLERANCE * maxCoverage &&
    candidate.typicalLineHeight >= WINNER_TOLERANCE * maxHeight
  )
  if (winners.length === 0) return fallbackDecision('criteria-conflict', input.fallbackRegion, candidates.length)
  if (winners.length > 1) return fallbackDecision('ambiguous', input.fallbackRegion, candidates.length)

  const winner = winners[0]
  const region = selectedRegion(winner, input.timeline, input.fallbackRegion)
  if (!region) return fallbackDecision('region-too-small', input.fallbackRegion, candidates.length)
  return {
    version: 1,
    mode: 'ocr-dominant',
    reason: 'selected',
    region,
    candidateCount: candidates.length,
    coverage: winner.coverage,
    typicalLineHeight: winner.typicalLineHeight
  }
}
