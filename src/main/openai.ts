import { safeStorage, app } from 'electron'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { debugRaw, errLabel, logInfo } from './logger'
import type { DichKeyStatus, SrtBlock } from '../shared/types'
import {
  buildSrt,
  buildDubbingTranslationPayload,
  buildTranslationBatches,
  chia,
  huongDan,
  parseSrt,
  stripOuterQuotes,
  validateTranslationItems
} from './translate-shared'

const BASE = 'https://api.openai.com/v1'

// ---- Khoa cua user: ma hoa bang DPAPI (Win) / Keychain (mac) ----
function keyFile(): string {
  return join(app.getPath('userData'), 'ok.bin')
}

export async function saveKey(key: string): Promise<void> {
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

export async function loadKey(): Promise<string> {
  try {
    const buf = await readFile(keyFile())
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf-8')
  } catch {
    return ''
  }
}

export async function hasKey(): Promise<boolean> {
  return (await loadKey()).length > 0
}

// ---- Chon model ----
const DU_PHONG = ['gpt-4o-mini', 'gpt-4o']

function diem(n: string): number {
  let s = 0
  if (n === 'gpt-4o-mini') s += 200
  if (n === 'gpt-4o') s += 150
  if (n.startsWith('gpt-4o-mini')) s += 100
  if (n.startsWith('gpt-4o')) s += 80
  if (n.includes('mini')) s += 20
  if (n.includes('realtime') || n.includes('audio') || n.includes('search')) s -= 100
  return s
}

async function danhSach(key: string): Promise<string[]> {
  let ds: string[] = []
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000)
    })
    if (res.ok) {
      const d = (await res.json()) as { data?: { id?: string }[] }
      ds = (d.data ?? [])
        .map((m) => m.id ?? '')
        .filter((id) => id.startsWith('gpt-4o') && !id.includes('realtime') && !id.includes('audio'))
    }
  } catch {
    /* rot ve du phong */
  }
  const pool = ds.length ? ds : DU_PHONG
  const uniq = [...new Set(pool)]
  return uniq.sort((a, b) => diem(b) - diem(a))
}

interface GenKQ {
  ok: boolean
  text?: string
  lui?: boolean
  status?: number
  err?: string
}

const HAN_KIEM = 20_000
const HAN_DICH = 180_000

/** OpenAI json_schema bat root object — boc mang {n,t} trong `items`. */
const SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'srt_translation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              t: { type: 'string' }
            },
            required: ['id', 't'],
            additionalProperties: false
          }
        }
      },
      required: ['items'],
      additionalProperties: false
    }
  }
}

async function goi(
  key: string,
  model: string,
  sys: string,
  user: string,
  dungSchema: boolean,
  han = HAN_DICH,
  signal?: AbortSignal
): Promise<GenKQ> {
  const messages: { role: string; content: string }[] = []
  if (sys) messages.push({ role: 'system', content: sys })
  messages.push({ role: 'user', content: user })

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.2
  }
  if (dungSchema) body.response_format = SCHEMA

  let res: Response
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(han)]) : AbortSignal.timeout(han)
    })
  } catch (e) {
    return { ok: false, lui: true, status: 0, err: String(e) }
  }
  if (!res.ok) {
    const t = await res.text()
    return { ok: false, lui: res.status === 429 || res.status >= 500, status: res.status, err: t }
  }
  const d = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[]
  }
  const text = d.choices?.[0]?.message?.content ?? ''
  if (!text.trim()) return { ok: false, lui: false, status: 200, err: 'rỗng' }
  return { ok: true, text }
}

async function goiCoLui(
  key: string,
  models: string[],
  sys: string,
  user: string,
  dungSchema: boolean,
  han?: number,
  signal?: AbortSignal
): Promise<GenKQ> {
  if (!models.length) return { ok: false, err: 'network: không lấy được danh sách' }
  let cuoi: GenKQ = { ok: false, err: 'hết model' }
  for (const m of models) {
    const r = await goi(key, m, sys, user, dungSchema, han, signal)
    if (r.ok) return r
    debugRaw(`openai ${m}`, r.err)
    cuoi = r
    if (!r.lui) break
  }
  return cuoi
}

export async function checkKey(key: string): Promise<DichKeyStatus> {
  const k = key.trim() || (await loadKey())
  if (!k) return { ok: false, message: 'Chưa nhập API key.' }

  const models = await danhSach(k)
  if (!models.length) return { ok: false, message: 'Kiểm tra thất bại: lỗi kết nối mạng.' }

  let ketHan = 0
  let loiKhac = ''
  for (const m of models) {
    const r = await goi(k, m, '', 'xin chào', false, HAN_KIEM)
    if (r.ok) return { ok: true, message: 'API KEY của bạn dùng được.' }
    debugRaw(`openai checkKey ${m}`, r.err)

    if (r.status === 0) return { ok: false, message: `Kiểm tra thất bại: ${errLabel(r.err)}` }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, message: 'API KEY không dùng được. Vui lòng tạo khoá mới và dán lại.' }
    }
    if (r.status === 429) ketHan++
    else loiKhac = r.err ?? ''
  }

  if (ketHan && !loiKhac) {
    return { ok: false, message: 'API KEY đã dùng hết lượt hôm nay. Vui lòng thử lại sau.' }
  }
  return { ok: false, message: `API KEY không dùng được: ${errLabel(loiKhac)}` }
}

/**
 * Dich 1 file .srt qua OpenAI. Timestamp khong gui di — ghep lai sau.
 */
export async function translateSrt(
  srtPath: string,
  outPath: string,
  dich: string,
  onProgress?: (done: number, total: number) => void,
  options: { strict?: boolean; mode?: 'subtitle' | 'dubbing'; concise?: boolean; sourceLanguage?: string | null; contextRadius?: number; signal?: AbortSignal } = {}
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const key = await loadKey()
  if (!key) return { ok: false, error: 'Chưa có API key.' }

  const blocks = parseSrt(await readFile(srtPath, 'utf-8')).map((block, index) => ({
    ...block,
    id: block.id || `cue-${index}`,
    sourceIndex: block.sourceIndex ?? index
  }))
  if (!blocks.length) return { ok: false, error: 'File phụ đề trống.' }

  const models = await danhSach(key)
  const chunks = options.mode === 'dubbing' ? buildTranslationBatches(blocks) : chia(blocks)
  logInfo(`Dịch phụ đề (ChatGPT): ${blocks.length} câu…`)

  const ra: SrtBlock[] = []
  let processed = 0
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    let payload: string
    if (options.mode === 'dubbing') {
      payload = buildDubbingTranslationPayload(c, blocks, options.contextRadius)
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
    const r = await goiCoLui(key, models, huongDan(dich, { mode: options.mode, concise: options.concise, sourceLanguage: options.sourceLanguage }), payload, true, undefined, options.signal)
    if (!r.ok) return { ok: false, error: errLabel(r.err) }

    let arr: { id: string; t: string }[] = []
    try {
      const parsed = JSON.parse(r.text as string) as
        | { items?: { id?: unknown; t?: unknown }[] }
        | { id?: unknown; t?: unknown }[]
      const rawItems = Array.isArray(parsed) ? parsed : (parsed.items ?? [])
      arr = rawItems.map((item) => {
        const rawT = typeof item.t === 'string' ? item.t.trim() : ''
        const cleanT = stripOuterQuotes(rawT.replace(/^\s*\((?:thời lượng|duration|time)[\s\S]*?\)\s*/iu, '').trim())
        return {
          id: typeof item.id === 'string' ? item.id.trim() : '',
          t: cleanT
        }
      })
    } catch {
      return { ok: false, error: 'Kết quả dịch không đọc được.' }
    }
    try {
      validateTranslationItems(arr.map((item) => ({ id: item.id, text: item.t })), c.map((block) => block.id || ''))
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Kết quả dịch không đạt contract.' }
    }
    const map = new Map(arr.map((item) => [item.id, item.t]))
    c.forEach((b) => {
      const translatedText = map.get(b.id || '')
      if (!translatedText) throw new Error('Kết quả dịch thiếu cue.')
      ra.push({ ...b, text: translatedText })
    })
    processed += c.length
    onProgress?.(processed, blocks.length)
  }

  await writeFile(outPath, buildSrt(ra), 'utf-8')
  logInfo(`Dịch phụ đề (ChatGPT): xong ${ra.length} câu.`)
  return { ok: true, count: ra.length }
}

export async function rephraseOpenaiCue(
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<string | null> {
  const key = await loadKey()
  if (!key) return null
  const models = await danhSach(key)
  const r = await goiCoLui(key, models, systemPrompt, userPrompt, false, undefined, signal)
  if (!r.ok || !r.text) return null
  return String(r.text)
}
