import { app, safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { GeminiKeyInfo } from '../shared/types'

const MAX_KEYS = 20
const keyFile = (): string => join(app.getPath('userData'), 'gk.bin')
const keyId = (key: string): string => createHash('sha256').update(key).digest('hex').slice(0, 24)
let mutations: Promise<unknown> = Promise.resolve()

export function parseGeminiKeys(value: string): string[] {
  if (typeof value !== 'string' || value.length > 20_000) throw new Error('Danh sách khóa Gemini không hợp lệ.')
  const keys = [...new Set(value.split(/\r?\n/u).map(key => key.trim()).filter(Boolean))]
  if (keys.length > MAX_KEYS) throw new Error(`Tối đa ${MAX_KEYS} khóa Gemini.`)
  if (keys.some(key => !/^[A-Za-z0-9_-]{6,256}$/u.test(key))) throw new Error('Mỗi dòng cần một khóa Gemini, không kèm dấu cách hoặc ký tự khác.')
  return keys
}

export async function loadGeminiKeys(): Promise<string[]> {
  try {
    const buffer = await readFile(keyFile())
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buffer) : buffer.toString('utf8')
    if (!text.trim().startsWith('{')) return parseGeminiKeys(text) // legacy single key
    const stored = JSON.parse(text) as { version?: number; keys?: unknown }
    if (stored.version !== 1 || !Array.isArray(stored.keys) || stored.keys.some(key => typeof key !== 'string')) throw new Error('invalid')
    return parseGeminiKeys(stored.keys.join('\n'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('Không thể đọc khóa Gemini đã lưu trên máy.')
  }
}

async function writeKeys(keys: string[]): Promise<void> {
  const path = keyFile()
  if (!keys.length) { await rm(path, { force: true }); return }
  await mkdir(app.getPath('userData'), { recursive: true })
  const text = JSON.stringify({ version: 1, keys })
  const buffer = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8')
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }).catch(() => {}) }
}

function mutate(action: () => Promise<void>): Promise<void> {
  const pending = mutations.then(action)
  mutations = pending.catch(() => {})
  return pending
}

export function replaceGeminiKeys(value: string): Promise<void> {
  const keys = parseGeminiKeys(value)
  return mutate(async () => { await writeKeys(keys); rotationForProfile().reset() })
}

export function addGeminiKeys(value: string): Promise<void> {
  const incoming = parseGeminiKeys(value)
  if (!incoming.length) throw new Error('Hãy nhập ít nhất một khóa Gemini.')
  return mutate(async () => {
    const keys = parseGeminiKeys([...(await loadGeminiKeys()), ...incoming].join('\n'))
    await writeKeys(keys)
  })
}

export function removeGeminiKey(id: string): Promise<void> {
  if (typeof id !== 'string' || !/^[a-f0-9]{24}$/u.test(id)) throw new Error('Mã khóa Gemini không hợp lệ.')
  return mutate(async () => { await writeKeys((await loadGeminiKeys()).filter(key => keyId(key) !== id)) })
}

export async function listGeminiKeys(): Promise<GeminiKeyInfo[]> {
  return (await loadGeminiKeys()).map((key, index) => ({ id: keyId(key), masked: `Khóa ${index + 1} · ••••${key.slice(-4)}` }))
}

export interface GeminiRequestResult {
  ok: boolean
  text?: string
  lui?: boolean
  status?: number
  err?: string
  truncated?: boolean
  retryAfterMs?: number
  allKeysExhausted?: boolean
}

/** Shared across Gemini translation, rephrase and title requests for this profile. */
export class GeminiKeyRotation {
  private active = ''
  private cooldown = new Map<string, Map<string, number>>()
  constructor(private now: () => number = Date.now) {}
  reset(): void { this.active = ''; this.cooldown.clear() }
  preferred(keys: readonly string[], model = ''): string {
    const cooldown = this.cooldown.get(model)
    return keys.find(key => key === this.active && (cooldown?.get(key) || 0) <= this.now())
      || keys.find(key => (cooldown?.get(key) || 0) <= this.now()) || keys[0] || ''
  }
  async run(keys: readonly string[], request: (key: string) => Promise<GeminiRequestResult>, signal?: AbortSignal, model = ''): Promise<GeminiRequestResult> {
    signal?.throwIfAborted()
    const unique = [...new Set(keys)]
    if (!unique.length) return { ok: false, status: 401, err: 'Chưa có khóa Gemini.' }
    // Quotas are project/model scoped; exhaustion on one model must not block another.
    let cooldown = this.cooldown.get(model)
    if (!cooldown) { cooldown = new Map(); this.cooldown.set(model, cooldown) }
    const first = this.preferred(unique, model)
    const ordered = [first, ...unique.filter(key => key !== first)]
    for (const key of ordered) {
      signal?.throwIfAborted()
      if ((cooldown.get(key) || 0) > this.now()) continue
      const result = await request(key)
      signal?.throwIfAborted()
      if (result.status !== 429) {
        if (result.ok && (cooldown.get(key) || 0) <= this.now()) this.active = key
        return result
      }
      const wait = Number.isFinite(result.retryAfterMs) ? Math.max(1000, result.retryAfterMs!) : 60_000
      cooldown.set(key, Math.max(cooldown.get(key) || 0, this.now() + wait))
    }
    return { ok: false, status: 429, lui: true, allKeysExhausted: true,
      retryAfterMs: Math.max(1000, Math.min(...unique.map(key => cooldown.get(key) || this.now())) - this.now()),
      err: 'Tất cả khóa Gemini hiện vượt hạn mức. Hãy chờ quota hồi phục hoặc thêm khóa còn hạn mức.' }
  }
}

const rotations = new Map<string, GeminiKeyRotation>()
export function rotationForProfile(): GeminiKeyRotation {
  const profile = keyFile()
  let rotation = rotations.get(profile)
  if (!rotation) { rotation = new GeminiKeyRotation(); rotations.set(profile, rotation) }
  return rotation
}

export function geminiRetryAfterMs(response: Response, body: string): number | undefined {
  const header = response.headers.get('retry-after')
  const waits: number[] = []
  if (header) {
    const seconds = Number(header)
    const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
    if (Number.isFinite(wait)) waits.push(Math.max(0, wait))
  }
  try {
    const details = JSON.parse(body)?.error?.details
    if (Array.isArray(details)) for (const detail of details) {
      if (detail?.['@type'] !== 'type.googleapis.com/google.rpc.RetryInfo') continue
      const match = /^(\d+(?:\.\d+)?)s$/u.exec(String(detail.retryDelay))
      if (match && Number.isFinite(Number(match[1]))) waits.push(Number(match[1]) * 1000)
    }
  } catch { /* provider may return plain text */ }
  return waits.length ? Math.max(...waits) : undefined
}
