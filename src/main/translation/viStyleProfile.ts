/**
 * Versioned Vietnamese narrator profile. The initial built-in set deliberately
 * contains no invented few-shot examples: only human-approved development
 * examples may be supplied by a later content pack.
 */
export const VI_NARRATIVE_NEUTRAL_PROFILE_VERSION = 'vi-narrative-neutral-v1'

export interface ViStyleExample {
  id: string
  domain: string
  source: string
  target: string
  approved: boolean
  split: 'development' | 'held-out'
}

export function selectViExamples(examples: readonly ViStyleExample[], domain = 'general'): ViStyleExample[] {
  const requestedDomain = domain.trim().toLowerCase() || 'general'
  return examples
    .filter((example) => example.approved && example.split === 'development'
      && (example.domain.trim().toLowerCase() === requestedDomain || example.domain.trim().toLowerCase() === 'general'))
    .sort((left, right) => {
      const leftExact = Number(left.domain.trim().toLowerCase() === requestedDomain)
      const rightExact = Number(right.domain.trim().toLowerCase() === requestedDomain)
      return rightExact - leftExact || left.id.localeCompare(right.id)
    })
    .slice(0, 3)
}

import type { TranslationTone } from '../../shared/translation'

export function vietnameseToneInstruction(tone?: TranslationTone, customInstruction?: string): string {
  const parts: string[] = []
  switch (tone) {
    case 'storytelling':
      parts.push('Narrative tone: Storytelling / Drama. Phóng tác câu từ cuốn hút, giàu tính dẫn dắt và hồi hộp, nhịp câu nhịp nhàng theo mạch diễn biến câu chuyện, giữ trọn vẹn sự kiện và cảm xúc nhân vật nhưng diễn đạt sinh động, kịch tính.')
      break
    case 'humorous':
      parts.push('Narrative tone: Humorous / Casual. Văn phong hài hước, dí dỏm, hóm hỉnh, tươi vui, dùng ngôn ngữ nói đời thường tự nhiên, xưng hô gần gũi thân mật nếu ngữ cảnh cho phép, tạo tiếng cười nhẹ nhàng mà không bóp méo nội dung gốc.')
      break
    case 'documentary':
      parts.push('Narrative tone: Documentary / Formal. Văn phong phóng sự tài liệu trang trọng, khách quan, súc tích, mạch lạc, sử dụng từ ngữ chuẩn xác, giải thích rõ ràng cơ chế hoặc hiện tượng mà không thêm cảm tính.')
      break
    case 'custom':
    case 'neutral':
    default:
      break
  }
  if (customInstruction && customInstruction.trim()) {
    parts.push(`Custom channel narrative guidance: ${customInstruction.trim()}`)
  }
  return parts.join(' ')
}

export function vietnameseNarrativeInstruction(tone?: TranslationTone, customInstruction?: string): string {
  const base = [
    `style_profile=${VI_NARRATIVE_NEUTRAL_PROFILE_VERSION}`,
    'Write concise, neutral Vietnamese narration with direct native word order and concrete verbs.',
    'Remove only redundant scaffolding, repeated fillers and literal source-language phrasing when an equivalent natural Vietnamese sentence is shorter.',
    'Preserve every actor, action, object, condition, negation, number, unit, proper name, causal relation and source CTA; never omit or invent meaning to make a line shorter.',
    'Keep register consistent across the video. Do not add slang, hype, marketing hooks, praise, generic pronouns or a regional voice that source did not establish.'
  ].join(' ')

  const toneRule = vietnameseToneInstruction(tone, customInstruction)
  return toneRule ? `${base} ${toneRule}` : base
}
