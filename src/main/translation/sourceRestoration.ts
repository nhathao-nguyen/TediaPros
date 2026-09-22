import { createHash } from 'node:crypto'
import type { SubtitleCue } from '../../shared/types'
import { parseAiJsonObject } from '../../shared/aiOutput'

export type SourceCue = SubtitleCue

export interface AudioMetadata {
  durationSeconds: number
  sampleRate: number
  channels: number
  format: 'mp3' | 'wav'
  sha256: string
}

export interface OcrVisualFrame {
  timestamp: number
  end?: number
  lines: Array<{
    text: string
    confidence?: number
    boundingBox?: { x: number; y: number; width: number; height: number }
  }>
}

export interface EvidenceItem {
  id: string
  type: 'ocr' | 'audio' | 'glossary'
  text: string
  timestamp?: number
  start?: number
  end?: number
  confidence?: number
  region?: { x: number; y: number; width: number; height: number }
  matchingCueIds: string[]
}

export interface SourceEvidencePack {
  schemaVersion: 1
  evidenceDigest: string
  /** Compatibility alias. It always has the same value as evidenceDigest. */
  digest: string
  cues: Array<{ id: string; text: string; start: number; end: number }>
  ocrEvidence: Array<{
    id: string
    text: string
    start: number
    end: number
    confidence: number
    region?: { x: number; y: number; width: number; height: number }
  }>
  items: EvidenceItem[]
  audioMeta?: AudioMetadata
  glossary?: Array<{ source: string; target: string }>
}

export interface SourceEdit {
  id: string
  text: string
  kind: 'homophone' | 'ocr_alignment' | 'entity' | 'semantic'
  evidenceRefs: string[]
}

export interface RestorationDraftResult {
  schemaVersion: 'restoration-translation-v1'
  evidenceDigest?: string
  sourceEdits: SourceEdit[]
  sentenceEndIds: string[]
  entities: Array<{
    source: string
    target: string
    sourceCueIds: string[]
    evidenceRefs: string[]
  }>
  synopsis?: string
  items: Array<{ id: string; target: string }>
}

export interface RestorationFinding {
  code: string
  severity: 'error' | 'warning'
  cueIds: string[]
  evidenceRefs: string[]
  note: string
  resolution: 'patched' | 'unresolved'
}

export interface RestorationReplacementGroup {
  groupId: string
  sourceEdits: SourceEdit[]
  items: Array<{ id: string; target: string }>
  sentenceEndIds?: string[]
}

export interface GroupAssessment {
  groupId: string
  cueIds: string[]
  status: 'approved' | 'needs_adjustment' | 'rejected'
  reason: string
}

export interface RestorationReviewResult {
  schemaVersion: 'restoration-review-v1'
  candidateDigest: string
  reviewedCueIds: string[]
  status: 'approved' | 'needs_adjustment' | 'rejected'
  confidenceScore: number
  reviewerNotes: string
  groupAssessments: GroupAssessment[]
  findings: RestorationFinding[]
  replacements: RestorationReplacementGroup[]
}

/** A quality field is null until a caller supplied independently known truth. */
export interface RestorationQualityReport {
  totalCues: number
  knownErrorsEvaluated: number | null
  fixedAsrErrors: number | null
  corruptedCleanCues: number | null
  droppedCues: number
  cueIdIntegrity: boolean
  timestampsIntegrity: boolean
  accuracyRate: number | null
  sourceEditsCount?: number
  appliedReplacementsCount?: number
  findingsCount?: number
  cueCountPreserved?: boolean
}

export type RestorationQualityMetrics = RestorationQualityReport

const SHA256_RE = /^[a-f0-9]{64}$/iu
const EDIT_KINDS = new Set<SourceEdit['kind']>(['homophone', 'ocr_alignment', 'entity', 'semantic'])
const REVIEW_STATUSES = new Set<GroupAssessment['status']>(['approved', 'needs_adjustment', 'rejected'])

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
  const actual = Object.keys(value)
  if (required.some((key) => !(key in value)) || actual.some((key) => !allowed.includes(key))) {
    throw new Error('Restoration payload có trường không đúng schema.')
  }
}

function parseObject(raw: unknown, label: string): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      const parsed = parseAiJsonObject(raw.trim(), {
        allowFence: false,
        allowProseObject: false,
        limits: { maxBytes: 2 * 1024 * 1024, maxDepth: 16, maxMembers: 4_000, maxCandidates: 1 }
      }).value
      if (!isPlainObject(parsed)) throw new Error('not-object')
      return parsed
    } catch {
      throw new Error(`${label} phải là JSON object hợp lệ, không có Markdown hay prose.`)
    }
  }
  if (!isPlainObject(raw)) throw new Error(`${label} phải là JSON object hợp lệ.`)
  return raw
}

function normalizedCues(cues: readonly SubtitleCue[]): Array<{ id: string; text: string; start: number; end: number }> {
  const ids = new Set<string>()
  return cues.map((cue, index) => {
    const id = String(cue.id || '').trim()
    const text = String(cue.text || '').trim()
    if (!id || ids.has(id) || !text || !finiteNumber(cue.start) || !finiteNumber(cue.end) || cue.end < cue.start) {
      throw new Error(`Cue nguồn thứ ${index + 1} không hợp lệ cho restoration.`)
    }
    ids.add(id)
    return { id, text, start: cue.start, end: cue.end }
  })
}

function matchingCueIds(cues: readonly { id: string; start: number; end: number }[], start: number, end: number): string[] {
  return cues
    .filter((cue) => Math.max(cue.start, start) <= Math.min(cue.end, end))
    .map((cue) => cue.id)
}

function normalizeRegion(value: unknown): EvidenceItem['region'] | undefined {
  if (!isPlainObject(value) || !finiteNumber(value.x) || !finiteNumber(value.y) || !finiteNumber(value.width) || !finiteNumber(value.height) ||
      value.width <= 0 || value.height <= 0) return undefined
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

/** Build a compact, deterministic evidence ledger. It deliberately excludes audio bytes. */
export function buildSourceEvidencePack(
  param1: readonly SubtitleCue[] | {
    audioMeta?: AudioMetadata
    ocrFrames?: readonly OcrVisualFrame[]
    cues?: readonly SubtitleCue[]
    glossary?: readonly { source: string; target: string }[]
  },
  legacyOcrCues: readonly SubtitleCue[] | null = null,
  legacyGlossary?: readonly { source: string; target: string }[]
): SourceEvidencePack {
  const options: {
    audioMeta?: AudioMetadata
    ocrFrames?: readonly OcrVisualFrame[]
    cues?: readonly SubtitleCue[]
    glossary?: readonly { source: string; target: string }[]
  } = Array.isArray(param1)
    ? { cues: param1 as readonly SubtitleCue[], glossary: legacyGlossary }
    : param1 as {
      audioMeta?: AudioMetadata
      ocrFrames?: readonly OcrVisualFrame[]
      cues?: readonly SubtitleCue[]
      glossary?: readonly { source: string; target: string }[]
    }
  const cues = normalizedCues(options.cues || [])
  const items: EvidenceItem[] = []
  const ocrEvidence: SourceEvidencePack['ocrEvidence'] = []

  if (options.audioMeta) {
    const audio = options.audioMeta
    if (!finiteNumber(audio.durationSeconds) || audio.durationSeconds <= 0 || !Number.isSafeInteger(audio.sampleRate) || audio.sampleRate <= 0 ||
        !Number.isSafeInteger(audio.channels) || audio.channels <= 0 || !['mp3', 'wav'].includes(audio.format) || !SHA256_RE.test(audio.sha256 || '')) {
      throw new Error('Audio evidence metadata không hợp lệ.')
    }
    items.push({
      id: 'audio_0',
      type: 'audio',
      text: `audio/${audio.format};${audio.durationSeconds.toFixed(3)}s`,
      start: 0,
      end: audio.durationSeconds,
      matchingCueIds: matchingCueIds(cues, 0, audio.durationSeconds)
    })
  }

  const addOcr = (timestamp: number, end: number, line: OcrVisualFrame['lines'][number]): void => {
    const text = String(line.text || '').trim()
    if (!text || !finiteNumber(timestamp) || !finiteNumber(end) || end < timestamp) return
    const id = `ocr_${ocrEvidence.length}`
    const confidence = finiteNumber(line.confidence) ? Math.max(0, Math.min(1, line.confidence)) : 0.9
    const region = normalizeRegion(line.boundingBox)
    const cueIds = matchingCueIds(cues, timestamp, end)
    ocrEvidence.push({ id, text, start: timestamp, end, confidence, ...(region ? { region } : {}) })
    items.push({
      id,
      type: 'ocr',
      text,
      timestamp,
      start: timestamp,
      end,
      confidence,
      ...(region ? { region } : {}),
      matchingCueIds: cueIds
    })
  }

  if (Array.isArray(options.ocrFrames)) {
    for (const frame of options.ocrFrames) {
      const start = frame.timestamp
      const end = finiteNumber(frame.end) ? frame.end : start + 0.5
      for (const line of frame.lines || []) addOcr(start, end, line)
    }
  }
  if (legacyOcrCues) {
    for (const cue of legacyOcrCues) addOcr(cue.start, cue.end, { text: cue.text, confidence: 0.95 })
  }

  const glossary = (options.glossary || []).flatMap((entry, index) => {
    const source = String(entry.source || '').trim()
    const target = String(entry.target || '').trim()
    if (!source || !target) return []
    const related = cues.filter((cue) => cue.text.includes(source)).map((cue) => cue.id)
    // A glossary with no local match stays user guidance only; it cannot
    // become a permissive evidence reference for an unrelated cue.
    if (related.length > 0) {
      items.push({ id: `glossary_${index}`, type: 'glossary', text: `${source} => ${target}`, matchingCueIds: related })
    }
    return [{ source, target }]
  })

  const payload = JSON.stringify({ schemaVersion: 1, cues, ocrEvidence, audioMeta: options.audioMeta, glossary })
  const evidenceDigest = sha256(payload)
  return {
    schemaVersion: 1,
    evidenceDigest,
    digest: evidenceDigest,
    cues,
    ocrEvidence,
    items,
    ...(options.audioMeta ? { audioMeta: options.audioMeta } : {}),
    ...(glossary.length > 0 ? { glossary } : {})
  }
}

/** Keep the full frame ledger locally. Send one real observation per identical
 * text/cue mapping; never union cue IDs or invent a continuous time interval. */
export function compactRestorationEvidence(items: readonly EvidenceItem[], requiredRefs: ReadonlySet<string> = new Set()): EvidenceItem[] {
  const representatives = new Map<string, EvidenceItem>()
  for (const item of items) {
    const key = JSON.stringify([item.type, item.text, [...item.matchingCueIds].sort()])
    const previous = representatives.get(key)
    if (!previous || (item.confidence ?? 0) > (previous.confidence ?? 0)) representatives.set(key, item)
  }
  const selected = new Set([...representatives.values()].map((item) => item.id))
  return items.filter((item) => selected.has(item.id) || requiredRefs.has(item.id)).map((item) => ({
    id: item.id,
    type: item.type,
    text: item.text,
    ...(item.start !== undefined ? { start: item.start } : {}),
    ...(item.end !== undefined ? { end: item.end } : {}),
    ...(item.confidence !== undefined ? { confidence: Math.round(item.confidence * 1000) / 1000 } : {}),
    matchingCueIds: [...item.matchingCueIds]
  }))
}

export function buildRestorationDraftPayload(params: {
  evidencePack: SourceEvidencePack
  targetLang: string
  cues: readonly SubtitleCue[]
  synopsis?: string
  channelContext?: string
}): string {
  return JSON.stringify({
    schemaVersion: 'restoration-draft-input-v1',
    targetLang: params.targetLang,
    evidenceDigest: params.evidencePack.evidenceDigest,
    cues: normalizedCues(params.cues),
    evidenceItems: compactRestorationEvidence(params.evidencePack.items),
    ...(params.synopsis?.trim() ? { synopsis: params.synopsis.trim() } : {}),
    ...(params.channelContext?.trim() ? { channelContext: params.channelContext.trim() } : {})
  })
}

function expectedIds(expected: Set<string> | readonly SubtitleCue[] | SourceEvidencePack): string[] {
  if (expected instanceof Set) return [...expected].map((id) => id.trim())
  if ('schemaVersion' in expected && expected.schemaVersion === 1 && Array.isArray(expected.cues)) return expected.cues.map((cue) => cue.id.trim())
  return normalizedCues(expected as readonly SubtitleCue[]).map((cue) => cue.id)
}

function getEvidencePack(value: Set<string> | SourceEvidencePack | undefined): SourceEvidencePack | undefined {
  return value && !(value instanceof Set) && value.schemaVersion === 1 ? value : undefined
}

function validateEvidenceReferences(refs: unknown, cueId: string, evidence: Map<string, EvidenceItem>, label: string): string[] {
  if (!Array.isArray(refs) || refs.length === 0 || refs.some((ref) => !nonEmptyString(ref))) {
    throw new Error(`${label} phải tham chiếu ít nhất một evidence hợp lệ.`)
  }
  const normalized = refs.map((ref) => (ref as string).trim())
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} có evidence ref trùng.`)
  for (const ref of normalized) {
    const item = evidence.get(ref)
    if (!item) throw new Error(`${label} tham chiếu evidence không tồn tại: ${ref}.`)
    if (!item.matchingCueIds.includes(cueId)) throw new Error(`${label} tham chiếu evidence không liên quan local tới cue ${cueId}.`)
  }
  return normalized
}

function validateEntityEvidenceReferences(refs: unknown, cueIds: readonly string[], evidence: Map<string, EvidenceItem>, label: string): string[] {
  if (!Array.isArray(refs) || refs.length === 0 || refs.some((ref) => !nonEmptyString(ref))) {
    throw new Error(`${label} phải tham chiếu ít nhất một evidence hợp lệ.`)
  }
  const normalized = refs.map((ref) => (ref as string).trim())
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} có evidence ref trùng.`)
  const covered = new Set<string>()
  for (const ref of normalized) {
    const item = evidence.get(ref)
    if (!item) throw new Error(`${label} tham chiếu evidence không tồn tại: ${ref}.`)
    const localCueIds = cueIds.filter((cueId) => item.matchingCueIds.includes(cueId))
    if (localCueIds.length === 0) throw new Error(`${label} tham chiếu evidence không liên quan local tới entity.`)
    for (const cueId of localCueIds) covered.add(cueId)
  }
  if (cueIds.some((cueId) => !covered.has(cueId))) throw new Error(`${label} chưa có evidence local cho toàn bộ cue của entity.`)
  return normalized
}

/**
 * Gemini Gateway previously returned this exact compact form despite the
 * restoration contract naming the cue field `id` and requiring `kind`.
 * Accept only that observed shape, then restore the missing classification as
 * the conservative generic kind. Any extra field or other alias still reaches
 * the strict schema validator below and is rejected.
 */
function normalizeObservedGatewaySourceEdit(value: unknown): unknown {
  if (!isPlainObject(value)) return value
  const legacyKeys = ['cueId', 'text', 'evidenceRefs']
  const keys = Object.keys(value)
  if (keys.length !== legacyKeys.length || legacyKeys.some((key) => !(key in value))) return value
  return {
    id: value.cueId,
    text: value.text,
    kind: 'semantic' as const,
    evidenceRefs: value.evidenceRefs
  }
}

function validateSourceEdit(value: unknown, ids: Set<string>, evidence: Map<string, EvidenceItem>, label: string, allowedIds = ids): SourceEdit {
  const normalizedValue = normalizeObservedGatewaySourceEdit(value)
  if (!isPlainObject(normalizedValue)) throw new Error(`${label} không hợp lệ.`)
  exactKeys(normalizedValue, ['id', 'text', 'kind', 'evidenceRefs'])
  const id = typeof normalizedValue.id === 'string' ? normalizedValue.id.trim() : ''
  const text = typeof normalizedValue.text === 'string' ? normalizedValue.text.trim() : ''
  const kind = normalizedValue.kind as SourceEdit['kind']
  if (!id || !allowedIds.has(id) || !ids.has(id) || !text || !EDIT_KINDS.has(kind)) throw new Error(`${label} có cue ID, text hoặc kind không hợp lệ.`)
  return { id, text, kind, evidenceRefs: validateEvidenceReferences(normalizedValue.evidenceRefs, id, evidence, label) }
}

function validateItems(value: unknown, ids: readonly string[], label: string): Array<{ id: string; target: string }> {
  if (!Array.isArray(value) || value.length !== ids.length) throw new Error(`${label} không khớp với số cue nguồn.`)
  const expected = new Set(ids)
  const seen = new Set<string>()
  const result = value.map((raw, index) => {
    if (!isPlainObject(raw)) throw new Error(`${label} item thứ ${index + 1} không hợp lệ.`)
    exactKeys(raw, ['id', 'target'])
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const target = typeof raw.target === 'string' ? raw.target.trim() : ''
    if (!id || !expected.has(id) || seen.has(id)) throw new Error(`${label} có cue ID không thuộc nguồn hoặc bị trùng.`)
    if (!target) throw new Error(`${label} có target text rỗng.`)
    seen.add(id)
    return { id, target }
  })
  if (seen.size !== expected.size) throw new Error(`${label} thiếu cue ID.`)
  return result
}

export function validateRestorationDraft(
  raw: unknown,
  expectedIdsOrCues: Set<string> | readonly SubtitleCue[],
  validEvidenceIdsOrPack?: Set<string> | SourceEvidencePack
): RestorationDraftResult {
  const obj = parseObject(raw, 'Restoration draft')
  exactKeys(obj, ['schemaVersion', 'evidenceDigest', 'sourceEdits', 'sentenceEndIds', 'entities', 'synopsis', 'items'], ['schemaVersion', 'evidenceDigest', 'sourceEdits', 'sentenceEndIds', 'entities', 'items'])
  if (obj.schemaVersion !== 'restoration-translation-v1') throw new Error('Restoration draft có schemaVersion không hợp lệ.')
  const ids = expectedIds(expectedIdsOrCues)
  if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Error('Tập cue nguồn không hợp lệ.')
  const pack = getEvidencePack(validEvidenceIdsOrPack)
  if (pack && obj.evidenceDigest !== pack.evidenceDigest) throw new Error('Restoration draft có evidence digest không khớp.')
  if (!pack && !nonEmptyString(obj.evidenceDigest)) throw new Error('Restoration draft thiếu evidence digest.')
  const evidence = new Map<string, EvidenceItem>()
  if (pack) for (const item of pack.items) evidence.set(item.id, item)
  else if (validEvidenceIdsOrPack instanceof Set) for (const id of validEvidenceIdsOrPack) evidence.set(id, { id, type: 'audio', text: 'legacy', matchingCueIds: ids })
  const idSet = new Set(ids)
  if (!Array.isArray(obj.sourceEdits)) throw new Error('Restoration draft thiếu sourceEdits.')
  const edited = new Set<string>()
  const sourceEdits: SourceEdit[] = []
  for (let index = 0; index < obj.sourceEdits.length; index++) {
    try {
      const normalized = validateSourceEdit(obj.sourceEdits[index], idSet, evidence, `Source edit ${index + 1}`)
      if (edited.has(normalized.id)) throw new Error(`Source edit bị trùng cue ID ${normalized.id}.`)
      edited.add(normalized.id)
      sourceEdits.push(normalized)
    } catch (error) {
      console.warn(`[AutoShort] Bỏ qua source edit không hợp lệ: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!Array.isArray(obj.sentenceEndIds) || obj.sentenceEndIds.some((id) => !nonEmptyString(id))) throw new Error('Restoration draft có sentenceEndIds không hợp lệ.')
  const sentenceEndIds = obj.sentenceEndIds.map((id) => (id as string).trim())
  if (new Set(sentenceEndIds).size !== sentenceEndIds.length || sentenceEndIds.some((id) => !idSet.has(id))) throw new Error('Restoration draft có sentenceEndIds không thuộc cue nguồn hoặc bị trùng.')
  if (!Array.isArray(obj.entities)) throw new Error('Restoration draft thiếu entities.')
  const entities = obj.entities.map((entity, index) => {
    if (!isPlainObject(entity)) throw new Error(`Entity ${index + 1} không hợp lệ.`)
    exactKeys(entity, ['source', 'target', 'sourceCueIds', 'evidenceRefs'])
    const source = typeof entity.source === 'string' ? entity.source.trim() : ''
    const target = typeof entity.target === 'string' ? entity.target.trim() : ''
    if (!source || !target || !Array.isArray(entity.sourceCueIds) || entity.sourceCueIds.length === 0 || entity.sourceCueIds.some((id) => !nonEmptyString(id))) throw new Error(`Entity ${index + 1} không hợp lệ.`)
    const sourceCueIds = entity.sourceCueIds.map((id) => (id as string).trim())
    if (new Set(sourceCueIds).size !== sourceCueIds.length || sourceCueIds.some((id) => !idSet.has(id))) throw new Error(`Entity ${index + 1} có cue ID không hợp lệ.`)
    const refs = Array.isArray(entity.evidenceRefs) && entity.evidenceRefs.length > 0
      ? validateEntityEvidenceReferences(entity.evidenceRefs, sourceCueIds, evidence, `Entity ${index + 1}`)
      : []
    return { source, target, sourceCueIds, evidenceRefs: refs }
  })
  return {
    schemaVersion: 'restoration-translation-v1',
    evidenceDigest: obj.evidenceDigest as string,
    sourceEdits,
    sentenceEndIds,
    entities,
    ...(typeof obj.synopsis === 'string' ? { synopsis: obj.synopsis.trim() } : {}),
    items: validateItems(obj.items, ids, 'Restoration draft')
  }
}

/** Candidate identity includes the exact source-edit and translated-item ledger. */
export function calculateRestorationCandidateDigest(draft: RestorationDraftResult): string {
  return sha256(JSON.stringify({
    schemaVersion: draft.schemaVersion,
    evidenceDigest: draft.evidenceDigest || '',
    sourceEdits: draft.sourceEdits.map((edit) => ({ ...edit, evidenceRefs: [...edit.evidenceRefs] })),
    sentenceEndIds: [...draft.sentenceEndIds],
    entities: draft.entities.map((entity) => ({ ...entity, sourceCueIds: [...entity.sourceCueIds], evidenceRefs: [...entity.evidenceRefs] })),
    items: draft.items.map((item) => ({ id: item.id, target: item.target }))
  }))
}

export function buildRestorationReviewPayload(params: {
  evidencePack: SourceEvidencePack
  targetLang: string
  draft: RestorationDraftResult
  synopsis?: string
}): string {
  return JSON.stringify({
    schemaVersion: 'restoration-review-input-v1',
    evidenceDigest: params.evidencePack.evidenceDigest,
    candidateDigest: calculateRestorationCandidateDigest(params.draft),
    targetLang: params.targetLang,
    draft: params.draft,
    evidenceItems: compactRestorationEvidence(params.evidencePack.items, new Set([
      ...params.draft.sourceEdits.flatMap((edit) => edit.evidenceRefs),
      ...params.draft.entities.flatMap((entity) => entity.evidenceRefs)
    ])),
    ...(params.synopsis?.trim() ? { synopsis: params.synopsis.trim() } : {})
  })
}

function expectedReviewIds(expectedDigestOrDraft: string | RestorationDraftResult, expectedIdsOrPack?: Set<string> | SourceEvidencePack): string[] {
  if (expectedIdsOrPack instanceof Set) return [...expectedIdsOrPack].map((id) => id.trim())
  if (expectedIdsOrPack) return expectedIds(expectedIdsOrPack)
  if (typeof expectedDigestOrDraft !== 'string') return expectedDigestOrDraft.items.map((item) => item.id.trim())
  throw new Error('Restoration review thiếu tập cue kỳ vọng.')
}

export function validateRestorationReview(
  raw: unknown,
  expectedDigestOrDraft: string | RestorationDraftResult,
  expectedIdsOrPack?: Set<string> | SourceEvidencePack
): RestorationReviewResult {
  const obj = parseObject(raw, 'Restoration review')
  exactKeys(obj, ['schemaVersion', 'candidateDigest', 'reviewedCueIds', 'status', 'confidenceScore', 'reviewerNotes', 'groupAssessments', 'findings', 'replacements'])
  if (obj.schemaVersion !== 'restoration-review-v1') throw new Error('Restoration review có schemaVersion không hợp lệ.')
  const candidateDigest = typeof expectedDigestOrDraft === 'string' ? expectedDigestOrDraft : calculateRestorationCandidateDigest(expectedDigestOrDraft)
  if (obj.candidateDigest !== candidateDigest) throw new Error('Restoration review có candidate digest không khớp hoặc stale.')
  const ids = expectedReviewIds(expectedDigestOrDraft, expectedIdsOrPack)
  const idSet = new Set(ids)
  if (!Array.isArray(obj.reviewedCueIds) || obj.reviewedCueIds.some((id) => !nonEmptyString(id))) throw new Error('Restoration review có reviewedCueIds không hợp lệ.')
  const reviewedCueIds = obj.reviewedCueIds.map((id) => (id as string).trim())
  if (reviewedCueIds.length !== ids.length || new Set(reviewedCueIds).size !== ids.length || reviewedCueIds.some((id) => !idSet.has(id))) throw new Error('Restoration review không bao phủ chính xác tập cue cần review.')
  const status = obj.status as RestorationReviewResult['status']
  if (!REVIEW_STATUSES.has(status) || !finiteNumber(obj.confidenceScore) || obj.confidenceScore < 0 || obj.confidenceScore > 1 || !nonEmptyString(obj.reviewerNotes)) throw new Error('Restoration review thiếu status, confidence hoặc reviewer notes hợp lệ.')
  if (!Array.isArray(obj.groupAssessments) || obj.groupAssessments.length === 0) throw new Error('Restoration review thiếu group assessments.')
  const groupIds = new Set<string>()
  const assigned = new Set<string>()
  const groupById = new Map<string, GroupAssessment>()
  const groupAssessments = obj.groupAssessments.map((assessment, index) => {
    if (!isPlainObject(assessment)) throw new Error(`Group assessment ${index + 1} không hợp lệ.`)
    exactKeys(assessment, ['groupId', 'cueIds', 'status', 'reason'])
    const groupId = typeof assessment.groupId === 'string' ? assessment.groupId.trim() : ''
    const cueIds = Array.isArray(assessment.cueIds) ? assessment.cueIds.map((id) => String(id).trim()) : []
    const groupStatus = assessment.status as GroupAssessment['status']
    const reason = typeof assessment.reason === 'string' ? assessment.reason.trim() : ''
    if (!groupId || groupIds.has(groupId) || cueIds.length === 0 || new Set(cueIds).size !== cueIds.length || cueIds.some((id) => !idSet.has(id) || assigned.has(id)) || !REVIEW_STATUSES.has(groupStatus) || !reason) throw new Error(`Group assessment ${index + 1} không bao phủ cue hợp lệ.`)
    groupIds.add(groupId)
    for (const id of cueIds) assigned.add(id)
    const normalized = { groupId, cueIds, status: groupStatus, reason }
    groupById.set(groupId, normalized)
    return normalized
  })
  if (assigned.size !== ids.length) throw new Error('Group assessments không bao phủ toàn bộ cue.')
  const evidence = new Map<string, EvidenceItem>()
  const pack = getEvidencePack(expectedIdsOrPack)
  if (pack) for (const item of pack.items) evidence.set(item.id, item)
  if (!Array.isArray(obj.findings)) throw new Error('Restoration review thiếu findings.')
  const findings = obj.findings.map((finding, index) => {
    if (!isPlainObject(finding)) throw new Error(`Finding ${index + 1} không hợp lệ.`)
    exactKeys(finding, ['code', 'severity', 'cueIds', 'evidenceRefs', 'note', 'resolution'])
    const cueIds = Array.isArray(finding.cueIds) ? finding.cueIds.map((id) => String(id).trim()) : []
    if (!nonEmptyString(finding.code) || (finding.severity !== 'error' && finding.severity !== 'warning') || cueIds.some((id) => !idSet.has(id)) || !nonEmptyString(finding.note) || (finding.resolution !== 'patched' && finding.resolution !== 'unresolved')) throw new Error(`Finding ${index + 1} không hợp lệ.`)
    const refs = Array.isArray(finding.evidenceRefs) ? finding.evidenceRefs.map((ref) => String(ref).trim()) : []
    if (refs.some((ref) => !evidence.has(ref))) throw new Error(`Finding ${index + 1} tham chiếu evidence không tồn tại.`)
    return { code: finding.code.trim(), severity: finding.severity as RestorationFinding['severity'], cueIds, evidenceRefs: refs, note: finding.note.trim(), resolution: finding.resolution as RestorationFinding['resolution'] }
  })
  if (!Array.isArray(obj.replacements)) throw new Error('Restoration review thiếu replacements.')
  const replacementGroups = new Set<string>()
  const replacements = obj.replacements.map((replacement, index) => {
    if (!isPlainObject(replacement)) throw new Error(`Replacement ${index + 1} không hợp lệ.`)
    exactKeys(replacement, ['groupId', 'sourceEdits', 'items', 'sentenceEndIds'], ['groupId', 'sourceEdits', 'items'])
    const groupId = typeof replacement.groupId === 'string' ? replacement.groupId.trim() : ''
    const group = groupById.get(groupId)
    if (!group || replacementGroups.has(groupId) || group.status !== 'needs_adjustment') throw new Error(`Replacement ${index + 1} không thuộc nhóm needs_adjustment hợp lệ.`)
    const groupSet = new Set(group.cueIds)
    const items = validateItems(replacement.items, group.cueIds, `Replacement ${index + 1}`)
    const sourceEdits: SourceEdit[] = []
    if (Array.isArray(replacement.sourceEdits)) {
      for (let editIndex = 0; editIndex < replacement.sourceEdits.length; editIndex++) {
        try {
          const normalized = validateSourceEdit(replacement.sourceEdits[editIndex], idSet, evidence, `Replacement ${index + 1} source edit ${editIndex + 1}`, groupSet)
          sourceEdits.push(normalized)
        } catch (error) {
          console.warn(`[AutoShort] Bỏ qua source edit không hợp lệ trong review: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (new Set(sourceEdits.map((edit) => edit.id)).size !== sourceEdits.length) throw new Error(`Replacement ${index + 1} có source edit trùng.`)
    } else {
      throw new Error(`Replacement ${index + 1} thiếu sourceEdits.`)
    }
    const sentenceEndIds = replacement.sentenceEndIds === undefined ? undefined : (() => {
      if (!Array.isArray(replacement.sentenceEndIds) || replacement.sentenceEndIds.some((id) => !nonEmptyString(id))) throw new Error(`Replacement ${index + 1} có sentenceEndIds không hợp lệ.`)
      const normalized = replacement.sentenceEndIds.map((id) => (id as string).trim())
      if (new Set(normalized).size !== normalized.length || normalized.some((id) => !groupSet.has(id))) throw new Error(`Replacement ${index + 1} có sentenceEndIds ngoài nhóm.`)
      return normalized
    })()
    replacementGroups.add(groupId)
    return { groupId, sourceEdits, items, ...(sentenceEndIds ? { sentenceEndIds } : {}) }
  })
  const groupStatuses = new Set(groupAssessments.map((item) => item.status))
  if ((groupStatuses.has('rejected') && status !== 'rejected') || (!groupStatuses.has('rejected') && groupStatuses.has('needs_adjustment') && status !== 'needs_adjustment') || (!groupStatuses.has('rejected') && !groupStatuses.has('needs_adjustment') && status !== 'approved')) throw new Error('Restoration review có status tổng không khớp group assessments.')
  if (groupAssessments.filter((group) => group.status === 'needs_adjustment').some((group) => !replacementGroups.has(group.groupId))) throw new Error('Restoration review needs_adjustment thiếu replacement nguyên nhóm.')
  if (groupStatuses.has('rejected') && replacements.length > 0) throw new Error('Restoration review rejected không được xuất replacement.')
  return {
    schemaVersion: 'restoration-review-v1',
    candidateDigest,
    reviewedCueIds,
    status,
    confidenceScore: obj.confidenceScore as number,
    reviewerNotes: (obj.reviewerNotes as string).trim(),
    groupAssessments,
    findings,
    replacements
  }
}

export function applyRestorationPipeline(params: { cues: readonly SubtitleCue[]; draft: RestorationDraftResult; review: RestorationReviewResult }): {
  restoredCues: SubtitleCue[]
  restoredSourceCues: SubtitleCue[]
  translatedItems: Array<{ id: string; target: string; isSentenceEnd: boolean }>
  finalTranslationItems: Array<{ id: string; text: string }>
  appliedEdits: SourceEdit[]
  groupPatchesApplied: number
  metrics: RestorationQualityMetrics
} {
  const source = normalizedCues(params.cues)
  const ids = source.map((cue) => cue.id)
  const idSet = new Set(ids)
  if (params.draft.items.length !== ids.length || new Set(params.draft.items.map((item) => item.id)).size !== ids.length || params.draft.items.some((item) => !idSet.has(item.id) || !item.target.trim())) throw new Error('Draft không có tập target 1:1 hợp lệ để xuất bản.')
  if (params.review.status === 'rejected' || params.review.groupAssessments.some((group) => group.status === 'rejected')) throw new Error('Restoration review rejected; không xuất bản source edit hay target translation của nhóm bị từ chối.')
  const groupOwners = new Map<string, GroupAssessment>()
  for (const group of params.review.groupAssessments) {
    if (!group.groupId || group.cueIds.length === 0 || !REVIEW_STATUSES.has(group.status)) throw new Error('Review group không hợp lệ.')
    for (const id of group.cueIds) {
      if (!idSet.has(id) || groupOwners.has(id)) throw new Error('Review group không bao phủ cue 1:1.')
      groupOwners.set(id, group)
    }
  }
  if (groupOwners.size !== ids.length) throw new Error('Review group không bao phủ toàn bộ cue.')
  const replacementByGroup = new Map(params.review.replacements.map((replacement) => [replacement.groupId, replacement]))
  const sourceMap = new Map(params.cues.map((cue) => [cue.id.trim(), { ...cue }]))
  const draftItems = new Map(params.draft.items.map((item) => [item.id, item.target]))
  const draftEdits = new Map(params.draft.sourceEdits.map((edit) => [edit.id, edit]))
  const translated = new Map<string, string>()
  const appliedEdits: SourceEdit[] = []
  let groupPatchesApplied = 0
  let sentenceEnds = new Set(params.draft.sentenceEndIds)
  for (const group of params.review.groupAssessments) {
    if (group.status === 'approved') {
      for (const id of group.cueIds) {
        const target = draftItems.get(id)
        if (!target) throw new Error(`Draft thiếu target cho ${id}.`)
        translated.set(id, target)
        const edit = draftEdits.get(id)
        if (edit) {
          sourceMap.get(id)!.text = edit.text
          appliedEdits.push(edit)
        }
      }
      continue
    }
    const replacement = replacementByGroup.get(group.groupId)
    if (!replacement) throw new Error(`Nhóm ${group.groupId} cần adjustment nhưng không có replacement nguyên khối.`)
    const replacementIds = replacement.items.map((item) => item.id)
    if (replacementIds.length !== group.cueIds.length || new Set(replacementIds).size !== replacementIds.length || replacementIds.some((id) => !group.cueIds.includes(id)) || replacement.items.some((item) => !item.target.trim())) throw new Error(`Replacement nhóm ${group.groupId} không đầy đủ; không áp dụng patch một phần.`)
    for (const item of replacement.items) translated.set(item.id, item.target)
    for (const edit of replacement.sourceEdits) {
      if (!group.cueIds.includes(edit.id) || !edit.text.trim()) throw new Error(`Replacement nhóm ${group.groupId} chứa source edit ngoài nhóm.`)
      sourceMap.get(edit.id)!.text = edit.text
      appliedEdits.push(edit)
    }
    if (replacement.sentenceEndIds) {
      for (const id of group.cueIds) sentenceEnds.delete(id)
      for (const id of replacement.sentenceEndIds) sentenceEnds.add(id)
    }
    groupPatchesApplied++
  }
  if (translated.size !== ids.length || ids.some((id) => !translated.get(id)?.trim())) throw new Error('Restoration không tạo đủ target translation; không copy source làm fallback.')
  const restoredCues = params.cues.map((cue) => sourceMap.get(cue.id.trim())!)
  const translatedItems = ids.map((id) => ({ id, target: translated.get(id)!, isSentenceEnd: sentenceEnds.has(id) }))
  const finalTranslationItems = translatedItems.map((item) => ({ id: item.id, text: item.target }))
  return {
    restoredCues,
    restoredSourceCues: restoredCues,
    translatedItems,
    finalTranslationItems,
    appliedEdits,
    groupPatchesApplied,
    metrics: {
      totalCues: source.length,
      knownErrorsEvaluated: null,
      fixedAsrErrors: null,
      corruptedCleanCues: null,
      droppedCues: 0,
      cueIdIntegrity: restoredCues.every((cue, index) => cue.id === params.cues[index].id),
      timestampsIntegrity: restoredCues.every((cue, index) => cue.start === params.cues[index].start && cue.end === params.cues[index].end),
      accuracyRate: null,
      sourceEditsCount: appliedEdits.length,
      appliedReplacementsCount: groupPatchesApplied,
      findingsCount: params.review.findings.length,
      cueCountPreserved: finalTranslationItems.length === source.length
    }
  }
}

export function measureRestorationQuality(params: {
  originalCues: readonly SubtitleCue[]
  restoredCues: readonly SubtitleCue[]
  groundTruthCleanCues: readonly SubtitleCue[]
  knownAsrErrors: Array<{ id: string; errorPattern: string; expectedFix: string }>
}): RestorationQualityReport {
  const original = normalizedCues(params.originalCues)
  const restored = normalizedCues(params.restoredCues)
  const truth = normalizedCues(params.groundTruthCleanCues)
  const knownErrors = params.knownAsrErrors
  const restoredById = new Map(restored.map((cue) => [cue.id, cue]))
  const originalById = new Map(original.map((cue) => [cue.id, cue]))
  const errorIds = new Set(knownErrors.map((item) => item.id.trim()))
  const fixedAsrErrors = knownErrors.reduce((count, error) => count + (restoredById.get(error.id.trim())?.text.includes(error.expectedFix) ? 1 : 0), 0)
  const corruptedCleanCues = truth.reduce((count, cue) => errorIds.has(cue.id) ? count : count + (originalById.get(cue.id)?.text !== restoredById.get(cue.id)?.text ? 1 : 0), 0)
  const droppedCues = Math.max(0, original.length - restored.length)
  const cueIdIntegrity = original.length === restored.length && restored.every((cue, index) => cue.id === original[index].id)
  const timestampsIntegrity = original.length === restored.length && restored.every((cue, index) => cue.start === original[index].start && cue.end === original[index].end)
  return {
    totalCues: original.length,
    knownErrorsEvaluated: knownErrors.length,
    fixedAsrErrors,
    corruptedCleanCues,
    droppedCues,
    cueIdIntegrity,
    timestampsIntegrity,
    accuracyRate: knownErrors.length > 0 ? fixedAsrErrors / knownErrors.length : null,
    sourceEditsCount: knownErrors.length,
    appliedReplacementsCount: 0,
    findingsCount: 0,
    cueCountPreserved: droppedCues === 0
  }
}
