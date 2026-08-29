import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildSrt,
  huongDan,
  parseSrt,
  parseTranslationItems,
  validateTranslationItems,
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
      signal: AbortSignal.timeout(10_000)
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
  const batches = buildSemanticBatches(semanticGroups, 10)
  const translatedBlocks: SrtBlock[] = []

  let doneCount = 0

  const translateGroupBatch = async (
    batchGroups: SemanticGroup<SrtBlock>[],
    startCueIndex: number
  ): Promise<Map<string, string>> => {
    const batchCues = batchGroups.flatMap((g) => g.cues)
    const expectedIds = batchCues.map((c) => c.id || '')

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

    const systemPrompt = huongDan(targetLanguage, { mode, sourceLanguage })

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
    for (let gIdx = 0; gIdx < batchGroups.length; gIdx++) {
      const g = batchGroups[gIdx]
      if (batchGroups.length > 1) {
        userPromptLines.push(`[Nhóm câu ${gIdx + 1}]`)
      }
      for (const cue of g.cues) {
        const timing = parseCueTiming(cue)
        const durStr = timing.start != null && timing.end != null
          ? ` (thời lượng: ${(timing.end - timing.start).toFixed(2)}s)`
          : ''
        userPromptLines.push(`[${cue.id}]${mode === 'dubbing' ? durStr : ''} ${cue.text}`)
      }
    }

    if (contextAfter.length > 0) {
      userPromptLines.push(
        '',
        '[Ngữ cảnh phía sau (chỉ để hiểu nghĩa, không dịch)]:',
        ...contextAfter.map((c) => `[${c.id}] ${c.text}`)
      )
    }

    const userPrompt = userPromptLines.join('\n')
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
          temperature: DEFAULT_LOCAL_TRANSLATION_TEMPERATURE
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

