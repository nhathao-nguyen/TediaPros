import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ackGatewayOperation,
  cancelGatewayOperation,
  generateClientRequestId,
  generateOperationToken,
  GatewayOperationDeferredError,
  getGatewayOperation,
  getGatewaySchedulerStatus,
  pollGatewayOperation,
  resetGatewayScheduler,
  submitGatewayOperation,
  type GatewayOperationRuntime
} from './geminiGatewayOperations'
import type { GatewayOperationReceipt } from '../shared/gatewayOperation'
import type { ProviderWaitStage } from '../shared/autoShortBatchJournal'
import type { DichKeyStatus, GatewayVerificationStatus } from '../shared/types'
import { DEFAULT_GEMINI_GATEWAY_URL, GEMINI_GATEWAY_MODEL } from '../shared/types'
import type { TranslationAssessment, TranslationInput } from '../shared/translation'
import type { PlannedTranslationBatch } from './translation/planner'
import type { TranslationAdapter } from './translation/orchestrator'
import { buildTranslationBatchMessages, buildRephraseMessages, modelMessageText, type ModelMessage } from './translation/prompts'
import { parseCueLinesV1Response, parseTranslationResponse } from './translation/response'
import { readBoundedAiResponseJson, readBoundedAiResponseText } from './aiResponseBody'
import { translateFileWithAdapter, type TranslationFileRunnerOptions } from './translation/fileRunner'
import { logInfo, logWarn } from './logger'
import { isSentenceTerminal } from './semanticGrouping'
import { assertExactKeys, parseAiJsonObject } from '../shared/aiOutput'
import {
  GEMINI_GATEWAY_PROMPT_VERSION,
  buildGatewayDraftMessages,
  buildGatewayReviewMessages,
  type GatewayOutputMode,
  type GatewayPromptContext
} from './geminiGatewayPrompts'
import type { VoicePromptHint } from './dubbing/voiceMeasurements'
import { resolveGatewayCapacity, type GatewayCapacity } from './translation/capabilitySnapshot'
import { checkRequestBudget, type GatewayRequestBudgetResult } from './translation/requestBudget'
import { buildSourceSpeechUnitPlan } from './translation/speechUnitPlanner'
import type { SpeechUnitPlan } from '../shared/speechUnitPlan'
import {
  calculateGatewaySourceDigest,
  GATEWAY_DRAFT_PARSER_VERSION,
  readGatewayDraft,
  readGatewayReview,
  writeGatewayDraft,
  writeGatewayReview
} from './geminiGatewayDraftCheckpoint'

export { GEMINI_GATEWAY_PROMPT_VERSION } from './geminiGatewayPrompts'

const MAX_AUDIT_BYTES = 16 * 1024 * 1024
/** Client-side safety bound for a JSON request; it still accommodates a 1M-token source ledger. */
const MAX_GATEWAY_REQUEST_BYTES = 32 * 1024 * 1024
/** Reserve provider/system tokens while the Gateway does not expose a qualified tokenizer RPC. */
const GATEWAY_TOKEN_SAFETY_RESERVE = 4_096
const GATEWAY_ESTIMATED_BYTES_PER_TOKEN = 3
export const GATEWAY_STAGE_TIMEOUT_MS = 360_000
const GATEWAY_CAPABILITIES_TIMEOUT_MS = 15_000

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

export interface GatewayCompletion {
  raw: string
  truncated: boolean
  modelIdentity: string
  upstreamAttempts: number
  upstreamRetryReasons: string[]
  responseId?: string
  finishReason: string
  requestBody: Record<string, unknown>
  logicalRequestId?: string
  observedModelId: string
  observedModel?: string
  routeFingerprint: string
  completionState: 'complete'
  completionEvidence: string
  normalizationOps?: string[]
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

function canonicalizeGatewayTranslation(
  raw: string,
  expectedIds: readonly string[],
  outputMode: GatewayOutputMode
): string {
  if (outputMode === 'json-items') return canonicalizeCompactTranslation(raw, expectedIds.length)
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('{')) {
    // Cue-line drafts are checkpointed as the same compact JSON envelope used
    // by the draft validator. This fallback makes a resumed checkpoint safe
    // without weakening the live wire contract (which remains cue-lines-v1).
    return canonicalizeCompactTranslation(raw, expectedIds.length)
  }
  const parsed = parseCueLinesV1Response(raw, expectedIds, false)
  if (!parsed.complete) {
    throw Object.assign(new Error(`Lượt Gateway không đúng contract cue-lines-v1: ${parsed.issues[0]?.message || 'response không hoàn chỉnh'}`), {
      providerCode: 'provider-protocol'
    })
  }
  return JSON.stringify({ items: parsed.items })
}


interface GatewayAuditRecord {
  stage: 'restore-translate' | 'independent-review'
  outputMode?: GatewayOutputMode
  startedAtUtc: string
  endedAtUtc: string
  expectedIds: string[]
  outcome: 'complete' | 'failed'
  logicalRequestId?: string
  inputHash?: string
  inputBytes?: number
  inputTokenEstimate?: number
  inputTokenProvenance?: 'utf8-byte-estimate'
  outputTokenReserve?: number
  requestBudget?: GatewayRequestBudgetResult
  contextTokens?: number
  outputTokens?: number
  contextLimitKind?: GatewayCapacity['limitKind']
  capacityProvenance?: GatewayCapacity['provenance']
  requestedModel?: string
  observedModelId?: string
  observedModel?: string
  routeFingerprint?: string
  completionState?: string
  completionEvidence?: string
  normalizationOps?: string[]
  upstreamAttempts?: number
  upstreamRetryReasons?: string[]
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

function sanitizeGatewayError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw)
  return text
    .replace(/https?:\/\/[^\s?]+(?:\?[^\s]+)?/gi, (url) => {
      try {
        const u = new URL(url)
        return `${u.protocol}//${u.host}${u.pathname}`
      } catch {
        return '[redacted-url]'
      }
    })
    .replace(/((?:key|token|cookie|psid|secret)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/([A-Fa-f0-9]{32,64})/g, (m) => (m.length > 32 ? `${m.slice(0, 8)}...` : m))
    .slice(0, 500)
}

export interface GeminiGatewayTranslationOptions {
  /** Fixed path inside the current AutoShort item scope. Never sent upstream. */
  auditPath?: string
  /** Directory inside current AutoShort item scope where draft is saved/resumed. Defaults to dirname(auditPath) if provided. */
  draftDir?: string
  /**
   * Output grammar for the two translation/review stages. JSON remains the
   * default. `cue-lines-v1` is an explicit opt-in: the Gateway must echo the
   * contract in v2 metadata before its plain-text response is accepted.
   */
  outputMode?: GatewayOutputMode
  /** Frozen advisory aggregate; never include raw text/audio/path in this option. */
  voiceHint?: VoicePromptHint
  /** Optional per-run output reservation override for bounded live probes. */
  outputTokens?: number
  /** Deterministic test override; each draft/review HTTP request gets a fresh deadline. */
  stageTimeoutMs?: number
  /** Live-evaluation fallback that returns the validated draft without a second provider generation. */
  reviewMode?: 'two-pass' | 'draft-only'
  /** AutoShort releases its item resources and lets the queue wake this exact operation. */
  deferOnProviderWait?: boolean
  /** Receives the exact validated scheduler receipt; no synthetic operation IDs are emitted. */
  onOperationProgress?: (receipt: GatewayOperationReceipt, stage: 'restore-translate' | 'independent-review') => void
  /** Controlled clock used by offline scheduler integration tests. */
  operationRuntime?: GatewayOperationRuntime
}

function createGatewayDeadline(parent: AbortSignal, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const onParentAbort = (): void => controller.abort(parent.reason)
  if (parent.aborted) onParentAbort()
  else parent.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Gemini Gateway request timed out.', 'TimeoutError'))
  }, Math.max(1, Math.ceil(timeoutMs)))
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent.removeEventListener('abort', onParentAbort)
    }
  }
}

function normalizeBaseUrl(value?: string): string {
  const raw = (value || DEFAULT_GEMINI_GATEWAY_URL).trim().replace(/\/+$/u, '')
  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Địa chỉ Gemini Gateway không hợp lệ.')
  }
  return raw
}

function isGatewayRouteFingerprint(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/iu.test(value)
}

/** Capabilities is a zero-generation preflight. It supplies the current
 * account-scoped route identity used to decide whether a saved draft is safe. */
export interface GatewayServerCapabilitiesInfo {
  routeFingerprint: string
  schedulerSupported: boolean
  /** Advertised limit for the complete scheduler POST body. Undefined means
   * an older text-only gateway; media restoration must fail closed. */
  maxRequestBodyBytes?: number
}

export async function readGatewayCapabilitiesInfo(baseUrl: string, signal: AbortSignal): Promise<GatewayServerCapabilitiesInfo> {
  const response = await fetch(`${baseUrl}/gateway/capabilities`, { signal })
  if (!response.ok) {
    const detail = await readBoundedAiResponseText(response, signal, 64 * 1024).catch(() => '')
    throw providerError(response.status, detail)
  }
  const data = await readBoundedAiResponseJson<{
    gateway_contract_version?: unknown
    provider_ready?: unknown
    provider_error?: unknown
    models?: unknown
    gateway_model_routes?: Record<string, { route_fingerprint?: unknown }> | unknown
    scheduler_contract_version?: unknown
    request_jobs?: unknown
    max_request_body_bytes?: unknown
  }>(response, signal, 256 * 1024)
  if (data.provider_ready === false) {
    const message = data.provider_error === 'authentication_required'
      ? 'Cookie Gemini của gateway đã hết hạn hoặc không hợp lệ. Hãy cập nhật cookie rồi khởi động lại gateway.'
      : 'Gemini Gateway chưa sẵn sàng để xác minh route model.'
    throw Object.assign(new Error(message), {
      providerCode: data.provider_error === 'authentication_required' ? 'provider-auth' : 'provider-protocol'
    })
  }
  if (data.gateway_contract_version !== 2) {
    throw Object.assign(new Error('Gemini Gateway không trả về hợp đồng phiên bản 2 khi kiểm tra route model.'), { providerCode: 'provider-protocol' })
  }
  const models = Array.isArray(data.models) ? data.models.filter((item): item is string => typeof item === 'string') : []
  if (!models.includes(GEMINI_GATEWAY_MODEL)) {
    throw Object.assign(new Error(`Gateway chưa cung cấp ${GEMINI_GATEWAY_MODEL} (Gemini 3.1 Pro).`), { providerCode: 'provider-protocol' })
  }
  const routes = data.gateway_model_routes
  const route = routes && typeof routes === 'object' && !Array.isArray(routes)
    ? (routes as Record<string, { route_fingerprint?: unknown }>)[GEMINI_GATEWAY_MODEL]
    : undefined
  if (!route || !isGatewayRouteFingerprint(route.route_fingerprint)) {
    throw Object.assign(new Error('Gemini Gateway không cung cấp route_fingerprint hợp lệ để khôi phục draft an toàn.'), { providerCode: 'provider-protocol' })
  }
  const schedulerSupported = data.scheduler_contract_version === 1 && data.request_jobs === true
  const maxRequestBodyBytes = typeof data.max_request_body_bytes === 'number' && Number.isSafeInteger(data.max_request_body_bytes) && data.max_request_body_bytes > 0
    ? data.max_request_body_bytes
    : undefined
  return {
    routeFingerprint: route.route_fingerprint,
    schedulerSupported,
    ...(maxRequestBodyBytes ? { maxRequestBodyBytes } : {})
  }
}

async function readGatewayRouteFingerprint(baseUrl: string, signal: AbortSignal): Promise<string> {
  const info = await readGatewayCapabilitiesInfo(baseUrl, signal)
  return info.routeFingerprint
}

export function isProviderThrottledError(message?: string): boolean {
  if (!message) return false
  return /provider-throttled|405|429|too many requests|rate limit|quota|resource-exhausted|robot|method not allowed|anti-bot|chống bot|hạn chế tần suất|giới hạn tần suất/iu.test(message)
}

export function isPermanentGatewayError(message?: string): boolean {
  if (!message) return false
  if (isProviderThrottledError(message)) return false
  return /model-unavailable|model-mismatch|model-unverified|invalid-structured-json|invalid-json|ambiguous-json|duplicate-key|response-limit|upstream-incomplete|chưa hỗ trợ Gemini 3.1 Pro|không khớp|hết hạn hoặc không hợp lệ|hợp đồng phiên bản 2|observed_model_id|route_fingerprint|completion_evidence|trạng thái unverified|trạng thái mismatch|không tự retry/iu.test(message)
}

function providerError(status: number, detail: string): Error {
  let errorCode: string | undefined
  let errorMsg: string | undefined
  let upstreamAttempts: number | undefined
  try {
    const parsed = JSON.parse(detail)
    errorCode = parsed?.error?.code || parsed?.gateway_metadata?.error_code
    errorMsg = parsed?.error?.message
    if (typeof parsed?.gateway_metadata?.upstream_attempts === 'number') {
      upstreamAttempts = parsed.gateway_metadata.upstream_attempts
    }
  } catch {}

  const isThrottled = status === 429 || status === 405 ||
    isProviderThrottledError(`${errorMsg || ''} ${detail || ''}`)

  let message = detail || `Gemini Gateway báo lỗi HTTP ${status}.`
  let providerCode: 'provider-transient' | 'provider-auth' | 'provider-protocol' | 'provider-throttled' = 'provider-protocol'

  if (isThrottled) {
    const attemptText = upstreamAttempts ? `${upstreamAttempts} lượt thử` : '1 lượt thử'
    message = `Google Gemini Web tạm từ chối hoặc giới hạn tần suất (HTTP ${status === 200 || status >= 500 ? '405/429' : status} - chống bot/rate limit); đã gọi ${attemptText}. Hãy tạm dừng để tránh bị chặn IP.`
    providerCode = 'provider-throttled'
  } else if (errorCode === 'model-unavailable') {
    message = 'Tài khoản Google của gateway chưa hỗ trợ Gemini 3.1 Pro (cần gói Google One AI Premium hoặc Gemini Advanced).'
    providerCode = 'provider-protocol'
  } else if (errorCode === 'model-mismatch') {
    message = `Gemini Gateway trả về model không khớp: ${errorMsg || detail}`
    providerCode = 'provider-protocol'
  } else if (errorCode === 'invalid-structured-json' || errorCode === 'invalid-json' || errorCode === 'ambiguous-json' || errorCode === 'duplicate-key') {
    message = `Gemini Gateway không thể chuẩn hóa JSON có cấu trúc: ${errorMsg || detail}`
    providerCode = 'provider-protocol'
  } else if (errorCode === 'model-unverified') {
    message = `Gemini Gateway không xác thực được model Gemini 3.1 Pro: ${errorMsg || detail}`
    providerCode = 'provider-protocol'
  } else if (errorCode === 'upstream-incomplete' || errorCode === 'response-limit') {
    message = `Gemini Gateway phản hồi chưa hoàn tất từ upstream: ${errorMsg || detail}`
    providerCode = 'provider-protocol'
  } else if (errorCode && [
    'upstream-http-5xx', 'gemini-transient-message', 'upstream-generation-error',
    'upstream-parse-error', 'upstream-timeout', 'invalid-payload', 'invalid-json',
    'ambiguous-json', 'duplicate-key', 'wrong-root'
  ].includes(errorCode)) {
    const attemptText = upstreamAttempts ? `${upstreamAttempts} lượt thử` : '1 lượt thử'
    message = `Gemini Gateway báo lỗi upstream (${errorCode}, ${attemptText}): ${errorMsg || detail || 'không có chi tiết'}. Hãy thử lại thủ công để mở một lượt gateway mới.`
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
    errorCode,
    upstreamAttempts
  })
}

export function createGatewayRequestBody(
  messages: readonly ModelMessage[],
  maxOutputTokens: number,
  structuredJson = true,
  outputMode: GatewayOutputMode = 'json-items',
  responseFormat?: Record<string, unknown>
): Record<string, unknown> {
  const useStructuredJson = structuredJson && outputMode === 'json-items'
  const selectedResponseFormat = responseFormat || (useStructuredJson ? TRANSLATION_RESPONSE_FORMAT : undefined)
  return {
    model: GEMINI_GATEWAY_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: maxOutputTokens,
    temporary: true,
    gateway_requirements: {
      contract_version: 2,
      // Google may serve a different text model than the catalog route. The
      // user-selected policy accepts that fallback; completion and structured
      // output evidence remain mandatory.
      require_verified_model: false,
      require_complete_response: true,
      ...(outputMode === 'cue-lines-v1' ? { text_output_contract: 'cue-lines-v1' } : {})
    },
    ...(selectedResponseFormat ? { response_format: selectedResponseFormat } : {})
  }
}

interface GatewayRequestPreflight {
  requestBody: Record<string, unknown>
  inputBytes: number
  inputTokenEstimate: number
  outputTokenReserve: number
  requestBudget: GatewayRequestBudgetResult
}

/**
 * This is deliberately a labelled estimate, not a claim that UTF-8 bytes are
 * an exact tokenizer. Near a 1M boundary without a qualified counter we fail
 * before dispatch rather than asserting false precision in audit data.
 */
function preflightGatewayRequest(
  messages: readonly ModelMessage[],
  maxOutputTokens: number,
  capacity: GatewayCapacity,
  structuredJson = true,
  outputMode: GatewayOutputMode = 'json-items'
): GatewayRequestPreflight {
  const requestBody = createGatewayRequestBody(messages, maxOutputTokens, structuredJson, outputMode)
  const inputBytes = Buffer.byteLength(JSON.stringify(requestBody), 'utf8')
  const inputTokenEstimate = Math.ceil(inputBytes / GATEWAY_ESTIMATED_BYTES_PER_TOKEN)
  const requestBudget = checkRequestBudget(capacity, {
    inputTokens: inputTokenEstimate,
    outputReserve: maxOutputTokens,
    safetyReserve: GATEWAY_TOKEN_SAFETY_RESERVE,
    requestBytes: inputBytes,
    requestByteLimit: MAX_GATEWAY_REQUEST_BYTES
  })
  if (requestBudget !== 'fit') {
    const detail = requestBudget === 'input-limit'
      ? 'Ước lượng token chưa được Gateway xác nhận chạm giới hạn context; cần token counter đủ điều kiện hoặc chia source theo scene, không tự cắt ledger.'
      : requestBudget === 'output-limit'
        ? 'Ngân sách output của request vượt output limit Gateway.'
        : requestBudget === 'byte-limit'
          ? 'Payload JSON vượt byte limit client trước khi gửi Gateway.'
          : 'Số liệu preflight Gateway không hợp lệ.'
    throw Object.assign(new Error(`Gateway preflight failed (${requestBudget}): ${detail}`), { providerCode: 'provider-protocol' })
  }
  return { requestBody, inputBytes, inputTokenEstimate, outputTokenReserve: maxOutputTokens, requestBudget }
}

export interface GeminiGatewaySchedulerConfig {
  spacingMs: number
  throttleCooldownMs: number
}

const isTestEnv = typeof process !== 'undefined' && Boolean(
  process.env.NODE_TEST_CONTEXT !== undefined ||
  process.env.npm_lifecycle_event?.includes('test') ||
  process.argv?.some((arg) => arg.includes('test'))
)

let gatewaySchedulerConfig: GeminiGatewaySchedulerConfig = {
  spacingMs: isTestEnv ? 0 : 3_000,
  throttleCooldownMs: isTestEnv ? 10 : 45_000
}

export function configureGeminiGatewayScheduler(config: Partial<GeminiGatewaySchedulerConfig>): void {
  gatewaySchedulerConfig = { ...gatewaySchedulerConfig, ...config }
}

let lastGatewayRequestFinishedAt = 0

async function enforceGatewaySpacing(signal: AbortSignal): Promise<void> {
  const spacing = gatewaySchedulerConfig.spacingMs
  if (spacing <= 0) return
  const now = Date.now()
  const wait = spacing - (now - lastGatewayRequestFinishedAt)
  if (wait > 0) {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error('Đã hủy tác vụ.'))
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, wait)
      const onAbort = () => {
        clearTimeout(timer)
        reject(new Error('Đã hủy tác vụ.'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }
}

async function waitForGatewayCooldown(ms: number, signal: AbortSignal, reason: string): Promise<void> {
  logWarn(`[GeminiGateway] ${reason}. Tạm dừng ${Math.round(ms / 1000)}s chờ Google phục hồi...`)
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Đã hủy tác vụ.'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Đã hủy tác vụ.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function parseGatewayCompletionData(
  data: any,
  requestBody: Record<string, unknown>,
  outputMode: GatewayOutputMode
): GatewayCompletion {
  if (!data || typeof data !== 'object') {
    throw Object.assign(new Error('Gemini Gateway không trả về payload hợp lệ.'), { providerCode: 'provider-protocol' })
  }
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
  if (!meta || meta.gateway_contract_version !== 2) {
    throw Object.assign(new Error('Gemini Gateway không trả về hợp đồng phiên bản 2 (gateway_metadata.gateway_contract_version: 2). Hãy kiểm tra phiên bản gateway và TediaPros.'), { providerCode: 'provider-protocol' })
  }
  if (!['matched', 'mismatch', 'unverified'].includes(String(meta.model_verification))) {
    throw Object.assign(new Error(`Gemini Gateway trả về trạng thái model không hợp lệ: ${meta.model_verification}.`), { providerCode: 'provider-protocol' })
  }
  if (!meta.observed_model_id || typeof meta.observed_model_id !== 'string') {
    throw Object.assign(new Error('Gemini Gateway không cung cấp observed_model_id hợp lệ.'), { providerCode: 'provider-protocol' })
  }
  if (meta.completion_state !== 'complete') {
    throw Object.assign(new Error(`Gemini Gateway phản hồi chưa hoàn tất (completion_state: ${meta.completion_state}).`), { providerCode: 'provider-protocol' })
  }
  if (outputMode === 'cue-lines-v1' && meta.text_output_contract !== 'cue-lines-v1') {
    throw Object.assign(new Error('Gemini Gateway không xác nhận text_output_contract=cue-lines-v1 trong metadata; không chấp nhận plain-text response khi chưa negotiated.'), { providerCode: 'provider-protocol' })
  }
  if (!isGatewayRouteFingerprint(meta.route_fingerprint)) {
    throw Object.assign(new Error('Gemini Gateway không cung cấp route_fingerprint hợp lệ.'), { providerCode: 'provider-protocol' })
  }
  if (typeof meta.completion_evidence !== 'string' || !meta.completion_evidence.trim()) {
    throw Object.assign(new Error('Gemini Gateway không cung cấp completion_evidence hợp lệ.'), { providerCode: 'provider-protocol' })
  }
  if (typeof meta.upstream_attempts !== 'number' || !Number.isInteger(meta.upstream_attempts) || meta.upstream_attempts < 1 || meta.upstream_attempts > 3) {
    throw Object.assign(new Error('Gemini Gateway cung cấp upstream_attempts ngoài giới hạn 1..3.'), { providerCode: 'provider-protocol' })
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
    logicalRequestId: typeof meta.logical_request_id === 'string' ? meta.logical_request_id : undefined,
    observedModelId: meta.observed_model_id,
    observedModel: typeof meta.observed_model === 'string' ? meta.observed_model : undefined,
    routeFingerprint: meta.route_fingerprint,
    completionState: 'complete',
    completionEvidence: meta.completion_evidence,
    normalizationOps: Array.isArray(meta.normalization)
      ? meta.normalization.filter((item: unknown): item is string => typeof item === 'string')
      : [],
    upstreamRetryReasons: Array.isArray(meta.upstream_retry_reasons)
      ? meta.upstream_retry_reasons.filter((item: unknown): item is string => typeof item === 'string').slice(0, 8)
      : [],
    upstreamAttempts: meta.upstream_attempts
  }
}

async function requestGatewayLegacy(
  baseUrl: string,
  messages: readonly ModelMessage[],
  signal: AbortSignal,
  maxOutputTokens: number,
  structuredJson = true,
  outputMode: GatewayOutputMode = 'json-items'
): Promise<GatewayCompletion> {
  let response: Response | undefined
  const requestBody = createGatewayRequestBody(messages, maxOutputTokens, structuredJson, outputMode)
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      await enforceGatewaySpacing(signal)
      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal
        })
        if (!response.ok) {
          const detail = await readBoundedAiResponseText(response, signal, 64 * 1024).catch(() => '')
          const error = providerError(response.status, detail)
          if (attempt === 1 && (error as { providerCode?: string }).providerCode === 'provider-throttled' && !signal.aborted) {
            await waitForGatewayCooldown(gatewaySchedulerConfig.throttleCooldownMs, signal, error.message)
            continue
          }
          throw error
        }
        break
      } finally {
        lastGatewayRequestFinishedAt = Date.now()
      }
    }
    if (!response || !response.ok) {
      throw Object.assign(new Error('Gemini Gateway không trả về phản hồi hợp lệ.'), { providerCode: 'provider-protocol' })
    }
    const data = await readBoundedAiResponseJson<Record<string, unknown>>(response, signal, 1024 * 1024)
    return parseGatewayCompletionData(data, requestBody, outputMode)
  } catch (error) {
    if (signal.aborted) {
      throw Object.assign(new Error(signal.reason instanceof Error ? signal.reason.message : 'Đã hủy dịch qua Gemini Gateway.'), {
        providerCode: signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'provider-transient' : 'cancelled'
      })
    }
    if (error instanceof TypeError && /fetch failed|failed to fetch/iu.test(error.message)) {
      throw Object.assign(new Error('Không thể kết nối Gemini Gateway; không tự retry để tránh nhân request. Hãy thử lại thủ công.', { cause: error }), { providerCode: 'provider-transient' })
    }
    throw error
  } finally {
    if (response?.body && !response.bodyUsed && !response.body.locked) await response.body.cancel().catch(() => {})
  }
}

export interface GatewayOperationContext {
  draftDir?: string
  stage: ProviderWaitStage
  httpTimeoutMs?: number
  runtime?: GatewayOperationRuntime
  deferOnWaitingProvider?: boolean
  onProgress?: (receipt: GatewayOperationReceipt) => void
  /** The server's advertised POST limit. Checked against the exact scheduler
   * envelope before any operation is submitted. */
  maxRequestBodyBytes?: number
  /** Optional exact JSON contract appended and normalized by Gateway. */
  responseFormat?: Record<string, unknown>
}

export interface GatewayOperationExecutionResult {
  completion: GatewayCompletion
  ack: () => Promise<void>
}

interface GatewayOperationLease {
  schemaVersion: 1
  clientRequestId: string
  operationToken: string
  payloadSha256: string
  operationId?: string
  stage: string
  startedAtUtc: string
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

function parseGatewayOperationLease(raw: string, payloadSha256: string, stage: string): GatewayOperationLease | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const lease = value as Partial<GatewayOperationLease>
  if (!lease || lease.schemaVersion !== 1 || typeof lease.clientRequestId !== 'string' || !lease.clientRequestId.trim() ||
      typeof lease.operationToken !== 'string' || !lease.operationToken.trim() || typeof lease.payloadSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(lease.payloadSha256) || lease.payloadSha256 !== payloadSha256 || lease.stage !== stage ||
      typeof lease.startedAtUtc !== 'string' || !Number.isFinite(Date.parse(lease.startedAtUtc)) ||
      (lease.operationId !== undefined && (typeof lease.operationId !== 'string' || !lease.operationId.trim()))) {
    return null
  }
  return lease as GatewayOperationLease
}

function recoveredStoreBlockedReceipt(error: unknown): GatewayOperationReceipt | null {
  if (!error || typeof error !== 'object') return null
  const receipt = (error as { receipt?: GatewayOperationReceipt }).receipt
  if (!receipt || receipt.status !== 'blocked' || receipt.dispatchState !== 'not-dispatched' || receipt.upstreamAttempts !== 0) return null
  return receipt.errorCode === 'recovered-from-store' || receipt.error?.includes('recovered-from-store')
    ? receipt
    : null
}

async function recoverStoredGovernorBlock(baseUrl: string, signal: AbortSignal): Promise<boolean> {
  const scheduler = await getGatewaySchedulerStatus(baseUrl, signal)
  if (scheduler.state === 'blocked') {
    if (scheduler.reason !== 'recovered-from-store' || scheduler.activePermits !== 0) return false
    logWarn('[GeminiGateway] Governor khôi phục từ snapshot khóa cũ; đang reset trước khi tạo operation mới…')
    if (!await resetGatewayScheduler(baseUrl, signal)) return false
    const verified = await getGatewaySchedulerStatus(baseUrl, signal)
    return verified.state === 'ready' && verified.activePermits === 0
  }
  return true
}

export async function requestGatewayOperation(
  baseUrl: string,
  messages: readonly ModelMessage[],
  signal: AbortSignal,
  maxOutputTokens: number,
  structuredJson = true,
  outputMode: GatewayOutputMode = 'json-items',
  context?: GatewayOperationContext
): Promise<GatewayOperationExecutionResult> {
  const requestBody = createGatewayRequestBody(messages, maxOutputTokens, structuredJson, outputMode, context?.responseFormat)
  const payloadSha256 = createHash('sha256').update(JSON.stringify(requestBody)).digest('hex')
  const createLease = (): GatewayOperationLease => ({
    schemaVersion: 1,
    clientRequestId: generateClientRequestId(),
    operationToken: generateOperationToken(),
    payloadSha256,
    stage: context?.stage || 'unknown',
    startedAtUtc: new Date().toISOString()
  })
  let lease = createLease()
  let leasePath: string | undefined

  if (context?.maxRequestBodyBytes !== undefined) {
    if (!Number.isSafeInteger(context.maxRequestBodyBytes) || context.maxRequestBodyBytes <= 0) {
      throw Object.assign(new Error('Gateway không công bố max_request_body_bytes hợp lệ cho media restoration.'), { providerCode: 'provider-protocol' })
    }
    // submitGatewayOperation serializes exactly this envelope. Check before
    // creating a durable operation lease so a body that was never dispatched
    // cannot block a later, smaller retry with a mismatched payload hash.
    const envelopeBytes = Buffer.byteLength(JSON.stringify({ client_request_id: lease.clientRequestId, request: requestBody }), 'utf8')
    if (envelopeBytes > context.maxRequestBodyBytes) {
      throw Object.assign(new Error(`Gateway media payload vượt max_request_body_bytes (${envelopeBytes} > ${context.maxRequestBodyBytes}); không gửi request.`), {
        providerCode: 'provider-protocol', requestBytes: envelopeBytes, requestByteLimit: context.maxRequestBodyBytes
      })
    }
  }

  if (context?.draftDir) {
    leasePath = join(context.draftDir, `${context.stage}-operation.json`)
    try {
      const rawLease = await readFile(leasePath, 'utf8')
      const parsed = parseGatewayOperationLease(rawLease, payloadSha256, context.stage)
      if (parsed) {
        lease = parsed
      } else {
        try {
          const old = JSON.parse(rawLease) as Partial<GatewayOperationLease>
          if (typeof old?.operationId === 'string' && old.operationId.trim() && typeof old?.operationToken === 'string' && old.operationToken.trim() &&
              typeof old.clientRequestId === 'string' && old.clientRequestId.trim()) {
            const { receipt } = await getGatewayOperation({
              baseUrl,
              operationId: old.operationId,
              operationToken: old.operationToken,
              expectedClientRequestId: old.clientRequestId,
              signal,
              httpTimeoutMs: Math.min(context.httpTimeoutMs ?? 10_000, 10_000)
            })
            const safelyCancellablePending = (receipt.status === 'queued' || receipt.status === 'waiting-provider') &&
              receipt.dispatchState === 'not-dispatched' && receipt.upstreamAttempts === 0
            if (safelyCancellablePending) {
              await cancelGatewayOperation(baseUrl, receipt.id, old.operationToken, {
                timeoutMs: Math.min(context.httpTimeoutMs ?? 10_000, 10_000),
                expectedClientRequestId: old.clientRequestId
              })
            } else if (['queued', 'waiting-provider', 'running', 'cancelling', 'outcome-unknown'].includes(receipt.status)) {
              const deferred = new GatewayOperationDeferredError(receipt)
              Object.assign(deferred, {
                stage: context.stage,
                cancelOperation: async () => {
                  await cancelGatewayOperation(baseUrl, receipt.id, old.operationToken!, {
                    timeoutMs: Math.min(context.httpTimeoutMs ?? 10_000, 10_000),
                    expectedClientRequestId: old.clientRequestId
                  })
                }
              })
              throw deferred
            } else {
              await ackGatewayOperation(baseUrl, receipt.id, old.operationToken, Math.min(context.httpTimeoutMs ?? 10_000, 10_000)).catch(() => {})
            }
          }
        } catch (error) {
          if (error instanceof GatewayOperationDeferredError) throw error
          const status = (error as { status?: number })?.status
          if (status !== 404) throw error
        }
        logWarn(`[GeminiGateway] Lease cũ tại ${leasePath} không khớp payload/stage (stage=${context.stage}); tạo lease mới cho generation hiện tại.`)
        await writeDurableJson(leasePath, lease)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      await writeDurableJson(leasePath, lease)
    }
  }

  let operationId = lease.operationId
  let recoveredStoreBlock = false
  while (true) {
    try {
      if (!operationId) {
        const receipt = await submitGatewayOperation({
          baseUrl,
          clientRequestId: lease.clientRequestId,
          operationToken: lease.operationToken,
          requestPayload: requestBody,
          signal,
          httpTimeoutMs: context?.httpTimeoutMs
        })
        operationId = receipt.id
        context?.onProgress?.(receipt)
        lease = { ...lease, operationId, startedAtUtc: receipt.createdAtUtc }
        if (leasePath) await writeDurableJson(leasePath, lease)
      }

      const rawResponse = await pollGatewayOperation({
        baseUrl,
        operationId,
        operationToken: lease.operationToken,
        signal,
        expectedClientRequestId: lease.clientRequestId,
        httpTimeoutMs: context?.httpTimeoutMs,
        runtime: context?.runtime,
        deferOnWaitingProvider: context?.deferOnWaitingProvider,
        onProgress: context?.onProgress
      })

      const completion = parseGatewayCompletionData(rawResponse, requestBody, outputMode)
      const ack = async (): Promise<void> => {
        await ackGatewayOperation(baseUrl, operationId!, lease.operationToken, context?.httpTimeoutMs)
        if (leasePath) await unlink(leasePath)
      }
      return { completion, ack }
    } catch (error) {
      const blockedReceipt = recoveredStoreBlockedReceipt(error)
      if (!recoveredStoreBlock && blockedReceipt && await recoverStoredGovernorBlock(baseUrl, signal)) {
        recoveredStoreBlock = true
        await ackGatewayOperation(baseUrl, blockedReceipt.id, lease.operationToken, context?.httpTimeoutMs).catch((ackError) => {
          logWarn(`[GeminiGateway] Không ACK được operation bị khóa ${blockedReceipt.id}: ${ackError instanceof Error ? ackError.message : String(ackError)}`)
        })
        lease = createLease()
        operationId = undefined
        if (leasePath) await writeDurableJson(leasePath, lease)
        continue
      }
      if (error instanceof GatewayOperationDeferredError) {
        Object.assign(error, {
          stage: context?.stage,
          cancelOperation: async () => {
            await cancelGatewayOperation(baseUrl, error.operationId, lease.operationToken, {
              timeoutMs: Math.min(context?.httpTimeoutMs ?? 10_000, 10_000),
              expectedClientRequestId: lease.clientRequestId
            })
          }
        })
        throw error
      }
      if (signal.aborted && operationId) {
        try {
          await cancelGatewayOperation(baseUrl, operationId, lease.operationToken, {
            timeoutMs: Math.min(context?.httpTimeoutMs ?? 10_000, 10_000),
            expectedClientRequestId: lease.clientRequestId
          })
        } catch (cancelError) {
          throw Object.assign(new Error(`Đã hủy tác vụ nhưng gateway không xác nhận cancel: ${cancelError instanceof Error ? cancelError.message : String(cancelError)}`, { cause: cancelError }), {
            providerCode: 'provider-protocol', operationId, stage: context?.stage
          })
        }
      }
      throw error
    }
  }
}

async function requestGateway(
  baseUrl: string,
  messages: readonly ModelMessage[],
  signal: AbortSignal,
  maxOutputTokens: number,
  structuredJson = true,
  outputMode: GatewayOutputMode = 'json-items'
): Promise<GatewayCompletion> {
  return requestGatewayLegacy(baseUrl, messages, signal, maxOutputTokens, structuredJson, outputMode)
}

function boundedAuditDocument(records: readonly GatewayAuditRecord[]): string {
  const counts: Record<string, number> = {}
  const pruned = records.map((record) => {
    counts[record.stage] = (counts[record.stage] || 0) + 1
    if (counts[record.stage] > 3 && record.response) {
      return {
        ...record,
        response: { ...record.response, raw: '[omitted: max 3 raw per stage exceeded]' }
      }
    }
    return record
  })

  const document = {
    schemaVersion: 1,
    promptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
    model: GEMINI_GATEWAY_MODEL,
    records: pruned
  }
  const full = JSON.stringify(document, null, 2)
  if (Buffer.byteLength(full, 'utf8') <= MAX_AUDIT_BYTES) return full
  return JSON.stringify({
    ...document,
    records: pruned.map((record) => ({
      ...record,
      request: record.request ? {
        omittedBecauseAuditExceededBytes: true,
        sha256: createHash('sha256').update(JSON.stringify(record.request)).digest('hex')
      } : undefined,
      response: record.response ? { ...record.response, raw: '[omitted: audit exceeded 16 MiB]' } : undefined
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
  const outputMode: GatewayOutputMode = options.outputMode || 'json-items'
  const reviewMode = options.reviewMode || 'two-pass'
  const gatewayCapacity = resolveGatewayCapacity()
  const outputTokensOverride = typeof options.outputTokens === 'number' && Number.isFinite(options.outputTokens) && options.outputTokens > 0
    ? Math.max(256, Math.min(16_384, Math.floor(options.outputTokens)))
    : undefined
  const effectiveOutputTokens = outputTokensOverride ?? gatewayCapacity.outputTokens
  const stageTimeoutMs = typeof options.stageTimeoutMs === 'number' && Number.isFinite(options.stageTimeoutMs) && options.stageTimeoutMs > 0
    ? options.stageTimeoutMs
    : GATEWAY_STAGE_TIMEOUT_MS
  const auditRecords: GatewayAuditRecord[] = []
  const draftDir = options.draftDir || (options.auditPath ? dirname(options.auditPath) : undefined)
  let cachedServerCapabilities: GatewayServerCapabilitiesInfo | undefined
  const speechUnitPlans = new Map<string, SpeechUnitPlan>()
  const promptContextFor = (sourceLedger: TranslationInput, sourceDigest: string): GatewayPromptContext => {
    if (sourceLedger.mode !== 'dubbing') return { sourceLedger }
    const lastSourceEnd = Math.max(...sourceLedger.cues.map((cue) => cue.end))
    const declaredDuration = sourceLedger.sourceVideoDuration
    if (declaredDuration !== undefined && declaredDuration < lastSourceEnd - 0.001) {
      throw Object.assign(new Error('Source video duration is shorter than the immutable source ledger.'), { providerCode: 'provider-protocol' })
    }
    const videoDuration = declaredDuration ?? lastSourceEnd + 0.12
    const cached = speechUnitPlans.get(sourceDigest)
    const speechUnitPlan = cached || buildSourceSpeechUnitPlan({ sourceDigest, videoDuration, cues: sourceLedger.cues })
    if (!cached) speechUnitPlans.set(sourceDigest, speechUnitPlan)
    return { sourceLedger, speechUnitPlan, voiceHint: options.voiceHint }
  }
  const runStage = async (
    stage: GatewayAuditRecord['stage'],
    batch: PlannedTranslationBatch,
    messages: readonly ModelMessage[],
    signal: AbortSignal
  ): Promise<{ completion: GatewayCompletion; ack?: () => Promise<void> }> => {
    const startedAtUtc = new Date().toISOString()
    const inputContent = messages.map((m) => modelMessageText(m.content)).join('\n')
    const inputHash = createHash('sha256').update(inputContent).digest('hex')
    const messageBytes = Buffer.byteLength(inputContent, 'utf8')
    let preflight: GatewayRequestPreflight | undefined
    try {
      preflight = preflightGatewayRequest(messages, batch.maxOutputTokens, gatewayCapacity, true, outputMode)
      const schedulerSupported = Boolean(cachedServerCapabilities?.schedulerSupported && draftDir)

      let completion: GatewayCompletion
      let ackFn: (() => Promise<void>) | undefined
      if (schedulerSupported) {
        const res = await requestGatewayOperation(
          baseUrl,
          messages,
          signal,
          batch.maxOutputTokens,
          true,
          outputMode,
          {
            draftDir,
            stage,
            httpTimeoutMs: stageTimeoutMs,
            runtime: options.operationRuntime,
            deferOnWaitingProvider: options.deferOnProviderWait,
            onProgress: (receipt) => options.onOperationProgress?.(receipt, stage)
          }
        )
        completion = res.completion
        ackFn = res.ack
      } else {
        const deadline = createGatewayDeadline(signal, stageTimeoutMs)
        try {
          completion = await requestGatewayLegacy(
            baseUrl,
            messages,
            deadline.signal,
            batch.maxOutputTokens,
            true,
            outputMode
          )
        } finally {
          deadline.dispose()
        }
      }
      auditRecords.push({
        stage,
        outputMode,
        startedAtUtc,
        endedAtUtc: new Date().toISOString(),
        expectedIds: batch.input.cues.map((cue) => cue.id),
        outcome: 'complete',
        logicalRequestId: completion.logicalRequestId,
        inputHash,
        inputBytes: preflight.inputBytes,
        inputTokenEstimate: preflight.inputTokenEstimate,
        inputTokenProvenance: 'utf8-byte-estimate',
        outputTokenReserve: preflight.outputTokenReserve,
        requestBudget: preflight.requestBudget,
        contextTokens: gatewayCapacity.contextTokens,
        outputTokens: gatewayCapacity.outputTokens,
        contextLimitKind: gatewayCapacity.limitKind,
        capacityProvenance: gatewayCapacity.provenance,
        requestedModel: GEMINI_GATEWAY_MODEL,
        observedModelId: completion.observedModelId,
        observedModel: completion.observedModel,
        routeFingerprint: completion.routeFingerprint,
        completionState: completion.completionState,
        completionEvidence: completion.completionEvidence,
        normalizationOps: completion.normalizationOps,
        upstreamAttempts: completion.upstreamAttempts,
        upstreamRetryReasons: completion.upstreamRetryReasons,
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
      return { completion, ...(ackFn ? { ack: ackFn } : {}) }
    } catch (error) {
      auditRecords.push({
        stage,
        outputMode,
        startedAtUtc,
        endedAtUtc: new Date().toISOString(),
        expectedIds: batch.input.cues.map((cue) => cue.id),
        outcome: 'failed',
        inputHash,
        inputBytes: preflight?.inputBytes ?? messageBytes,
        ...(preflight ? {
          inputTokenEstimate: preflight.inputTokenEstimate,
          inputTokenProvenance: 'utf8-byte-estimate' as const,
          outputTokenReserve: preflight.outputTokenReserve,
          requestBudget: preflight.requestBudget
        } : {}),
        contextTokens: gatewayCapacity.contextTokens,
        outputTokens: gatewayCapacity.outputTokens,
        contextLimitKind: gatewayCapacity.limitKind,
        capacityProvenance: gatewayCapacity.provenance,
        requestedModel: GEMINI_GATEWAY_MODEL,
        error: sanitizeGatewayError(error)
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
      contextTokens: gatewayCapacity.contextTokens,
      outputTokens: effectiveOutputTokens,
      wholeDocument: true,
      independentContentReview: reviewMode === 'two-pass',
      transportRetryOwner: 'gateway',
      requestTimeoutOwner: 'adapter',
      outputAware: true
    },
    async requestOnce(batch, signal, sourceLedger = batch.input) {
      const expectedIds = batch.input.cues.map((cue) => cue.id)
      const contextIds = [...batch.input.contextBefore, ...batch.input.contextAfter].map((cue) => cue.id)
      const sourceDigest = calculateGatewaySourceDigest(sourceLedger)
      const promptContext = promptContextFor(sourceLedger, sourceDigest)
      const draftIdentity = `gemini-gateway:${GEMINI_GATEWAY_MODEL}:${GEMINI_GATEWAY_PROMPT_VERSION}:${GATEWAY_DRAFT_PARSER_VERSION}:${outputMode}:${batch.input.targetLocale}:${expectedIds.length}`

      let canonicalDraft: string | undefined
      let draftTruncated = false

      if (draftDir) {
        const preflightStartedAtUtc = new Date().toISOString()
        try {
          const deadline = createGatewayDeadline(signal, GATEWAY_CAPABILITIES_TIMEOUT_MS)
          let routeFingerprint: string
          try {
            cachedServerCapabilities = await readGatewayCapabilitiesInfo(baseUrl, deadline.signal)
            routeFingerprint = cachedServerCapabilities.routeFingerprint
          } finally {
            deadline.dispose()
          }
          const existingReview = await readGatewayReview(draftDir, {
            identity: `${draftIdentity}:review`,
            sourceDigest,
            expectedIds,
            targetLocale: batch.input.targetLocale,
            promptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
            parserVersion: GATEWAY_DRAFT_PARSER_VERSION,
            routeFingerprint
          })
          if (existingReview) {
            logInfo(`[GeminiGateway] request=2/2 stage=independent-review status=resumed-from-review sha256=${existingReview.rawSha256.slice(0, 8)} cues=${expectedIds.length}`)
            auditRecords.push({
              stage: 'independent-review',
              outputMode,
              startedAtUtc: preflightStartedAtUtc,
              endedAtUtc: new Date().toISOString(),
              expectedIds,
              outcome: 'complete',
              observedModelId: existingReview.observedModelId,
              observedModel: existingReview.observedModel || undefined,
              routeFingerprint: existingReview.routeFingerprint,
              completionState: 'complete',
              completionEvidence: 'resumed-validated-review-v1',
              upstreamAttempts: 0,
              upstreamRetryReasons: [],
              response: {
                id: 'resumed-from-review',
                raw: existingReview.raw,
                sha256: existingReview.rawSha256,
                finishReason: 'stop',
                truncated: false,
                upstreamAttempts: 0,
                upstreamRetryReasons: []
              }
            })
            await writeGatewayAudit(options.auditPath, auditRecords).catch(() => {})
            return {
              raw: canonicalizeGatewayTranslation(existingReview.raw, expectedIds, outputMode),
              truncated: false,
              modelIdentity: existingReview.observedModelId
            }
          }
          const existing = await readGatewayDraft(draftDir, {
            identity: draftIdentity,
            sourceDigest,
            expectedIds,
            targetLocale: batch.input.targetLocale,
            draftPromptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
            reviewPromptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
            parserVersion: GATEWAY_DRAFT_PARSER_VERSION,
            routeFingerprint
          })
          if (existing) {
            logInfo(`[GeminiGateway] request=1/2 stage=restore-translate status=resumed-from-draft sha256=${existing.rawSha256.slice(0, 8)} cues=${expectedIds.length}`)
            auditRecords.push({
              stage: 'restore-translate',
              outputMode,
              startedAtUtc: preflightStartedAtUtc,
              endedAtUtc: new Date().toISOString(),
              expectedIds,
              outcome: 'complete',
              observedModelId: existing.observedModelId,
              observedModel: existing.observedModel || undefined,
              routeFingerprint: existing.routeFingerprint,
              completionState: 'complete',
              completionEvidence: 'resumed-validated-draft-v2',
              upstreamAttempts: 0,
              upstreamRetryReasons: [],
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
            canonicalDraft = canonicalizeGatewayTranslation(existing.raw, expectedIds, outputMode)
          }
        } catch (error) {
          auditRecords.push({
            stage: 'restore-translate',
            startedAtUtc: preflightStartedAtUtc,
            endedAtUtc: new Date().toISOString(),
            expectedIds,
            outcome: 'failed',
            requestedModel: GEMINI_GATEWAY_MODEL,
            error: sanitizeGatewayError(error)
          })
          await writeGatewayAudit(options.auditPath, auditRecords).catch(() => {})
          throw error
        }
      }

      if (!canonicalDraft) {
        logInfo(`[GeminiGateway] request=1/2 stage=restore-translate cues=${expectedIds.length} model=${GEMINI_GATEWAY_MODEL}`)
        const draftStage = await runStage('restore-translate', batch, buildGatewayDraftMessages(batch, promptContext, outputMode), signal)
        const draft = draftStage.completion
        logInfo(`[GeminiGateway] request=1/2 outcome=complete upstreamAttempts=${draft.upstreamAttempts} retryReasons=${draft.upstreamRetryReasons.join(',') || 'none'}`)
        draftTruncated = draft.truncated
        // Never review, checkpoint, or partly accept a length-limited draft.
        // Return its explicit truncation marker to the orchestrator, which
        // discards every provisional item and divides the unfinished batch
        // under the normal bounded scheduler policy. Preserve raw text here:
        // a cutoff can leave JSON malformed, yet that must still be split
        // rather than upgraded into a provider-protocol terminal failure.
        if (draftTruncated) {
          return {
            raw: draft.raw,
            truncated: true,
            modelIdentity: draft.modelIdentity
          }
        }
        canonicalDraft = canonicalizeGatewayTranslation(draft.raw, expectedIds, outputMode)
        const parsedDraft = parseTranslationResponse(canonicalDraft, 'json-items', expectedIds, draft.truncated, contextIds)
        if (!parsedDraft.complete) {
          throw Object.assign(new Error(`Lượt khôi phục và dịch không đúng contract: ${parsedDraft.issues[0]?.message || 'response không hoàn chỉnh'}`), {
            providerCode: 'provider-protocol'
          })
        }

        if (draftDir) {
          const checkpointRaw = outputMode === 'cue-lines-v1'
            ? JSON.stringify({ translations: Object.fromEntries(parsedDraft.items.map((item) => [item.id, item.text])) })
            : draft.raw
          await writeGatewayDraft(draftDir, {
            schemaVersion: 2,
            state: 'draft-validated',
            identity: draftIdentity,
            raw: checkpointRaw,
            rawSha256: createHash('sha256').update(checkpointRaw).digest('hex'),
            observedModelId: draft.observedModelId,
            observedModel: draft.observedModel || null,
            routeFingerprint: draft.routeFingerprint,
            sourceDigest,
            expectedIds,
            targetLocale: batch.input.targetLocale,
            draftPromptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
            reviewPromptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
            parserVersion: GATEWAY_DRAFT_PARSER_VERSION,
            savedAtUtc: new Date().toISOString()
          })
        }
        await draftStage.ack?.()
      }

      const parsedDraftForReview = parseTranslationResponse(canonicalDraft, 'json-items', expectedIds, draftTruncated, contextIds)
      if (reviewMode === 'draft-only') {
        return {
          raw: canonicalDraft,
          truncated: draftTruncated,
          modelIdentity: GEMINI_GATEWAY_MODEL
        }
      }
      const reviewedDraft = JSON.stringify({ translations: Object.fromEntries(parsedDraftForReview.items.map((item) => [item.id, item.text])) })
      logInfo(`[GeminiGateway] request=2/2 stage=independent-review cues=${expectedIds.length} model=${GEMINI_GATEWAY_MODEL}`)
      const reviewStage = await runStage('independent-review', batch, buildGatewayReviewMessages(batch, reviewedDraft, promptContext, outputMode), signal)
      const reviewed = reviewStage.completion
      logInfo(`[GeminiGateway] request=2/2 outcome=complete upstreamAttempts=${reviewed.upstreamAttempts} retryReasons=${reviewed.upstreamRetryReasons.join(',') || 'none'}`)
      if (reviewed.truncated) {
        return {
          raw: reviewed.raw,
          truncated: true,
          modelIdentity: reviewed.modelIdentity
        }
      }
      const canonicalReviewed = canonicalizeGatewayTranslation(reviewed.raw, expectedIds, outputMode)
      validateReviewedDubbingPunctuation(batch, canonicalReviewed)
      if (draftDir) {
        const parsedReview = parseTranslationResponse(canonicalReviewed, 'json-items', expectedIds, false, contextIds)
        if (!parsedReview.complete) {
          throw Object.assign(new Error(`Lượt review không đúng contract: ${parsedReview.issues[0]?.message || 'response không hoàn chỉnh'}`), {
            providerCode: 'provider-protocol'
          })
        }
        const reviewCheckpointRaw = JSON.stringify({
          translations: Object.fromEntries(parsedReview.items.map((item) => [item.id, item.text]))
        })
        await writeGatewayReview(draftDir, {
          schemaVersion: 1,
          state: 'review-validated',
          identity: `${draftIdentity}:review`,
          raw: reviewCheckpointRaw,
          rawSha256: createHash('sha256').update(reviewCheckpointRaw).digest('hex'),
          observedModelId: reviewed.observedModelId,
          observedModel: reviewed.observedModel || null,
          routeFingerprint: reviewed.routeFingerprint,
          sourceDigest,
          expectedIds,
          targetLocale: batch.input.targetLocale,
          promptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
          parserVersion: GATEWAY_DRAFT_PARSER_VERSION,
          savedAtUtc: new Date().toISOString()
        })
      }
      await reviewStage.ack?.()
      return {
        raw: canonicalReviewed,
        truncated: reviewed.truncated,
        modelIdentity: reviewed.modelIdentity
      }
    }
  }
}

export async function checkGeminiGateway(
  serverUrl?: string,
  options?: { verifyModel?: boolean; force?: boolean }
): Promise<DichKeyStatus> {
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
      gateway_verification?: {
        state?: string
        requested_model?: string
        observed_model_id?: string
        observed_model?: string
        verified_at_utc?: string
        expires_at_utc?: string
        verification_generation_requests?: number
        error_message?: string
      }
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

    let verificationStatus: GatewayVerificationStatus | undefined
    if (data.gateway_verification && typeof data.gateway_verification.state === 'string') {
      verificationStatus = {
        state: data.gateway_verification.state as GatewayVerificationStatus['state'],
        requestedModel: String(data.gateway_verification.requested_model || GEMINI_GATEWAY_MODEL),
        observedModelId: data.gateway_verification.observed_model_id ? String(data.gateway_verification.observed_model_id) : undefined,
        observedModel: data.gateway_verification.observed_model ? String(data.gateway_verification.observed_model) : undefined,
        verifiedAtUtc: data.gateway_verification.verified_at_utc ? String(data.gateway_verification.verified_at_utc) : undefined,
        expiresAtUtc: data.gateway_verification.expires_at_utc ? String(data.gateway_verification.expires_at_utc) : undefined,
        verificationGenerationRequests: Number(data.gateway_verification.verification_generation_requests || 0),
        errorMessage: data.gateway_verification.error_message ? String(data.gateway_verification.error_message) : undefined
      }
    }

    if (options?.verifyModel) {
      const verifyRes = await fetch(`${baseUrl}/gateway/verify-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: GEMINI_GATEWAY_MODEL, force: Boolean(options.force) }),
        signal: AbortSignal.timeout(300_000)
      })
      if (!verifyRes.ok) {
        return {
          ok: false,
          message: `Không thể xác minh model: Gateway báo lỗi HTTP ${verifyRes.status}.`
        }
      }
      const verifyData = await readBoundedAiResponseJson<{
        state?: string
        requested_model?: string
        observed_model_id?: string
        observed_model?: string
        verified_at_utc?: string
        expires_at_utc?: string
        verification_generation_requests?: number
        error_message?: string
      }>(verifyRes, undefined, 64 * 1024)

      verificationStatus = {
        state: (verifyData.state || 'unverified') as GatewayVerificationStatus['state'],
        requestedModel: String(verifyData.requested_model || GEMINI_GATEWAY_MODEL),
        observedModelId: verifyData.observed_model_id ? String(verifyData.observed_model_id) : undefined,
        observedModel: verifyData.observed_model ? String(verifyData.observed_model) : undefined,
        verifiedAtUtc: verifyData.verified_at_utc ? String(verifyData.verified_at_utc) : undefined,
        expiresAtUtc: verifyData.expires_at_utc ? String(verifyData.expires_at_utc) : undefined,
        verificationGenerationRequests: Number(verifyData.verification_generation_requests || 0),
        errorMessage: verifyData.error_message ? String(verifyData.error_message) : undefined
      }

      if (verificationStatus.state === 'verified') {
        return {
          ok: true,
          message: `Đã xác minh Gemini 3.1 Pro (${verificationStatus.observedModel || '3.1 Pro'}${verificationStatus.observedModelId ? ` · ${verificationStatus.observedModelId}` : ''}).`,
          gatewayVerification: verificationStatus
        }
      }
      if (verificationStatus.state === 'mismatch') {
        return {
          ok: false,
          message: `Gateway trả sai model: yêu cầu Gemini 3.1 Pro nhưng quan sát thấy ${verificationStatus.observedModel || 'khác'} (${verificationStatus.observedModelId || 'unknown'}).`,
          gatewayVerification: verificationStatus
        }
      }
      if (verificationStatus.state === 'authentication-required') {
        return {
          ok: false,
          message: 'Cookie Gemini đã hết hạn hoặc không hợp lệ. Hãy cập nhật cookie và khởi động lại gateway.',
          gatewayVerification: verificationStatus
        }
      }
      if (verificationStatus.state === 'unavailable') {
        return {
          ok: false,
          message: `Model Gemini 3.1 Pro (${GEMINI_GATEWAY_MODEL}) không khả dụng cho tài khoản này.`,
          gatewayVerification: verificationStatus
        }
      }
      return {
        ok: false,
        message: `Chưa thể xác minh model: ${verificationStatus.errorMessage || 'không rõ lý do'}.`,
        gatewayVerification: verificationStatus
      }
    }

    return {
      ok: true,
      message: `Đã kết nối Gemini Gateway · dùng model văn bản do Google cung cấp (${GEMINI_GATEWAY_MODEL}).`,
      gatewayVerification: verificationStatus
    }
  } catch (error) {
    return { ok: false, message: `Không thể kết nối Gemini Gateway: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function probeGeminiGatewayGeneration(
  serverUrl?: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; message?: string }> {
  try {
    const baseUrl = normalizeBaseUrl(serverUrl)
    const probeBody = {
      model: GEMINI_GATEWAY_MODEL,
      messages: [
        { role: 'user', content: 'Ping' }
      ],
      max_tokens: 16,
      temporary: true,
      gateway_requirements: {
        contract_version: 2,
        require_verified_model: false,
        require_complete_response: false
      }
    }
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(probeBody),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
    })
    if (!res.ok) {
      const detail = await readBoundedAiResponseText(res, signal, 32 * 1024).catch(() => '')
      let errorMsg = detail
      try {
        const parsed = JSON.parse(detail)
        errorMsg = parsed?.error?.message || parsed?.detail || detail
      } catch {}
      if (res.status === 405 || isProviderThrottledError(detail) || isProviderThrottledError(errorMsg)) {
        return {
          ok: false,
          message: 'Google Gemini Web đang tạm từ chối hoặc giới hạn tần suất (HTTP 405/429 - chống bot/rate limit). Hãy tạm dừng và thử lại sau hoặc làm mới session.'
        }
      }
      return { ok: false, message: `Gemini Gateway báo lỗi generation (HTTP ${res.status}): ${errorMsg}` }
    }
    return { ok: true }
  } catch (error) {
    if (signal?.aborted) return { ok: false, message: 'Đã hủy kiểm tra Gemini Gateway' }
    return { ok: false, message: `Không thể kết nối generation probe tới Gemini Gateway: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function translateSrtWithGeminiGateway(
  inputPath: string,
  outputPath: string,
  targetLocale: string,
  serverUrl?: string,
  options: TranslationFileRunnerOptions = {},
  gatewayOptions: GeminiGatewayTranslationOptions = {}
): Promise<{ ok: boolean; error?: string; count?: number; assessment?: TranslationAssessment }> {
  const result = await translateFileWithAdapter(
    inputPath,
    outputPath,
    targetLocale,
    createGeminiGatewayTranslationAdapter(serverUrl, gatewayOptions),
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
