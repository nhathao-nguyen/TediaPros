import type { SubtitleCue } from '../shared/types'

export type ContentQualitySeverity = 'error' | 'warning'

export interface ContentQualityFinding {
  severity: ContentQualitySeverity
  code: 'duplicate-source-id' | 'duplicate-target-id' | 'missing-target-id' | 'unexpected-target-id' | 'empty-target-text' | 'protected-token-mismatch'
  cueId?: string
  message: string
}

export interface AutoShortContentQualityResult {
  ok: boolean
  findings: ContentQualityFinding[]
}

const NEGATION_WORDS = new Set([
  'không', 'chưa', 'đừng', 'chẳng', 'chả', 'never', 'not', 'no', "don't", "doesn't", "isn't", "wasn't", 'without'
])

function protectedTokens(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase()
  const tokens: string[] = []
  // Keep a numeric value and its canonical unit as protected tokens. Unit
  // words often change during translation ("phút" -> "minutes", "%" ->
  // "percent"), so compare their semantic class rather than their spelling.
  const unitAliases: Array<[RegExp, string]> = [
    [/^(?:phần\s*trăm|percent(?:age)?|%$)/u, '%'],
    [/^(?:độ|degree(?:s)?|°$)/u, 'deg'],
    [/^(?:kilogram(?:s)?|kg$)/u, 'kg'],
    [/^(?:milligram(?:s)?|mg$)/u, 'mg'],
    [/^(?:gram(?:s)?|g$)/u, 'g'],
    [/^(?:kilometer(?:s)?|kilometre(?:s)?|km$)/u, 'km'],
    [/^(?:centimeter(?:s)?|centimetre(?:s)?|cm$)/u, 'cm'],
    [/^(?:millimeter(?:s)?|millimetre(?:s)?|mm$)/u, 'mm'],
    [/^(?:milliliter(?:s)?|millilitre(?:s)?|ml$)/u, 'ml'],
    [/^(?:liter(?:s)?|litre(?:s)?|lít|l$)/u, 'l'],
    [/^(?:millisecond(?:s)?|mili\s*giây|ms$)/u, 'ms'],
    [/^(?:second(?:s)?|sec(?:s)?|giây|s$)/u, 's'],
    [/^(?:minute(?:s)?|min(?:s)?|phút|phut)/u, 'min'],
    [/^(?:hour(?:s)?|giờ|gio|h$)/u, 'h'],
    [/^(?:day(?:s)?|ngày)/u, 'day'],
    [/^(?:year(?:s)?|năm)/u, 'year'],
    [/^(?:meter(?:s)?|metre(?:s)?|m$)/u, 'm']
  ]
  const numberPattern = /[-+]?\d+(?:[.,]\d+)*(?:\s*(%|°|phần\s*trăm|percent(?:age)?|độ|degree(?:s)?|kilogram(?:s)?|kg|milligram(?:s)?|mg|gram(?:s)?|g|kilometer(?:s)?|kilometre(?:s)?|km|centimeter(?:s)?|centimetre(?:s)?|cm|millimeter(?:s)?|millimetre(?:s)?|mm|milliliter(?:s)?|millilitre(?:s)?|ml|liter(?:s)?|litre(?:s)?|lít|l|millisecond(?:s)?|mili\s*giây|ms|second(?:s)?|secs?|giây|s|minute(?:s)?|mins?|phút|phut|hour(?:s)?|giờ|gio|h|day(?:s)?|ngày|year(?:s)?|năm|meter(?:s)?|metre(?:s)?|m))?/giu
  for (const match of normalized.matchAll(numberPattern)) {
    const raw = match[0].replace(/\s+/gu, ' ').replace(/,/gu, '.').trim()
    const numeric = raw.match(/^[-+]?\d+(?:\.\d+)*/u)?.[0]
    if (!numeric) continue
    tokens.push(`num:${numeric}`)
    const rawUnit = raw.slice(numeric.length).trim()
    if (rawUnit) {
      const canonicalUnit = unitAliases.find(([pattern]) => pattern.test(rawUnit))?.[1]
      if (canonicalUnit) tokens.push(`unit:${canonicalUnit}`)
    }
  }
  for (const word of normalized.match(/[\p{L}']+/gu) || []) {
    if (NEGATION_WORDS.has(word)) tokens.push('neg')
  }
  return tokens.sort()
}

function idCounts(cues: readonly SubtitleCue[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const cue of cues) {
    const id = String(cue.id || '').trim()
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}

/**
 * Cheap structural checks that can run on every job. It deliberately does
 * not claim semantic translation quality; human/ASR review remains separate.
 */
export function validateAutoShortContentQuality(input: {
  sourceCues: readonly SubtitleCue[]
  targetCues: readonly SubtitleCue[]
}): AutoShortContentQualityResult {
  const findings: ContentQualityFinding[] = []
  const sourceCounts = idCounts(input.sourceCues)
  const targetCounts = idCounts(input.targetCues)

  for (const [id, count] of sourceCounts) {
    if (count > 1) findings.push({ severity: 'error', code: 'duplicate-source-id', cueId: id, message: `Source cue ID ${id || '(rỗng)'} bị lặp ${count} lần.` })
    const targetCount = targetCounts.get(id) || 0
    if (targetCount === 0) findings.push({ severity: 'error', code: 'missing-target-id', cueId: id, message: `Thiếu target cue cho source ID ${id || '(rỗng)'}.` })
  }
  for (const [id, count] of targetCounts) {
    if (count > 1) findings.push({ severity: 'error', code: 'duplicate-target-id', cueId: id, message: `Target cue ID ${id || '(rỗng)'} bị lặp ${count} lần.` })
    if (!sourceCounts.has(id)) findings.push({ severity: 'error', code: 'unexpected-target-id', cueId: id, message: `Target cue ID ${id || '(rỗng)'} không có source tương ứng.` })
  }

  const targetById = new Map(input.targetCues.map((cue) => [String(cue.id || '').trim(), cue]))
  for (const source of input.sourceCues) {
    const target = targetById.get(String(source.id || '').trim())
    if (!target) continue
    if (!target.text?.trim()) {
      findings.push({ severity: 'error', code: 'empty-target-text', cueId: source.id, message: `Target cue ${source.id} không có nội dung.` })
      continue
    }
    const sourceTokens = protectedTokens(source.text)
    const targetTokens = protectedTokens(target.text)
    if (sourceTokens.join('\u0000') !== targetTokens.join('\u0000')) {
      findings.push({
        severity: 'error',
        code: 'protected-token-mismatch',
        cueId: source.id,
        message: `Cue ${source.id} thay đổi số, đơn vị hoặc phủ định quan trọng (${sourceTokens.join(', ')} -> ${targetTokens.join(', ')}).`
      })
    }
  }
  return { ok: findings.every((finding) => finding.severity !== 'error'), findings }
}
