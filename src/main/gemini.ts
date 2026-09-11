import { readFile, writeFile } from 'node:fs/promises'
import { debugRaw, errLabel, logInfo } from './logger'
import type { GeminiStatus, SrtBlock } from '../shared/types'
import type { TranslationAssessment, TranslationInput, TranslationItem } from '../shared/translation'
import type { TranslationBudgetSnapshot } from './translation/budget'
import {
  buildSrt,
  buildDubbingTranslationPayload,
  buildTranslationBatches,
  chia,
  parseSrt,
  stripOuterQuotes,
  validateTranslationItems
} from './translate-shared'
import { buildTranslationMessages, buildTranslationBatchMessages } from './translation/prompts'
import { parseTranslationResponse } from './translation/response'
import type { TranslationAdapter } from './translation/orchestrator'
import { translateFileWithAdapter } from './translation/fileRunner'
import { addGeminiKeys, removeGeminiKey, listGeminiKeys, replaceGeminiKeys, loadGeminiKeys,
  parseGeminiKeys, rotationForProfile, GeminiKeyRotation, geminiRetryAfterMs, type GeminiRequestResult } from './geminiKeys'

export { parseSrt, buildSrt } from './translate-shared'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

// Preserve the legacy single-key API; the new UI appends/removes through typed IPC.
export const saveKey = replaceGeminiKeys
export const addKeys = addGeminiKeys
export const removeKey = removeGeminiKey
export const listKeys = listGeminiKeys
export async function loadKey(): Promise<string> {
  return rotationForProfile().preferred(await loadGeminiKeys())
}

export async function hasKey(): Promise<boolean> {
  // Status probes remain non-throwing; the key manager reports read errors explicitly.
  try { return (await loadKey()).length > 0 } catch { return false }
}

// ---- Chon model ----
const DU_PHONG = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite']
const LOAI = /image|imagen|tts|audio|speech|embedding|robotics|computer-use|omni/

function diem(n: string): number {
  const m = n.match(/(\d+\.\d+|\d+)/)
  let s = (m ? parseFloat(m[1]) : 1) * 100
  if (n.includes('flash')) s += 50
  if (n.includes('lite')) s -= 20
  if (n.includes('preview') || n.includes('-exp')) s -= 30
  return s
}

async function danhSach(key: string, signal?: AbortSignal): Promise<string[]> {
  let ds: string[] = []
  try {
    // Cung phai co han: mat mang o day thi treo truoc khi kip goi dich.
    signal?.throwIfAborted()
    const res = await fetch(`${BASE}/models`, { headers: { 'x-goog-api-key': key },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    if (res.ok) {
      const d = (await res.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[]
      }
      ds = (d.models ?? [])
        .filter(
          (m) =>
            (m.name ?? '').includes('gemini-') &&
            (m.supportedGenerationMethods ?? []).includes('generateContent')
        )
        .map((m) => (m.name as string).replace('models/', ''))
    }
  } catch {
    signal?.throwIfAborted()
    /* rot ve du phong */
  }
  const pool = ds.length ? ds : DU_PHONG
  // Translation may use at most two models selected by the configured
  // provider profile. A long discovery list must never become an unbounded
  // model-hop retry loop.
  return pool.filter((n) => !LOAI.test(n)).sort((a, b) => diem(b) - diem(a)).slice(0, 2)
}

type GenKQ = GeminiRequestResult

// fetch cua Node KHONG tu het gio. Google mo ket noi roi im -> cho VINH VIEN,
// nut quay mai, khong co duong thoat. Bat buoc phai tu dat han.
const HAN_KIEM = 20_000 // kiem key: 1 cau "xin chào", 20s la qua du
const HAN_DICH = 180_000 // dich 1 chunk 20k ky tu: do that 14-60s

async function goi(
  key: string,
  model: string,
  sys: string,
  user: string,
  schema?: object,
  han = HAN_DICH,
  signal?: AbortSignal
): Promise<GenKQ> {
  const cfg: Record<string, unknown> = { temperature: 0.2 }
  if (schema) {
    cfg.responseMimeType = 'application/json'
    cfg.responseSchema = schema
  }
  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: cfg
  }
  if (sys) body.systemInstruction = { parts: [{ text: sys }] }
  let res: Response
  try {
    res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(han)]) : AbortSignal.timeout(han)
    })
  } catch (e) {
    signal?.throwIfAborted()
    return { ok: false, lui: true, status: 0, err: String(e).split(key).join('[REDACTED]') }
  }
  if (!res.ok) {
    const t = await res.text()
    return { ok: false, lui: res.status === 429 || res.status >= 500, status: res.status,
      retryAfterMs: geminiRetryAfterMs(res, t), err: t.split(key).join('[REDACTED]') }
  }
  const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] }
  const candidate = d.candidates?.[0]
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('')
  if (!text.trim()) return { ok: false, lui: false, status: 200, err: 'rỗng' }
  return { ok: true, text, truncated: candidate?.finishReason === 'MAX_TOKENS' }
}

async function goiCoLui(
  key: string | undefined,
  models: string[],
  sys: string,
  user: string,
  schema?: object,
  han?: number,
  signal?: AbortSignal
): Promise<GenKQ> {
  // Khong co model nao de thu -> phai bao ro, dung de rot ve "lỗi không xác định"
  if (!models.length) return { ok: false, err: 'network: không lấy được danh sách' }
  let cuoi: GenKQ = { ok: false, err: 'hết model' }
  for (const m of models) {
    const r = await runWithKeys(key, m, candidate => goi(candidate, m, sys, user, schema, han, signal), signal)
    if (r.ok) return r
    debugRaw(`gemini ${m}`, r.err)
    cuoi = r
    if (!r.lui) break
  }
  return cuoi
}

async function runWithKeys(key: string | undefined, model: string, request: (key: string) => Promise<GenKQ>, signal?: AbortSignal): Promise<GenKQ> {
  signal?.throwIfAborted()
  const keys = key === undefined ? await loadGeminiKeys() : parseGeminiKeys(key)
  // Explicit test/validation keys never silently use another saved credential.
  const rotation = key === undefined ? rotationForProfile() : new GeminiKeyRotation()
  return rotation.run(keys, request, signal, model)
}

/**
 * Kiem tra khoa = gui MOT cau chao that don gian, co tra loi la khoa con song.
 * Khong system instruction, khong schema — cang it thu cang it cho hong.
 * UI chi duoc bao dung/khong: khong ten model, khong so lieu.
 */
export async function checkKey(key: string): Promise<GeminiStatus> {
  const explicit = key.trim() || undefined
  const k = explicit ? parseGeminiKeys(explicit)[0] : await loadKey()
  if (!k) return { ok: false, message: 'Chưa nhập API key.' }

  const models = await danhSach(k)
  if (!models.length) return { ok: false, message: 'Kiểm tra thất bại: lỗi kết nối mạng.' }

  // Co mang thi Google LUON tra loi — chi la tra bang loi. Nen ket luan "khoa
  // chet" chi duoc rut ra khi da di HET danh sach ma khong cai nao tra loi.
  // (Truoc day chi thu 5 -> 5 cai dau ket hạn la bao chet, trong khi nhung cai
  //  sau van song -> bao oan.)
  let ketHan = 0
  let loiKhac = ''
  for (const m of models) {
    const r = await runWithKeys(explicit, m, candidate => goi(candidate, m, '', 'xin chào', undefined, HAN_KIEM))
    if (r.ok) return { ok: true, message: 'API KEY của bạn dùng được.' }
    debugRaw(`checkKey ${m}`, r.err)

    // Mat mang / het gio -> dung ngay, thu tiep cung vo ich
    if (r.status === 0) return { ok: false, message: `Kiểm tra thất bại: ${errLabel(r.err)}` }
    // Khoa sai/bi thu hoi -> chac chan chet, khong can thu tiep
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      return { ok: false, message: 'API KEY không dùng được. Vui lòng tạo khoá mới và dán lại.' }
    }
    if (r.status === 429) ketHan++
    else loiKhac = r.err ?? ''
  }

  // Di het danh sach, khong cai nao tra loi
  if (ketHan && !loiKhac) {
    return { ok: false, message: 'Các khóa Gemini hiện vượt hạn mức. Hãy thử lại sau hoặc thêm khóa còn quota.' }
  }
  return { ok: false, message: `API KEY không dùng được: ${errLabel(loiKhac)}` }
}

// ---- Dich .srt ----
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, text: { type: 'STRING' } },
        required: ['id', 'text']
      }
    }
  },
  required: ['items']
}

/** One logical request with finite credential failover; transport retry remains in the scheduler. */
export async function createGeminiTranslationAdapter(key?: string, signal?: AbortSignal): Promise<TranslationAdapter> {
  signal?.throwIfAborted()
  const models = await danhSach(key || await loadKey(), signal)
  let cursor = 0
  const firstModel = models[0] || 'gemini-2.5-flash'
  return {
    capability: {
      provider: 'gemini', modelIdentity: firstModel, revisionKnown: false,
      format: 'json-items', contextTokens: null, outputTokens: 2_048
    },
    async requestOnce(batch, signal) {
      const start = Math.min(cursor++, Math.max(0, models.length - 1))
      const candidates = models.length ? [...models.slice(start), ...models.slice(0, start)] : [firstModel]
      let model = candidates[0]
      let result: GenKQ = { ok: false }
      let earliestRetryMs = Infinity
      const messages = buildTranslationBatchMessages(batch, 'json-items')
      for (const candidateModel of candidates) {
        model = candidateModel
        result = await runWithKeys(key, model, candidate => goi(candidate, model, messages[0].content, messages[1].content, SCHEMA, undefined, signal), signal)
        if (!result.allKeysExhausted) break
        earliestRetryMs = Math.min(earliestRetryMs, result.retryAfterMs ?? 60_000)
      }
      if (result.allKeysExhausted) result.retryAfterMs = earliestRetryMs
      if (!result.ok) {
        const retryable = result.lui === true || result.status === 429 || (result.status != null && result.status >= 500)
        throw Object.assign(new Error(result.err || 'Gemini translation request failed.'), {
          status: result.status,
          retryAfterMs: result.retryAfterMs,
          providerCode: retryable ? 'provider-transient' : result.status === 401 || result.status === 403 ? 'provider-auth' : 'provider-protocol'
        })
      }
      return { raw: result.text || '', truncated: result.truncated === true, modelIdentity: model }
    }
  }
}

/**
 * Dich 1 file .srt. Timestamp KHONG bao gio gui di — giu o may, ghep lai sau.
 * Khoi nao khong co ban dich -> giu nguyen chu goc (tha 1 dong chua dich con
 * hon ca file sai gio).
 */
export async function translateSrt(
  srtPath: string,
  outPath: string,
  dich: string,
  onProgress?: (done: number, total: number) => void,
  options: { strict?: boolean; mode?: 'subtitle' | 'dubbing'; concise?: boolean; sourceLanguage?: string | null; contextRadius?: number; signal?: AbortSignal; onBatch?: (items: readonly { id: string; text: string }[], batchIndex: number) => Promise<void> | void; onBudget?: (snapshot: TranslationBudgetSnapshot) => Promise<void> | void; resumeItems?: readonly TranslationItem[]; restoredBudget?: TranslationBudgetSnapshot; translationGuidance?: import('../shared/translation').TranslationGuidance } = {}
): Promise<{ ok: boolean; error?: string; count?: number; assessment?: TranslationAssessment; budget?: TranslationBudgetSnapshot; modelIdentity?: string }> {
  const key = await loadKey()
  if (!key) return { ok: false, error: 'Chưa có API key.' }

  if (options.strict) {
    const adapter = await createGeminiTranslationAdapter(undefined, options.signal)
    const result = await translateFileWithAdapter(srtPath, outPath, dich, adapter, {
      sourceLanguage: options.sourceLanguage,
      mode: options.mode || (options.concise ? 'dubbing' : 'subtitle'),
      signal: options.signal,
      onProgress,
      onBatch: options.onBatch,
      onBudget: options.onBudget,
      resumeItems: options.resumeItems,
      restoredBudget: options.restoredBudget,
      translationGuidance: options.translationGuidance
    })
    return { ok: result.ok, error: result.error, count: result.count, assessment: result.assessment, budget: result.budget, modelIdentity: result.modelIdentity }
  }

  const blocks = parseSrt(await readFile(srtPath, 'utf-8')).map((block, index) => ({
    ...block,
    id: block.id || `cue-${index}`,
    sourceIndex: block.sourceIndex ?? index
  }))
  if (!blocks.length) return { ok: false, error: 'File phụ đề trống.' }

  const models = await danhSach(key, options.signal)
  const chunks = options.mode === 'dubbing' ? buildTranslationBatches(blocks) : chia(blocks)
  logInfo(`Dịch phụ đề: ${blocks.length} câu…`)

  const ra: SrtBlock[] = []
  let processed = 0
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    let payload: string
    if (options.mode === 'dubbing') {
      payload = buildDubbingTranslationPayload(c, blocks, options.contextRadius, dich, options.sourceLanguage || 'auto')
    } else {
      const radius = Number.isInteger(options.contextRadius) ? Math.max(0, Math.min(3, options.contextRadius!)) : 1
      const firstIndex = blocks.findIndex((b) => b.id === c[0]?.id)
      const lastIndex = blocks.findIndex((b) => b.id === c[c.length - 1]?.id)
      const contextBefore = firstIndex > 0 ? blocks.slice(Math.max(0, firstIndex - radius), firstIndex) : []
      const contextAfter = lastIndex >= 0 && lastIndex < blocks.length - 1 ? blocks.slice(lastIndex + 1, Math.min(blocks.length, lastIndex + 1 + radius)) : []
      const payloadLines: string[] = []
      if (contextBefore.length > 0) {
        payloadLines.push(
          '[Ngữ cảnh phía trước (chỉ để hiểu nghĩa, không dịch)]:',
          ...contextBefore.map((b) => `[${b.id}] ${b.text}`),
          ''
        )
      }
      payloadLines.push('[Nội dung cần dịch]:')
      for (const cue of c) {
        payloadLines.push(`[${cue.id}] ${cue.text}`)
      }
      if (contextAfter.length > 0) {
        payloadLines.push(
          '',
          '[Ngữ cảnh phía sau (chỉ để hiểu nghĩa, không dịch)]:',
          ...contextAfter.map((b) => `[${b.id}] ${b.text}`)
        )
      }
      payload = payloadLines.join('\n')
    }
    const promptInput: TranslationInput = {
      sourceLanguage: options.sourceLanguage?.trim() || 'auto',
      targetLocale: dich,
      mode: options.mode || (options.concise ? 'dubbing' : 'subtitle'),
      cues: c.map((cue, index) => ({
        id: cue.id || `cue-${index}`,
        sourceIndex: cue.sourceIndex ?? index,
        start: typeof cue.start === 'number' ? cue.start : 0,
        end: typeof cue.end === 'number' ? cue.end : typeof cue.start === 'number' ? cue.start : 0,
        text: cue.text,
        groupId: `group-${cue.sourceIndex ?? index}`
      })),
      contextBefore: [],
      contextAfter: [],
      glossary: []
    }
    const messages = buildTranslationMessages(promptInput, 'json-items')
    const r = await goiCoLui(undefined, models, messages[0].content, messages[1].content, SCHEMA, undefined, options.signal)
    if (!r.ok) return { ok: false, error: errLabel(r.err) }

    const parsed = parseTranslationResponse(r.text || '', 'json-items', c.map((block) => block.id || ''), Boolean(r.truncated))
    if (!parsed.complete) {
      const firstIssue = parsed.issues.find((issue) => issue.severity === 'error')
      return { ok: false, error: firstIssue?.message || 'Kết quả dịch không đạt contract.' }
    }
    const arr = parsed.items.map((item) => ({
      id: item.id,
      t: stripOuterQuotes(item.text.replace(/^\s*\((?:thời lượng|duration|time)[\s\S]*?\)\s*/iu, '').trim())
    }))
    validateTranslationItems(arr.map((item) => ({ id: item.id, text: item.t })), c.map((block) => block.id || ''))
    const map = new Map(arr.map((item) => [item.id, item.t]))
    c.forEach((b) => {
      const translatedText = map.get(b.id || '')
      if (!translatedText) throw new Error('Kết quả dịch thiếu cue.')
      ra.push({ ...b, text: translatedText })
    })
    await options.onBatch?.(c.map((b) => ({ id: b.id || '', text: map.get(b.id || '') || '' })), i)
    processed += c.length
    onProgress?.(processed, blocks.length)
  }

  await writeFile(outPath, buildSrt(ra), 'utf-8')
  logInfo(`Dịch phụ đề: xong ${ra.length} câu.`)
  return { ok: true, count: ra.length }
}

export async function rephraseGeminiCue(
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<string | null> {
  signal?.throwIfAborted()
  const key = await loadKey()
  if (!key) return null
  const models = await danhSach(key, signal)
  const r = await goiCoLui(undefined, models, systemPrompt, userPrompt, undefined, undefined, signal)
  if (!r.ok || !r.text) return null
  return String(r.text)
}
