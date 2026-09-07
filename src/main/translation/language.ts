import type {
  TranslationInput,
  TranslationIssue,
  TranslationItem,
  TranslationStageCapability
} from '../../shared/translation'

export type StageCapability = TranslationStageCapability

const AUTO_LOCALES = new Set(['auto', 'mixed', 'unknown'])

export function normalizeTranslationLocale(value: string, allowAuto = false): string {
  const raw = value.trim()
  if (AUTO_LOCALES.has(raw.toLowerCase())) {
    if (!allowAuto) throw new Error(`Explicit target locale required; received ${raw || '(empty)'}.`)
    return raw.toLowerCase()
  }
  if (!raw) throw new Error('Locale cannot be empty.')
  try {
    return new Intl.Locale(raw).toString()
  } catch {
    throw new Error(`Invalid BCP47 locale: ${raw}`)
  }
}

function scriptMatcher(script: string): RegExp | null {
  switch (script) {
    case 'Latn': return /\p{Script=Latin}/u
    case 'Hans':
    case 'Hant':
    case 'Han': return /\p{Script=Han}/u
    case 'Jpan': return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
    case 'Kore': return /[\p{Script=Hangul}\p{Script=Han}]/u
    case 'Hang': return /\p{Script=Hangul}/u
    case 'Cyrl': return /\p{Script=Cyrillic}/u
    case 'Arab': return /\p{Script=Arabic}/u
    case 'Deva': return /\p{Script=Devanagari}/u
    case 'Thai': return /\p{Script=Thai}/u
    case 'Grek': return /\p{Script=Greek}/u
    default: return null
  }
}

function letterCount(text: string): number {
  return Array.from(text).filter((character) => /\p{L}/u.test(character)).length
}

function scriptCount(text: string, matcher: RegExp): number {
  return Array.from(text).filter((character) => matcher.test(character)).length
}

function normalizeText(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ')
}

function warning(code: TranslationIssue['code'], message: string, cueIds: readonly string[]): TranslationIssue {
  return { code, severity: 'warning', cueIds: [...cueIds], confidence: 'heuristic', message }
}

/**
 * Language checks are evidence only. Script ratios can flag an obvious echo,
 * but they cannot certify an English-to-French translation that shares Latin.
 */
export function assessTranslationLanguage(
  input: TranslationInput,
  items: readonly TranslationItem[]
): Pick<import('../../shared/translation').TranslationAssessment, 'languageEvidence' | 'issues'> {
  const issues: TranslationIssue[] = []
  let sourceLocale = ''
  let targetLocale = ''
  try {
    sourceLocale = normalizeTranslationLocale(input.sourceLanguage, true)
    targetLocale = normalizeTranslationLocale(input.targetLocale)
  } catch {
    return { languageEvidence: 'unknown', issues: [warning('language-suspect', 'Không xác định được locale để đánh giá ngôn ngữ; cần kiểm tra thủ công.', input.cues.map((cue) => cue.id))] }
  }

  const targetById = new Map(items.map((item) => [item.id, item.text]))
  const copiedIds: string[] = []
  const translatedText = input.cues.map((cue) => targetById.get(cue.id) || '').join(' ')
  let sameLanguage = false
  if (!AUTO_LOCALES.has(sourceLocale)) {
    try {
      sameLanguage = new Intl.Locale(sourceLocale).language.toLowerCase() === new Intl.Locale(targetLocale).language.toLowerCase()
    } catch {
      sameLanguage = false
    }
  }
  if (!sameLanguage) {
    for (const cue of input.cues) {
      const translated = targetById.get(cue.id)
      if (translated && normalizeText(translated) === normalizeText(cue.text) && letterCount(cue.text) >= 4) copiedIds.push(cue.id)
    }
  }

  if (copiedIds.length > 0 && copiedIds.length / Math.max(1, input.cues.length) >= 0.5) {
    issues.push(warning('language-suspect', `Một phần đáng kể bản dịch giữ nguyên nội dung nguồn; cần xác nhận ngôn ngữ đích ${targetLocale}.`, copiedIds))
    return { languageEvidence: 'suspect', issues }
  }

  if (AUTO_LOCALES.has(sourceLocale)) return { languageEvidence: 'unknown', issues }
  try {
    const sourceScript = new Intl.Locale(sourceLocale).maximize().script || ''
    const targetScript = new Intl.Locale(targetLocale).maximize().script || ''
    const sourceMatcher = scriptMatcher(sourceScript)
    const targetMatcher = scriptMatcher(targetScript)
    const translatedLetters = letterCount(translatedText)
    if (sourceMatcher && targetMatcher && translatedLetters >= 12 && sourceScript !== targetScript) {
      const sourceRatio = scriptCount(translatedText, sourceMatcher) / translatedLetters
      const targetRatio = scriptCount(translatedText, targetMatcher) / translatedLetters
      if (sourceRatio >= 0.65 && sourceRatio > targetRatio * 1.5) {
        issues.push(warning('language-suspect', `Bản dịch vẫn chủ yếu ở hệ chữ nguồn ${sourceScript}; cần kiểm tra ngôn ngữ đích ${targetLocale}.`, input.cues.map((cue) => cue.id)))
        return { languageEvidence: 'suspect', issues }
      }
    }
  } catch {
    // Keep evidence unknown for locales/scripts that this runtime cannot infer.
  }
  // No detector in this layer is qualified to return a positive match. A
  // clean result is therefore unknown rather than an unsupported guarantee.
  return { languageEvidence: 'unknown', issues }
}

export function resolveTranslationReadiness(stages: readonly StageCapability[]): {
  canStart: boolean
  warnings: StageCapability[]
  blocking: StageCapability[]
} {
  const blocking = stages.filter((stage) => stage.required && stage.support === 'unsupported')
  const warnings = stages.filter((stage) => stage.required && stage.support !== 'unsupported' && (stage.support === 'unknown' || !stage.qualified))
  return { canStart: blocking.length === 0, warnings, blocking }
}
