import type { SubtitleTextCase } from './types'

export const SUBTITLE_TEXT_CASES: ReadonlyArray<{ id: SubtitleTextCase; label: string; desc: string }> = [
  { id: 'original', label: 'Mặc định (Giữ nguyên)', desc: 'Giữ nguyên chữ hoa/thường của phụ đề gốc' },
  { id: 'uppercase', label: 'IN HOA TOÀN BỘ (UPPERCASE)', desc: 'Chuyển toàn bộ phụ đề sang chữ in hoa' },
  { id: 'lowercase', label: 'Chữ thường (lowercase)', desc: 'Chuyển toàn bộ phụ đề sang chữ thường' },
  { id: 'titlecase', label: 'Viết hoa chữ đầu mỗi từ (Title Case)', desc: 'Viết hoa ký tự đầu của từng từ' }
]

export const SUBTITLE_TEXT_CASE_IDS = new Set<SubtitleTextCase>([
  'original',
  'uppercase',
  'lowercase',
  'titlecase'
])

export function isValidSubtitleTextCase(value: unknown): value is SubtitleTextCase {
  return typeof value === 'string' && SUBTITLE_TEXT_CASE_IDS.has(value as SubtitleTextCase)
}

/**
 * Viết hoa chữ cái đầu tiên của mỗi từ theo Unicode (hỗ trợ tiếng Việt và tiếng Anh).
 */
export function toTitleCase(text: string): string {
  return text.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, prefix, char) => `${prefix}${char.toUpperCase()}`)
}

/**
 * Biến đổi chuỗi văn bản theo định dạng chữ hoa / chữ thường.
 */
export function applySubtitleTextCase(text: string, textCase?: SubtitleTextCase | null): string {
  if (!text || !textCase || textCase === 'original') return text
  switch (textCase) {
    case 'uppercase':
      return text.toUpperCase()
    case 'lowercase':
      return text.toLowerCase()
    case 'titlecase':
      return toTitleCase(text)
    default:
      return text
  }
}

/**
 * Áp dụng biến đổi chữ hoa/thường cho danh sách cues.
 */
export function applyTextCaseToCues<T extends { text: string }>(
  cues: readonly T[],
  textCase?: SubtitleTextCase | null
): T[] {
  if (!textCase || textCase === 'original') return cues.slice()
  return cues.map((cue) => ({
    ...cue,
    text: applySubtitleTextCase(cue.text, textCase)
  }))
}
