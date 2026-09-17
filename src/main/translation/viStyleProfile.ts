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

export function vietnameseNarrativeInstruction(): string {
  return [
    `style_profile=${VI_NARRATIVE_NEUTRAL_PROFILE_VERSION}`,
    'Write concise, neutral Vietnamese narration with direct native word order and concrete verbs.',
    'Remove only redundant scaffolding, repeated fillers and literal source-language phrasing when an equivalent natural Vietnamese sentence is shorter.',
    'Preserve every actor, action, object, condition, negation, number, unit, proper name, causal relation and source CTA; never omit or invent meaning to make a line shorter.',
    'Keep register consistent across the video. Do not add slang, hype, marketing hooks, praise, generic pronouns or a regional voice that source did not establish.'
  ].join(' ')
}
