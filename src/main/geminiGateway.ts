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
import { logInfo, logWarn } from './logger'
import { isSentenceTerminal } from './semanticGrouping'
import { assertExactKeys, parseAiJsonObject } from '../shared/aiOutput'
import {
  GEMINI_GATEWAY_PROMPT_VERSION,
  buildGatewayDraftMessages,
  buildGatewayReviewMessages
} from './geminiGatewayPrompts'
import {
  calculateGatewaySourceDigest,
  readGatewayDraft,
  writeGatewayDraft
} from './geminiGatewayDraftCheckpoint'

export { GEMINI_GATEWAY_PROMPT_VERSION } from './geminiGatewayPrompts'

const MAX_AUDIT_BYTES = 4 * 1024 * 1024

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
  observedModelId?: string
  observedModel?: string
  routeFingerprint?: string
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
  /** Directory inside current AutoShort item scope where draft is saved/resumed. Defaults to dirname(auditPath) if provided. */
  draftDir?: string
}

function normalizeBaseUrl(value?: string): string {
  const raw = (value || DEFAULT_GEMINI_GATEWAY_URL).trim().replace(/\/+$/u, '')
  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Địa chỉ Gemini Gateway không hợp lệ.')
  }
  return raw
}

export function isPermanentGatewayError(message?: string): boolean {
  if (!message) return false
  return /model-unavailable|model-mismatch|invalid-structured-json|chưa hỗ trợ Gemini 3.1 Pro|không khớp|hết hạn hoặc không hợp lệ|hợp đồng phiên bản 2|observed_model_id|trạng thái unverified|trạng thái mismatch/iu.test(message)
}

function providerError(status: number, detail: string): Error {
  let errorCode: string | undefined
  let errorMsg: string | undefined
  try {
    const parsed = JSON.parse(detail)
    errorCode = parsed?.error?.code || parsed?.gateway_metadata?.error_code
    errorMsg = parsed?.error?.message
  } catch {}

  let message = detail || `Gemini Gateway báo lỗi HTTP ${status}.`
  let providerCode: 'provider-transient' | 'provider-auth' | 'provider-protocol' = 'provider-protocol'

  if (errorCode === 'model-unavailable') {
    message = 'Tài khoản Google của gateway chưa hỗ trợ Gemini 3.1 Pro (cần gói Google One AI Premium hoặc Gemini Advanced).'
    providerCode = 'provider-protocol'
  } else if (errorCode === 'model-mismatch') {
    message = `Gemini Gateway trả về model không khớp: ${errorMsg || detail}`
    providerCode = 'provider-protocol'
  } else if (errorCode === 'invalid-structured-json') {
    message = `Gemini Gateway không thể chuẩn hóa JSON có cấu trúc: ${errorMsg || detail}`
    providerCode = 'provider-protocol'
  } else if (errorCode === 'upstream-incomplete') {
    message = `Gemini Gateway phản hồi chưa hoàn tất từ upstream: ${errorMsg || detail}`
    providerCode = 'provider-transient'
  } else if (errorCode === 'upstream-transient' || status === 408 || status === 425 || status === 429 || status >= 500) {
    message = errorMsg ? `Gemini Gateway lỗi upstream: ${errorMsg}` : (detail || `Gemini Gateway báo lỗi HTTP ${status}.`)
    providerCode = 'provider-transient'
  } else if (status === 401 || status === 403 || errorCode === 'authentication_required') {
    message = 'Cookie Gemini của gateway đã hết hạn hoặc không hợp lệ. Hãy cập nhật cookie rồi khởi động lại gateway.'
    providerCode = 'provider-auth'
  }

  return Object.assign(new Error(message), {
    status,
    providerCode,
    errorCode
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
    gateway_requirements: {
      contract_version: 2,
      require_verified_model: true,
      require_complete_response: true
    },
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
      gateway_metadata?: {
        contract_version?: unknown
        requested_model?: unknown
        resolved_model?: unknown
        observed_model_id?: unknown
        observed_model?: unknown
        route_fingerprint?: unknown
        model_verification?: unknown
        completion_state?: unknown
        upstream_attempts?: unknown
        upstream_retry_reasons?: unknown
        error_code?: unknown
      }
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

    const meta = data.gateway_metadata
    if (!meta || meta.contract_version !== 2) {
      throw Object.assign(new Error('Gemini Gateway không trả về hợp đồng phiên bản 2 (contract_version: 2). Hãy nâng cấp gateway.'), { providerCode: 'provider-protocol' })
    }
    if (meta.model_verification !== 'matched') {
      throw Object.assign(new Error(`Gemini Gateway không xác thực được model: trạng thái ${meta.model_verification}.`), { providerCode: 'provider-protocol' })
    }
    if (!meta.observed_model_id || typeof meta.observed_model_id !== 'string') {
      throw Object.assign(new Error('Gemini Gateway không cung cấp observed_model_id hợp lệ.'), { providerCode: 'provider-protocol' })
    }
    if (meta.completion_state !== 'complete') {
      throw Object.assign(new Error(`Gemini Gateway phản hồi chưa hoàn tất (completion_state: ${meta.completion_state}).`), { providerCode: 'provider-protocol' })
    }

    const resolved = typeof meta.resolved_model === 'string'
      ? meta.resolved_model
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
      observedModelId: typeof meta.observed_model_id === 'string' ? meta.observed_model_id : undefined,
      observedModel: typeof meta.observed_model === 'string' ? meta.observed_model : undefined,
      routeFingerprint: typeof meta.route_fingerprint === 'string' ? meta.route_fingerprint : undefined,
      upstreamRetryReasons: Array.isArray(meta.upstream_retry_reasons)
        ? meta.upstream_retry_reasons.filter((item): item is string => typeof item === 'string').slice(0, 8)
        : [],
      upstreamAttempts: typeof meta.upstream_attempts === 'number'
        ? Math.max(1, Math.floor(meta.upstream_attempts))
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

/** Gemini Gateway adapter performs two fresh generations for each planned batch:
 * a full-context draft and an independent full-context review that returns the
 * final canonical translation. */
export function createGeminiGatewayTranslationAdapter(serverUrl?: string, options: GeminiGatewayTranslationOptions = {}): TranslationAdapter {
  const baseUrl = normalizeBaseUrl(serverUrl)
  const auditRecords: GatewayAuditRecord[] = []
  const draftDir = options.draftDir || (options.auditPath ? dirname(options.auditPath) : undefined)
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
      const sourceDigest = calculateGatewaySourceDigest(batch.input)
      const draftIdentity = `gemini-gateway:${GEMINI_GATEWAY_MODEL}:${GEMINI_GATEWAY_PROMPT_VERSION}:${batch.input.targetLocale}:${expectedIds.length}`

      let canonicalDraft: string | undefined
      let draftTruncated = false

      if (draftDir) {
        const existing = await readGatewayDraft(draftDir, draftIdentity, sourceDigest)
        if (existing) {
          logInfo(`[GeminiGateway] request=1/2 stage=restore-translate status=resumed-from-draft sha256=${existing.rawSha256.slice(0, 8)} cues=${expectedIds.length}`)
          auditRecords.push({
            stage: 'restore-translate',
            startedAtUtc: new Date().toISOString(),
            endedAtUtc: new Date().toISOString(),
            expectedIds,
            outcome: 'complete',
            response: {
              id: 'resumed-from-draft',
              raw: existing.raw,
              sha256: existing.rawSha256,
              finishReason: 'stop',
              truncated: false,
              upstreamAttempts: 0,
              upstreamRetryReasons: []
            }
          })
          await writeGatewayAudit(options.auditPath, auditRecords).catch(() => {})
          canonicalDraft = canonicalizeCompactTranslation(existing.raw, expectedIds.length)
        }
      }

      if (!canonicalDraft) {
        logInfo(`[GeminiGateway] request=1/2 stage=restore-translate cues=${expectedIds.length} model=${GEMINI_GATEWAY_MODEL}`)
        const draft = await runStage('restore-translate', batch, buildGatewayDraftMessages(batch), signal)
        logInfo(`[GeminiGateway] request=1/2 outcome=complete upstreamAttempts=${draft.upstreamAttempts} retryReasons=${draft.upstreamRetryReasons.join(',') || 'none'}`)
        canonicalDraft = canonicalizeCompactTranslation(draft.raw, expectedIds.length)
        draftTruncated = draft.truncated
        const parsedDraft = parseTranslationResponse(canonicalDraft, 'json-items', expectedIds, draft.truncated, contextIds)
        if (!parsedDraft.complete) {
          throw Object.assign(new Error(`Lượt khôi phục và dịch không đúng contract: ${parsedDraft.issues[0]?.message || 'response không hoàn chỉnh'}`), {
            providerCode: 'provider-protocol'
          })
        }

        if (draftDir) {
          await writeGatewayDraft(draftDir, {
            schemaVersion: 1,
            state: 'draft-validated',
            identity: draftIdentity,
            raw: draft.raw,
            rawSha256: createHash('sha256').update(draft.raw).digest('hex'),
            observedModelId: draft.observedModelId || 'e6fa609c3fa255c0',
            observedModel: draft.observedModel || '3.1 Pro',
            routeFingerprint: draft.routeFingerprint || 'route-fingerprint',
            sourceDigest,
            expectedIds,
            targetLocale: batch.input.targetLocale,
            savedAtUtc: new Date().toISOString()
          }).catch((err) => {
            logWarn(`[GeminiGateway] Không ghi được draft checkpoint: ${err instanceof Error ? err.message : String(err)}`)
          })
        }
      }

      const parsedDraftForReview = parseTranslationResponse(canonicalDraft, 'json-items', expectedIds, draftTruncated, contextIds)
      const reviewedDraft = JSON.stringify({ translations: Object.fromEntries(parsedDraftForReview.items.map((item) => [item.id, item.text])) })
      logInfo(`[GeminiGateway] request=2/2 stage=independent-review cues=${expectedIds.length} model=${GEMINI_GATEWAY_MODEL}`)
      const reviewed = await runStage('independent-review', batch, buildGatewayReviewMessages(batch, reviewedDraft), signal)
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
      provider_ready?: unknown
      provider_error?: unknown
      schema_mode?: unknown
      model_selection?: unknown
      gateway_contract_version?: unknown
    }>(response, undefined, 256 * 1024)
    if (data.provider_ready === false && data.provider_error === 'authentication_required') {
      return {
        ok: false,
        message: 'Cookie Gemini của gateway đã hết hạn hoặc không hợp lệ. Hãy cập nhật GEMINI_1PSID và GEMINI_1PSIDTS rồi khởi động lại gateway.'
      }
    }
    if (data.gateway_contract_version !== 2) {
      return { ok: false, message: 'Gemini Gateway chưa hỗ trợ hợp đồng phiên bản 2. Hãy cập nhật gateway.' }
    }
    const ids = Array.isArray(data.models) ? data.models.filter((item): item is string => typeof item === 'string') : []
    if (!ids.includes(GEMINI_GATEWAY_MODEL)) {
      return { ok: false, message: `Gateway chưa cung cấp ${GEMINI_GATEWAY_MODEL} (Gemini 3.1 Pro).` }
    }
    if (data.model_selection !== 'exact' && data.model_selection !== 'observed-id-required') {
      return { ok: false, message: 'Gateway chưa bật chọn model chính xác hoặc observed-id-required.' }
    }
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
