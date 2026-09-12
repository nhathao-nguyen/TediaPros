import {
  normalizeFrameCutRanges,
  type AutoShortTemporalEditV2,
  type CutExecutionIdentity,
  type CutFrameIndex,
  type CutIdentity,
  type CutTime,
  type FrameBoundary
} from './autoShortCutContract'

export interface CutKeepSegment {
  segmentId: string
  sourceStart: FrameBoundary
  sourceEnd: FrameBoundary
  editedStart: CutTime
  editedEnd: CutTime
  outputSampleStart?: string
  outputSampleEnd?: string
}

export interface CutExecutionPlan {
  identity: CutExecutionIdentity
  source: CutIdentity
  sourceDuration: CutTime
  editedDuration: CutTime
  videoEpoch: CutTime
  audio?: { sampleRate: number; channels: number; startRelativeToVideo: CutTime }
  keepSegments: CutKeepSegment[]
  joins: { leftSegmentId: string; rightSegmentId: string; editedAt: CutTime }[]
}

export interface ProjectedCutInterval {
  segmentId: string
  sourceStart: CutTime
  sourceEnd: CutTime
  editedStart: CutTime
  editedEnd: CutTime
}

interface Rational { n: bigint; d: bigint }

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) [a, b] = [b, a % b]
  return a || 1n
}

function rational(value: CutTime): Rational {
  if (!/^-?\d+$/u.test(value.num) || !/^\d+$/u.test(value.den)) throw new Error('CUT_INVALID_RANGE')
  let n = BigInt(value.num)
  let d = BigInt(value.den)
  if (d <= 0n) throw new Error('CUT_INVALID_RANGE')
  const common = gcd(n, d)
  n /= common
  d /= common
  return { n, d }
}

function time(value: Rational): CutTime {
  const common = gcd(value.n, value.d)
  const n = value.n / common
  const d = value.d / common
  return { num: n.toString(), den: d.toString() }
}

function add(left: CutTime, right: CutTime): CutTime {
  const a = rational(left)
  const b = rational(right)
  return time({ n: a.n * b.d + b.n * a.d, d: a.d * b.d })
}

function subtract(left: CutTime, right: CutTime): CutTime {
  const b = rational(right)
  return add(left, time({ n: -b.n, d: b.d }))
}

export function subtractCutTime(left: CutTime, right: CutTime): CutTime {
  return subtract(left, right)
}

export function cutTimeToDecimal(value: CutTime, digits = 12): string {
  if (!Number.isSafeInteger(digits) || digits < 0 || digits > 18) throw new Error('CUT_INVALID_RANGE')
  const source = rational(value)
  const sign = source.n < 0n ? '-' : ''
  const absolute = source.n < 0n ? -source.n : source.n
  const scale = 10n ** BigInt(digits)
  const rounded = (2n * absolute * scale + source.d) / (2n * source.d)
  const integerPart = rounded / scale
  if (digits === 0) return `${sign}${integerPart}`
  const fraction = (rounded % scale).toString().padStart(digits, '0').replace(/0+$/u, '')
  return fraction ? `${sign}${integerPart}.${fraction}` : `${sign}${integerPart}`
}

function compare(left: CutTime, right: CutTime): number {
  const a = rational(left)
  const b = rational(right)
  const delta = a.n * b.d - b.n * a.d
  return delta < 0n ? -1 : delta > 0n ? 1 : 0
}

function maximum(left: CutTime, right: CutTime): CutTime {
  return compare(left, right) >= 0 ? left : right
}

function minimum(left: CutTime, right: CutTime): CutTime {
  return compare(left, right) <= 0 ? left : right
}

export function boundaryTime(boundary: FrameBoundary): CutTime {
  if (!/^-?\d+$/u.test(boundary.ptsTicks) || !Number.isSafeInteger(boundary.timeBase.num)
    || boundary.timeBase.num <= 0 || !Number.isSafeInteger(boundary.timeBase.den) || boundary.timeBase.den <= 0) {
    throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
  }
  return time({ n: BigInt(boundary.ptsTicks) * BigInt(boundary.timeBase.num), d: BigInt(boundary.timeBase.den) })
}

export function sampleAt(value: CutTime, sampleRate: number): bigint {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error('CUT_INVALID_RANGE')
  const source = rational(value)
  const n = source.n * BigInt(sampleRate)
  const sign = n < 0n ? -1n : 1n
  const absolute = n < 0n ? -n : n
  return sign * ((2n * absolute + source.d) / (2n * source.d))
}

function sameBoundary(left: FrameBoundary, right: FrameBoundary): boolean {
  return left.presentationIndex === right.presentationIndex
    && left.ptsTicks === right.ptsTicks
    && left.timeBase.num === right.timeBase.num
    && left.timeBase.den === right.timeBase.den
    && left.eof === right.eof
}

function findBoundary(index: CutFrameIndex, requested: FrameBoundary): FrameBoundary {
  const found = index.validatedBoundaries.find((candidate) => candidate.presentationIndex === requested.presentationIndex)
  if (!found || !sameBoundary(found, requested)) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
  return found
}

function sameSource(left: CutIdentity, right: CutIdentity): boolean {
  return left.itemId === right.itemId && left.sourceDigest === right.sourceDigest
    && left.frameIndexRevision === right.frameIndexRevision
}

export function compileFrameCutPlan(input: {
  edit: AutoShortTemporalEditV2
  index: CutFrameIndex
  identity: CutExecutionIdentity
}): CutExecutionPlan {
  if (!sameSource(input.edit, input.index.identity) || input.identity.sourceDigest !== input.index.identity.sourceDigest) {
    throw new Error('CUT_SOURCE_CHANGED')
  }
  if (!Number.isSafeInteger(input.index.frameCount) || input.index.frameCount <= 0) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
  const ordered = [...input.index.validatedBoundaries]
  if (ordered.length < 2) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
  for (let position = 0; position < ordered.length; position += 1) {
    if (ordered[position].presentationIndex !== position || (ordered[position].eof !== (position === ordered.length - 1))) {
      throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
    }
    if (position > 0 && compare(boundaryTime(ordered[position - 1]), boundaryTime(ordered[position])) >= 0) {
      throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
    }
  }
  if (ordered.length !== input.index.frameCount + 1) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')

  const removed = normalizeFrameCutRanges(input.edit.removedRanges).map((range) => ({
    ...range,
    start: findBoundary(input.index, range.start),
    end: findBoundary(input.index, range.end)
  }))
  const keepSegments: CutKeepSegment[] = []
  let cursor = ordered[0]
  let editedCursor: CutTime = { num: '0', den: '1' }
  for (const range of removed) {
    if (range.start.presentationIndex > cursor.presentationIndex) {
      const duration = subtract(boundaryTime(range.start), boundaryTime(cursor))
      const editedEnd = add(editedCursor, duration)
      keepSegments.push({
        segmentId: `keep-${cursor.presentationIndex}-${range.start.presentationIndex}`,
        sourceStart: cursor,
        sourceEnd: range.start,
        editedStart: editedCursor,
        editedEnd,
        ...(input.index.audio ? {
          outputSampleStart: sampleAt(editedCursor, input.index.audio.sampleRate).toString(),
          outputSampleEnd: sampleAt(editedEnd, input.index.audio.sampleRate).toString()
        } : {})
      })
      editedCursor = editedEnd
    }
    cursor = range.end
  }
  const eof = ordered.at(-1)!
  if (cursor.presentationIndex < eof.presentationIndex) {
    const duration = subtract(boundaryTime(eof), boundaryTime(cursor))
    const editedEnd = add(editedCursor, duration)
    keepSegments.push({
      segmentId: `keep-${cursor.presentationIndex}-${eof.presentationIndex}`,
      sourceStart: cursor,
      sourceEnd: eof,
      editedStart: editedCursor,
      editedEnd,
      ...(input.index.audio ? {
        outputSampleStart: sampleAt(editedCursor, input.index.audio.sampleRate).toString(),
        outputSampleEnd: sampleAt(editedEnd, input.index.audio.sampleRate).toString()
      } : {})
    })
    editedCursor = editedEnd
  }
  if (keepSegments.length === 0 || compare(editedCursor, { num: '0', den: '1' }) <= 0) throw new Error('CUT_INVALID_RANGE')
  return {
    identity: { ...input.identity },
    source: { ...input.index.identity },
    sourceDuration: { ...input.index.sourceDuration },
    editedDuration: editedCursor,
    videoEpoch: { ...input.index.videoEpoch },
    ...(input.index.audio ? { audio: { ...input.index.audio, startRelativeToVideo: { ...input.index.audio.startRelativeToVideo } } } : {}),
    keepSegments,
    joins: keepSegments.slice(1).map((right, index) => ({
      leftSegmentId: keepSegments[index].segmentId,
      rightSegmentId: right.segmentId,
      editedAt: { ...right.editedStart }
    }))
  }
}

export function projectCutInterval(plan: CutExecutionPlan, start: CutTime, end: CutTime): ProjectedCutInterval[] {
  if (compare(start, end) >= 0) throw new Error('CUT_INVALID_RANGE')
  const fragments: ProjectedCutInterval[] = []
  for (const segment of plan.keepSegments) {
    const segmentStart = subtract(boundaryTime(segment.sourceStart), plan.videoEpoch)
    const segmentEnd = subtract(boundaryTime(segment.sourceEnd), plan.videoEpoch)
    const sourceStart = maximum(start, segmentStart)
    const sourceEnd = minimum(end, segmentEnd)
    if (compare(sourceStart, sourceEnd) >= 0) continue
    fragments.push({
      segmentId: segment.segmentId,
      sourceStart,
      sourceEnd,
      editedStart: add(segment.editedStart, subtract(sourceStart, segmentStart)),
      editedEnd: add(segment.editedStart, subtract(sourceEnd, segmentStart))
    })
  }
  return fragments
}
