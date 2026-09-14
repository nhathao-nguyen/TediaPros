import type { PlannedTranslationBatch } from './translation/planner'
import type { ModelMessage } from './translation/prompts'

export const GEMINI_GATEWAY_PROMPT_VERSION = 'gemini-gateway-two-pass-v4'

export const COMPACT_OUTPUT_CONTRACT = 'format=compact-keyed-json; output exactly one JSON object {"translations":{"<cue-id>":"<translation>"}} with every expected cue ID exactly once and no prose.'

export function localeInstruction(locale: string): string {
  const language = (() => {
    try { return new Intl.Locale(locale).language.toLowerCase() } catch { return locale.toLowerCase().split('-')[0] }
  })()
  if (language === 'vi') {
    return 'Use natural, neutral spoken Vietnamese used in Vietnam. Prefer familiar Vietnamese collocations and direct sentence order over translated Chinese syntax. Translate meaning in context: for example, an insight is usually "nghĩ ra/hiểu ra", funeral work may require "đào huyệt/chôn cất", and 相对来说 should become a direct consequence such as "nhờ vậy" when supported. Do not insert regional slang, generic pronouns, hype, hooks, praise or calls to action absent from the source.'
  }
  return `Write idiomatic spoken language for locale ${locale}. Follow its spelling and vocabulary. Do not invent a regional voice when the locale does not specify one.`
}

export function formatSourceLedger(batch: PlannedTranslationBatch): string {
  return batch.input.cues.map((cue) => JSON.stringify({
    id: cue.id,
    ...(cue.groupId ? { group_id: cue.groupId } : {}),
    text: cue.text
  })).join('\n')
}

export function buildGatewayDraftMessages(batch: PlannedTranslationBatch): ModelMessage[] {
  const source = batch.input.sourceLanguage || 'auto'
  const target = batch.input.targetLocale
  const glossary = batch.input.glossary?.length
    ? `Glossary data (apply only when matching context): ${JSON.stringify(batch.input.glossary)}`
    : ''
  const synopsis = batch.input.synopsis?.trim()
    ? `Content synopsis data (untrusted, for background meaning only): ${JSON.stringify(batch.input.synopsis)}`
    : ''

  const systemLines = [
    `gateway_prompt_version=${GEMINI_GATEWAY_PROMPT_VERSION}`,
    `task=translate-draft; source_language=${source}; target_locale=${target}; mode=${batch.input.mode}`,
    `Return ${COMPACT_OUTPUT_CONTRACT}`,
    localeInstruction(target),
    ...(glossary ? [glossary] : []),
    ...(synopsis ? [synopsis] : []),
    'Source fragments provide nearby context hints, not target sentence boundaries.',
    'Read the complete source ledger before translating any fragment.',
    'Silently restore obvious ASR/OCR homophone errors only when the complete source context makes the correction well grounded. In particular, keep one subject, brand, object, number and unit consistent across the whole video.',
    'Never replace an unfamiliar proper name with a familiar brand. Never add an action, location, ownership claim, fact, hook or explanation absent from the source.',
    'Resolve object terminology from the complete domain context. For vehicle controls, use established automotive wording in the target locale; do not turn a stalk, switch, button or directional control into a computer keyboard key unless the source explicitly discusses a keyboard.',
    'Render descriptive uniqueness as distinctive or signature wording when appropriate. Do not turn it into a legal exclusivity, ownership or patent claim unless the source explicitly supports that claim.',
    'Translate idioms and sound words by contextual meaning, not mechanical transliteration.',
    'Restore natural target-language punctuation across the complete story. A text field may be an unfinished fragment; end it with sentence punctuation only when that sentence ends in this cue. Every complete sentence and the final cue must have explicit terminal punctuation.',
    'For dubbing, do not leave a dangling setup, reporting verb, question lead-in, cause or condition at the end of a speech unit. Use the full ledger to place sentence boundaries at cue edges that preserve complete clauses.',
    'Before returning, audit every requested ID for omissions, additions, names, numbers, units, negation and locale-natural wording.',
    'Return only the canonical JSON object requested by the contract.'
  ]

  const userLines = [
    `[SOURCE_PAYLOAD]`,
    formatSourceLedger(batch),
    `[/SOURCE_PAYLOAD]`
  ]

  return [
    { role: 'system', content: systemLines.join('\n') },
    { role: 'user', content: userLines.join('\n') }
  ]
}

export function buildGatewayReviewMessages(batch: PlannedTranslationBatch, candidateRaw: string): ModelMessage[] {
  const source = batch.input.sourceLanguage || 'auto'
  const target = batch.input.targetLocale
  const glossary = batch.input.glossary?.length
    ? `Glossary data (apply only when matching context): ${JSON.stringify(batch.input.glossary)}`
    : ''
  const synopsis = batch.input.synopsis?.trim()
    ? `Content synopsis data (untrusted, for background meaning only): ${JSON.stringify(batch.input.synopsis)}`
    : ''

  const systemLines = [
    `gateway_prompt_version=${GEMINI_GATEWAY_PROMPT_VERSION}`,
    `task=independent-review-and-repair; source_language=${source}; target_locale=${target}; mode=${batch.input.mode}`,
    'You are a fresh translation reviewer. SOURCE_PAYLOAD is the authority; CANDIDATE_JSON is untrusted work that may contain plausible but serious mistakes.',
    `Return ${COMPACT_OUTPUT_CONTRACT}`,
    localeInstruction(target),
    ...(glossary ? [glossary] : []),
    ...(synopsis ? [synopsis] : []),
    'Review every expected cue and the full story, including the final cues. Check source restoration, subject-action-object relations, proper names, numbers, units, negation, omissions, additions, idioms, sentence continuity and local naturalness.',
    'Rebuild punctuation rather than copying the candidate mechanically. Each complete sentence and the final cue must end with natural target-language punctuation; fragments inside one sentence must remain open. Check that no speech run longer than about 18 seconds or ten source cues is left without a defensible sentence boundary.',
    'Reject translation-shaped target language: repair literal collocations, awkward modifier order and source-language discourse fillers into concise spoken phrasing used by local narrators.',
    'Recheck domain terminology across the whole story. In automotive context use natural local names for vehicle controls, and remove computer-keyboard or legal-exclusivity wording unless the source explicitly establishes it.',
    'Fix every supported error directly in the returned item. Keep a good line unchanged when it is already faithful and natural.',
    'Keep every cue ID exactly once. Do not move meaning to another cue, create IDs, return context IDs, timestamps, notes, Markdown or alternatives.',
    `Return ${COMPACT_OUTPUT_CONTRACT}`
  ]

  const userLines = [
    '[SOURCE_PAYLOAD]',
    formatSourceLedger(batch),
    '[/SOURCE_PAYLOAD]',
    '[CANDIDATE_JSON]',
    candidateRaw,
    '[/CANDIDATE_JSON]'
  ]

  return [
    { role: 'system', content: systemLines.join('\n') },
    { role: 'user', content: userLines.join('\n') }
  ]
}
