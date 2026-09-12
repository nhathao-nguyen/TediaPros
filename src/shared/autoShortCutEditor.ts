const STRICT_DECIMAL_SECONDS = /^\d+(?:[.,]\d*)?$/

export type CutSecondsParseResult =
  | { ok: true; seconds: number }
  | { ok: false }

export function parseCutSeconds(value: string): CutSecondsParseResult {
  const normalized = value.trim()
  if (!normalized || !STRICT_DECIMAL_SECONDS.test(normalized)) return { ok: false }
  const seconds = Number(normalized.replace(',', '.'))
  return Number.isFinite(seconds) && seconds >= 0 ? { ok: true, seconds } : { ok: false }
}
