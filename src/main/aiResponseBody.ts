const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024

/** Read a provider response with a byte ceiling and strict UTF-8 decoding.
 * This gate runs before JSON.parse so parser limits cannot be bypassed by a
 * huge chunked body or malformed byte sequence. */
export async function readBoundedAiResponseText(
  response: Response,
  signal?: AbortSignal,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<string> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid AI response byte limit.')
  signal?.throwIfAborted()
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new Error('AI response exceeds the byte limit.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let total = 0
  let text = ''
  try {
    while (true) {
      signal?.throwIfAborted()
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) throw new Error('AI response exceeds the byte limit.')
      text += decoder.decode(next.value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch (error) {
    await reader.cancel(error).catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}

export async function readBoundedAiResponseJson<T>(
  response: Response,
  signal?: AbortSignal,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES
): Promise<T> {
  return JSON.parse(await readBoundedAiResponseText(response, signal, maxBytes)) as T
}
