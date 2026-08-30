export const WHISPER_PROTOCOL = 'whisper-engine/1' as const
export const LEGACY_WHISPER_PROTOCOL = 'whisper-local/1' as const

export interface WhisperVersionEvent {
  type: 'version'
  protocol: typeof WHISPER_PROTOCOL | typeof LEGACY_WHISPER_PROTOCOL
  engine: 'faster-whisper' | 'whisper.cpp'
  version: string
  features?: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isWhisperVersionEvent(value: unknown): value is WhisperVersionEvent {
  if (!isRecord(value)) return false
  if (value.type !== 'version') return false
  if (value.protocol !== WHISPER_PROTOCOL && value.protocol !== LEGACY_WHISPER_PROTOCOL) return false
  if (value.engine !== 'faster-whisper' && value.engine !== 'whisper.cpp') return false
  if (typeof value.version !== 'string' || value.version.trim().length === 0) return false
  if (value.features !== undefined && (!Array.isArray(value.features) || !value.features.every((f) => typeof f === 'string'))) {
    return false
  }
  return true
}

export function parseWhisperVersion(output: string): WhisperVersionEvent | null {
  for (const line of output.split(/\r?\n/).reverse()) {
    const text = line.trim()
    if (!text) continue
    try {
      const parsed: unknown = JSON.parse(text)
      if (isWhisperVersionEvent(parsed)) return parsed
    } catch {
      // A native runtime may write diagnostics beside its JSON protocol.
    }
  }
  return null
}
