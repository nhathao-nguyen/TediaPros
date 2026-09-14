import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DichKeyStatus } from '../shared/types'
import { DEFAULT_GEMINI_GATEWAY_URL, GEMINI_GATEWAY_MODEL } from '../shared/types'
import type { TranslationAssessment } from '../shared/translation'
import type { PlannedTranslationBatch } from './translation/planner'
import type { TranslationAdapter } from './translation/orchestrator'
import { buildTranslationBatchMessages, buildRephraseMessages, type ModelMessage } from './translation/prompts'
import { parseTranslationResponse } from './translation/response'
import { readBoundedAiResponseJson, readBoundedAiResponseText } from './aiResponseBody'
import { translateFileWithAdapter, type TranslationFileRunnerOptions } from './translation/fileRunner'
import { logInfo } from './logger'
import { isSentenceTerminal } from './semanticGrouping'
import { assertExactKeys, parseAiJsonObject } from '../shared/aiOutput'

export const GEMINI_GATEWAY_PROMPT_VERSION = 'gemini-gateway-two-pass-v3'
const MAX_AUDIT_BYTES = 4 * 1024 * 1024
const COMPACT_OUTPUT_CONTRACT = 'format=compact-keyed-json; output exactly one JSON object {"translations":{"<cue-id>":"<translation>"}} with every expected cue ID exactly once and no prose.'
const SOURCE_ONLY_GROUPING_INSTRUCTION = 'Source fragments sharing group_id form one speech unit established before translation. Read the whole source group as a continuous thought, then translate each original ID as its corresponding fragment. Do not turn an unfinished fragment into a standalone question or move the question, negation or answer into a neighboring ID. Translated punctuation must not redefine speech boundaries.'
const REVIEWED_GROUPING_INSTRUCTION = 'Source fragments sharing group_id provide nearby source context. They are context hints, not target sentence boundaries. Read the whole source ledger as a continuous story, keep each original ID as its corresponding fragment, and never move a question, negation or answer into another ID. Restore punctuation at defensible cue edges so the reviewed target defines complete speech sentences.'

const TRANSLATION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'srt_translation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        translations: {
          type: 'object',
          additionalProperties: { type: 'string' }
        }
      },
      required: ['translations'],
      additionalProperties: false
    }
  }
} as const

interface GatewayCompletion {
  raw: string
  truncated: boolean
  modelIdentity: string
  upstreamAttempts: number
  upstreamRetryReasons: string[]
  responseId?: string
  finishReason: string
  requestBody: Record<string, unknown>
}

function canonicalizeCompactTranslation(raw: string, expectedCount: number): string {
  const parsed = parseAiJsonObject(raw, {
    limits: { maxBytes: 1024 * 1024, maxDepth: 8, maxMembers: Math.max(64, expectedCount + 8), maxCandidates: 1 }
  }).value
  assertExactKeys(parsed, ['translations'])
  const translations = parsed.translations
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
    throw Object.assign(new Error('Gemini Gateway không trả về object translations.'), { providerCode: 'provider-protocol' })
  }
  const items = Object.entries(translations).map(([id, text]) => {
    if (typeof text !== 'string') {
      throw Object.assign(new Error(`Bản dịch cho cue ${id} không phải chuỗi.`), { providerCode: 'provider-protocol' })
    }
    return { id, text }
  })
  return JSON.stringify({ items })
}

function gatewayBaseMessages(batch: PlannedTranslationBatch): ModelMessage[] {
  const base = buildTranslationBatchMessages(batch, 'json-items')
  return [{
    ...base[0],
    content: base[0].content
      .replace('format=json-items; output exactly one JSON object {"items":[{"id":"<cue-id>","text":"<translation>"}]} with no prose.', COMPACT_OUTPUT_CONTRACT)
      .replace(SOURCE_ONLY_GROUPING_INSTRUCTION, REVIEWED_GROUPING_INSTRUCTION)
  }, base[1]]
}

interface GatewayAuditRecord {
  stage: 'restore-translate' | 'independent-review'
  startedAtUtc: string
  endedAtUtc: string
  expectedIds: string[]
  outcome: 'complete' | 'failed'
  request?: Record<string, unknown>
  response?: {
    id?: string
    raw: string
    sha256: string
    finishReason: string
    truncated: boolean
    upstreamAttempts: number
    upstreamRetryReasons: string[]
  }
  error?: string
}

export interface GeminiGatewayTranslationOptions {
  /** Fixed path inside the current AutoShort item scope. Never sent upstream. */
  auditPath?: string
}

function normalizeBaseUrl(value?: string): string {
  const raw = (value || DEFAULT_GEMINI_GATEWAY_URL).trim().replace(/\/+$/u, '')
  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Địa chỉ Gemini Gateway không hợp lệ.')
  }
  return raw
}

function providerError(status: number, detail: string): Error {
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500
  return Object.assign(new Error(detail || `Gemini Gateway báo lỗi HTTP ${status}.`), {
    status,
    providerCode: retryable ? 'provider-transient' : status === 401 || status === 403 ? 'provider-auth' : 'provider-protocol'
  })
}

async function requestGateway(
  baseUrl: string,
  messages: readonly ModelMessage[],
  signal: AbortSignal,
  maxOutputTokens: number,
  structuredJson = true
): Promise<GatewayCompletion> {
  let response: Response | undefined
  const requestBody = {
    model: GEMINI_GATEWAY_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: maxOutputTokens,
    temporary: true,
    ...(structuredJson ? { response_format: TRANSLATION_RESPONSE_FORMAT } : {})
  }
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal
    })
    if (!response.ok) {
      const detail = await readBoundedAiResponseText(response, signal, 64 * 1024).catch(() => '')
      throw providerError(response.status, detail)
    }
    const data = await readBoundedAiResponseJson<{
      id?: unknown
      model?: unknown
      choices?: Array<{
        message?: { content?: unknown; refusal?: unknown; tool_calls?: unknown }
        finish_reason?: unknown
      }>
      gateway_metadata?: { requested_model?: unknown; resolved_model?: unknown; upstream_attempts?: unknown; upstream_retry_reasons?: unknown }
    }>(response, signal, 1024 * 1024)
    if (!Array.isArray(data.choices) || data.choices.length !== 1) {
      throw Object.assign(new Error('Gemini Gateway trả về số candidate không hợp lệ.'), { providerCode: 'provider-protocol' })
    }
    const choice = data.choices[0]
    const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : 'unknown'
    if (finishReason === 'content_filter' ||
        (typeof choice.message?.refusal === 'string' && choice.message.refusal.trim()) ||
        choice.message?.tool_calls !== undefined) {
      throw Object.assign(new Error('Gemini Gateway lọc, từ chối hoặc trả tool payload.'), { providerCode: 'provider-protocol' })
    }
    const raw = typeof choice.message?.content === 'string' ? choice.message.content.trim() : ''
    if (!raw) throw Object.assign(new Error('Gemini Gateway trả về nội dung rỗng.'), { providerCode: 'provider-protocol' })
    const resolved = typeof data.gateway_metadata?.resolved_model === 'string'
      ? data.gateway_metadata.resolved_model
      : typeof data.model === 'string' ? data.model : GEMINI_GATEWAY_MODEL
    if (resolved !== GEMINI_GATEWAY_MODEL) {
      throw Object.assign(new Error(`Gemini Gateway đã chọn model ${resolved} thay vì ${GEMINI_GATEWAY_MODEL}.`), { providerCode: 'provider-protocol' })
    }
    return {
      raw,
      truncated: finishReason === 'length',
      modelIdentity: `gemini-gateway:${GEMINI_GATEWAY_MODEL}`,
      responseId: typeof data.id === 'string' ? data.id : undefined,
      finishReason,
      requestBody,
      upstreamRetryReasons: Array.isArray(data.gateway_metadata?.upstream_retry_reasons)
        ? data.gateway_metadata.upstream_retry_reasons.filter((item): item is string => typeof item === 'string').slice(0, 8)
        : [],
      upstreamAttempts: typeof (data.gateway_metadata as { upstream_attempts?: unknown } | undefined)?.upstream_attempts === 'number'
        ? Math.max(1, Math.floor((data.gateway_metadata as { upstream_attempts: number }).upstream_attempts))
        : 1
    }
  } catch (error) {
    if (signal.aborted) {
      throw Object.assign(new Error(signal.reason instanceof Error ? signal.reason.message : 'Đã hủy dịch qua Gemini Gateway.'), {
        providerCode: signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'provider-transient' : 'cancelled'
      })
    }
    if (error instanceof TypeError && /fetch failed|failed to fetch/iu.test(error.message)) {
      throw Object.assign(new Error('Không thể kết nối Gemini Gateway.', { cause: error }), { providerCode: 'provider-transient' })
    }
    throw error
  } finally {
    if (response?.body && !response.bodyUsed && !response.body.locked) await response.body.cancel().catch(() => {})
  }
}

function boundedAuditDocument(records: readonly GatewayAuditRecord[]): string {
  const document = {
    schemaVersion: 1,
    promptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
    model: GEMINI_GATEWAY_MODEL,
    records
  }
  const full = JSON.stringify(document, null, 2)
  if (Buffer.byteLength(full, 'utf8') <= MAX_AUDIT_BYTES) return full
  return JSON.stringify({
    ...document,
    records: records.map((record) => ({
      ...record,
      request: record.request ? {
        omittedBecauseAuditExceededBytes: true,
        sha256: createHash('sha256').update(JSON.stringify(record.request)).digest('hex')
      } : undefined,
      response: record.response ? { ...record.response, raw: '[omitted: audit exceeded 4 MiB]' } : undefined
    }))
  }, null, 2)
}

async function writeGatewayAudit(path: string | undefined, records: readonly GatewayAuditRecord[]): Promise<void> {
  if (!path) return
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, boundedAuditDocument(records), 'utf8')
  await rename(temporary, path)
}

function validateReviewedDubbingPunctuation(batch: PlannedTranslationBatch, raw: string): void {
  if (batch.input.mode !== 'dubbing' || batch.input.cues.length === 0) return
  const expectedIds = batch.input.cues.map((cue) => cue.id)
  const contextIds = [...batch.input.contextBefore, ...batch.input.contextAfter].map((cue) => cue.id)
  const parsed = parseTranslationResponse(raw, 'json-items', expectedIds, false, contextIds)
  if (!parsed.complete) return
  const byId = new Map(parsed.items.map((item) => [item.id, item.text]))
  const lastText = byId.get(expectedIds.at(-1)!) || ''
  if (!isSentenceTerminal(lastText)) {
    throw Object.assign(new Error('Lượt review chưa khôi phục dấu kết thúc cho câu cuối của video.'), { providerCode: 'provider-protocol' })
  }
  let runStart = batch.input.cues[0].start
  let runCues = 0
  for (let index = 0; index < batch.input.cues.length; index++) {
    const cue = batch.input.cues[index]
    const next = batch.input.cues[index + 1]
    runCues++
    const boundary = isSentenceTerminal(byId.get(cue.id) || '') || !next || next.start - cue.end >= 0.6 - 1e-9
    if (!boundary) continue
    const duration = cue.end - runStart
    if (runCues > 10 || duration > 18) {
      throw Object.assign(new Error(`Lượt review chưa đặt đủ ranh giới câu quanh cue ${cue.id}.`), { providerCode: 'provider-protocol' })
    }
    if (next) runStart = next.start
    runCues = 0
  }
}

function localeInstruction(locale: string): string {
  const language = (() => {
    try { return new Intl.Locale(locale).language.toLowerCase() } catch { return locale.toLowerCase().split('-')[0] }
  })()
  if (language === 'vi') {
    return 'Use natural, neutral spoken Vietnamese used in Vietnam. Prefer familiar Vietnamese collocations and direct sentence order over translated Chinese syntax. Translate meaning in context: for example, an insight is usually "nghĩ ra/hiểu ra", funeral work may require "đào huyệt/chôn cất", and 相对来说 should become a direct consequence such as "nhờ vậy" when supported. Do not insert regional slang, generic pronouns, hype, hooks, praise or calls to action absent from the source.'
  }
  return `Write idiomatic spoken language for locale ${locale}. Follow its spelling and vocabulary. Do not invent a regional voice when the locale does not specify one.`
}

function draftMessages(batch: PlannedTranslationBatch): ModelMessage[] {
  const base = gatewayBaseMessages(batch)
  return [{
    role: 'system',
    content: [
      `gateway_prompt_version=${GEMINI_GATEWAY_PROMPT_VERSION}`,
      base[0].content,
      localeInstruction(batch.input.targetLocale),
      'Read the complete source ledger before translating any fragment.',
      'Silently restore obvious ASR/OCR homophone errors only when the complete source context makes the correction well grounded. In particular, keep one subject, brand, object, number and unit consistent across the whole video.',
      'Never replace an unfamiliar proper name with a familiar brand. Never add an action, location, ownership claim, fact, hook or explanation absent from the source.',
      'Resolve object terminology from the complete domain context. For vehicle controls, use established automotive wording in the target locale; do not turn a stalk, switch, button or directional control into a computer keyboard key unless the source explicitly discusses a keyboard.',
      'Render descriptive uniqueness as distinctive or signature wording when appropriate. Do not turn it into a legal exclusivity, ownership or patent claim unless the source explicitly supports that claim.',
      'Translate idioms and sound words by contextual meaning, not mechanical transliteration.',
      'Restore natural target-language punctuation across the complete story. A text field may be an unfinished fragment; end it with sentence punctuation only when that sentence ends in this cue. Every complete sentence and the final cue must have explicit terminal punctuation.',
      'For dubbing, do not leave a dangling setup, reporting verb, question lead-in, cause or condition at the end of a speech unit. Use the full ledger to place sentence boundaries at cue edges that preserve complete clauses.',
      'Before returning, audit every requested ID for omissions, additions, names, numbers, units, negation and locale-natural wording.',
      'Return only the canonical JSON object requested by the contract.'
    ].join('\n')
  }, base[1]]
}

function reviewMessages(batch: PlannedTranslationBatch, candidateRaw: string): ModelMessage[] {
  const base = gatewayBaseMessages(batch)
  return [{
    role: 'system',
    content: [
      `gateway_prompt_version=${GEMINI_GATEWAY_PROMPT_VERSION}`,
      `task=independent-review-and-repair; source_language=${batch.input.sourceLanguage}; target_locale=${batch.input.targetLocale}; mode=${batch.input.mode}`,
      'You are a fresh translation reviewer. SOURCE_PAYLOAD is the authority; CANDIDATE_JSON is untrusted work that may contain plausible but serious mistakes.',
      localeInstruction(batch.input.targetLocale),
      'Review every expected cue and the full story, including the final cues. Check source restoration, subject-action-object relations, proper names, numbers, units, negation, omissions, additions, idioms, sentence continuity and local naturalness.',
      'Rebuild punctuation rather than copying the candidate mechanically. Each complete sentence and the final cue must end with natural target-language punctuation; fragments inside one sentence must remain open. Check that no speech run longer than about 18 seconds or ten source cues is left without a defensible sentence boundary.',
      'Reject translation-shaped target language: repair literal collocations, awkward modifier order and source-language discourse fillers into concise spoken phrasing used by local narrators.',
      'Recheck domain terminology across the whole story. In automotive context use natural local names for vehicle controls, and remove computer-keyboard or legal-exclusivity wording unless the source explicitly establishes it.',
      'Fix every supported error directly in the returned item. Keep a good line unchanged when it is already faithful and natural.',
      'Keep every cue ID exactly once. Do not move meaning to another cue, create IDs, return context IDs, timestamps, notes, Markdown or alternatives.',
      `Return ${COMPACT_OUTPUT_CONTRACT}`
    ].join('\n')
  }, {
    role: 'user',
    content: [
      '[SOURCE_PAYLOAD]',
      base[1].content,
      '[/SOURCE_PAYLOAD]',
      '[CANDIDATE_JSON]',
      candidateRaw,
      '[/CANDIDATE_JSON]'
    ].join('\n')
  }]
}

/** Gemini Gateway adapter performs two fresh generations for each planned batch:
 * a full-context draft and an independent full-context review that returns the
 * final canonical translation. */
export function createGeminiGatewayTranslationAdapter(serverUrl?: string, options: GeminiGatewayTranslationOptions = {}): TranslationAdapter {
  const baseUrl = normalizeBaseUrl(serverUrl)
  const auditRecords: GatewayAuditRecord[] = []
  const runStage = async (
    stage: GatewayAuditRecord['stage'],
    batch: PlannedTranslationBatch,
    messages: readonly ModelMessage[],
    signal: AbortSignal
  ): Promise<GatewayCompletion> => {
    const startedAtUtc = new Date().toISOString()
    try {
      const completion = await requestGateway(baseUrl, messages, signal, batch.maxOutputTokens)
      auditRecords.push({
        stage,
        startedAtUtc,
        endedAtUtc: new Date().toISOString(),
        expectedIds: batch.input.cues.map((cue) => cue.id),
        outcome: 'complete',
        request: completion.requestBody,
        response: {
          id: completion.responseId,
          raw: completion.raw,
          sha256: createHash('sha256').update(completion.raw).digest('hex'),
          finishReason: completion.finishReason,
          truncated: completion.truncated,
          upstreamAttempts: completion.upstreamAttempts,
          upstreamRetryReasons: completion.upstreamRetryReasons
        }
      })
      await writeGatewayAudit(options.auditPath, auditRecords)
      return completion
    } catch (error) {
      auditRecords.push({
        stage,
        startedAtUtc,
        endedAtUtc: new Date().toISOString(),
        expectedIds: batch.input.cues.map((cue) => cue.id),
        outcome: 'failed',
        error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
      })
      await writeGatewayAudit(options.auditPath, auditRecords).catch(() => {})
      throw error
    }
  }
  return {
    capability: {
      provider: 'gemini-gateway',
      modelIdentity: `gemini-gateway:${GEMINI_GATEWAY_MODEL}`,
      revisionKnown: false,
      format: 'json-items',
      contextTokens: null,
      outputTokens: 16_384,
      wholeDocument: true,
      independentContentReview: true
    },
    async requestOnce(batch, signal) {
      const expectedIds = batch.input.cues.map((cue) => cue.id)
      const contextIds = [...batch.input.contextBefore, ...batch.input.contextAfter].map((cue) => cue.id)
      logInfo(`[GeminiGateway] request=1/2 stage=restore-translate cues=${expectedIds.length} model=${GEMINI_GATEWAY_MODEL}`)
      const draft = await runStage('restore-translate', batch, draftMessages(batch), signal)
      logInfo(`[GeminiGateway] request=1/2 outcome=complete upstreamAttempts=${draft.upstreamAttempts} retryReasons=${draft.upstreamRetryReasons.join(',') || 'none'}`)
      const canonicalDraft = canonicalizeCompactTranslation(draft.raw, expectedIds.length)
      const parsedDraft = parseTranslationResponse(canonicalDraft, 'json-items', expectedIds, draft.truncated, contextIds)
      if (!parsedDraft.complete) {
        throw Object.assign(new Error(`Lượt khôi phục và dịch không đúng contract: ${parsedDraft.issues[0]?.message || 'response không hoàn chỉnh'}`), {
          providerCode: 'provider-protocol'
        })
      }
      const reviewedDraft = JSON.stringify({ translations: Object.fromEntries(parsedDraft.items.map((item) => [item.id, item.text])) })
      logInfo(`[GeminiGateway] request=2/2 stage=independent-review cues=${expectedIds.length} model=${GEMINI_GATEWAY_MODEL}`)
      const reviewed = await runStage('independent-review', batch, reviewMessages(batch, reviewedDraft), signal)
      logInfo(`[GeminiGateway] request=2/2 outcome=complete upstreamAttempts=${reviewed.upstreamAttempts} retryReasons=${reviewed.upstreamRetryReasons.join(',') || 'none'}`)
      const canonicalReviewed = canonicalizeCompactTranslation(reviewed.raw, expectedIds.length)
      validateReviewedDubbingPunctuation(batch, canonicalReviewed)
      return {
        raw: canonicalReviewed,
        truncated: reviewed.truncated,
        modelIdentity: reviewed.modelIdentity
      }
    }
  }
}

export async function checkGeminiGateway(serverUrl?: string): Promise<DichKeyStatus> {
  try {
    const baseUrl = normalizeBaseUrl(serverUrl)
    const response = await fetch(`${baseUrl}/gateway/capabilities`, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return { ok: false, message: `Gemini Gateway báo lỗi HTTP ${response.status}.` }
    const data = await readBoundedAiResponseJson<{
      models?: unknown
      schema_mode?: unknown
      model_selection?: unknown
    }>(response, undefined, 256 * 1024)
    const ids = Array.isArray(data.models) ? data.models.filter((item): item is string => typeof item === 'string') : []
    if (!ids.includes(GEMINI_GATEWAY_MODEL)) {
      return { ok: false, message: `Gateway chưa cung cấp ${GEMINI_GATEWAY_MODEL} (Gemini 3.1 Pro).` }
    }
    if (data.model_selection !== 'exact') return { ok: false, message: 'Gateway chưa bật chọn model chính xác.' }
    return { ok: true, message: `Đã kết nối Gemini Gateway · Gemini 3.1 Pro (${GEMINI_GATEWAY_MODEL}).` }
  } catch (error) {
    return { ok: false, message: `Không thể kết nối Gemini Gateway: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function translateSrtWithGeminiGateway(
  inputPath: string,
  outputPath: string,
  targetLocale: string,
  serverUrl?: string,
  options: TranslationFileRunnerOptions = {}
): Promise<{ ok: boolean; error?: string; count?: number; assessment?: TranslationAssessment }> {
  const result = await translateFileWithAdapter(
    inputPath,
    outputPath,
    targetLocale,
    createGeminiGatewayTranslationAdapter(serverUrl),
    options
  )
  return { ok: result.ok, error: result.error, count: result.count, assessment: result.assessment }
}

export async function rephraseGeminiGateway(
  serverUrl: string | undefined,
  messages: ReturnType<typeof buildRephraseMessages>,
  signal?: AbortSignal
): Promise<string> {
  logInfo(`[GeminiGateway] request=extra stage=tts-overflow-rephrase model=${GEMINI_GATEWAY_MODEL}`)
  const result = await requestGateway(
    normalizeBaseUrl(serverUrl),
    messages,
    signal || AbortSignal.timeout(90_000),
    2_048,
    false
  )
  return result.raw
}
