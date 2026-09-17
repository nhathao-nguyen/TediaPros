import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { SubtitleCue } from '../shared/types'
import type { TranslationInput, TranslationItem } from '../shared/translation'
import { ackGatewayOperation } from './geminiGatewayOperations'
import {
  createGatewayRequestBody,
  GATEWAY_STAGE_TIMEOUT_MS,
  readGatewayCapabilitiesInfo,
  requestGatewayOperation,
  type GatewayServerCapabilitiesInfo
} from './geminiGateway'
import type { ModelMessage } from './translation/prompts'
import type { GatewayRestorationAudio } from './translation/restorationAudio'
import {
  applyRestorationPipeline,
  buildRestorationDraftPayload,
  buildRestorationReviewPayload,
  buildSourceEvidencePack,
  calculateRestorationCandidateDigest,
  type RestorationDraftResult,
  type RestorationQualityMetrics,
  type RestorationReviewResult,
  type OcrVisualFrame,
  type SourceEvidencePack,
  validateRestorationDraft,
  validateRestorationReview
} from './translation/sourceRestoration'

export const GATEWAY_RESTORATION_PROMPT_VERSION = 'gateway-restoration-media-v2'
export const GATEWAY_RESTORATION_PARSER_VERSION = 'gateway-restoration-parser-v1'
const RESTORATION_DRAFT_FILE = 'restoration-draft-v1.json'
const RESTORATION_REVIEW_FILE = 'restoration-review-v1.json'
const MAX_STAGE_RECORD_BYTES = 2 * 1024 * 1024
const MIN_RESTORATION_OUTPUT_TOKENS = 2_048
const MAX_RESTORATION_OUTPUT_TOKENS = 8_192
export const MAX_RESTORATION_CUES_PER_CHUNK = 8

export function calculateRestorationOutputTokenLimit(cueCount: number): number {
  const safeCount = Number.isSafeInteger(cueCount) && cueCount > 0 ? cueCount : 1
  return Math.min(MAX_RESTORATION_OUTPUT_TOKENS, Math.max(MIN_RESTORATION_OUTPUT_TOKENS, 1_024 + safeCount * 128))
}

export function partitionRestorationCues(cues: readonly SubtitleCue[]): SubtitleCue[][] {
  const chunks: SubtitleCue[][] = []
  for (let offset = 0; offset < cues.length; offset += MAX_RESTORATION_CUES_PER_CHUNK) {
    chunks.push(cues.slice(offset, offset + MAX_RESTORATION_CUES_PER_CHUNK).map((cue) => ({ ...cue })))
  }
  return chunks
}

const SOURCE_EDIT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    kind: { type: 'string', enum: ['homophone', 'ocr_alignment', 'entity', 'semantic'] },
    evidenceRefs: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true }
  },
  required: ['id', 'text', 'kind', 'evidenceRefs'],
  additionalProperties: false
} as const

const RESTORATION_DRAFT_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'restoration_translation_v1',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'string', const: 'restoration-translation-v1' },
        evidenceDigest: { type: 'string' },
        sourceEdits: { type: 'array', items: SOURCE_EDIT_SCHEMA },
        sentenceEndIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              sourceCueIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true },
              evidenceRefs: { type: 'array', items: { type: 'string' }, uniqueItems: true }
            },
            required: ['source', 'target', 'sourceCueIds', 'evidenceRefs'],
            additionalProperties: false
          }
        },
        synopsis: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, target: { type: 'string' } },
            required: ['id', 'target'],
            additionalProperties: false
          }
        }
      },
      required: ['schemaVersion', 'evidenceDigest', 'sourceEdits', 'sentenceEndIds', 'entities', 'items'],
      additionalProperties: false
    }
  }
} as const

const RESTORATION_REVIEW_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'restoration_review_v1',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        schemaVersion: { type: 'string', const: 'restoration-review-v1' },
        candidateDigest: { type: 'string' },
        reviewedCueIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        status: { type: 'string', enum: ['approved', 'needs_adjustment', 'rejected'] },
        confidenceScore: { type: 'number', minimum: 0, maximum: 1 },
        reviewerNotes: { type: 'string' },
        groupAssessments: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              groupId: { type: 'string' },
              cueIds: { type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true },
              status: { type: 'string', enum: ['approved', 'needs_adjustment', 'rejected'] },
              reason: { type: 'string' }
            },
            required: ['groupId', 'cueIds', 'status', 'reason'],
            additionalProperties: false
          }
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              severity: { type: 'string', enum: ['error', 'warning'] },
              cueIds: { type: 'array', items: { type: 'string' }, uniqueItems: true },
              evidenceRefs: { type: 'array', items: { type: 'string' }, uniqueItems: true },
              note: { type: 'string' },
              resolution: { type: 'string', enum: ['patched', 'unresolved'] }
            },
            required: ['code', 'severity', 'cueIds', 'evidenceRefs', 'note', 'resolution'],
            additionalProperties: false
          }
        },
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              groupId: { type: 'string' },
              sourceEdits: { type: 'array', items: SOURCE_EDIT_SCHEMA },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { id: { type: 'string' }, target: { type: 'string' } },
                  required: ['id', 'target'],
                  additionalProperties: false
                }
              },
              sentenceEndIds: { type: 'array', items: { type: 'string' }, uniqueItems: true }
            },
            required: ['groupId', 'sourceEdits', 'items'],
            additionalProperties: false
          }
        }
      },
      required: ['schemaVersion', 'candidateDigest', 'reviewedCueIds', 'status', 'confidenceScore', 'reviewerNotes', 'groupAssessments', 'findings', 'replacements'],
      additionalProperties: false
    }
  }
} as const

export interface GatewayRestorationIdentityInput {
  sourceCues: readonly SubtitleCue[]
  mediaDigest: string
  sourceLanguage: string
  targetLocale: string
  mode: TranslationInput['mode']
  glossary: readonly { source: string; target: string }[]
  synopsis?: string
}

export interface GatewayRestorationCheckpoint {
  schemaVersion: 1
  identity: string
  mediaDigest: string
  sourceDigest: string
  routeFingerprint: string
  evidenceDigest: string
  promptVersion: typeof GATEWAY_RESTORATION_PROMPT_VERSION
  parserVersion: typeof GATEWAY_RESTORATION_PARSER_VERSION
  rawSourceCues: SubtitleCue[]
  restoredSourceCues: SubtitleCue[]
  reviewedTranslatedCues: SubtitleCue[]
  evidence: SourceEvidencePack
  candidateDigest: string
  reviewDigest: string
  savedAtUtc: string
}

export interface GatewayRestorationResult {
  identity: string
  routeFingerprint: string
  evidence: SourceEvidencePack
  draft: RestorationDraftResult
  review: RestorationReviewResult
  restoredSourceCues: SubtitleCue[]
  translatedItems: TranslationItem[]
  metrics: RestorationQualityMetrics
  candidateDigest: string
  reviewDigest: string
}

export interface RunGatewayRestorationInput extends GatewayRestorationIdentityInput {
  baseUrl: string
  audio: GatewayRestorationAudio
  ocrFrames: readonly OcrVisualFrame[]
  signal: AbortSignal
  draftDir: string
  capabilities?: GatewayServerCapabilitiesInfo
}

interface RestorationStageRecord {
  schemaVersion: 1
  state: 'validated'
  stage: 'restoration-draft' | 'restoration-review'
  identity: string
  routeFingerprint: string
  evidenceDigest: string
  expectedIds: string[]
  targetLocale: string
  promptVersion: string
  parserVersion: string
  raw: string
  rawSha256: string
  observedModelId: string
  observedModel: string | null
  savedAtUtc: string
}

interface OperationLease {
  schemaVersion: 1
  clientRequestId: string
  operationToken: string
  payloadSha256: string
  operationId?: string
  stage: string
  startedAtUtc: string
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function cloneCues(cues: readonly SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue) => ({ ...cue }))
}

function evidenceForChunk(evidence: SourceEvidencePack, cues: readonly SubtitleCue[]): SourceEvidencePack {
  const cueIds = new Set(cues.map((cue) => cue.id.trim()))
  const normalizedCues = cues.map((cue) => ({ id: cue.id.trim(), text: cue.text.trim(), start: cue.start, end: cue.end }))
  const items = evidence.items.flatMap((item) => {
    const matchingCueIds = item.matchingCueIds.filter((id) => cueIds.has(id))
    return matchingCueIds.length > 0 ? [{ ...item, matchingCueIds }] : []
  })
  const itemIds = new Set(items.map((item) => item.id))
  const ocrEvidence = evidence.ocrEvidence.filter((item) => itemIds.has(item.id)).map((item) => ({ ...item }))
  const glossary = evidence.glossary?.map((entry) => ({ ...entry })) || []
  const digest = sha256(JSON.stringify({
    schemaVersion: 1,
    cues: normalizedCues,
    ocrEvidence,
    audioMeta: evidence.audioMeta,
    glossary
  }))
  return {
    schemaVersion: 1,
    evidenceDigest: digest,
    digest,
    cues: normalizedCues,
    ocrEvidence,
    items,
    ...(evidence.audioMeta ? { audioMeta: { ...evidence.audioMeta } } : {}),
    ...(glossary.length > 0 ? { glossary } : {})
  }
}

function validCueList(value: unknown, expected?: readonly SubtitleCue[]): value is SubtitleCue[] {
  if (!Array.isArray(value) || value.length === 0) return false
  if (expected && value.length !== expected.length) return false
  const ids = new Set<string>()
  for (let index = 0; index < value.length; index++) {
    const cue = value[index]
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)) return false
    const id = typeof cue.id === 'string' ? cue.id.trim() : ''
    if (!id || ids.has(id) || typeof cue.text !== 'string' || !cue.text.trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end < cue.start) return false
    if (expected) {
      const original = expected[index]
      if (id !== original.id.trim() || cue.start !== original.start || cue.end !== original.end) return false
    }
    ids.add(id)
  }
  return true
}

function validSha(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/iu.test(value)
}

export function calculateGatewayRestorationIdentity(input: GatewayRestorationIdentityInput): string {
  return sha256(JSON.stringify({
    mediaDigest: input.mediaDigest,
    sourceLanguage: input.sourceLanguage.trim() || 'auto',
    targetLocale: input.targetLocale.trim(),
    mode: input.mode,
    glossary: input.glossary.map((entry) => ({ source: entry.source, target: entry.target })),
    synopsis: input.synopsis?.trim() || '',
    promptVersion: GATEWAY_RESTORATION_PROMPT_VERSION,
    parserVersion: GATEWAY_RESTORATION_PARSER_VERSION,
    cues: input.sourceCues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end, text: cue.text }))
  }))
}

export function calculateGatewayRestorationSourceDigest(cues: readonly SubtitleCue[]): string {
  return sha256(JSON.stringify(cues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end, text: cue.text }))))
}

export function readReusableGatewayRestorationCheckpoint(
  value: unknown,
  expected: GatewayRestorationIdentityInput & { routeFingerprint: string }
): GatewayRestorationCheckpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const checkpoint = value as Partial<GatewayRestorationCheckpoint>
  const identity = calculateGatewayRestorationIdentity(expected)
  if (checkpoint.schemaVersion !== 1 || checkpoint.identity !== identity || checkpoint.mediaDigest !== expected.mediaDigest ||
      checkpoint.sourceDigest !== calculateGatewayRestorationSourceDigest(expected.sourceCues) ||
      checkpoint.routeFingerprint !== expected.routeFingerprint || checkpoint.promptVersion !== GATEWAY_RESTORATION_PROMPT_VERSION ||
      checkpoint.parserVersion !== GATEWAY_RESTORATION_PARSER_VERSION || !validSha(checkpoint.evidenceDigest) ||
      !validSha(checkpoint.candidateDigest) || !validSha(checkpoint.reviewDigest) ||
      typeof checkpoint.savedAtUtc !== 'string' || !Number.isFinite(Date.parse(checkpoint.savedAtUtc)) ||
      !validCueList(checkpoint.rawSourceCues, expected.sourceCues) || !validCueList(checkpoint.restoredSourceCues, expected.sourceCues) ||
      !validCueList(checkpoint.reviewedTranslatedCues, expected.sourceCues) ||
      !checkpoint.evidence || checkpoint.evidence.schemaVersion !== 1 || checkpoint.evidence.evidenceDigest !== checkpoint.evidenceDigest ||
      checkpoint.evidence.digest !== checkpoint.evidenceDigest || !Array.isArray(checkpoint.evidence.items)) return null
  return checkpoint as GatewayRestorationCheckpoint
}

export function buildGatewayRestorationCheckpoint(
  result: GatewayRestorationResult,
  rawSourceCues: readonly SubtitleCue[],
  mediaDigest: string
): GatewayRestorationCheckpoint {
  const reviewedTranslatedCues = rawSourceCues.map((cue) => {
    const item = result.translatedItems.find((candidate) => candidate.id === cue.id)
    if (!item || !item.text.trim()) throw new Error(`Restoration không có target cue ${cue.id} để checkpoint.`)
    return { ...cue, text: item.text }
  })
  return {
    schemaVersion: 1,
    identity: result.identity,
    mediaDigest,
    sourceDigest: calculateGatewayRestorationSourceDigest(rawSourceCues),
    routeFingerprint: result.routeFingerprint,
    evidenceDigest: result.evidence.evidenceDigest,
    promptVersion: GATEWAY_RESTORATION_PROMPT_VERSION,
    parserVersion: GATEWAY_RESTORATION_PARSER_VERSION,
    rawSourceCues: cloneCues(rawSourceCues),
    restoredSourceCues: cloneCues(result.restoredSourceCues),
    reviewedTranslatedCues,
    evidence: result.evidence,
    candidateDigest: result.candidateDigest,
    reviewDigest: result.reviewDigest,
    savedAtUtc: new Date().toISOString()
  }
}

function draftMessages(input: RunGatewayRestorationInput, evidence: SourceEvidencePack): ModelMessage[] {
  const ids = input.sourceCues.map((cue) => cue.id)
  const payload = buildRestorationDraftPayload({
    evidencePack: evidence,
    targetLang: input.targetLocale,
    cues: input.sourceCues,
    synopsis: input.synopsis
  })
  const system = [
    `gateway_restoration_prompt_version=${GATEWAY_RESTORATION_PROMPT_VERSION}`,
    `task=audio-ocr-grounded-restoration-and-translation; source_language=${input.sourceLanguage || 'auto'}; target_locale=${input.targetLocale}; mode=${input.mode}`,
    'Return exactly one JSON object and no Markdown or prose.',
    'The local cue IDs and timestamps are immutable. Return each requested ID exactly once; never add, delete, merge, or reorder IDs.',
    'Correct a source cue only when at least one local OCR/audio/glossary evidence reference supports that cue. Every source edit needs non-empty evidenceRefs; do not guess brands, numbers, names, units, negation, places, or facts.',
    'Produce schemaVersion=restoration-translation-v1 with exact evidenceDigest, sourceEdits, sentenceEndIds, entities, and items. Every sourceEdits entry has exactly {id,text,kind,evidenceRefs}: use id (never cueId), kind is homophone|ocr_alignment|entity|semantic, and evidenceRefs is non-empty. Every item has exactly {id,target}, and target must be non-empty target-language text.',
    `Requested cue IDs: ${JSON.stringify(ids)}`
  ].join('\n')
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: payload },
        { type: 'input_audio', input_audio: { data: input.audio.data.toString('base64'), format: input.audio.format } }
      ]
    }
  ]
}

function reviewMessages(input: RunGatewayRestorationInput, evidence: SourceEvidencePack, draft: RestorationDraftResult): ModelMessage[] {
  const ids = input.sourceCues.map((cue) => cue.id)
  const payload = buildRestorationReviewPayload({ evidencePack: evidence, targetLang: input.targetLocale, draft, synopsis: input.synopsis })
  const system = [
    `gateway_restoration_prompt_version=${GATEWAY_RESTORATION_PROMPT_VERSION}`,
    `task=independent-audio-ocr-restoration-review; target_locale=${input.targetLocale}`,
    'You are a fresh reviewer. Return exactly one JSON object and no Markdown or prose.',
    'Verify the candidate against the attached source audio and timestamped OCR/glossary evidence. Do not approve an unsupported source edit.',
    'Produce schemaVersion=restoration-review-v1 with exact candidateDigest, exact reviewedCueIds, explicit status, confidenceScore 0..1, reviewerNotes, groupAssessments, findings and replacements. Every replacement sourceEdits entry has exactly {id,text,kind,evidenceRefs}: use id (never cueId), kind is homophone|ocr_alignment|entity|semantic, and evidenceRefs is non-empty.',
    'Every cue must appear in exactly one group. A needs_adjustment group must include a full replacement for every cue in that group. A rejected group must not return a replacement.',
    `Requested cue IDs: ${JSON.stringify(ids)}`
  ].join('\n')
  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: [
        { type: 'text', text: payload },
        { type: 'input_audio', input_audio: { data: input.audio.data.toString('base64'), format: input.audio.format } }
      ]
    }
  ]
}

function stagePayloadSha(messages: readonly ModelMessage[], responseFormat: Record<string, unknown>, maxOutputTokens: number): string {
  return sha256(JSON.stringify(createGatewayRequestBody(messages, maxOutputTokens, false, 'json-items', responseFormat)))
}

function stageRecordPath(dir: string, stage: RestorationStageRecord['stage']): string {
  return join(dir, stage === 'restoration-draft' ? RESTORATION_DRAFT_FILE : RESTORATION_REVIEW_FILE)
}

function leasePath(dir: string, stage: RestorationStageRecord['stage']): string {
  return join(dir, `${stage}-operation.json`)
}

async function writeDurableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx')
    await handle.writeFile(JSON.stringify(value, null, 2), 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, path)
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
  }
}

function isValidStageRecord(value: unknown, expected: Omit<RestorationStageRecord, 'raw' | 'rawSha256' | 'observedModelId' | 'observedModel' | 'savedAtUtc' | 'state' | 'schemaVersion'>): value is RestorationStageRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<RestorationStageRecord>
  return record.schemaVersion === 1 && record.state === 'validated' && record.stage === expected.stage &&
    record.identity === expected.identity && record.routeFingerprint === expected.routeFingerprint && record.evidenceDigest === expected.evidenceDigest &&
    Array.isArray(record.expectedIds) && record.expectedIds.length === expected.expectedIds.length && record.expectedIds.every((id, index) => id === expected.expectedIds[index]) &&
    record.targetLocale === expected.targetLocale && record.promptVersion === expected.promptVersion && record.parserVersion === expected.parserVersion &&
    typeof record.raw === 'string' && Buffer.byteLength(record.raw, 'utf8') > 0 && Buffer.byteLength(record.raw, 'utf8') <= MAX_STAGE_RECORD_BYTES &&
    validSha(record.rawSha256) && sha256(record.raw) === record.rawSha256 && typeof record.observedModelId === 'string' && record.observedModelId.trim().length > 0 &&
    (record.observedModel === null || typeof record.observedModel === 'string') && typeof record.savedAtUtc === 'string' && Number.isFinite(Date.parse(record.savedAtUtc))
}

async function readStageRecord(dir: string, expected: Omit<RestorationStageRecord, 'raw' | 'rawSha256' | 'observedModelId' | 'observedModel' | 'savedAtUtc' | 'state' | 'schemaVersion'>): Promise<RestorationStageRecord | null> {
  if (!isAbsolute(dir)) return null
  try {
    const raw = await readFile(stageRecordPath(dir, expected.stage), 'utf8')
    if (Buffer.byteLength(raw, 'utf8') > MAX_STAGE_RECORD_BYTES) return null
    const parsed = JSON.parse(raw) as unknown
    return isValidStageRecord(parsed, expected) ? parsed : null
  } catch {
    return null
  }
}

async function acknowledgeRecordedLease(
  baseUrl: string,
  dir: string,
  stage: RestorationStageRecord['stage'],
  payloadSha256: string
): Promise<void> {
  try {
    const raw = await readFile(leasePath(dir, stage), 'utf8')
    const lease = JSON.parse(raw) as Partial<OperationLease>
    if (lease.schemaVersion !== 1 || lease.stage !== stage || lease.payloadSha256 !== payloadSha256 || !validSha(lease.payloadSha256) ||
        typeof lease.operationId !== 'string' || !lease.operationId.trim() || typeof lease.operationToken !== 'string' || !lease.operationToken.trim() ||
        typeof lease.clientRequestId !== 'string' || !lease.clientRequestId.trim()) {
      await unlink(leasePath(dir, stage)).catch(() => {})
      return
    }
    await ackGatewayOperation(baseUrl, lease.operationId, lease.operationToken)
    await unlink(leasePath(dir, stage))
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') return
  }
}

async function executeStage(input: {
  baseUrl: string
  messages: ModelMessage[]
  stage: RestorationStageRecord['stage']
  signal: AbortSignal
  draftDir: string
  maxRequestBodyBytes: number
  expected: Omit<RestorationStageRecord, 'raw' | 'rawSha256' | 'observedModelId' | 'observedModel' | 'savedAtUtc' | 'state' | 'schemaVersion'>
  validate: (raw: string) => void
  responseFormat: Record<string, unknown>
}): Promise<{ raw: string; observedModelId: string; observedModel?: string }> {
  const maxOutputTokens = calculateRestorationOutputTokenLimit(input.expected.expectedIds.length)
  const payloadSha256 = stagePayloadSha(input.messages, input.responseFormat, maxOutputTokens)
  const existing = await readStageRecord(input.draftDir, input.expected)
  if (existing) {
    try {
      input.validate(existing.raw)
      await acknowledgeRecordedLease(input.baseUrl, input.draftDir, input.stage, payloadSha256)
      return { raw: existing.raw, observedModelId: existing.observedModelId, ...(existing.observedModel ? { observedModel: existing.observedModel } : {}) }
    } catch (error) {
      // A corrupted/stale local output is never promoted. Remove only this
      // validated-record cache; an operation lease is left intact so the
      // scheduler can still resolve its exact in-flight request safely.
      await rm(stageRecordPath(input.draftDir, input.stage), { force: true }).catch(() => {})
      if ((error as { providerCode?: string })?.providerCode === 'provider-protocol') throw error
    }
  }
  const execution = await requestGatewayOperation(
    input.baseUrl,
    input.messages,
    input.signal,
    maxOutputTokens,
    false,
    'json-items',
    {
      draftDir: input.draftDir,
      stage: input.stage,
      httpTimeoutMs: GATEWAY_STAGE_TIMEOUT_MS,
      deferOnWaitingProvider: true,
      maxRequestBodyBytes: input.maxRequestBodyBytes,
      responseFormat: input.responseFormat
    }
  )
  try {
    input.validate(execution.completion.raw)
  } catch (validationError) {
    await execution.ack().catch(() => {})
    throw validationError
  }
  const record: RestorationStageRecord = {
    schemaVersion: 1,
    state: 'validated',
    ...input.expected,
    raw: execution.completion.raw,
    rawSha256: sha256(execution.completion.raw),
    observedModelId: execution.completion.observedModelId,
    observedModel: execution.completion.observedModel || null,
    savedAtUtc: new Date().toISOString()
  }
  await writeDurableJson(stageRecordPath(input.draftDir, input.stage), record)
  await execution.ack()
  return { raw: record.raw, observedModelId: record.observedModelId, ...(record.observedModel ? { observedModel: record.observedModel } : {}) }
}

function stageExpectation(
  stage: RestorationStageRecord['stage'],
  identity: string,
  routeFingerprint: string,
  evidenceDigest: string,
  expectedIds: string[],
  targetLocale: string
): Omit<RestorationStageRecord, 'raw' | 'rawSha256' | 'observedModelId' | 'observedModel' | 'savedAtUtc' | 'state' | 'schemaVersion'> {
  return {
    stage,
    identity,
    routeFingerprint,
    evidenceDigest,
    expectedIds,
    targetLocale,
    promptVersion: GATEWAY_RESTORATION_PROMPT_VERSION,
    parserVersion: GATEWAY_RESTORATION_PARSER_VERSION
  }
}

interface ExecutedRestorationChunk {
  evidence: SourceEvidencePack
  draft: RestorationDraftResult
  review: RestorationReviewResult
  reviewDigest: string
}

async function executeRestorationChunk(
  input: RunGatewayRestorationInput,
  capabilities: GatewayServerCapabilitiesInfo,
  evidence: SourceEvidencePack,
  identity: string,
  draftDir: string
): Promise<ExecutedRestorationChunk> {
  const expectedIds = input.sourceCues.map((cue) => cue.id.trim())
  const draftStage = stageExpectation('restoration-draft', identity, capabilities.routeFingerprint, evidence.evidenceDigest, expectedIds, input.targetLocale)
  const draftResult = await executeStage({
    baseUrl: input.baseUrl,
    messages: draftMessages(input, evidence),
    stage: 'restoration-draft',
    signal: input.signal,
    draftDir,
    maxRequestBodyBytes: capabilities.maxRequestBodyBytes!,
    expected: draftStage,
    validate: (raw) => { validateRestorationDraft(raw, input.sourceCues, evidence) },
    responseFormat: RESTORATION_DRAFT_RESPONSE_FORMAT
  })
  const draft = validateRestorationDraft(draftResult.raw, input.sourceCues, evidence)
  const candidateDigest = calculateRestorationCandidateDigest(draft)
  const reviewStage = stageExpectation('restoration-review', identity, capabilities.routeFingerprint, evidence.evidenceDigest, expectedIds, input.targetLocale)
  const reviewResult = await executeStage({
    baseUrl: input.baseUrl,
    messages: reviewMessages(input, evidence, draft),
    stage: 'restoration-review',
    signal: input.signal,
    draftDir,
    maxRequestBodyBytes: capabilities.maxRequestBodyBytes!,
    expected: reviewStage,
    validate: (raw) => { validateRestorationReview(raw, draft, evidence) },
    responseFormat: RESTORATION_REVIEW_RESPONSE_FORMAT
  })
  const review = validateRestorationReview(reviewResult.raw, draft, evidence)
  // Apply once per chunk before aggregation so a rejected or incomplete chunk
  // can never be hidden by valid output from its neighbours.
  applyRestorationPipeline({ cues: input.sourceCues, draft, review })
  return { evidence, draft, review, reviewDigest: sha256(reviewResult.raw) }
}

function combineRestorationChunks(
  input: RunGatewayRestorationInput,
  evidence: SourceEvidencePack,
  chunks: readonly ExecutedRestorationChunk[]
): Pick<GatewayRestorationResult, 'draft' | 'review' | 'restoredSourceCues' | 'translatedItems' | 'metrics' | 'candidateDigest' | 'reviewDigest'> {
  const draftCandidate: RestorationDraftResult = {
    schemaVersion: 'restoration-translation-v1',
    evidenceDigest: evidence.evidenceDigest,
    sourceEdits: chunks.flatMap((chunk) => chunk.draft.sourceEdits),
    sentenceEndIds: chunks.flatMap((chunk) => chunk.draft.sentenceEndIds),
    entities: chunks.flatMap((chunk) => chunk.draft.entities),
    ...(input.synopsis?.trim() ? { synopsis: input.synopsis.trim() } : {}),
    items: chunks.flatMap((chunk) => chunk.draft.items)
  }
  const draft = validateRestorationDraft(JSON.stringify(draftCandidate), input.sourceCues, evidence)
  const candidateDigest = calculateRestorationCandidateDigest(draft)
  const groupAssessments = chunks.flatMap((chunk, chunkIndex) => chunk.review.groupAssessments.map((group) => ({
    ...group,
    groupId: `chunk-${String(chunkIndex + 1).padStart(3, '0')}-${group.groupId}`
  })))
  const replacements = chunks.flatMap((chunk, chunkIndex) => chunk.review.replacements.map((replacement) => ({
    ...replacement,
    groupId: `chunk-${String(chunkIndex + 1).padStart(3, '0')}-${replacement.groupId}`
  })))
  const status: RestorationReviewResult['status'] = groupAssessments.some((group) => group.status === 'needs_adjustment')
    ? 'needs_adjustment'
    : 'approved'
  const reviewCandidate: RestorationReviewResult = {
    schemaVersion: 'restoration-review-v1',
    candidateDigest,
    reviewedCueIds: input.sourceCues.map((cue) => cue.id.trim()),
    status,
    confidenceScore: Math.min(...chunks.map((chunk) => chunk.review.confidenceScore)),
    reviewerNotes: chunks.map((chunk, index) => `[chunk-${String(index + 1).padStart(3, '0')}] ${chunk.review.reviewerNotes}`).join('\n'),
    groupAssessments,
    findings: chunks.flatMap((chunk) => chunk.review.findings),
    replacements
  }
  const review = validateRestorationReview(JSON.stringify(reviewCandidate), draft, evidence)
  const applied = applyRestorationPipeline({ cues: input.sourceCues, draft, review })
  return {
    draft,
    review,
    restoredSourceCues: applied.restoredSourceCues,
    translatedItems: applied.finalTranslationItems,
    metrics: applied.metrics,
    candidateDigest,
    reviewDigest: sha256(JSON.stringify(review))
  }
}

/**
 * Two-pass, scheduler-only restoration. Long inputs are split into bounded,
 * ordered cue chunks. Each chunk has its own durable operation leases and is
 * validated independently before a whole-input validation pass. The operation
 * lease persists only a hash; validated records never persist audio/base64.
 */
export async function runGatewayRestoration(input: RunGatewayRestorationInput): Promise<GatewayRestorationResult> {
  if (!isAbsolute(input.draftDir)) throw new Error('Gateway restoration draftDir phải là đường dẫn tuyệt đối.')
  const capabilities = input.capabilities || await readGatewayCapabilitiesInfo(input.baseUrl, input.signal)
  if (!capabilities.schedulerSupported) throw Object.assign(new Error('Gemini Gateway không hỗ trợ Operation API; không chạy media restoration ngoài governor.'), { providerCode: 'provider-protocol' })
  if (!capabilities.maxRequestBodyBytes) throw Object.assign(new Error('Gemini Gateway không công bố max_request_body_bytes; không gửi audio media.'), { providerCode: 'provider-protocol' })
  const identity = calculateGatewayRestorationIdentity(input)
  const evidence = buildSourceEvidencePack({
    cues: input.sourceCues,
    ocrFrames: input.ocrFrames,
    audioMeta: {
      durationSeconds: input.audio.durationSeconds,
      sampleRate: input.audio.sampleRate,
      channels: input.audio.channels,
      format: input.audio.format,
      sha256: input.audio.sha256
    },
    glossary: input.glossary
  })
  const cueChunks = partitionRestorationCues(input.sourceCues)
  if (cueChunks.length === 0) throw new Error('Gateway restoration cần ít nhất một cue nguồn.')
  const executed: ExecutedRestorationChunk[] = []
  for (let index = 0; index < cueChunks.length; index++) {
    const sourceCues = cueChunks[index]
    const chunkEvidence = cueChunks.length === 1 ? evidence : evidenceForChunk(evidence, sourceCues)
    const chunkIdentity = cueChunks.length === 1
      ? identity
      : sha256(JSON.stringify({ identity, index, evidenceDigest: chunkEvidence.evidenceDigest, cueIds: sourceCues.map((cue) => cue.id.trim()) }))
    const chunkDir = cueChunks.length === 1 ? input.draftDir : join(input.draftDir, `chunk-${String(index + 1).padStart(3, '0')}`)
    executed.push(await executeRestorationChunk({ ...input, sourceCues }, capabilities, chunkEvidence, chunkIdentity, chunkDir))
  }
  const combined = cueChunks.length === 1
    ? (() => {
      const chunk = executed[0]
      const applied = applyRestorationPipeline({ cues: input.sourceCues, draft: chunk.draft, review: chunk.review })
      return {
        draft: chunk.draft,
        review: chunk.review,
        restoredSourceCues: applied.restoredSourceCues,
        translatedItems: applied.finalTranslationItems,
        metrics: applied.metrics,
        candidateDigest: calculateRestorationCandidateDigest(chunk.draft),
        reviewDigest: chunk.reviewDigest
      }
    })()
    : combineRestorationChunks(input, evidence, executed)
  return {
    identity,
    routeFingerprint: capabilities.routeFingerprint,
    evidence,
    ...combined
  }
}
