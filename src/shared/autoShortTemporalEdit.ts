export const AUTO_SHORT_TEMPORAL_EDIT_VERSION = 1 as const
export const MAX_AUTO_SHORT_CUT_RANGES = 1000
export const MICROSECONDS_PER_SECOND = 1_000_000

export interface AutoShortCutRange {
  id: string
  /** Inclusive source boundary, in integer microseconds. */
  startUs: number
  /** Exclusive source boundary, in integer microseconds. */
  endUs: number
}

export interface AutoShortTemporalEdit {
  schemaVersion: typeof AUTO_SHORT_TEMPORAL_EDIT_VERSION
  revision: number
  mode: 'ripple-delete'
  removedRanges: AutoShortCutRange[]
}

export interface AutoShortKeepSegment {
  id: string
  sourceStartUs: number
  sourceEndUs: number
  editedStartUs: number
  editedEndUs: number
}

export interface AutoShortCutPlan {
  sourceDurationUs: number
  editedDurationUs: number
  removedRanges: AutoShortCutRange[]
  keepSegments: AutoShortKeepSegment[]
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} không hợp lệ.`)
  return value as number
}

export function normalizeAutoShortTemporalEdit(raw: unknown): AutoShortTemporalEdit | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Bản cắt video không hợp lệ.')
  const value = raw as Record<string, unknown>
  const allowed = new Set(['schemaVersion', 'revision', 'mode', 'removedRanges'])
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) throw new Error(`Bản cắt video có field không hợp lệ: ${unknown}.`)
  if (value.schemaVersion !== AUTO_SHORT_TEMPORAL_EDIT_VERSION || value.mode !== 'ripple-delete') {
    throw new Error('Phiên bản hoặc chế độ cắt video không được hỗ trợ.')
  }
  const revision = integer(value.revision, 'Revision bản cắt')
  if (!Array.isArray(value.removedRanges) || value.removedRanges.length > MAX_AUTO_SHORT_CUT_RANGES) {
    throw new Error(`Bản cắt chỉ hỗ trợ tối đa ${MAX_AUTO_SHORT_CUT_RANGES} khoảng.`)
  }
  const ranges = value.removedRanges.map((entry, index): AutoShortCutRange => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Khoảng cắt ${index + 1} không hợp lệ.`)
    const range = entry as Record<string, unknown>
    const extra = Object.keys(range).find((key) => !['id', 'startUs', 'endUs'].includes(key))
    if (extra) throw new Error(`Khoảng cắt ${index + 1} có field không hợp lệ: ${extra}.`)
    if (typeof range.id !== 'string' || !SAFE_ID.test(range.id)) throw new Error(`ID khoảng cắt ${index + 1} không hợp lệ.`)
    const startUs = integer(range.startUs, `Điểm đầu khoảng cắt ${index + 1}`)
    const endUs = integer(range.endUs, `Điểm cuối khoảng cắt ${index + 1}`)
    if (endUs <= startUs) throw new Error(`Khoảng cắt ${index + 1} phải có điểm cuối lớn hơn điểm đầu.`)
    return { id: range.id, startUs, endUs }
  })
  ranges.sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs || left.id.localeCompare(right.id))
  const merged: AutoShortCutRange[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, range.endUs)
      previous.id = previous.id.localeCompare(range.id) <= 0 ? previous.id : range.id
    } else {
      merged.push({ ...range })
    }
  }
  if (merged.length === 0) return undefined
  return { schemaVersion: AUTO_SHORT_TEMPORAL_EDIT_VERSION, revision, mode: 'ripple-delete', removedRanges: merged }
}

export function compileAutoShortCutPlan(edit: AutoShortTemporalEdit | undefined, sourceDurationUs: number): AutoShortCutPlan {
  const duration = integer(sourceDurationUs, 'Thời lượng video nguồn')
  if (duration <= 0) throw new Error('Thời lượng video nguồn phải lớn hơn 0.')
  const normalized = normalizeAutoShortTemporalEdit(edit)
  const removedRanges = normalized?.removedRanges || []
  for (const range of removedRanges) {
    if (range.endUs > duration) throw new Error('Khoảng cắt vượt quá thời lượng video nguồn.')
  }
  const keepSegments: AutoShortKeepSegment[] = []
  let sourceCursor = 0
  let editedCursor = 0
  for (const range of removedRanges) {
    if (range.startUs > sourceCursor) {
      const length = range.startUs - sourceCursor
      keepSegments.push({ id: `keep-${sourceCursor}-${range.startUs}`, sourceStartUs: sourceCursor, sourceEndUs: range.startUs,
        editedStartUs: editedCursor, editedEndUs: editedCursor + length })
      editedCursor += length
    }
    sourceCursor = range.endUs
  }
  if (sourceCursor < duration) {
    keepSegments.push({ id: `keep-${sourceCursor}-${duration}`, sourceStartUs: sourceCursor, sourceEndUs: duration,
      editedStartUs: editedCursor, editedEndUs: editedCursor + duration - sourceCursor })
    editedCursor += duration - sourceCursor
  }
  if (keepSegments.length === 0 || editedCursor <= 0) throw new Error('Bản cắt đã xóa toàn bộ video.')
  return { sourceDurationUs: duration, editedDurationUs: editedCursor, removedRanges, keepSegments }
}

export function mapSourceToEdited(plan: AutoShortCutPlan, sourceUs: number): number | null {
  if (!Number.isSafeInteger(sourceUs) || sourceUs < 0 || sourceUs > plan.sourceDurationUs) return null
  if (sourceUs === plan.sourceDurationUs) return plan.editedDurationUs
  const segment = plan.keepSegments.find((part) => sourceUs >= part.sourceStartUs && sourceUs < part.sourceEndUs)
  return segment ? segment.editedStartUs + sourceUs - segment.sourceStartUs : null
}

export function cutDurationSeconds(edit: AutoShortTemporalEdit | undefined, sourceDurationSeconds: number): number {
  const plan = compileAutoShortCutPlan(edit, Math.round(sourceDurationSeconds * MICROSECONDS_PER_SECOND))
  return plan.editedDurationUs / MICROSECONDS_PER_SECOND
}
