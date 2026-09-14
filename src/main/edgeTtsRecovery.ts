export type EdgeFailureCode = 'cancelled' | 'rate_limited' | 'access_denied' | 'timeout' | 'transient_network' | 'provider_5xx' | 'invalid_input' | 'audio_validation' | 'local_media' | 'disk' | 'unknown' | 'circuit_open'

export class EdgeTtsError extends Error {
  constructor(
    readonly code: EdgeFailureCode,
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) { super(message); this.name = 'EdgeTtsError' }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = /^\d+(?:\.\d+)?$/u.test(value.trim()) ? Number(value) : NaN
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now
  return Number.isFinite(delay) && delay >= 0 ? delay : undefined
}

export function classifyEdgeFailure(error: unknown, cancelled = false): EdgeTtsError {
  if (cancelled) return new EdgeTtsError('cancelled', 'Đã hủy tác vụ Edge-TTS')
  if (error instanceof EdgeTtsError) return error
  const message = error instanceof Error ? error.message : String(error)
  // Only accept status in a HTTP/handshake diagnostic, never arbitrary numbers in text.
  const statusText = /(?:HTTP\s+|Unexpected server response:\s*)(\d{3})\b/iu.exec(message)?.[1]
  const status = statusText ? Number(statusText) : undefined
  if (status === 429) return new EdgeTtsError('rate_limited', 'Edge-TTS giới hạn tần suất (HTTP 429).', status)
  if (status === 401 || status === 403) return new EdgeTtsError('access_denied', `Edge-TTS từ chối truy cập (HTTP ${status}).`, status)
  if (status && status >= 500) return new EdgeTtsError('provider_5xx', `Edge-TTS lỗi máy chủ (HTTP ${status}).`, status)
  if (status && status >= 400) return new EdgeTtsError('invalid_input', `Edge-TTS từ chối request (HTTP ${status}).`, status)
  if (/ENOSPC|không đủ dung lượng/iu.test(message)) return new EdgeTtsError('disk', 'Không đủ dung lượng cho Edge-TTS.')
  if (/hết thời gian chờ|ETIMEDOUT|timed?\s*out/iu.test(message)) return new EdgeTtsError('timeout', 'Edge-TTS hết thời gian chờ.')
  if (/ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|socket hang up|Stream closed before/iu.test(message)) {
    return new EdgeTtsError('transient_network', 'Kết nối Edge-TTS bị gián đoạn.')
  }
  return new EdgeTtsError('unknown', 'Edge-TTS không hoàn tất yêu cầu; xem chẩn đoán cục bộ.')
}

export function retryableEdgeFailure(error: EdgeTtsError): boolean {
  return ['rate_limited', 'timeout', 'transient_network', 'provider_5xx'].includes(error.code)
}
