import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'

const userDataDir = (): string => (app && typeof app.getPath === 'function' ? app.getPath('userData') : process.cwd())
const keyFile = (): string => join(userDataDir(), 'typesafe_key.bin')
const plainFile = (): string => join(userDataDir(), 'typesafe_key.txt')

export async function checkTypeSafeKey(key: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = key.trim()
  if (!trimmed) return { ok: false, message: 'Khóa API không được để trống.' }
  if (!trimmed.startsWith('apikey_')) {
    return { ok: false, message: 'Khóa TypeSafe API phải bắt đầu bằng "apikey_".' }
  }

  const payload = JSON.stringify({
    state: 'Healthcheck',
    model: 'jev-latest',
    questions: {
      ping: {
        type: 'noul',
        instructions: 'Is this a healthcheck?'
      }
    }
  })

  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    try {
      const req = httpsRequest(
        'https://api.typesafe.ai/v1/systemone',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${trimmed}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 10000
        },
        (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => {
            if (res.statusCode === 200) {
              resolve({ ok: true, message: 'Khóa TypeSafe Jev hoạt động tốt.' })
            } else if (res.statusCode === 401) {
              resolve({ ok: false, message: 'Khóa API không hợp lệ hoặc đã hết hạn (401 Unauthorized).' })
            } else {
              resolve({ ok: false, message: `TypeSafe API trả về mã lỗi HTTP ${res.statusCode}.` })
            }
          })
        }
      )

      req.on('error', (e) => resolve({ ok: false, message: `Không thể kết nối đến TypeSafe API: ${e.message}` }))
      req.on('timeout', () => {
        req.destroy()
        resolve({ ok: false, message: 'Kết nối đến TypeSafe API bị quá thời gian (timeout).' })
      })
      req.write(payload)
      req.end()
    } catch (err: any) {
      resolve({ ok: false, message: `Lỗi: ${err?.message || String(err)}` })
    }
  })
}

export async function loadTypeSafeKey(): Promise<string | null> {
  const envKey = (process.env.TYPESAFE_API_KEY || '').trim()
  if (envKey.startsWith('apikey_')) return envKey

  try {
    const buffer = await readFile(keyFile())
    const text = safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString('utf8')
    const key = text.trim()
    if (key.startsWith('apikey_')) return key
  } catch {}

  try {
    const plain = (await readFile(plainFile(), 'utf8')).trim()
    if (plain.startsWith('apikey_')) return plain
  } catch {}

  return null
}

export async function hasTypeSafeKey(): Promise<boolean> {
  const k = await loadTypeSafeKey()
  return !!k
}

export async function saveTypeSafeKey(key: string): Promise<{ ok: boolean; message: string }> {
  const trimmed = key.trim()
  if (!trimmed) {
    await clearTypeSafeKey()
    return { ok: true, message: 'Đã xóa khóa TypeSafe API.' }
  }

  const check = await checkTypeSafeKey(trimmed)
  if (!check.ok) return check

  await mkdir(userDataDir(), { recursive: true })
  const buffer = safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(trimmed)
    : Buffer.from(trimmed, 'utf8')
  const path = keyFile()
  const tempPath = `${path}.${Math.random().toString(36).slice(2)}.tmp`

  try {
    await writeFile(tempPath, buffer, { flag: 'wx', mode: 0o600 })
    await rename(tempPath, path)
    await writeFile(plainFile(), trimmed, { encoding: 'utf8', mode: 0o600 }).catch(() => {})
    return { ok: true, message: 'Đã lưu và xác thực khóa TypeSafe Jev thành công.' }
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

export async function clearTypeSafeKey(): Promise<void> {
  await rm(keyFile(), { force: true }).catch(() => {})
  await rm(plainFile(), { force: true }).catch(() => {})
}

export async function getTypeSafeKeyInfo(): Promise<{ hasKey: boolean; masked: string }> {
  const key = await loadTypeSafeKey()
  if (!key) return { hasKey: false, masked: '' }
  const masked = key.length > 16 ? `${key.slice(0, 10)}...${key.slice(-6)}` : '••••••••'
  return { hasKey: true, masked }
}
