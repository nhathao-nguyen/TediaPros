export * from './semanticGrouping'

export const DEFAULT_LOCAL_TRANSLATION_TEMPERATURE = 0.2

/** Only errors that may clear on a later request are safe to retry. */
export function isRetryableLocalTranslationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /HTTP\s+(?:429|5\d\d)\b|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? ?out|timeout/i.test(message)
}

export function isCompleteLocalTranslationBatch(lines: readonly string[], expectedCount: number): boolean {
  return expectedCount > 0 && lines.length === expectedCount && lines.every((line) => line.trim().length > 0)
}

export function splitLocalTranslationBatch<T>(items: readonly T[]): [T[], T[]] | null {
  if (items.length < 2) return null
  const midpoint = Math.ceil(items.length / 2)
  return [items.slice(0, midpoint), items.slice(midpoint)]
}

export function resolveTranslationSourceLanguage(
  configured?: string | null,
  detected?: string | null
): string {
  const configuredCode = configured?.trim().toLowerCase()
  if (configuredCode && configuredCode !== 'auto') return configuredCode
  const detectedCode = detected?.trim().toLowerCase()
  if (detectedCode && detectedCode !== 'auto') return detectedCode
  return 'auto'
}

/** @deprecated Source detection belongs to Whisper/provider capability, not a script heuristic. */
export function inferTranslationSourceLanguage(_texts: readonly string[]): string {
  return 'auto'
}

