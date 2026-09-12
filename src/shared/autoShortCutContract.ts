export const AUTO_SHORT_TEMPORAL_EDIT_V2_VERSION = 2 as const
export const AUTO_SHORT_CUT_POLICY_VERSION = 'cut-v2' as const
export const MAX_AUTO_SHORT_RAW_CUT_RANGES = 1000
export const MAX_AUTO_SHORT_CUT_EDIT_BYTES = 2 * 1024 * 1024

export interface CutIdentity {
  itemId: string
  sourceDigest: string
  frameIndexRevision: string
}

export interface CutRequestIdentity extends CutIdentity {
  requestId: string
  editRevision: number
}

export interface CutTime {
  num: string
  den: string
}

export interface FrameBoundary {
  presentationIndex: number
  ptsTicks: string
  timeBase: { num: number; den: number }
  eof: boolean
}

export interface FrameCutRange {
  id: string
  start: FrameBoundary
  end: FrameBoundary
}

export interface CutReviewResolution {
  cueId: string
  segmentId: string
  evidenceDigest: string
  editDigest: string
  action: 'edit-retained-text' | 'keep-intentional-cut'
  text?: string
}

export interface AutoShortTemporalEditV2 extends CutIdentity {
  schemaVersion: typeof AUTO_SHORT_TEMPORAL_EDIT_V2_VERSION
  editId: string
  revision: number
  mode: 'ripple-delete'
  policyVersion: typeof AUTO_SHORT_CUT_POLICY_VERSION
  removedRanges: FrameCutRange[]
  reviewResolutions: CutReviewResolution[]
}

export interface CutEditContent {
  operations: FrameCutRange[]
  reviewResolutions: CutReviewResolution[]
}

export interface CutEditDocument extends CutIdentity {
  schemaVersion: typeof AUTO_SHORT_TEMPORAL_EDIT_V2_VERSION
  editId: string
  revision: number
  draft: CutEditContent
  applied?: AutoShortTemporalEditV2
}

export interface CutHistory {
  past: CutEditContent[]
  present: CutEditContent
  future: CutEditContent[]
}

export type CutHistoryAction =
  | { type: 'replace'; content: CutEditContent }
  | { type: 'undo' }
  | { type: 'redo' }

export type CutRunIntent = 'resolve-draft' | 'new-run' | 'resume' | 'start'

export interface CutExecutionIdentity {
  sourceDigest: string
  editDigest: string
  executorRevision: string
  runtimeDigest: string
  mediaPolicyDigest: string
}

export interface CutFrameIndex {
  identity: CutIdentity
  frameCount: number
  videoEpoch: CutTime
  sourceDuration: CutTime
  audio?: {
    sampleRate: number
    channels: number
    startRelativeToVideo: CutTime
    pcmCodec?: 'pcm_u8' | 'pcm_s16le' | 'pcm_s24le' | 'pcm_s32le' | 'pcm_f32le' | 'pcm_f64le'
  }
  validatedBoundaries: readonly FrameBoundary[]
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const SHA_256 = /^[a-f0-9]{64}$/u
const INTEGER_TICKS = /^-?\d+$/u

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} không hợp lệ.`)
  return value as Record<string, unknown>
}

function exactFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const fields = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !fields.has(key))
  if (unknown) throw new Error(`${label} có field không hợp lệ: ${unknown}.`)
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${label} không hợp lệ.`)
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} không hợp lệ.`)
  return value as number
}

function validateBoundary(raw: unknown, label: string): FrameBoundary {
  const value = record(raw, label)
  exactFields(value, ['presentationIndex', 'ptsTicks', 'timeBase', 'eof'], label)
  const presentationIndex = nonNegativeInteger(value.presentationIndex, `${label} index`)
  if (typeof value.ptsTicks !== 'string' || !INTEGER_TICKS.test(value.ptsTicks)) throw new Error(`${label} PTS không hợp lệ.`)
  const timeBase = record(value.timeBase, `${label} time base`)
  exactFields(timeBase, ['num', 'den'], `${label} time base`)
  if (!Number.isSafeInteger(timeBase.num) || (timeBase.num as number) <= 0 || !Number.isSafeInteger(timeBase.den) || (timeBase.den as number) <= 0) {
    throw new Error(`${label} time base không hợp lệ.`)
  }
  if (typeof value.eof !== 'boolean') throw new Error(`${label} EOF không hợp lệ.`)
  return {
    presentationIndex,
    ptsTicks: value.ptsTicks,
    timeBase: { num: timeBase.num as number, den: timeBase.den as number },
    eof: value.eof
  }
}

function validateRange(raw: unknown, index: number): FrameCutRange {
  const value = record(raw, `Khoảng cắt ${index + 1}`)
  exactFields(value, ['id', 'start', 'end'], `Khoảng cắt ${index + 1}`)
  const start = validateBoundary(value.start, `Điểm đầu khoảng cắt ${index + 1}`)
  const end = validateBoundary(value.end, `Điểm cuối khoảng cắt ${index + 1}`)
  if (end.presentationIndex <= start.presentationIndex) throw new Error(`Khoảng cắt ${index + 1} phải có điểm cuối lớn hơn điểm đầu.`)
  if (start.eof) throw new Error(`Điểm đầu khoảng cắt ${index + 1} không thể là EOF.`)
  return { id: safeId(value.id, `ID khoảng cắt ${index + 1}`), start, end }
}

function validateResolution(raw: unknown, index: number): CutReviewResolution {
  const value = record(raw, `Xử lý review ${index + 1}`)
  exactFields(value, ['cueId', 'segmentId', 'evidenceDigest', 'editDigest', 'action', 'text'], `Xử lý review ${index + 1}`)
  if (value.action !== 'edit-retained-text' && value.action !== 'keep-intentional-cut') throw new Error(`Hành động review ${index + 1} không hợp lệ.`)
  if (value.text !== undefined && typeof value.text !== 'string') throw new Error(`Nội dung review ${index + 1} không hợp lệ.`)
  return {
    cueId: safeId(value.cueId, `Cue ID review ${index + 1}`),
    segmentId: safeId(value.segmentId, `Segment ID review ${index + 1}`),
    evidenceDigest: safeId(value.evidenceDigest, `Evidence digest review ${index + 1}`),
    editDigest: safeId(value.editDigest, `Edit digest review ${index + 1}`),
    action: value.action,
    ...(value.text !== undefined ? { text: value.text } : {})
  }
}

function serializedSize(raw: unknown): number {
  let json: string | undefined
  try {
    json = JSON.stringify(raw)
  } catch {
    throw new Error('Bản cắt video không thể serialize.')
  }
  if (json === undefined) throw new Error('Bản cắt video không thể serialize.')
  return new TextEncoder().encode(json).byteLength
}

export function validateAutoShortTemporalEditV2(raw: unknown): AutoShortTemporalEditV2 {
  if (serializedSize(raw) > MAX_AUTO_SHORT_CUT_EDIT_BYTES) throw new Error('Bản cắt video vượt quá giới hạn 2 MiB.')
  const value = record(raw, 'Bản cắt video')
  exactFields(value, [
    'schemaVersion', 'editId', 'revision', 'mode', 'policyVersion', 'itemId', 'sourceDigest',
    'frameIndexRevision', 'removedRanges', 'reviewResolutions'
  ], 'Bản cắt video')
  if (value.schemaVersion !== AUTO_SHORT_TEMPORAL_EDIT_V2_VERSION) throw new Error('Phiên bản bản cắt video không được hỗ trợ.')
  if (value.mode !== 'ripple-delete') throw new Error('Phiên bản hoặc chế độ cắt video không được hỗ trợ.')
  if (value.policyVersion !== AUTO_SHORT_CUT_POLICY_VERSION) throw new Error('Phiên bản chính sách cắt video không được hỗ trợ.')
  if (typeof value.sourceDigest !== 'string' || !SHA_256.test(value.sourceDigest)) throw new Error('Source digest bản cắt không hợp lệ.')
  if (!Array.isArray(value.removedRanges) || value.removedRanges.length > MAX_AUTO_SHORT_RAW_CUT_RANGES) {
    throw new Error(`Bản cắt chỉ hỗ trợ tối đa ${MAX_AUTO_SHORT_RAW_CUT_RANGES} khoảng.`)
  }
  if (!Array.isArray(value.reviewResolutions)) throw new Error('Danh sách xử lý review không hợp lệ.')
  const removedRanges = value.removedRanges.map(validateRange)
  const ids = new Set<string>()
  for (const range of removedRanges) {
    if (ids.has(range.id)) throw new Error(`ID khoảng cắt bị trùng: ${range.id}.`)
    ids.add(range.id)
  }
  return {
    schemaVersion: AUTO_SHORT_TEMPORAL_EDIT_V2_VERSION,
    editId: safeId(value.editId, 'Edit ID'),
    revision: nonNegativeInteger(value.revision, 'Revision bản cắt'),
    mode: 'ripple-delete',
    policyVersion: AUTO_SHORT_CUT_POLICY_VERSION,
    itemId: safeId(value.itemId, 'Item ID'),
    sourceDigest: value.sourceDigest,
    frameIndexRevision: safeId(value.frameIndexRevision, 'Frame index revision'),
    removedRanges: normalizeFrameCutRanges(removedRanges),
    reviewResolutions: value.reviewResolutions.map(validateResolution)
  }
}

export function normalizeFrameCutRanges(ranges: readonly FrameCutRange[]): FrameCutRange[] {
  const sorted = ranges.map((range, index) => validateRange(range, index))
    .sort((left, right) => left.start.presentationIndex - right.start.presentationIndex
      || left.end.presentationIndex - right.end.presentationIndex
      || left.id.localeCompare(right.id))
  const normalized: FrameCutRange[] = []
  for (const range of sorted) {
    const previous = normalized.at(-1)
    if (previous && range.start.presentationIndex <= previous.end.presentationIndex) {
      if (range.end.presentationIndex > previous.end.presentationIndex) previous.end = { ...range.end, timeBase: { ...range.end.timeBase } }
      if (range.id.localeCompare(previous.id) < 0) previous.id = range.id
    } else {
      normalized.push({
        id: range.id,
        start: { ...range.start, timeBase: { ...range.start.timeBase } },
        end: { ...range.end, timeBase: { ...range.end.timeBase } }
      })
    }
  }
  return normalized
}
