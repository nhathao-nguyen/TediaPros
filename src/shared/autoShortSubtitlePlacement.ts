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
  distinctStates: number
}

const MAX_TRACKS = 128
const MIN_COVERAGE = 0.08
const MIN_CONFIDENCE = 0.68
const MIN_TEXT_STATE_SECONDS = 0.3
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
    const distinctStates = distinctTextStateCount(track.observations)
    if (
      coverage < MIN_COVERAGE ||
      confidence < MIN_CONFIDENCE ||
      distinctStates < 2
    ) return []
    return [{ track, coverage, typicalLineHeight, confidence, distinctStates }]
  })
  return { candidates, tooMany: false }
}

export function computeSmartFallbackRegion(
  scanRegion: PixelRegion,
  video: { width: number; height: number },
  userFallback: AutoShortNormalizedRegion
): AutoShortNormalizedRegion {
  if (!scanRegion || video.height <= 0 || video.width <= 0) {
    return userFallback
  }
  const scanNorm = {
    x0: scanRegion.x0 / video.width,
    y0: scanRegion.y0 / video.height,
    x1: scanRegion.x1 / video.width,
    y1: scanRegion.y1 / video.height
  }
  const overlap = Math.max(0, Math.min(scanNorm.y1, userFallback.y1) - Math.max(scanNorm.y0, userFallback.y0))
  const userH = userFallback.y1 - userFallback.y0
  // If user fallback already significantly overlaps with scanRegion (>= 40% vertical overlap), keep userFallback
  if (userH > 0 && overlap >= userH * 0.4) {
    return userFallback
  }
  // Otherwise, userFallback is far away (e.g. defaulted to bottom 0.78-0.90 while scanning higher up)
  // Center the subtitle box inside scanRegion so it always lands on the erased/blurred area
  const scanH = scanNorm.y1 - scanNorm.y0
  const scanW = scanNorm.x1 - scanNorm.x0
  const targetH = Math.min(userH > 0 ? userH : 0.12, scanH)
  const userW = userFallback.x1 - userFallback.x0
  const targetW = Math.min(userW > 0 ? userW : 0.84, scanW)
  const centerY = (scanNorm.y0 + scanNorm.y1) / 2
  const centerX = (scanNorm.x0 + scanNorm.x1) / 2
  const y0 = Math.max(scanNorm.y0, Math.min(scanNorm.y1 - targetH, centerY - targetH / 2))
  const x0 = Math.max(scanNorm.x0, Math.min(scanNorm.x1 - targetW, centerX - targetWidthFallback(scanNorm, targetW, centerX)))
  return {
    x0: Math.max(0, Math.min(1, x0)),
    y0: Math.max(0, Math.min(1, y0)),
    x1: Math.max(0, Math.min(1, x0 + targetW)),
    y1: Math.max(0, Math.min(1, y0 + targetH))
  }
}

function targetWidthFallback(scanNorm: { x0: number; x1: number }, targetW: number, centerX: number): number {
  return targetW / 2
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

  const textEnvelopeWidth = envelope.x1 - envelope.x0 + padding * 2
  const textEnvelopeHeight = envelope.y1 - envelope.y0 + padding * 2

  const scanWidth = timeline.scanRegion.x1 - timeline.scanRegion.x0
  const scanHeight = timeline.scanRegion.y1 - timeline.scanRegion.y0

  // Require scanRegion to fit at least 70% of text envelope
  if (scanWidth < textEnvelopeWidth * 0.7 || scanHeight < textEnvelopeHeight * 0.7) return null

  // Ensure desired dimensions do not exceed scanRegion even if fallback box was drawn oversized
  const desiredWidth = Math.min(scanWidth, Math.max(textEnvelopeWidth, Math.min(fallbackWidth, scanWidth)))
  const desiredHeight = Math.min(scanHeight, Math.max(textEnvelopeHeight, Math.min(fallbackHeight, scanHeight)))

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
  candidateCount: number,
  timeline?: OcrVisualTimeline | null
): SubtitlePlacementDecision {
  const region = fallbackRegion && timeline
    ? computeSmartFallbackRegion(timeline.scanRegion, timeline.video, fallbackRegion)
    : fallbackRegion
  return { version: 1, mode: 'ocr-dominant', reason, region, candidateCount }
}

function scoreSubtitleCandidate(candidate: Candidate, timeline: OcrVisualTimeline): number {
  // Dialogue subtitles typically:
  // 1. Have changing text (distinctStates >= 2, capped at 10)
  // 2. High coverage (longer duration on screen)
  // 3. Subtitle height plausibility (0.015 - 0.10 of video height)
  // 4. Vertical position: lower half of scanRegion is more typical for dialogue subtitles than top title banner
  const stateBonus = Math.min(candidate.distinctStates, 10)
  const dynamicMultiplier = candidate.distinctStates >= 2 ? 1.6 : 0.5
  const heightPlausibility = candidate.typicalLineHeight >= 0.015 && candidate.typicalLineHeight <= 0.09 ? 1.0 : 0.7
  const observations = candidate.track.observations
  const centerY = weightedQuantile(observations.map((o) => ({
    value: (o.region.y0 + o.region.y1) / 2,
    weight: o.duration
  })), 0.5) / timeline.video.height
  const positionBonus = 1.0 + Math.max(0, centerY - 0.35) * 0.35

  return candidate.coverage * (1 + stateBonus * 0.3) * dynamicMultiplier * heightPlausibility * positionBonus * candidate.confidence
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
    return fallbackDecision('no-candidate', input.fallbackRegion, 0, input.timeline)
  }
  const { candidates, tooMany } = buildCandidates(input.timeline)
  if (tooMany) return fallbackDecision('too-many-candidates', input.fallbackRegion, 0, input.timeline)
  if (candidates.length === 0) return fallbackDecision('no-candidate', input.fallbackRegion, 0, input.timeline)

  const maxCoverage = Math.max(...candidates.map((candidate) => candidate.coverage))
  const maxHeight = Math.max(...candidates.map((candidate) => candidate.typicalLineHeight))
  const strictWinners = candidates.filter((candidate) =>
    candidate.coverage >= WINNER_TOLERANCE * maxCoverage &&
    candidate.typicalLineHeight >= WINNER_TOLERANCE * maxHeight
  )
  if (strictWinners.length === 1) {
    const winner = strictWinners[0]
    const region = selectedRegion(winner, input.timeline, input.fallbackRegion)
    if (!region) return fallbackDecision('region-too-small', input.fallbackRegion, candidates.length, input.timeline)
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

  // When strict winners don't yield a single winner (e.g. large title vs dialogue subtitle, or tie):
  // Score candidates by dialogue subtitle characteristics
  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreSubtitleCandidate(candidate, input.timeline!)
  })).sort((a, b) => b.score - a.score)

  const best = scored[0]
  const second = scored[1]

  // If best candidate is clearly dominant over the second (or single candidate)
  if (best && (!second || best.score >= 1.25 * second.score)) {
    const winner = best.candidate
    const region = selectedRegion(winner, input.timeline, input.fallbackRegion)
    if (!region) return fallbackDecision('region-too-small', input.fallbackRegion, candidates.length, input.timeline)
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

  // Truly ambiguous or conflicting candidates with equivalent scores
  const reason = strictWinners.length > 1 ? 'ambiguous' : 'criteria-conflict'
  return fallbackDecision(reason, input.fallbackRegion, candidates.length, input.timeline)
}
