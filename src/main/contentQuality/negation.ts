export interface ComparedNegationTokens {
  source: readonly string[]
  target: readonly string[]
}

const NEGATION_WORDS = new Set([
  'không', 'chưa', 'đừng', 'chẳng', 'chả', 'never', 'not', 'no', "don't", "doesn't", "isn't", "wasn't", 'without'
])

const NON_LATIN_NEGATION = /不要|不是|不|沒|没|别|無|无|ない|ません|안|않|لا|ليس|नहीं|ไม่/gu

function rawNegationTokens(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase()
  const tokens = (normalized.match(/[\p{L}']+/gu) || [])
    .filter((word) => NEGATION_WORDS.has(word))
    .map(() => 'neg')
  for (const _match of normalized.matchAll(NON_LATIN_NEGATION)) tokens.push('neg')
  return tokens
}

function negationTokens(text: string): string[] {
  const clauses = text.normalize('NFKC').split(/(?<=[?？。.!！;；\n])/u).filter((clause) => clause.trim())
  return clauses.flatMap((clause) => {
    const scope = /[?？]\s*$/u.test(clause.trim()) ? 'question' : 'statement'
    return rawNegationTokens(clause).map(() => `neg:${scope}`)
  })
}

function positiveChinesePolarQuestion(text: string): boolean {
  const normalized = text.normalize('NFKC').trim().replace(/[?？。.!！]+$/u, '')
  return !/[。.!！?？;；\n]/u.test(normalized) && /[吗嗎]$/u.test(normalized)
}

function hasVietnameseQuestionSuffix(text: string): boolean {
  const normalized = text.normalize('NFKC').trim()
  if (!/[?？]$/u.test(normalized)) return false
  const body = normalized.replace(/[?？]+$/u, '').trim()
  if (/[.!?。！？;；\n]/u.test(body)) return false
  return /(?:^|\s)có\s+.+\s+không$/iu.test(body) || /(?:^|\s)đã\s+.+\s+chưa$/iu.test(body)
}

/** Remove one Vietnamese interrogative suffix only when both sides prove a
 * single-clause positive Chinese polar question. Real negation is preserved. */
export function negationTokensForComparison(
  sourceText: string,
  targetText: string
): ComparedNegationTokens {
  const source = negationTokens(sourceText)
  const target = negationTokens(targetText)
  if (source.length === 0 && target.length === 1 &&
      positiveChinesePolarQuestion(sourceText) && hasVietnameseQuestionSuffix(targetText)) {
    return { source, target: [] }
  }
  return { source, target }
}
