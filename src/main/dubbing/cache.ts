import { createHash } from 'node:crypto'

export const DUBBING_TTS_CACHE_SCHEMA_VERSION = 2

export interface TtsCacheKeyInput {
  schemaVersion?: number
  endpoint?: string
  finalSpokenText: string
  language: string
  model: string
  voice?: string | null
  serverSpeed?: number | null
  options?: unknown
  referenceAudio?: unknown
  referenceTranscript?: string | null
}

function stableValue(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`
}

function normalizedCacheInput(input: TtsCacheKeyInput): Record<string, unknown> {
  return {
    schemaVersion: input.schemaVersion ?? DUBBING_TTS_CACHE_SCHEMA_VERSION,
    endpoint: input.endpoint?.trim() || '',
    finalSpokenText: input.finalSpokenText,
    language: input.language.trim().toLowerCase(),
    model: input.model.trim(),
    voice: input.voice?.trim() || null,
    serverSpeed: input.serverSpeed == null ? null : Number(input.serverSpeed),
    options: input.options ?? {},
    referenceAudio: input.referenceAudio ?? null,
    referenceTranscript: input.referenceTranscript ?? null
  }
}

export function buildTtsCacheKey(input: TtsCacheKeyInput): string {
  return createHash('sha256')
    .update(stableValue(normalizedCacheInput(input)))
    .digest('hex')
}

export function buildTtsCacheFingerprint(input: TtsCacheKeyInput): string {
  return `tts-${DUBBING_TTS_CACHE_SCHEMA_VERSION}-${buildTtsCacheKey(input)}`
}
