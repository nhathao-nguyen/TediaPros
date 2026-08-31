import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildSrt,
  buildDubbingTranslationPayload,
  buildTranslationBatches,
  huongDan,
  parseSrt,
  parseTranslationItems,
  validateTranslationItems,
  type TranslationItem,
  type TranslationMode
} from './translate-shared'
import {
  buildSemanticBatches,
  buildSemanticGroups,
  DEFAULT_LOCAL_TRANSLATION_TEMPERATURE,
  isRetryableLocalTranslationError,
  parseCueTiming,
  resolveTranslationSourceLanguage,
  splitSemanticBatch,
  type SemanticGroup
} from './localTranslatePolicy'
import { debugRaw, errLabel, logInfo, logWarn } from './logger'
import { DEFAULT_AI_SERVER_URL, type DichKeyStatus, type SrtBlock } from '../shared/types'

export type { TranslationMode }

export interface TranslateOptions {
  strict?: boolean
  mode?: TranslationMode
  concise?: boolean
  sourceLanguage?: string | null
  contextRadius?: number
  signal?: AbortSignal
  model?: string
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

async function fetchLocalTranslationBatch(
  url: string,
  init: Omit<RequestInit, 'signal'>,
  signal?: AbortSignal
): Promise<Response> {
  for (let attempt = 0; attempt < LOCAL_TRANSLATION_MAX_ATTEMPTS; attempt++) {
    try {
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000)
      const response = await fetch(url, { ...init, signal: requestSignal })
      if (response.ok) return response

      const error = translationHttpError(response.status, await response.text().catch(() => ''))
      if (!isRetryableLocalTranslationError(error) || attempt >= LOCAL_TRANSLATION_MAX_ATTEMPTS - 1) throw error
      await waitForLocalTranslationRetry(LOCAL_TRANSLATION_RETRY_DELAYS_MS[attempt], signal)
    } catch (error) {
      if (signal?.aborted || !isRetryableLocalTranslationError(error) || attempt >= LOCAL_TRANSLATION_MAX_ATTEMPTS - 1) {
        throw error
      }
      await waitForLocalTranslationRetry(LOCAL_TRANSLATION_RETRY_DELAYS_MS[attempt], signal)
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
  const semanticGroups = buildSemanticGroups(sourceBlocks)
  const batches = mode === 'dubbing'
    ? buildTranslationBatches(sourceBlocks).map((batch) => buildSemanticGroups(batch))
    : buildSemanticBatches(semanticGroups, 10)
  const translatedBlocks: SrtBlock[] = []

  let doneCount = 0

  const translateGroupBatch = async (
    batchGroups: SemanticGroup<SrtBlock>[],
    startCueIndex: number
  ): Promise<Map<string, string>> => {
    const batchCues = batchGroups.flatMap((g) => g.cues)
    const expectedIds = batchCues.map((c) => c.id || '')

    const systemPrompt = huongDan(targetLanguage, { mode, sourceLanguage })
    let userPrompt: string
    if (mode === 'dubbing') {
      userPrompt = buildDubbingTranslationPayload(batchCues, sourceBlocks, options.contextRadius, targetLanguage)
    } else {
      const radius = Number.isInteger(options.contextRadius)
        ? Math.max(0, Math.min(3, options.contextRadius!))
        : 1
      const firstCueIndex = sourceBlocks.findIndex((b) => b.id === batchCues[0]?.id)
      const lastCueIndex = sourceBlocks.findIndex((b) => b.id === batchCues[batchCues.length - 1]?.id)
      const contextBefore = firstCueIndex > 0
        ? sourceBlocks.slice(Math.max(0, firstCueIndex - radius), firstCueIndex)
        : []
      const contextAfter = lastCueIndex >= 0 && lastCueIndex < sourceBlocks.length - 1
        ? sourceBlocks.slice(lastCueIndex + 1, Math.min(sourceBlocks.length, lastCueIndex + 1 + radius))
        : []
      const userPromptLines: string[] = [
        `Dịch các nhóm lời thoại/phụ đề sau sang ngôn ngữ đích: target_language=${targetLanguage} (chế độ: ${mode}).`,
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

    for (let responseAttempt = 0; responseAttempt < LOCAL_TRANSLATION_RESPONSE_MAX_ATTEMPTS; responseAttempt++) {
      const activeUserPrompt = responseAttempt === 0
        ? userPrompt
        : `${userPrompt}\nLưu ý: Bản trả lời trước chưa đạt yêu cầu (${invalidResponseReason || 'schema không hợp lệ'}). Yêu cầu trả về đúng và đủ các cue ID: ${expectedIds.join(', ')}.`

      const res = await fetchLocalTranslationBatch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: getAuthHeaders(effectiveKey),
        body: JSON.stringify({
          model: 'llm-default',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: activeUserPrompt }
          ],
          temperature: DEFAULT_LOCAL_TRANSLATION_TEMPERATURE,
          // The gateway maps this to Ollama's num_predict. A bounded budget
          // avoids a long batch being cut off before every cue is returned.
          max_tokens: Math.min(8_192, Math.max(512, expectedIds.length * 64))
        })
      }, options.signal)

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw translationHttpError(res.status, errText)
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        translation?: string
      }
      const transText = (data.choices?.[0]?.message?.content || data.translation || '').trim()
      if (!transText) throw new Error('Server AI trả về kết quả rỗng')

      const candidate = parseTranslationItems(transText)
      try {
        validateTranslationItems(candidate, expectedIds)
        if (isLikelySourceScriptEcho(sourceBlocks, candidate, sourceLanguage, targetLanguage)) {
          invalidResponseReason = 'nội dung phản hồi vẫn ở hệ chữ nguồn'
          // Do not spend another request repeating the same oversized prompt;
          // the bounded semantic split below is the recovery path.
          break
        }
        resultMap = new Map(candidate.map((item) => [item.id, item.text]))
        break
      } catch (error) {
        invalidResponseReason = error instanceof Error ? error.message : 'schema không hợp lệ'
      }

      if (responseAttempt < LOCAL_TRANSLATION_RESPONSE_MAX_ATTEMPTS - 1) {
        logWarn(`[Translate] Batch ${startCueIndex + 1}-${startCueIndex + batchCues.length} ${invalidResponseReason}; thử lại response.`)
        await waitForLocalTranslationRetry(LOCAL_TRANSLATION_RETRY_DELAYS_MS[responseAttempt], options.signal)
      }
    }

    if (resultMap) return resultMap

    const split = splitSemanticBatch(batchGroups)
    if (split) {
      const [leftGroups, rightGroups] = split
      const leftCount = leftGroups.reduce((sum, g) => sum + g.cues.length, 0)
      const rightCount = rightGroups.reduce((sum, g) => sum + g.cues.length, 0)
      logWarn(`[Translate] Batch ${startCueIndex + 1}-${startCueIndex + batchCues.length} ${invalidResponseReason || 'không đạt schema'}; chia thành ${leftCount}+${rightCount}.`)
      const leftMap = await translateGroupBatch(leftGroups, startCueIndex)
      const rightMap = await translateGroupBatch(rightGroups, startCueIndex + leftCount)
      return new Map([...leftMap.entries(), ...rightMap.entries()])
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
