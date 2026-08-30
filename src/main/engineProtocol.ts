export const WHISPER_PROTOCOL = 'whisper-engine/1' as const

export interface WhisperVersionEvent {
  type: 'version'
  protocol: typeof WHISPER_PROTOCOL
  engine: 'faster-whisper'
  version: string
  features?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isWhisperVersionEvent(value: unknown): value is WhisperVersionEvent {
  if (!isRecord(value)) return false
  if (value.type !== 'version' || value.protocol !== WHISPER_PROTOCOL || value.engine !== 'faster-whisper') return false
  if (typeof value.version !== 'string' || value.version.trim().length === 0) return false
  return value.features === undefined ||
    (Array.isArray(value.features) && value.features.every((feature) => typeof feature === 'string'))
}

export function parseWhisperVersion(output: string): WhisperVersionEvent | null {
  for (const line of output.split(/\r?\n/).reverse()) {
    const text = line.trim()
    if (!text) continue
    try {
      const parsed: unknown = JSON.parse(text)
      if (isWhisperVersionEvent(parsed)) return parsed
    } catch {
      // Diagnostics may be printed beside the JSON-lines protocol.
    }
  }
  return null
}
