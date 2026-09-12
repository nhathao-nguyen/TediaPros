import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { validateAutoShortTemporalEditV2, type AutoShortTemporalEditV2, type CutFrameIndex, type CutTime, type FrameBoundary } from '../shared/autoShortCutContract'
import type { AutoShortTemporalEdit } from '../shared/autoShortTemporalEdit'
import { boundaryTime } from '../shared/autoShortCutPlan'
import { canonicalJson } from './autoShortStageKeys'
import { hashFileSha256 } from './autoShortStageKeys'
import { assertContainedRegularFile } from './safeContainedPath'
import { terminateProcessTree, trackChildProcess } from './processTree'

interface Rational { n: bigint; d: bigint }

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left
  let b = right < 0n ? -right : right
  while (b !== 0n) [a, b] = [b, a % b]
  return a || 1n
}

function rational(value: CutTime): Rational {
  if (!/^-?\d+$/u.test(value.num) || !/^\d+$/u.test(value.den)) throw new Error('CUT_INVALID_RANGE')
  const n = BigInt(value.num)
  const d = BigInt(value.den)
  if (d <= 0n) throw new Error('CUT_INVALID_RANGE')
  return { n, d }
}

function normalized(value: Rational): CutTime {
  const common = gcd(value.n, value.d)
  return { num: (value.n / common).toString(), den: (value.d / common).toString() }
}

function compare(left: CutTime, right: CutTime): number {
  const a = rational(left)
  const b = rational(right)
  const delta = a.n * b.d - b.n * a.d
  return delta < 0n ? -1 : delta > 0n ? 1 : 0
}

function add(left: CutTime, right: CutTime): CutTime {
  const a = rational(left)
  const b = rational(right)
  return normalized({ n: a.n * b.d + b.n * a.d, d: a.d * b.d })
}

function subtract(left: CutTime, right: CutTime): CutTime {
  const value = rational(right)
  return add(left, normalized({ n: -value.n, d: value.d }))
}

export function resolveFrameBoundary(
  orderedBoundaries: readonly FrameBoundary[],
  seconds: CutTime,
  videoEpoch: CutTime
): FrameBoundary {
  if (orderedBoundaries.length < 2) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
  let previousTime: CutTime | null = null
  for (const [position, boundary] of orderedBoundaries.entries()) {
    if (boundary.presentationIndex !== position || boundary.eof !== (position === orderedBoundaries.length - 1)) {
      throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
    }
    const currentTime = boundaryTime(boundary)
    if (previousTime && compare(previousTime, currentTime) >= 0) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED')
    previousTime = currentTime
  }
  const target = add(videoEpoch, seconds)
  if (compare(target, boundaryTime(orderedBoundaries[0])) < 0 || compare(target, boundaryTime(orderedBoundaries.at(-1)!)) > 0) {
    throw new Error('CUT_INVALID_RANGE')
  }
  const resolved = orderedBoundaries.find((boundary) => compare(boundaryTime(boundary), target) >= 0)
  if (!resolved) throw new Error('CUT_INVALID_RANGE')
  return { ...resolved, timeBase: { ...resolved.timeBase } }
}

interface FfprobeStreamInput {
  time_base?: unknown
  start_pts?: unknown
  duration_ts?: unknown
  sample_rate?: unknown
  channels?: unknown
  sample_fmt?: unknown
  bits_per_raw_sample?: unknown
  bits_per_sample?: unknown
}

export function selectCutPcmCodec(stream: FfprobeStreamInput): NonNullable<CutFrameIndex['audio']>['pcmCodec'] {
  const format = typeof stream.sample_fmt === 'string' ? stream.sample_fmt.toLowerCase() : ''
  const rawBits = Number(stream.bits_per_raw_sample || stream.bits_per_sample || 0)
  if (format === 'u8' || format === 'u8p') return 'pcm_u8'
  if (format === 's16' || format === 's16p') return 'pcm_s16le'
  if (format === 's32' || format === 's32p') return rawBits > 0 && rawBits <= 24 ? 'pcm_s24le' : 'pcm_s32le'
  if (format === 'flt' || format === 'fltp') return 'pcm_f32le'
  if (format === 'dbl' || format === 'dblp') return 'pcm_f64le'
  return 'pcm_s32le'
}

interface FfprobeFrameInput {
  best_effort_timestamp?: unknown
  pts?: unknown
  pkt_duration?: unknown
}

function integerText(value: unknown, label: string): string {
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof text !== 'string' || !/^-?\d+$/u.test(text)) throw new Error(`CUT_FRAME_INDEX_UNSUPPORTED: ${label}`)
  return text
}

function positiveInteger(value: unknown, label: string): number {
  const number = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(number) || (number as number) <= 0) throw new Error(`CUT_FRAME_INDEX_UNSUPPORTED: ${label}`)
  return number as number
}

function parseTimeBase(value: unknown): { num: number; den: number } {
  if (typeof value !== 'string') throw new Error('CUT_FRAME_INDEX_UNSUPPORTED: time_base')
  const match = /^(\d+)\/(\d+)$/u.exec(value)
  if (!match) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED: time_base')
  return { num: positiveInteger(match[1], 'time_base num'), den: positiveInteger(match[2], 'time_base den') }
}

function ticksTime(ticks: string, timeBase: { num: number; den: number }): CutTime {
  return normalized({ n: BigInt(ticks) * BigInt(timeBase.num), d: BigInt(timeBase.den) })
}

export function parseFfprobeFrameIndex(input: {
  itemId: string
  sourceDigest: string
  videoStream: FfprobeStreamInput
  audioStream?: FfprobeStreamInput
  frames: readonly FfprobeFrameInput[]
}): CutFrameIndex {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(input.itemId) || !/^[a-f0-9]{64}$/u.test(input.sourceDigest)) {
    throw new Error('CUT_SOURCE_CHANGED')
  }
  if (!Array.isArray(input.frames) || input.frames.length === 0) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED: no frames')
  const timeBase = parseTimeBase(input.videoStream.time_base)
  const boundaries: FrameBoundary[] = input.frames.map((frame, presentationIndex) => ({
    presentationIndex,
    ptsTicks: integerText(frame.best_effort_timestamp ?? frame.pts, `frame ${presentationIndex} PTS`),
    timeBase: { ...timeBase },
    eof: false
  }))
  for (let index = 1; index < boundaries.length; index += 1) {
    if (compare(boundaryTime(boundaries[index - 1]), boundaryTime(boundaries[index])) >= 0) {
      throw new Error('CUT_FRAME_INDEX_UNSUPPORTED: duplicate or unordered PTS')
    }
  }
  const lastFrame = input.frames.at(-1)!
  const packetDuration = lastFrame.pkt_duration === undefined ? null : BigInt(integerText(lastFrame.pkt_duration, 'last frame duration'))
  let eofTicks: bigint
  if (packetDuration !== null && packetDuration > 0n) {
    eofTicks = BigInt(boundaries.at(-1)!.ptsTicks) + packetDuration
  } else if (input.videoStream.duration_ts !== undefined) {
    const startTicks = BigInt(integerText(input.videoStream.start_pts ?? boundaries[0].ptsTicks, 'video start PTS'))
    eofTicks = startTicks + BigInt(integerText(input.videoStream.duration_ts, 'video duration ticks'))
  } else if (boundaries.length > 1) {
    const last = BigInt(boundaries.at(-1)!.ptsTicks)
    eofTicks = last + last - BigInt(boundaries.at(-2)!.ptsTicks)
  } else {
    throw new Error('CUT_FRAME_INDEX_UNSUPPORTED: one-frame duration missing')
  }
  if (eofTicks <= BigInt(boundaries.at(-1)!.ptsTicks)) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED: invalid EOF')
  boundaries.push({ presentationIndex: boundaries.length, ptsTicks: eofTicks.toString(), timeBase: { ...timeBase }, eof: true })
  const videoEpoch = ticksTime(boundaries[0].ptsTicks, timeBase)
  const sourceDuration = subtract(boundaryTime(boundaries.at(-1)!), videoEpoch)
  let audio: CutFrameIndex['audio']
  if (input.audioStream) {
    const audioTimeBase = parseTimeBase(input.audioStream.time_base)
    const audioStart = ticksTime(integerText(input.audioStream.start_pts ?? '0', 'audio start PTS'), audioTimeBase)
    audio = {
      sampleRate: positiveInteger(input.audioStream.sample_rate, 'audio sample rate'),
      channels: positiveInteger(input.audioStream.channels, 'audio channels'),
      startRelativeToVideo: subtract(audioStart, videoEpoch),
      pcmCodec: selectCutPcmCodec(input.audioStream)
    }
  }
  const frameIndexRevision = createHash('sha256').update(canonicalJson({
    revision: 'cut-frame-index-v1', sourceDigest: input.sourceDigest, boundaries, videoEpoch, sourceDuration, audio
  })).digest('hex')
  return {
    identity: { itemId: input.itemId, sourceDigest: input.sourceDigest, frameIndexRevision },
    frameCount: input.frames.length,
    videoEpoch,
    sourceDuration,
    ...(audio ? { audio } : {}),
    validatedBoundaries: boundaries
  }
}

export function pageFrameBoundaries(
  boundaries: readonly FrameBoundary[],
  cursor: string | undefined,
  limit: number
): { boundaries: FrameBoundary[]; nextCursor?: string } {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 256) throw new Error('CUT_RESOURCE_LIMIT')
  const offset = cursor === undefined ? 0 : Number(cursor)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > boundaries.length) throw new Error('CUT_INVALID_RANGE')
  const page = boundaries.slice(offset, offset + limit).map((boundary) => ({ ...boundary, timeBase: { ...boundary.timeBase } }))
  const nextOffset = offset + page.length
  return { boundaries: page, ...(nextOffset < boundaries.length ? { nextCursor: String(nextOffset) } : {}) }
}

const MAX_FRAME_PROBE_BYTES = 256 * 1024 * 1024

async function captureJson(command: string, args: readonly string[], signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new Error('Đã hủy tạo frame index.')
  const text = await new Promise<string>((resolve, reject) => {
    const child = trackChildProcess(spawn(command, [...args], {
      windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']
    }))
    const chunks: Buffer[] = []
    let total = 0
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const abort = (): void => {
      terminateProcessTree(child)
      finish(new Error('Đã hủy tạo frame index.'))
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_FRAME_PROBE_BYTES) {
        terminateProcessTree(child)
        finish(new Error('CUT_RESOURCE_LIMIT: frame index quá lớn.'))
        return
      }
      chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096) })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) finish(new Error(`CUT_FRAME_INDEX_UNSUPPORTED: ffprobe ${code}; ${stderr}`))
      else finish()
    })
  })
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('CUT_FRAME_INDEX_UNSUPPORTED: ffprobe JSON')
  }
}

export async function probeAutoShortFrameIndex(input: {
  ffprobePath: string
  sourcePath: string
  itemId: string
  expectedSourceDigest?: string
  signal: AbortSignal
}): Promise<CutFrameIndex> {
  await assertContainedRegularFile(input.sourcePath, dirname(input.sourcePath), 'Video nguồn frame index')
  const sourceDigest = await hashFileSha256(input.sourcePath, input.signal)
  if (input.expectedSourceDigest && input.expectedSourceDigest !== sourceDigest) throw new Error('CUT_SOURCE_CHANGED')
  const raw = await captureJson(input.ffprobePath, [
    '-v', 'error', '-show_streams', '-show_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_type,time_base,start_pts,duration_ts,sample_rate,channels:frame=best_effort_timestamp,pts,pkt_duration',
    '-of', 'json', input.sourcePath
  ], input.signal) as { streams?: FfprobeStreamInput[]; frames?: FfprobeFrameInput[] }
  const audioRaw = await captureJson(input.ffprobePath, [
    '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type,time_base,start_pts,duration_ts,sample_rate,channels,sample_fmt,bits_per_raw_sample,bits_per_sample',
    '-of', 'json', input.sourcePath
  ], input.signal) as { streams?: FfprobeStreamInput[] }
  const videoStream = raw.streams?.[0]
  if (!videoStream || !raw.frames) throw new Error('CUT_FRAME_INDEX_UNSUPPORTED: video stream')
  const index = parseFfprobeFrameIndex({
    itemId: input.itemId,
    sourceDigest,
    videoStream,
    ...(audioRaw.streams?.[0] ? { audioStream: audioRaw.streams[0] } : {}),
    frames: raw.frames
  })
  if (await hashFileSha256(input.sourcePath, input.signal) !== sourceDigest) throw new Error('CUT_SOURCE_CHANGED')
  return index
}

export function upgradeLegacyTemporalEdit(edit: AutoShortTemporalEdit, index: CutFrameIndex): AutoShortTemporalEditV2 {
  const removedRanges = edit.removedRanges.map((range) => {
    const start = resolveFrameBoundary(index.validatedBoundaries, { num: String(range.startUs), den: '1000000' }, index.videoEpoch)
    const end = resolveFrameBoundary(index.validatedBoundaries, { num: String(range.endUs), den: '1000000' }, index.videoEpoch)
    if (start.presentationIndex === end.presentationIndex) throw new Error('CUT_INVALID_RANGE: khoảng cắt không chứa frame nào.')
    return { id: range.id, start, end }
  })
  const editId = `legacy-${createHash('sha256').update(canonicalJson(edit)).digest('hex').slice(0, 24)}`
  return validateAutoShortTemporalEditV2({
    ...index.identity,
    schemaVersion: 2,
    editId,
    revision: edit.revision,
    mode: 'ripple-delete',
    policyVersion: 'cut-v2',
    removedRanges,
    reviewResolutions: []
  })
}
