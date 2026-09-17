import type { SubtitleCue } from '../shared/types'
import type {
  TranslationAssessment,
  TranslationIssue,
  TranslationIssueCode
} from '../shared/translation'
import { negationTokensForComparison } from './contentQuality/negation'
import { extractContextualNumberTokens, normalizeUnicodeDecimalDigits } from './contentQuality/numerals'

export type ContentQualitySeverity = 'error' | 'warning'

export interface ContentQualityFinding {
  severity: ContentQualitySeverity
  code: 'duplicate-source-id' | 'duplicate-target-id' | 'missing-target-id' | 'unexpected-target-id' | 'empty-target-text' | 'protected-token-mismatch' | 'embedded-cue-marker' | 'invalid-source'
  cueId?: string
  message: string
}

export interface AutoShortContentQualityResult {
  ok: boolean
  findings: ContentQualityFinding[]
}

const ISSUE_CODE_BY_FINDING: Record<ContentQualityFinding['code'], TranslationIssueCode> = {
  'duplicate-source-id': 'invalid-source',
  'duplicate-target-id': 'duplicate-id',
  'missing-target-id': 'missing-id',
  'unexpected-target-id': 'unknown-id',
  'empty-target-text': 'empty-text',
  'protected-token-mismatch': 'protected-token-suspect',
  'embedded-cue-marker': 'provider-protocol',
  'invalid-source': 'invalid-source'
}

function protectedTokens(text: string): string[] {
  const normalized = normalizeUnicodeDecimalDigits(text.normalize('NFKC')).toLowerCase()
  const contextual = extractContextualNumberTokens(normalized)
  const remainder = normalized.split('')
  for (const span of contextual) {
    for (let index = span.start; index < span.end; index++) remainder[index] = ' '
  }
  const numericRemainder = remainder.join('')
  const tokens: string[] = contextual.map((span) => span.token)
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
  for (const match of numericRemainder.matchAll(numberPattern)) {
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
  return tokens.sort()
}

export interface RephraseSemanticResult {
  ok: boolean
  reasons: Array<'protected-token' | 'named-entity' | 'relation' | 'lexical-anchor' | 'quantified-object' | 'action-order'>
}

const REPHRASE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from', 'he', 'her', 'his', 'i', 'in',
  'is', 'it', 'its', 'of', 'on', 'or', 'she', 'that', 'the', 'their', 'them', 'they', 'this', 'to', 'we', 'you',
  'các', 'có', 'của', 'cho', 'đã', 'đang', 'được', 'là', 'một', 'này', 'những', 'rằng', 'thì', 'và', 'với'
])

function lexicalAnchors(text: string): Set<string> {
  return new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter((word) => word.length > 1 && !REPHRASE_STOP_WORDS.has(word) && !/^\p{N}+$/u.test(word)))
}

function namedAnchors(text: string): string[] {
  const result: string[] = []
  for (const match of text.matchAll(/["“”']([^"“”']{2,80})["“”']/gu)) result.push(match[1]!.normalize('NFKC').toLowerCase())
  const words = text.match(/[\p{L}\p{N}]+/gu) || []
  words.forEach((word, index) => {
    const normalized = word.normalize('NFKC').toLowerCase()
    if (/^[A-Z][A-Za-zÀ-ỹ0-9_-]+$/u.test(word) && index > 0 || /^(?=.*[A-Z])(?=.*[A-Z0-9])[A-Z0-9._-]{2,}$/u.test(word)) {
      if (!result.includes(normalized)) result.push(normalized)
    }
  })
  return result
}

function objectAnchors(text: string): Set<string> {
  const result = new Set<string>()
  for (const match of text.normalize('NFKC').toLowerCase().matchAll(/\bthe\s+([\p{L}\p{N}_]+)/gu)) {
    if (match[1] && !REPHRASE_STOP_WORDS.has(match[1])) result.add(match[1])
  }
  return result
}

function relationAnchors(text: string): Set<string> {
  const normalized = text.normalize('NFKC').toLowerCase()
  const relations: Array<[string, RegExp]> = [
    ['before', /\b(?:before|trước\s+khi)\b/u],
    ['after', /\b(?:after|sau\s+khi)\b/u],
    ['if', /\b(?:if|nếu)\b/u],
    ['unless', /\b(?:unless|trừ\s+khi)\b/u],
    ['because', /\b(?:because|because\s+of|vì|do)\b/u],
    ['until', /\b(?:until|cho\s+đến\s+khi)\b/u]
  ]
  return new Set(relations.filter(([, pattern]) => pattern.test(normalized)).map(([name]) => name))
}

const QUANTITY_WORDS: Record<string, string> = {
  một: '1', hai: '2', ba: '3', bốn: '4', tư: '4', năm: '5', sáu: '6', bảy: '7', tám: '8', chín: '9', mười: '10',
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10'
}
const QUANTIFIED_MEASURES = new Set([
  'thìa', 'muỗng', 'cốc', 'chén', 'ly', 'chai', 'hộp', 'túi', 'miếng', 'con', 'cái', 'quả', 'kg', 'g', 'gram', 'lít', 'ml',
  'spoon', 'spoons', 'tablespoon', 'tablespoons', 'cup', 'cups', 'bottle', 'bottles', 'box', 'boxes', 'bag', 'bags',
  'piece', 'pieces', 'kilogram', 'kilograms', 'gram', 'grams', 'liter', 'liters', 'ml', 'times', 'time'
])

function wordTokens(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []
}

function canonicalQuantity(value: string): string | null {
  if (/^\p{N}+$/u.test(value)) return value
  return QUANTITY_WORDS[value] || null
}

/**
 * Cross-language source repair cannot be proven locally in full, but an
 * explicit quantity is objective evidence that must survive the repair. Keep
 * this deliberately narrower than the same-language rephrase gate: source
 * and target vocabulary are expected to differ, while `2` and `20` are not.
 */
function sourceRepairNumericTokens(text: string): string[] {
  const explicit = protectedTokens(text)
    .filter((token) => token.startsWith('num:') || token.startsWith('ordinal:'))
  const written = wordTokens(text)
    // Arabic/Unicode digit spans are already represented by `protectedTokens`.
    // Do not add the same span a second time merely because it is also a word
    // token; retain lexical number words (two/hai/...) as their own evidence.
    .filter((token) => !/^[-+]?\p{N}+(?:[.,]\p{N}+)*$/u.test(token))
    .map((token) => canonicalQuantity(token))
    .filter((token): token is string => Boolean(token))
    .map((token) => `num:${token}`)
  return [...explicit, ...written].sort()
}

export interface SourceRepairSemanticResult extends RephraseSemanticResult {
  /** False means the source did not contain a deterministic numeric fact. */
  checkedNumbers: boolean
}

/**
 * Reject a source-anchored repair when it changes an explicit source number
 * before any TTS request is made. Number words such as `two`/`hai` are
 * normalized too, so localization does not create a false rejection.
 */
export function validateSourceRepairNumericPreservation(
  sourceText: string,
  candidateText: string
): SourceRepairSemanticResult {
  const sourceNumbers = sourceRepairNumericTokens(sourceText)
  if (sourceNumbers.length === 0) return { ok: true, reasons: [], checkedNumbers: false }
  const candidateNumbers = sourceRepairNumericTokens(candidateText)
  const ok = sourceNumbers.join('\u0000') === candidateNumbers.join('\u0000')
  return {
    ok,
    reasons: ok ? [] : ['protected-token'],
    checkedNumbers: true
  }
}

function normalizedMeasure(value: string): string {
  return value.endsWith('s') && value.length > 3 ? value.slice(0, -1) : value
}

/** High-confidence object evidence only: numeral + explicit classifier/unit + noun.
 * Keep a multiset rather than a quantity/unit map: `2 spoons salt` and
 * `2 spoons sugar` are two facts, and an inventory may be reordered without
 * changing either fact. */
function quantifiedObjects(text: string): string[] {
  const tokens = wordTokens(text)
  const result: string[] = []
  for (let index = 0; index + 2 < tokens.length; index++) {
    const quantity = canonicalQuantity(tokens[index]!)
    if (!quantity) continue
    const rawMeasure = tokens[index + 1]!
    if (!QUANTIFIED_MEASURES.has(rawMeasure)) continue
    let objectIndex = index + 2
    if (tokens[objectIndex] === 'of') objectIndex++
    const object = tokens[objectIndex]
    if (!object || REPHRASE_STOP_WORDS.has(object) || canonicalQuantity(object)) continue
    result.push(`${quantity}|${normalizedMeasure(rawMeasure)}|${object}`)
  }
  return result.sort()
}

function actionSignature(text: string): string {
  return wordTokens(text)
    .filter((token) => token.length > 1 && !REPHRASE_STOP_WORDS.has(token)
      && !['before', 'after', 'trước', 'khi', 'sau'].includes(token))
    .join(' ')
}

function beforeActionOrder(text: string): [string, string] | null {
  const normalized = text.normalize('NFKC').toLowerCase().trim()
  const match = normalized.match(/^(.+?)\s+(?:before|trước\s+khi)\s+(.+?)(?:[.!?]|$)/u)
  if (!match) return null
  const first = actionSignature(match[1] || '')
  const second = actionSignature(match[2] || '')
  return first && second ? [first, second] : null
}

/** Conservative same-language gate for TTS rescue candidates. It only rejects
 * evidence that can be checked deterministically; it does not claim complete
 * semantic equivalence. The original measured text remains the safe fallback. */
export function validateRephraseSemanticPreservation(
  currentText: string,
  candidateText: string,
  _locale?: string
): RephraseSemanticResult {
  const reasons = new Set<RephraseSemanticResult['reasons'][number]>()
  const polarity = negationTokensForComparison(currentText, candidateText)
  const currentProtected = [...protectedTokens(currentText), ...polarity.source].sort()
  const candidateProtected = [...protectedTokens(candidateText), ...polarity.target].sort()
  if (currentProtected.join('\u0000') !== candidateProtected.join('\u0000')) reasons.add('protected-token')

  const candidateNormalized = candidateText.normalize('NFKC').toLowerCase()
  const currentNames = namedAnchors(currentText)
  const candidateNames = namedAnchors(candidateText)
  // Ignore the first capitalized word because it may only start a sentence;
  // preserve every later name/acronym and their order.
  if (currentNames.length >= 1 && currentNames.join('\u0000') !== candidateNames.join('\u0000')) reasons.add('named-entity')
  if ([...objectAnchors(currentText)].some((anchor) => !lexicalAnchors(candidateText).has(anchor))) reasons.add('lexical-anchor')
  const currentRelations = relationAnchors(currentText)
  const candidateRelations = relationAnchors(candidateText)
  if ([...currentRelations].some((anchor) => !candidateRelations.has(anchor))) reasons.add('relation')

  const currentQuantifiedObjects = quantifiedObjects(currentText)
  const candidateQuantifiedObjects = quantifiedObjects(candidateText)
  if (currentQuantifiedObjects.join('\u0000') !== candidateQuantifiedObjects.join('\u0000')) {
    reasons.add('quantified-object')
  }

  const currentOrder = beforeActionOrder(currentText)
  const candidateOrder = beforeActionOrder(candidateText)
  if (currentOrder && candidateOrder && currentOrder[0] !== currentOrder[1]
    && currentOrder[0] === candidateOrder[1] && currentOrder[1] === candidateOrder[0]) {
    reasons.add('action-order')
  }

  return { ok: reasons.size === 0, reasons: [...reasons] }
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
    } else if (/\[\s*cue-[\w-]+\s*\]/iu.test(target.text)) {
      findings.push({
        severity: 'error',
        code: 'embedded-cue-marker',
        cueId: target.id,
        message: `Target cue ${target.id || '(rỗng)'} chứa nhãn cue trong nội dung đọc.`
      })
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
    const polarity = negationTokensForComparison(source.text, target.text)
    const sourceTokens = [...protectedTokens(source.text), ...polarity.source].sort()
    const targetTokens = [...protectedTokens(target.text), ...polarity.target].sort()
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
