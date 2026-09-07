import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ArtifactStage } from './autoShortArtifactCache'

/** Canonical JSON used by cache/checkpoint keys; object insertion order is irrelevant. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Stage key không nhận số NaN hoặc vô cực.')
    return JSON.stringify(value)
  }
  if (typeof value === 'bigint') return `{"$bigint":${JSON.stringify(value.toString())}}`
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (value instanceof Date) return `{"$date":${JSON.stringify(value.toISOString())}}`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new Error(`Stage key không hỗ trợ kiểu dữ liệu ${typeof value}.`)
}

/** Build an opaque SHA-256 key. Prompt/reference text is never stored in the key manifest. */
export function buildStageKey(
  stage: ArtifactStage,
  canonicalInputs: Readonly<Record<string, unknown>>
): string {
  return createHash('sha256')
    .update(canonicalJson({ schemaVersion: 1, stage, inputs: canonicalInputs }))
    .digest('hex')
}

/** Stream a source file once, so callers can share the resulting promise across stages. */
export async function hashFileSha256(filePath: string, signal?: AbortSignal): Promise<string> {
  if (!isAbsolute(filePath)) throw new Error('Source hash yêu cầu đường dẫn tuyệt đối.')
  const info = await stat(filePath)
  if (!info.isFile() || info.size <= 0) throw new Error('Source hash yêu cầu một file có dữ liệu.')
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Đã hủy source hash.')
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Đã hủy source hash.')
      hash.update(chunk as Buffer)
    }
  } finally {
    stream.destroy()
  }
  return hash.digest('hex')
}

export interface SourceDigestMemo {
  get(filePath: string, signal?: AbortSignal): Promise<string>
  clear(): void
}

/** Memoize source hashing per run without relying on size/mtime as identity. */
export function createSourceDigestMemo(): SourceDigestMemo {
  const promises = new Map<string, Promise<string>>()
  const waitForDigest = (promise: Promise<string>, signal?: AbortSignal): Promise<string> => {
    if (!signal) return promise
    if (signal.aborted) return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Đã hủy source hash.'))
    return new Promise<string>((resolve, reject) => {
      let settled = false
      const onAbort = (): void => {
        if (settled) return
        settled = true
        reject(signal.reason instanceof Error ? signal.reason : new Error('Đã hủy source hash.'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then((value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      }, (error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      })
    })
  }
  return {
    get(filePath: string, signal?: AbortSignal): Promise<string> {
      const existing = promises.get(filePath)
      if (existing) return waitForDigest(existing, signal)
      const promise = hashFileSha256(filePath).finally(() => {
        // Keep the settled digest for the lifetime of this run; this is a
        // memo, not a process-global cache and therefore cannot become stale
        // across a new job.
      })
      promises.set(filePath, promise)
      return waitForDigest(promise, signal)
    },
    clear(): void {
      promises.clear()
    }
  }
}
