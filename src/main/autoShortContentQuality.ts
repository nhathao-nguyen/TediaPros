import type { SubtitleCue } from '../shared/types'
import type {
  TranslationAssessment,
  TranslationIssue,
  TranslationIssueCode
} from '../shared/translation'

export type ContentQualitySeverity = 'error' | 'warning'

export interface ContentQualityFinding {
  severity: ContentQualitySeverity
  code: 'duplicate-source-id' | 'duplicate-target-id' | 'missing-target-id' | 'unexpected-target-id' | 'empty-target-text' | 'protected-token-mismatch' | 'invalid-source'
  cueId?: string
  message: string
}

export interface AutoShortContentQualityResult {
  ok: boolean
  findings: ContentQualityFinding[]
}

const NEGATION_WORDS = new Set([
  'không', 'chưa', 'đừng', 'chẳng', 'chả', 'never', 'not', 'no', "don't", "doesn't", "isn't", "wasn't", 'without',
  '不', '沒', '没', '别', '不要', '無', '无', 'ない', 'ません', '안', '않', 'لا', 'ليس', 'नहीं', 'ไม่'
])

const ISSUE_CODE_BY_FINDING: Record<ContentQualityFinding['code'], TranslationIssueCode> = {
  'duplicate-source-id': 'invalid-source',
  'duplicate-target-id': 'duplicate-id',
  'missing-target-id': 'missing-id',
  'unexpected-target-id': 'unknown-id',
  'empty-target-text': 'empty-text',
  'protected-token-mismatch': 'protected-token-suspect',
  'invalid-source': 'invalid-source'
}

const CJK_DIGIT_MAP: Record<string, string> = {
  '零': '0', '〇': '0', '一': '1', '二': '2', '两': '2',
  '三': '3', '四': '4', '五': '5', '六': '6', '七': '7',
  '八': '8', '九': '9'
}

function unicodeDigitsToAscii(value: string): string {
  return Array.from(value).map((character) => {
    if (CJK_DIGIT_MAP[character] !== undefined) return CJK_DIGIT_MAP[character]
    const codePoint = character.codePointAt(0) || 0
    if (codePoint >= 0x0660 && codePoint <= 0x0669) return String(codePoint - 0x0660)
    if (codePoint >= 0x06f0 && codePoint <= 0x06f9) return String(codePoint - 0x06f0)
    if (codePoint >= 0x0966 && codePoint <= 0x096f) return String(codePoint - 0x0966)
    if (codePoint >= 0x0e50 && codePoint <= 0x0e59) return String(codePoint - 0x0e50)
    return character
  }).join('')
}

function isQuestionSentence(text: string): boolean {
  if (!text) return false
  if (/[?？]/u.test(text)) return true
  if (/(?:phải\s+không|đúng\s+không|được\s+không|hả|sao|chăng|chưa)\s*[.!]?$/iu.test(text.trim())) return true
  if (/[吗呢吧か]\s*[.!]?$/u.test(text.trim())) return true
  return false
}

function protectedTokens(text: string): string[] {
  // Chinese ordinal markers such as 第一/第二 identify cue order, not a
  // quantity that a translation must repeat. Strip that marker before the
  // optional CJK digit normalization so generic fixture/translation text
  // does not become a false protected-number warning.
  const normalized = unicodeDigitsToAscii(text.normalize('NFKC').replace(/第[零〇一二两三四五六七八九]+/gu, '第')).toLowerCase()
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
  // CJK and several other scripts do not expose whitespace-delimited words.
  // Treat the presence of a known negation marker as one heuristic signal;
  // this is deliberately not a hard semantic assertion.
  if (/(?:不|沒|没|别|不要|無|无|ない|ません|안|않|لا|ليس|नहीं|ไม่)/u.test(normalized) && !tokens.includes('neg')) {
    tokens.push('neg')
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

  if (input.sourceCues.length === 0) {
    findings.push({ severity: 'error', code: 'invalid-source', message: 'Không có cue nguồn để kiểm tra.' })
  }

  for (const [id, count] of sourceCounts) {
    const sourceCue = input.sourceCues.find((cue) => String(cue.id || '').trim() === id)
    if (!id) findings.push({ severity: 'error', code: 'invalid-source', cueId: id, message: 'Source cue không có ID ổn định.' })
    if (count > 1) findings.push({ severity: 'error', code: 'duplicate-source-id', cueId: id, message: `Source cue ID ${id || '(rỗng)'} bị lặp ${count} lần.` })
    if (!sourceCue?.text?.trim()) findings.push({ severity: 'error', code: 'invalid-source', cueId: id, message: `Source cue ${id || '(rỗng)'} không có nội dung.` })
    if (sourceCue && (!Number.isFinite(sourceCue.start) || !Number.isFinite(sourceCue.end) || sourceCue.end < sourceCue.start)) {
      findings.push({ severity: 'error', code: 'invalid-source', cueId: id, message: `Source cue ${id || '(rỗng)'} có timeline không hợp lệ.` })
    }
    const targetCount = targetCounts.get(id) || 0
    if (targetCount === 0) findings.push({ severity: 'error', code: 'missing-target-id', cueId: id, message: `Thiếu target cue cho source ID ${id || '(rỗng)'}.` })
  }
  for (const [id, count] of targetCounts) {
    if (count > 1) findings.push({ severity: 'error', code: 'duplicate-target-id', cueId: id, message: `Target cue ID ${id || '(rỗng)'} bị lặp ${count} lần.` })
    if (!sourceCounts.has(id)) findings.push({ severity: 'error', code: 'unexpected-target-id', cueId: id, message: `Target cue ID ${id || '(rỗng)'} không có source tương ứng.` })
  }

  for (const target of input.targetCues) {
    if (!target.text?.trim()) {
      findings.push({ severity: 'error', code: 'empty-target-text', cueId: target.id, message: `Target cue ${target.id || '(rỗng)'} không có nội dung.` })
    }
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
    const sourceWithoutNeg = sourceTokens.filter((token) => token !== 'neg')
    const targetWithoutNeg = targetTokens.filter((token) => token !== 'neg')
    const onlyNegDiffers = sourceWithoutNeg.join('\u0000') === targetWithoutNeg.join('\u0000') &&
      sourceTokens.includes('neg') !== targetTokens.includes('neg')
    const isQuestionContext = isQuestionSentence(source.text) || isQuestionSentence(target.text)
    if (onlyNegDiffers && isQuestionContext) {
      // Question particles across languages (e.g. Chinese 吗/呢 -> Vietnamese không/chưa)
      // are interrogative markers rather than semantic polarity reversals.
      continue
    }
    if (sourceTokens.join('\u0000') !== targetTokens.join('\u0000')) {
      findings.push({
        severity: 'warning',
        code: 'protected-token-mismatch',
        cueId: source.id,
        message: `Cue ${source.id} thay đổi số, đơn vị hoặc phủ định quan trọng (${sourceTokens.join(', ')} -> ${targetTokens.join(', ')}).`
      })
    }
  }
  return { ok: findings.every((finding) => finding.severity !== 'error'), findings }
}

/**
 * Convert the legacy QA findings to the shared assessment contract. Structural
 * failures stop publication; number/unit/negation differences remain visible
 * review evidence because a valid translation is allowed to change their
 * surface form (for example 2 -> two or 不 -> do not).
 */
export function assessContentQuality(
  sourceCues: readonly SubtitleCue[],
  targetCues: readonly SubtitleCue[]
): TranslationAssessment
export function assessContentQuality(input: {
  sourceCues: readonly SubtitleCue[]
  targetCues: readonly SubtitleCue[]
}): TranslationAssessment
export function assessContentQuality(
  sourceOrInput: readonly SubtitleCue[] | { sourceCues: readonly SubtitleCue[]; targetCues: readonly SubtitleCue[] },
  maybeTargetCues?: readonly SubtitleCue[]
): TranslationAssessment {
  const input: { sourceCues: readonly SubtitleCue[]; targetCues: readonly SubtitleCue[] } = Array.isArray(sourceOrInput)
    ? { sourceCues: sourceOrInput as readonly SubtitleCue[], targetCues: maybeTargetCues || [] }
    : sourceOrInput as { sourceCues: readonly SubtitleCue[]; targetCues: readonly SubtitleCue[] }
  const result = validateAutoShortContentQuality(input)
  const issues: TranslationIssue[] = result.findings.map((finding) => ({
    code: ISSUE_CODE_BY_FINDING[finding.code],
    severity: finding.severity,
    cueIds: finding.cueId ? [finding.cueId] : [],
    confidence: finding.severity === 'error' ? 'certain' : 'heuristic',
    message: finding.message
  }))
  const hasErrors = issues.some((issue) => issue.severity === 'error')
  return {
    version: 'translation-assessment-v2',
    disposition: hasErrors ? 'needs-review' : issues.length > 0 ? 'with-warnings' : 'validated',
    issues,
    languageEvidence: 'unknown'
  }
}
