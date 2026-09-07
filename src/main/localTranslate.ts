import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildSrt,
  buildDubbingTranslationPayload,
  buildTranslationBatches,
  huongDan,
  parseSrt,
  validateTranslationItems,
  type TranslationItem,
  type TranslationMode
} from './translate-shared'
import { parseTranslationResponse } from './translation/response'
import {
  buildSemanticBatches,
  buildSemanticGroups,
  DEFAULT_LOCAL_TRANSLATION_TEMPERATURE,
  LOCAL_DUBBING_BATCH_MAX_CUES,
  LOCAL_DUBBING_BATCH_MAX_CHARS,
  isRetryableLocalTranslationError,
  parseCueTiming,
  resolveTranslationSourceLanguage,
  splitSemanticBatch,
  type SemanticGroup
} from './localTranslatePolicy'
import { joinGroupText } from './semanticGrouping'
import { debugRaw, errLabel, logInfo, logWarn } from './logger'
import { DEFAULT_AI_SERVER_URL, type DichKeyStatus, type SrtBlock } from '../shared/types'
import type { TranslationInput } from '../shared/translation'
import { getGlobalResourceManager } from './autoShortResourceManager'
import { buildTranslationMessages } from './translation/prompts'

export type { TranslationMode }

export interface TranslateOptions {
  strict?: boolean
  mode?: TranslationMode
  concise?: boolean
  sourceLanguage?: string | null
  contextRadius?: number
  signal?: AbortSignal
  model?: string
  /** Per-item wall-clock budget. Defaults to ten minutes. */
  deadlineMs?: number
  /** Optional request-count ceiling; omitted/null keeps only the deadline guard. */
  maxRequests?: number | null
  /** Monotonic clock hook for deterministic tests. */
  now?: () => number
  /** Wall-clock hook used when parsing HTTP-date Retry-After values. */
  wallNow?: () => number
  /** Retry sleep hook for deterministic tests. */
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
  /** Durable observer invoked after each validated provider batch. */
  onBatch?: (items: readonly TranslationItem[], batchIndex: number) => Promise<void> | void
}

export const LOCAL_TRANSLATION_DEADLINE_MS = 10 * 60 * 1000

export interface LocalTranslationRequestBudget {
  readonly maxRequests: number
  readonly deadlineAtMs: number
  readonly requests: number
  remainingMs(): number
  consume(): void
}

class TranslationRequestBudget implements LocalTranslationRequestBudget {
  readonly maxRequests: number
  readonly deadlineAtMs: number
  private requestCount = 0
  private readonly now: () => number

  constructor(maxRequests: number, deadlineMs: number, now: () => number) {
    this.maxRequests = Number.isFinite(maxRequests)
      ? Math.max(1, Math.floor(maxRequests))
      : Number.POSITIVE_INFINITY
    this.now = now
    this.deadlineAtMs = now() + Math.max(0, deadlineMs)
  }

  get requests(): number {
    return this.requestCount
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineAtMs - this.now())
  }

  consume(): void {
    if (this.remainingMs() <= 0) {
      throw new Error(`Đã hết thời gian dịch cho item (deadline ${Math.round(LOCAL_TRANSLATION_DEADLINE_MS / 60_000)} phút)`)
    }
    if (Number.isFinite(this.maxRequests) && this.requestCount >= this.maxRequests) {
      throw new Error(`Đã hết ngân sách request dịch (${this.maxRequests} lượt)`)
    }
    this.requestCount++
  }
}

/** Parse Retry-After as delay-seconds or an RFC 7231 HTTP-date. */
export function parseRetryAfterMs(value: string | null | undefined, wallNow = Date.now()): number | null {
  const raw = value?.trim()
  if (!raw) return null
  if (/^\d+(?:\.\d+)?$/u.test(raw)) {
    const seconds = Number(raw)
    if (!Number.isFinite(seconds)) return null
    return Math.max(0, Math.round(seconds * 1000))
  }
  const timestamp = Date.parse(raw)
  if (Number.isNaN(timestamp)) return null
  return Math.max(0, timestamp - wallNow)
}

function keyFile(): string {
  return join(app.getPath('userData'), 'lk.bin')
}

export async function saveLocalKey(key: string): Promise<void> {
  const t = key.trim()
  if (!t) {
    await rm(keyFile(), { force: true })
    return
  }
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(t)
    : Buffer.from(t, 'utf-8')
  await writeFile(keyFile(), buf)
}

export async function loadLocalKey(): Promise<string> {
  try {
    const buf = await readFile(keyFile())
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
  } catch {
    return ''
  }
}

export async function hasLocalKey(): Promise<boolean> {
  return (await loadLocalKey()).length > 0
}

function normalizeUrl(url?: string): string {
  const target = (url || DEFAULT_AI_SERVER_URL).trim()
  return target.replace(/\/+$/, '')
}

function getAuthHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`
  }
  return headers
}

function translationHttpError(status: number, body: string): Error {
  let code = ''
  try {
    const payload = JSON.parse(body) as { code?: unknown; detail?: unknown; error?: { code?: unknown } }
    const candidate = payload.code ?? payload.error?.code ?? payload.detail
    if (typeof candidate === 'string' && /^[a-z0-9_.-]{2,80}$/i.test(candidate)) code = candidate
  } catch {
    // The server may return a non-JSON proxy error; keep the response bounded.
  }
  const suffix = code ? `, ${code}` : ''
  if (status === 401 || status === 403) return new Error(`Server AI từ chối quyền dịch (HTTP ${status}${suffix})`)
  if (status === 422) return new Error(`Server AI từ chối dữ liệu dịch (HTTP 422${suffix})`)
  if (status >= 500) return new Error(`Server AI lỗi nội bộ (HTTP ${status}${suffix})`)
  return new Error(`Server AI phản hồi lỗi HTTP ${status}${suffix}`)
}

const LOCAL_TRANSLATION_MAX_ATTEMPTS = 3
const LOCAL_TRANSLATION_RETRY_DELAYS_MS = [800, 1600]
const LOCAL_TRANSLATION_RESPONSE_MAX_ATTEMPTS = 2

function scriptMatcher(script: string): RegExp | null {
  switch (script) {
    case 'Latn': return /\p{Script=Latin}/u
    case 'Hans': return /\p{Script=Han}/u
    case 'Hant': return /\p{Script=Han}/u
    case 'Jpan': return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
    case 'Kore': return /[\p{Script=Hangul}\p{Script=Han}]/u
    case 'Cyrl': return /\p{Script=Cyrillic}/u
    case 'Arab': return /\p{Script=Arabic}/u
    case 'Deva': return /\p{Script=Devanagari}/u
    default: return null
  }
}

function scriptCount(text: string, matcher: RegExp): number {
  return Array.from(text).filter((character) => matcher.test(character)).length
}

function letterCount(text: string): number {
  return Array.from(text).filter((character) => /\p{L}/u.test(character)).length
}

/** Detect a valid-looking response that simply copied the source script. */
function isLikelySourceScriptEcho(
  source: readonly SrtBlock[],
  translated: readonly TranslationItem[],
  sourceLanguage: string,
  targetLanguage: string
): boolean {
  try {
    const sourceScript = new Intl.Locale(sourceLanguage).maximize().script
    const targetScript = new Intl.Locale(targetLanguage).maximize().script
    if (!sourceScript || !targetScript || sourceScript === targetScript) return false
    const sourceMatcher = scriptMatcher(sourceScript)
    const targetMatcher = scriptMatcher(targetScript)
    if (!sourceMatcher || !targetMatcher) return false
    const sourceById = new Map(source.map((cue) => [cue.id || '', cue.text]))
    const sourceText = source.map((cue) => cue.text).join(' ')
    const translatedText = translated.map((cue) => cue.text).join(' ')
    const sourceLetters = letterCount(sourceText)
    const translatedLetters = letterCount(translatedText)
    if (sourceLetters < 12 || translatedLetters < 12) return false

    const translatedSourceScriptLetters = scriptCount(translatedText, sourceMatcher)
    const translatedTargetScriptLetters = scriptCount(translatedText, targetMatcher)
    const aggregateEcho =
      translatedSourceScriptLetters >= Math.max(12, translatedTargetScriptLetters * 1.5) &&
      translatedSourceScriptLetters / translatedLetters >= 0.65
    if (aggregateEcho) return true

    let comparable = 0
    let echoCount = 0
    for (const item of translated) {
      const sourceTextForCue = sourceById.get(item.id)
      if (!sourceTextForCue || sourceTextForCue.trim() === item.text.trim()) continue
      const sourceCueLetters = letterCount(sourceTextForCue)
      const translatedCueLetters = letterCount(item.text)
      if (sourceCueLetters < 8 || translatedCueLetters < 8) continue
      comparable++
      const sourceCueScript = scriptCount(item.text, sourceMatcher)
      const targetCueScript = scriptCount(item.text, targetMatcher)
      if (sourceCueScript >= Math.max(8, targetCueScript * 1.5) && sourceCueScript / translatedCueLetters >= 0.65) {
        echoCount++
      }
    }
    return comparable >= 2 && echoCount / comparable >= 0.75
  } catch {
    return false
  }
}

async function waitForLocalTranslationRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Đã hủy tác vụ'))
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const reason = signal?.reason
      reject(reason instanceof Error ? reason : new Error('Đã hủy tác vụ'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function translationDeadlineError(): Error {
  return new Error(`Đã hết thời gian dịch cho item (deadline ${Math.round(LOCAL_TRANSLATION_DEADLINE_MS / 60_000)} phút)`)
}

/**
 * Keep response items that are structurally usable even when the provider
 * omitted a few cue IDs. Re-requesting already valid cues wastes the shared
 * deadline budget and is especially harmful for small batches.
 */
function collectUsableTranslationItems(
  candidate: readonly TranslationItem[],
  expectedIds: readonly string[]
): Map<string, string> {
  const expected = new Set(expectedIds)
  const usable = new Map<string, string>()
  const seen = new Set<string>()
  for (const item of candidate) {
    if (!item || typeof item.id !== 'string' || !expected.has(item.id)) continue
    if (seen.has(item.id)) {
      usable.delete(item.id)
      continue
    }
    seen.add(item.id)
    if (typeof item.text !== 'string' || !item.text.trim()) continue
    usable.set(item.id, item.text.trim())
  }
  return usable
}

function hasOneExpectedItemPerCue(
  candidate: readonly TranslationItem[],
  expectedIds: readonly string[],
  usable: ReadonlyMap<string, string>
): boolean {
  if (usable.size !== expectedIds.length) return false
  const expected = new Set(expectedIds)
  const expectedItems = candidate.filter((item) => expected.has(item.id))
  if (expectedItems.length !== expectedIds.length) return false
  return new Set(expectedItems.map((item) => item.id)).size === expectedIds.length
}

function groupsForMissingCues(
  groups: readonly SemanticGroup<SrtBlock>[],
  usable: ReadonlyMap<string, string>,
  locale?: string
): SemanticGroup<SrtBlock>[] {
  return groups.flatMap((group) => {
    const missingCues = group.cues.filter((cue) => !usable.has(cue.id || ''))
    if (missingCues.length === 0) return []
    if (missingCues.length === group.cues.length) return [group]
    const first = parseCueTiming(missingCues[0])
    const last = parseCueTiming(missingCues[missingCues.length - 1])
    return [{
      ...group,
      id: `${group.id}-missing`,
      cues: missingCues,
      text: joinGroupText(missingCues, locale),
      start: first.start,
      end: last.end
    }]
  })
}

function assertRetryFitsBudget(delayMs: number, budget: LocalTranslationRequestBudget): void {
  if (delayMs > budget.remainingMs()) throw translationDeadlineError()
}

async function fetchLocalTranslationBatch(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  signal: AbortSignal | undefined,
  budget: LocalTranslationRequestBudget,
  sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>,
  wallNow: () => number
): Promise<Response> {
  for (let attempt = 0; attempt < LOCAL_TRANSLATION_MAX_ATTEMPTS; attempt++) {
    try {
      budget.consume()
      const remainingMs = budget.remainingMs()
      if (remainingMs <= 0) throw translationDeadlineError()
      const { response, bodyText, errText, retryAfter } = await getGlobalResourceManager().withLease(
        ['server-inference'],
        signal,
        async () => {
          const leaseRemainingMs = budget.remainingMs()
          if (leaseRemainingMs <= 0) throw translationDeadlineError()
          const timeoutMs = Math.max(1, Math.min(60_000, Math.ceil(leaseRemainingMs)))
          const timeoutSignal = AbortSignal.timeout(timeoutMs)
          const requestSignal = signal
            ? AbortSignal.any([signal, timeoutSignal])
            : timeoutSignal
          const resp = await fetch(url, { ...init, signal: requestSignal })
          if (resp.ok) {
            const text = await resp.text()
            return { response: resp, bodyText: text, errText: '', retryAfter: null }
          }
          const text = await resp.text().catch(() => '')
          const ra = resp.headers.get('Retry-After')
          return { response: resp, bodyText: '', errText: text, retryAfter: ra }
        }
      )

      if (response.ok) {
        if (budget.remainingMs() <= 0) throw translationDeadlineError()
        return new Response(bodyText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        })
      }

      let retryDelayMs = LOCAL_TRANSLATION_RETRY_DELAYS_MS[attempt]
      if (response.status === 429 || response.status === 503) {
        const parsedRetryAfter = parseRetryAfterMs(retryAfter, wallNow())
        if (parsedRetryAfter !== null) retryDelayMs = parsedRetryAfter
      }

      const error = translationHttpError(response.status, errText)
      if (!isRetryableLocalTranslationError(error) || attempt >= LOCAL_TRANSLATION_MAX_ATTEMPTS - 1) throw error
      assertRetryFitsBudget(retryDelayMs, budget)
      await sleep(retryDelayMs, signal)
    } catch (error) {
      if (budget.remainingMs() <= 0) throw translationDeadlineError()
      if (signal?.aborted || !isRetryableLocalTranslationError(error) || attempt >= LOCAL_TRANSLATION_MAX_ATTEMPTS - 1) {
        throw error
      }
      const retryDelayMs = LOCAL_TRANSLATION_RETRY_DELAYS_MS[attempt]
      assertRetryFitsBudget(retryDelayMs, budget)
      await sleep(retryDelayMs, signal)
    }
  }
  throw new Error('Server AI không trả về kết quả dịch')
}

export async function checkLocalTranslateKey(
  serverUrl?: string,
  apiKey?: string,
  _targetLanguage?: string,
  _sourceLanguage?: string | null
): Promise<DichKeyStatus> {
  const base = normalizeUrl(serverUrl)
  const effectiveKey = apiKey !== undefined ? apiKey : await loadLocalKey()
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: getAuthHeaders(effectiveKey),
      body: JSON.stringify({
        model: 'llm-default',
        messages: [{ role: 'user', content: 'health-check' }]
      }),
      signal: AbortSignal.timeout(30_000)
    })

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'API Key không hợp lệ hoặc thiếu quyền llm' }
      }
      return { ok: false, message: `Server AI nội bộ báo lỗi HTTP ${res.status}` }
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; translation?: string }
    if (data.choices?.[0]?.message?.content || data.translation) {
      return { ok: true, message: 'Kết nối AI nội bộ thành công' }
    }
    return { ok: false, message: 'Server không trả về kết quả' }
  } catch (err) {
    return { ok: false, message: `Không thể kết nối tới server AI: ${errLabel(err)}` }
  }
}

export async function localTranslateSrt(
  srtPath: string,
  outPath: string,
  targetLanguage: string,
  serverUrl?: string,
  apiKey?: string,
  onProgress?: (done: number, total: number) => void,
  options: TranslateOptions = {}
): Promise<{ ok: boolean; error?: string }> {
  const base = normalizeUrl(serverUrl)
  const effectiveKey = apiKey !== undefined && apiKey !== '' ? apiKey : await loadLocalKey()
  const mode: TranslationMode = options.mode || (options.concise ? 'dubbing' : 'subtitle')
  logInfo(`[Translate] Bắt đầu dịch phụ đề bằng AI nội bộ Chat API (${base}) sang ngôn ngữ: ${targetLanguage} (mode: ${mode})`)

  let raw = ''
  try {
    raw = await readFile(srtPath, 'utf8')
  } catch (err) {
    return { ok: false, error: `Không thể đọc file phụ đề: ${errLabel(err)}` }
  }

  const blocks = parseSrt(raw)
  if (blocks.length === 0) {
    return { ok: false, error: 'File phụ đề rỗng hoặc không đúng định dạng SRT' }
  }

  const sourceBlocks = blocks.map((block, index) => ({
    ...block,
    id: block.id || `cue-${index}`,
    sourceIndex: block.sourceIndex ?? index
  }))

  const total = sourceBlocks.length
  const sourceLanguage = resolveTranslationSourceLanguage(options.sourceLanguage)
  const semanticGroups = buildSemanticGroups(sourceBlocks, undefined, sourceLanguage)
  const batches = mode === 'dubbing'
    ? buildTranslationBatches(sourceBlocks, LOCAL_DUBBING_BATCH_MAX_CHARS, LOCAL_DUBBING_BATCH_MAX_CUES, targetLanguage).map((batch) => buildSemanticGroups(batch, undefined, targetLanguage))
    : buildSemanticBatches(semanticGroups, 10)
  const translatedBlocks: SrtBlock[] = []

  let doneCount = 0
  const now = options.now || (() => performance.now())
  const sleep = options.sleep || waitForLocalTranslationRetry
  const budget = new TranslationRequestBudget(
    options.maxRequests ?? (
      batches.length + Math.max(4, Math.ceil(batches.length * 0.5))
    ),
    options.deadlineMs ?? LOCAL_TRANSLATION_DEADLINE_MS,
    now
  )
  const wallNow = options.wallNow || (() => Date.now())

  const translateGroupBatch = async (
    batchGroups: SemanticGroup<SrtBlock>[],
    startCueIndex: number,
    splitDepth = 0
  ): Promise<Map<string, string>> => {
    const batchCues = batchGroups.flatMap((g) => g.cues)
    const expectedIds = batchCues.map((c) => c.id || '')

    const outputContract = [
      `Định dạng đầu ra bắt buộc: mỗi dòng là [id] bản dịch, ví dụ [${expectedIds[0]}] <bản dịch bằng ngôn ngữ đích>.`,
      `Giữ nguyên chính xác các ID cần dịch: ${expectedIds.join(', ')}. Không đánh số lại từ đầu.`,
      'Không trả nhãn nhóm, thời lượng, lời giải thích, Markdown hoặc cue ngữ cảnh. Dù chỉ có một cue vẫn phải ghi [id].'
    ].join('\n')
    const radius = Number.isInteger(options.contextRadius)
      ? Math.max(0, Math.min(3, options.contextRadius!))
      : 1
    const firstCueIndex = sourceBlocks.findIndex((b) => b.id === batchCues[0]?.id)
    const lastCueIndex = sourceBlocks.findIndex((b) => b.id === batchCues[batchCues.length - 1]?.id)
    const toPromptCue = (cue: SrtBlock, index: number) => ({
      id: cue.id || `cue-${index}`,
      sourceIndex: cue.sourceIndex ?? index,
      start: typeof cue.start === 'number' ? cue.start : 0,
      end: typeof cue.end === 'number' ? cue.end : typeof cue.start === 'number' ? cue.start : 0,
      text: cue.text,
      groupId: `group-${cue.sourceIndex ?? index}`
    })
    const promptInput: TranslationInput = {
      sourceLanguage,
      targetLocale: targetLanguage,
      mode,
      cues: batchCues.map((cue, index) => toPromptCue(cue, index)),
      contextBefore: firstCueIndex > 0
        ? sourceBlocks.slice(Math.max(0, firstCueIndex - radius), firstCueIndex).map((cue, index) => toPromptCue(cue, index))
        : [],
      contextAfter: lastCueIndex >= 0 && lastCueIndex < sourceBlocks.length - 1
        ? sourceBlocks.slice(lastCueIndex + 1, Math.min(sourceBlocks.length, lastCueIndex + 1 + radius)).map((cue, index) => toPromptCue(cue, index))
        : [],
      glossary: []
    }
    const systemPrompt = `${buildTranslationMessages(promptInput, 'id-lines')[0].content}\n\n${outputContract}`
    let userPrompt: string
    if (mode === 'dubbing') {
      userPrompt = buildDubbingTranslationPayload(batchCues, sourceBlocks, options.contextRadius, targetLanguage)
    } else {
      const firstCueIndex = sourceBlocks.findIndex((b) => b.id === batchCues[0]?.id)
      const lastCueIndex = sourceBlocks.findIndex((b) => b.id === batchCues[batchCues.length - 1]?.id)
      const contextBefore = firstCueIndex > 0
        ? sourceBlocks.slice(Math.max(0, firstCueIndex - radius), firstCueIndex)
        : []
      const contextAfter = lastCueIndex >= 0 && lastCueIndex < sourceBlocks.length - 1
        ? sourceBlocks.slice(lastCueIndex + 1, Math.min(sourceBlocks.length, lastCueIndex + 1 + radius))
        : []
      const userPromptLines: string[] = [
        `Dịch các nhóm lời thoại/phụ đề sau sang locale đích: target_locale=${targetLanguage} (chế độ: ${mode}).`,
        '',
        'Yêu cầu dịch thuật:',
        '1. Đọc toàn bộ các cue trong cùng một nhóm như một câu/lời thoại liền mạch để hiểu trọn vẹn ngữ cảnh và ý nghĩa toàn câu.',
        '2. Dịch câu tự nhiên, trôi chảy theo văn phong nói của người bản ngữ.',
        '3. Phân phối nội dung dịch trở lại đúng các cue ID trong nhóm.',
        '4. Trả về đúng định dạng [cue-id] bản_dịch cho tất cả các cue cần dịch.',
        ''
      ]
      if (contextBefore.length > 0) {
        userPromptLines.push(
          '[Ngữ cảnh phía trước (chỉ để hiểu nghĩa, không dịch)]:',
          ...contextBefore.map((c) => `[${c.id}] ${c.text}`),
          ''
        )
      }
      userPromptLines.push('[Nội dung cần dịch]:')
      for (const group of batchGroups) {
        for (const cue of group.cues) userPromptLines.push(`[${cue.id}] ${cue.text}`)
      }
      if (contextAfter.length > 0) {
        userPromptLines.push(
          '',
          '[Ngữ cảnh phía sau (chỉ để hiểu nghĩa, không dịch)]:',
          ...contextAfter.map((c) => `[${c.id}] ${c.text}`)
        )
      }
      userPrompt = userPromptLines.join('\n')
    }
    let resultMap: Map<string, string> | undefined
    let invalidResponseReason = ''
    let partialMap: Map<string, string> | undefined
    let partialMissingGroups: SemanticGroup<SrtBlock>[] | undefined

    for (let responseAttempt = 0; responseAttempt < LOCAL_TRANSLATION_RESPONSE_MAX_ATTEMPTS; responseAttempt++) {
      if (options.signal?.aborted) throw new Error('Đã hủy tác vụ')
      const activeUserPrompt = responseAttempt === 0
        ? userPrompt
        : `${userPrompt}\nLưu ý: Bản trả lời trước chưa đạt yêu cầu (${invalidResponseReason || 'schema không hợp lệ'}). Yêu cầu trả về đúng và đủ các cue ID: ${expectedIds.join(', ')}.`

      const requestStarted = performance.now()
      const res = await fetchLocalTranslationBatch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: getAuthHeaders(effectiveKey),
        body: JSON.stringify({
          model: options.model?.trim() || 'llm-default',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: activeUserPrompt }
          ],
          temperature: DEFAULT_LOCAL_TRANSLATION_TEMPERATURE,
          // Bounded token budget prevents runaway generation on local server
          max_tokens: Math.min(2_048, Math.max(512, expectedIds.length * 64))
        })
      }, options.signal, budget, sleep, wallNow)

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw translationHttpError(res.status, errText)
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
        translation?: string
      }
      if (options.signal?.aborted) throw new Error('Đã hủy tác vụ')
      const transText = (data.choices?.[0]?.message?.content || data.translation || '').trim()
      const truncated = data.choices?.[0]?.finish_reason === 'length'
      logInfo(`[Translate] response cues=${batchCues.length} attempt=${responseAttempt + 1} elapsedMs=${Math.round(performance.now() - requestStarted)} truncated=${truncated}`)

      const jsonFormat = /^\s*(?:```(?:json)?\s*\r?\n)?(?:\{|\[\s*\{)/iu.test(transText)
      const contextIds = sourceBlocks
        .map((cue) => cue.id || '')
        .filter((id) => id && !expectedIds.includes(id))
      const parsedResponse = parseTranslationResponse(
        transText,
        jsonFormat ? 'json-items' : 'id-lines',
        expectedIds,
        truncated,
        contextIds
      )
      const candidate = parsedResponse.items
      const responseIdCounts = new Map<string, number>()
      for (const item of candidate) responseIdCounts.set(item.id, (responseIdCounts.get(item.id) || 0) + 1)
      const missingCount = expectedIds.filter((id) => !responseIdCounts.has(id)).length
      const duplicateCount = expectedIds.filter((id) => (responseIdCounts.get(id) || 0) > 1).length
      const expectedSet = new Set(expectedIds)
      const unknownCount = candidate.filter((item) => !expectedSet.has(item.id)).length
      const emptyCount = candidate.filter((item) => expectedSet.has(item.id) && !item.text.trim()).length
      // Counts only: no prompt, raw response, unknown ID strings or credentials.
      logInfo(`[Translate] schema expected=${expectedIds.length} parsed=${candidate.length} missing=${missingCount} duplicate=${duplicateCount} unknown=${unknownCount} empty=${emptyCount} chars=${transText.length} fenced=${transText.startsWith('```')}`)
      const sourceEcho = !truncated && isLikelySourceScriptEcho(sourceBlocks, candidate, sourceLanguage, targetLanguage)
      const usable = !truncated && !sourceEcho
        ? collectUsableTranslationItems(candidate, expectedIds)
        : new Map<string, string>()
      // Some older local gateways echo a read-only context line that is not
      // present in the current batch. It cannot be mapped to output; tolerate
      // that extra only when every expected cue is present exactly once. Any
      // missing/duplicate/empty/unparsed item remains a hard recovery path.
      const onlyUnknownExtras = parsedResponse.issues.length > 0 && parsedResponse.issues.every((item) => item.code === 'unknown-id')
      try {
        // Even a syntactically complete final line may have lost its last words.
        if (truncated) throw new Error('phản hồi bị cắt do giới hạn token')
        // Ignore non-current context items only when every current cue appears
        // exactly once. This keeps the identity contract while preventing a
        // harmless extra context line from triggering a full retranslation.
        if ((parsedResponse.complete || onlyUnknownExtras) && hasOneExpectedItemPerCue(candidate, expectedIds, usable)) {
          if (candidate.length !== expectedIds.length) {
            logWarn(`[Translate] Bỏ qua ${candidate.length - expectedIds.length} cue ngoài batch; các cue hiện tại đã đủ.`)
          }
          resultMap = usable as Map<string, string>
          // Compatibility validation remains at the public wrapper boundary;
          // the parser above is authoritative and already reports typed issues.
          validateTranslationItems([...resultMap.entries()].map(([id, text]) => ({ id, text })), expectedIds)
          break
        }
        const parserIssue = parsedResponse.issues.find((item) => item.severity === 'error' && item.code !== 'unknown-id')
        if (parserIssue) throw new Error(parserIssue.message)
        if (sourceEcho) {
          invalidResponseReason = 'nội dung phản hồi vẫn ở hệ chữ nguồn'
          // Do not spend another request repeating the same oversized prompt;
          // the bounded semantic split below is the recovery path.
          break
        }
        resultMap = new Map(candidate.map((item) => [item.id, item.text]))
        break
      } catch (error) {
        invalidResponseReason = error instanceof Error ? error.message : 'schema không hợp lệ'
        if (candidate.length === 0 && !truncated) {
          invalidResponseReason = 'Không đọc được cue có ID từ phản hồi AI; cần định dạng [id] bản dịch hoặc JSON có id và t/text.'
        }
      }

      // A provider may return most IDs correctly and omit only a small tail.
      // Preserve those valid translations and recurse only over groups that
      // still contain a missing cue. This keeps semantic boundaries intact
      // while avoiding duplicate requests for work already completed.
      if (!truncated && !sourceEcho && usable.size > 0) {
        const mergedUsable = new Map(partialMap)
        for (const [id, text] of usable) mergedUsable.set(id, text)
        const missingGroups = groupsForMissingCues(batchGroups, mergedUsable, targetLanguage)
        if (mergedUsable.size > 0 && mergedUsable.size < expectedIds.length && missingGroups.length > 0) {
          partialMap = mergedUsable
          partialMissingGroups = missingGroups
        }
      }

      // Retain whole utterances, but avoid repeating a failed multi-group
      // request before trying smaller batches. A single group gets one repair.
      if (batchGroups.length > 1 || (truncated && batchCues.length > 1)) break

      if (responseAttempt < LOCAL_TRANSLATION_RESPONSE_MAX_ATTEMPTS - 1) {
        logWarn(`[Translate] Batch ${startCueIndex + 1}-${startCueIndex + batchCues.length} ${invalidResponseReason}; thử lại response.`)
        const retryDelayMs = LOCAL_TRANSLATION_RETRY_DELAYS_MS[responseAttempt]
        assertRetryFitsBudget(retryDelayMs, budget)
        await sleep(retryDelayMs, options.signal)
      }
    }

    if (resultMap) return resultMap

    if (partialMap && partialMissingGroups) {
      const missingCueCount = partialMissingGroups.reduce((sum, group) => sum + group.cues.length, 0)
      logWarn(`[Translate] Batch ${startCueIndex + 1}-${startCueIndex + batchCues.length} ${invalidResponseReason || 'thiếu cue'}; giữ ${partialMap.size} cue hợp lệ và dịch lại ${missingCueCount} cue còn thiếu.`)
      const recovered = await translateGroupBatch(partialMissingGroups, startCueIndex, splitDepth)
      return new Map([...partialMap.entries(), ...recovered.entries()])
    }

    const split = splitDepth < 2 ? splitSemanticBatch(batchGroups, targetLanguage) : null
    if (split) {
      const [leftGroups, rightGroups] = split
      const leftCount = leftGroups.reduce((sum, g) => sum + g.cues.length, 0)
      const rightCount = rightGroups.reduce((sum, g) => sum + g.cues.length, 0)
      logWarn(`[Translate] Batch ${startCueIndex + 1}-${startCueIndex + batchCues.length} ${invalidResponseReason || 'không đạt schema'}; chia thành ${leftCount}+${rightCount}.`)
      const leftMap = await translateGroupBatch(leftGroups, startCueIndex, splitDepth + 1)
      const rightMap = await translateGroupBatch(rightGroups, startCueIndex + leftCount, splitDepth + 1)
      return new Map([...leftMap.entries(), ...rightMap.entries()])
    }

    if (Number.isFinite(budget.maxRequests) && budget.requests >= budget.maxRequests) {
      throw new Error(`Đã hết ngân sách request dịch (${budget.maxRequests} lượt)`)
    }
    throw new Error(`Kết quả dịch không đạt yêu cầu: ${invalidResponseReason || 'thiếu câu hoặc có câu rỗng'}`)
  }

  let processedCues = 0
  for (const batch of batches) {
    const batchCues = batch.flatMap((g) => g.cues)
    try {
      const resultMap = await translateGroupBatch(batch, processedCues)
      for (const cue of batchCues) {
        const text = resultMap.get(cue.id || '')
        if (!text) throw new Error('Kết quả dịch thiếu cue.')
        translatedBlocks.push({
          ...cue,
          text
        })
      }
      await options.onBatch?.(batchCues.map((cue) => ({ ...cue, text: resultMap!.get(cue.id || '') || '' })), batches.indexOf(batch))
      doneCount += batchCues.length
      onProgress?.(Math.min(doneCount, total), total)
    } catch (err) {
      const label = errLabel(err)
      logWarn(`[Translate] Lỗi khi dịch batch ${processedCues + 1}-${processedCues + batchCues.length}: ${label}`)
      return { ok: false, error: label }
    }
    processedCues += batchCues.length
  }

  try {
    const outputSrtContent = buildSrt(translatedBlocks)
    await writeFile(outPath, outputSrtContent, 'utf8')
    logInfo(`[Translate] Dịch hoàn tất ${total} câu và ghi ra: ${outPath}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: `Không thể lưu file phụ đề đã dịch: ${errLabel(err)}` }
  }
}
