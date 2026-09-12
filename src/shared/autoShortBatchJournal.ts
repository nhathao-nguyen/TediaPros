import { normalizeAutoShortTemporalEdit } from './autoShortTemporalEdit'

export type BatchItemState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'needs-review'
  | 'interrupted'
  | 'cancelled'

export interface BatchOutputReceipt {
  path: string
  sha256: string
  bytes: number
  durationSeconds: number
}

export interface BatchFailure {
  code: string
  message: string
  recoverable: boolean
}

export interface BatchItemRecord {
  itemId: string
  inputPath: string
  inputDigest: string
  configDigest: string
  temporalEdit?: import('./autoShortTemporalEdit').AutoShortTemporalEdit
  ordinal: number
  attempt: number
  state: BatchItemState
  reservedOutputDir?: string
  artifactDir?: string
  outputReceipt?: BatchOutputReceipt
  failure?: BatchFailure
}

export interface BatchSnapshot {
  schemaVersion: 1
  jobId: string
  revision: number
  createdAtUtc: string
  updatedAtUtc: string
  items: BatchItemRecord[]
}

const STATES = new Set<BatchItemState>([
  'pending', 'running', 'succeeded', 'failed', 'needs-review', 'interrupted', 'cancelled'
])
const DIGEST = /^[a-f0-9]{64}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} schema không hợp lệ.`)
  return value as Record<string, unknown>
}

function exactFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) throw new Error(`${label} có field không hợp lệ: ${unknown}.`)
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) {
    throw new Error(`${label} không hợp lệ.`)
  }
  return value
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${label} không hợp lệ.`)
  return value as number
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) throw new Error(`${label} không hợp lệ.`)
  return value
}

function date(value: unknown, label: string): string {
  const result = text(value, label, 64)
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${label} không hợp lệ.`)
  return result
}

function validateReceipt(value: unknown): BatchOutputReceipt {
  const raw = record(value, 'Output receipt')
  exactFields(raw, ['path', 'sha256', 'bytes', 'durationSeconds'], 'Output receipt')
  const bytes = integer(raw.bytes, 'Output receipt bytes')
  if (bytes === 0) throw new Error('Output receipt bytes không hợp lệ.')
  if (typeof raw.durationSeconds !== 'number' || !Number.isFinite(raw.durationSeconds) || raw.durationSeconds <= 0) {
    throw new Error('Output receipt duration không hợp lệ.')
  }
  return {
    path: text(raw.path, 'Output receipt path', 32768),
    sha256: digest(raw.sha256, 'Output receipt checksum'),
    bytes,
    durationSeconds: raw.durationSeconds
  }
}

function validateFailure(value: unknown): BatchFailure {
  const raw = record(value, 'Failure')
  exactFields(raw, ['code', 'message', 'recoverable'], 'Failure')
  if (typeof raw.recoverable !== 'boolean') throw new Error('Failure recoverable không hợp lệ.')
  return {
    code: text(raw.code, 'Failure code', 128),
    message: text(raw.message, 'Failure message', 4096),
    recoverable: raw.recoverable
  }
}

export function validateBatchSnapshot(value: unknown): BatchSnapshot {
  const raw = record(value, 'Batch snapshot')
  exactFields(raw, ['schemaVersion', 'jobId', 'revision', 'createdAtUtc', 'updatedAtUtc', 'items'], 'Batch snapshot')
  if (raw.schemaVersion !== 1) throw new Error('Batch snapshot schema version không được hỗ trợ.')
  const jobId = text(raw.jobId, 'Batch job ID', 128)
  if (!SAFE_ID.test(jobId)) throw new Error('Batch job ID không hợp lệ.')
  if (!Array.isArray(raw.items) || raw.items.length > 100_000) throw new Error('Batch items không hợp lệ.')

  const ids = new Set<string>()
  const ordinals = new Set<number>()
  const items = raw.items.map((value, index): BatchItemRecord => {
    const item = record(value, `Batch item ${index}`)
    exactFields(item, [
      'itemId', 'inputPath', 'inputDigest', 'configDigest', 'temporalEdit', 'ordinal', 'attempt', 'state', 'reservedOutputDir', 'artifactDir', 'outputReceipt', 'failure'
    ], `Batch item ${index}`)
    const itemId = text(item.itemId, `Batch item ${index} ID`, 128)
    if (!SAFE_ID.test(itemId)) throw new Error(`Batch item ${index} ID không hợp lệ.`)
    const ordinal = integer(item.ordinal, `Batch item ${index} ordinal`)
    if (ids.has(itemId) || ordinals.has(ordinal)) throw new Error('Batch item ID hoặc ordinal bị trùng duplicate.')
    ids.add(itemId)
    ordinals.add(ordinal)
    if (!STATES.has(item.state as BatchItemState)) throw new Error(`Batch item ${index} state không hợp lệ.`)
    const state = item.state as BatchItemState
    const outputReceipt = item.outputReceipt === undefined ? undefined : validateReceipt(item.outputReceipt)
    if (state === 'succeeded' && !outputReceipt) throw new Error('Batch item succeeded thiếu output receipt biên nhận.')
    if (outputReceipt && state !== 'succeeded' && state !== 'needs-review') {
      throw new Error('Output receipt chỉ hợp lệ cho succeeded hoặc needs-review.')
    }
    const failure = item.failure === undefined ? undefined : validateFailure(item.failure)
    let temporalEdit
    if (item.temporalEdit !== undefined) {
      temporalEdit = normalizeAutoShortTemporalEdit(item.temporalEdit)
    }
    return {
      itemId,
      inputPath: text(item.inputPath, `Batch item ${index} inputPath`, 32768),
      inputDigest: digest(item.inputDigest, `Batch item ${index} inputDigest`),
      configDigest: digest(item.configDigest, `Batch item ${index} configDigest`),
      ...(temporalEdit ? { temporalEdit } : {}),
      ordinal,
      attempt: integer(item.attempt, `Batch item ${index} attempt`),
      state,
      ...(item.reservedOutputDir === undefined ? {} : { reservedOutputDir: text(item.reservedOutputDir, `Batch item ${index} reservedOutputDir`, 32768) }),
      ...(item.artifactDir === undefined ? {} : { artifactDir: text(item.artifactDir, `Batch item ${index} artifactDir`, 32768) }),
      ...(outputReceipt ? { outputReceipt } : {}),
      ...(failure ? { failure } : {})
    }
  })

  return {
    schemaVersion: 1,
    jobId,
    revision: integer(raw.revision, 'Batch revision'),
    createdAtUtc: date(raw.createdAtUtc, 'Batch createdAtUtc'),
    updatedAtUtc: date(raw.updatedAtUtc, 'Batch updatedAtUtc'),
    items
  }
}

export function recoverInterruptedBatch(snapshot: BatchSnapshot): BatchSnapshot {
  const source = validateBatchSnapshot(snapshot)
  return {
    ...source,
    items: source.items.map((item) => item.state === 'running'
      ? { ...item, state: 'interrupted', failure: { code: 'process_interrupted', message: 'Ứng dụng đã dừng trước khi mục hoàn tất.', recoverable: true } }
      : { ...item, ...(item.outputReceipt ? { outputReceipt: { ...item.outputReceipt } } : {}), ...(item.failure ? { failure: { ...item.failure } } : {}) })
  }
}

export function resumeCandidateIds(snapshot: BatchSnapshot): string[] {
  return validateBatchSnapshot(snapshot).items
    .filter((item) => item.state === 'pending' || item.state === 'interrupted')
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((item) => item.itemId)
}

export function isSafeBatchId(value: string): boolean {
  return SAFE_ID.test(value)
}
