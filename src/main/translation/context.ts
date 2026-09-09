import type { TranslationCue, TranslationInput } from '../../shared/translation'
import type { TranslationUnitMapping } from './planner'

const CONTEXT_CUES_PER_SIDE = 2
const CONTEXT_TEXT_CHARACTERS = 512

type SourceContext = Pick<TranslationInput, 'contextBefore' | 'contextAfter'>

function excerpt(cue: TranslationCue, before: boolean, limit = CONTEXT_TEXT_CHARACTERS): TranslationCue {
  const characters = Array.from(cue.text)
  return { ...cue, text: (before ? characters.slice(-limit) : characters.slice(0, limit)).join('') }
}

/** Context is optional evidence, never another requested output or a mutable source ledger. */
export function fitTranslationSourceContext(
  input: TranslationInput,
  fits: (candidate: TranslationInput) => boolean = () => true
): TranslationInput {
  const seen = new Set(input.cues.map((cue) => cue.id))
  const take = (cues: readonly TranslationCue[], before: boolean): TranslationCue[] => {
    const selected: TranslationCue[] = []
    for (const cue of before ? [...cues].reverse() : cues) {
      if (!cue.id.trim() || !cue.text.trim() || seen.has(cue.id)) continue
      seen.add(cue.id)
      selected.push(excerpt(cue, before))
      if (selected.length === CONTEXT_CUES_PER_SIDE) break
    }
    return before ? selected.reverse() : selected
  }
  const result = { ...input, contextBefore: take(input.contextBefore, true), contextAfter: take(input.contextAfter, false) }
  // Reduce farthest evidence first; even compatibility providers get finite
  // context. The caller counts the actual translate/repair payload and output
  // reservation. Required source and glossary are never truncated here.
  while (!fits(result) && (result.contextBefore.length || result.contextAfter.length)) {
    const before = result.contextBefore.length > result.contextAfter.length
    const side = before ? result.contextBefore : result.contextAfter
    const index = before ? 0 : side.length - 1
    const cue = side[index]
    const length = Array.from(cue.text).length
    if (length > 128) side[index] = excerpt(cue, before, Math.floor(length / 2))
    else side.splice(index, 1)
  }
  return result
}

/**
 * Select source neighbors from the complete immutable ledger, including the
 * exact original offsets of split units. Pass the complete plan.mapping on
 * recovery, not just the selected child mapping, to retain sibling parts.
 */
export function selectTranslationSourceContext(
  source: TranslationInput,
  requested: readonly TranslationCue[],
  mappings: readonly TranslationUnitMapping[] = []
): SourceContext {
  const byOriginal = new Map<string, TranslationUnitMapping[]>()
  for (const mapping of mappings) {
    const list = byOriginal.get(mapping.originalId) || []
    list.push(mapping)
    byOriginal.set(mapping.originalId, list)
  }
  const ledger = source.cues.flatMap((cue) => {
    const spans = byOriginal.get(cue.id)
    if (!spans?.length) return [{ ...cue }]
    return [...spans].sort((a, b) => a.startOffset - b.startOffset).map((span) => ({
      ...cue, id: span.unitId, text: cue.text.slice(span.startOffset, span.endOffset)
    }))
  })
  const requestedIds = new Set(requested.map((cue) => cue.id))
  const first = ledger.findIndex((cue) => requestedIds.has(cue.id))
  const last = ledger.reduce((found, cue, index) => requestedIds.has(cue.id) ? index : found, -1)
  const context = fitTranslationSourceContext({
    ...source, cues: [...requested],
    contextBefore: [...source.contextBefore, ...(first > 0 ? ledger.slice(Math.max(0, first - CONTEXT_CUES_PER_SIDE), first) : [])],
    contextAfter: [...(last >= 0 ? ledger.slice(last + 1, last + 1 + CONTEXT_CUES_PER_SIDE) : []), ...source.contextAfter]
  })
  return { contextBefore: context.contextBefore, contextAfter: context.contextAfter }
}
