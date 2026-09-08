import type {
  TranslationCapability as SharedTranslationCapability,
  TranslationInput,
  TranslationItem,
  TranslationCue
} from '../../shared/translation'
import { buildSemanticGroups, joinGroupText, type SemanticCue } from '../semanticGrouping'
import { buildTranslationMessages } from './prompts'

export interface TranslationCapability extends SharedTranslationCapability {
  provider: 'local' | 'gemini' | 'openai' | 'fixture'
  modelIdentity: string
  revisionKnown: boolean
  format: 'json-items' | 'id-lines'
  contextTokens: number | null
  outputTokens: number | null
  countTokens?: (text: string) => number
}

export interface TranslationUnitMapping {
  unitId: string
  originalId: string
  partIndex: number
  startOffset: number
  endOffset: number
}

export interface PlannedTranslationBatch {
  id: string
  input: TranslationInput
  maxOutputTokens: number
  mapping: TranslationUnitMapping[]
}

export interface TranslationPlan {
  planVersion: 'translation-plan-v2'
  batches: PlannedTranslationBatch[]
  mapping: TranslationUnitMapping[]
  warnings: string[]
  unsupported: boolean
}

function validateLocale(value: string): void {
  const locale = value.trim()
  if (!locale || /^(?:auto|mixed|unknown)$/iu.test(locale)) throw new Error('Translation planner requires an explicit target locale.')
  try {
    new Intl.Locale(locale)
  } catch {
    throw new Error(`Invalid target locale: ${locale}`)
  }
}

function safeTokenCount(capability: TranslationCapability, value: string): number {
  try {
    const counted = capability.countTokens?.(value)
    if (typeof counted === 'number' && Number.isFinite(counted) && counted >= 0) return counted
  } catch {
    // fall back to a conservative byte estimate
  }
  return new TextEncoder().encode(value).length
}

function safeBoundary(text: string, candidate: number): number {
  let end = Math.max(1, Math.min(text.length, candidate))
  const code = text.charCodeAt(end)
  if (code >= 0xdc00 && code <= 0xdfff) end--
  return Math.max(1, end)
}

function preferredBreak(text: string, limit: number): number {
  const bounded = safeBoundary(text, limit)
  const sentence = text.slice(0, bounded).search(/[.!?。！？…]\s*[^\s]*$/u)
  if (sentence > Math.floor(bounded * 0.55)) return safeBoundary(text, sentence + 1)
  const whitespace = text.slice(0, bounded).search(/\s+(?=[^\s]*$)/u)
  if (whitespace > Math.floor(bounded * 0.45)) return safeBoundary(text, whitespace + 1)
  return bounded
}

function splitCue(cue: TranslationCue, maxChars: number): { cue: TranslationCue; mapping: TranslationUnitMapping }[] {
  if (cue.text.length <= maxChars) {
    return [{ cue: { ...cue }, mapping: { unitId: cue.id, originalId: cue.id, partIndex: 1, startOffset: 0, endOffset: cue.text.length } }]
  }
  const result: { cue: TranslationCue; mapping: TranslationUnitMapping }[] = []
  let offset = 0
  let partIndex = 1
  while (offset < cue.text.length) {
    const remaining = cue.text.slice(offset)
    const length = preferredBreak(remaining, maxChars)
    const endOffset = offset + length
    const partText = cue.text.slice(offset, endOffset)
    const unitId = `${cue.id}/part-${partIndex}`
    result.push({
      cue: { ...cue, id: unitId, text: partText, groupId: `${cue.groupId}/part-${partIndex}` },
      mapping: { unitId, originalId: cue.id, partIndex, startOffset: offset, endOffset }
    })
    offset = endOffset
    partIndex++
  }
  return result
}

function asSemanticCue(cue: TranslationCue): SemanticCue {
  return { id: cue.id, text: cue.text, start: cue.start, end: cue.end, sourceIndex: cue.sourceIndex }
}

function cloneCue(cue: TranslationCue): TranslationCue {
  return { ...cue }
}

function normalizedInput(input: TranslationInput): TranslationInput {
  validateLocale(input.targetLocale)
  if (!Array.isArray(input.cues) || input.cues.length === 0) throw new Error('Translation source has no cues.')
  const seen = new Set<string>()
  const cues = input.cues.map((cue) => {
    if (!cue.id.trim() || seen.has(cue.id.trim())) throw new Error(`Invalid or duplicate source cue ID: ${cue.id}`)
    if (!cue.text.trim() || !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end < cue.start) throw new Error(`Invalid source cue: ${cue.id}`)
    seen.add(cue.id.trim())
    return cloneCue({ ...cue, id: cue.id.trim() })
  })
  return {
    ...input,
    targetLocale: input.targetLocale.trim(),
    sourceLanguage: input.sourceLanguage.trim() || 'auto',
    cues,
    contextBefore: input.contextBefore.map(cloneCue),
    contextAfter: input.contextAfter.map(cloneCue),
    glossary: input.glossary.map((item) => ({ source: item.source, target: item.target }))
  }
}

/** Build deterministic, locale-aware translation units and bounded batches. */
export function planTranslation(input: TranslationInput, capability: TranslationCapability): TranslationPlan {
  const source = normalizedInput(input)
  const warnings: string[] = []
  const outputTokens = capability.outputTokens == null
    ? 2_048
    : Math.max(1, Math.min(2_048, Math.floor(capability.outputTokens)))
  const maxChars = Math.max(256, Math.min(4_000, Math.floor(outputTokens * 3)))
  const units = source.cues.flatMap((cue) => splitCue(cue, maxChars))
  const mapping = units.map((item) => item.mapping)

  // Keep semantic groups intact where possible, while allowing a long cue's
  // internal units to form a bounded request when the provider budget requires.
  const semanticGroups = buildSemanticGroups(units.map((item) => asSemanticCue(item.cue)), {
    maxCuesPerGroup: 6,
    maxGroupChars: Math.max(300, maxChars),
    maxGroupDurationSeconds: 15,
    maxPauseSeconds: 0.6
  }, source.sourceLanguage)
  const groups = semanticGroups.map((group) => group.cues.map((cue) => units.find((item) => item.cue.id === cue.id)!).filter(Boolean))
  const batches: PlannedTranslationBatch[] = []
  let pending: typeof units = []

  const buildBatchInput = (items: typeof units): TranslationInput => ({
    ...source,
    cues: items.map((item) => item.cue),
    contextBefore: source.contextBefore.map(cloneCue),
    contextAfter: source.contextAfter.map(cloneCue)
  })

  const exactInputCost = (items: typeof units): number => {
    const serialized = JSON.stringify(buildTranslationMessages(buildBatchInput(items), capability.format))
    return safeTokenCount(capability, serialized)
  }

  const fitsContext = (items: typeof units): boolean =>
    capability.contextTokens === null || exactInputCost(items) + outputTokens <= capability.contextTokens

  const flush = (): void => {
    if (pending.length === 0) return
    const batchInput = buildBatchInput(pending)
    // Count the exact system/user payload sent by every production adapter so
    // batching and context guards do not drift from the wire contract.
    const inputCost = exactInputCost(pending)
    const reservedOutput = outputTokens
    if (capability.contextTokens !== null && inputCost + reservedOutput > capability.contextTokens) {
      warnings.push(`Batch ${batches.length + 1} vượt ngân sách context ước lượng (${inputCost + reservedOutput} > ${capability.contextTokens}).`)
    }
    batches.push({
      id: `translation-batch-${batches.length + 1}`,
      input: batchInput,
      maxOutputTokens: outputTokens,
      mapping: pending.map((item) => item.mapping)
    })
    pending = []
  }

  for (const group of groups) {
    const groupCost = group.reduce((sum, item) => sum + item.cue.text.length + 64, 0)
    const currentCost = pending.reduce((sum, item) => sum + item.cue.text.length + 64, 0)
    // The semantic-group estimate is only a cheap early filter. Before
    // accepting a group, measure the exact system+user payload. If the group
    // itself is too large, fall back to cue boundaries so one oversized group
    // does not make otherwise valid cues unsupported.
    const candidate = pending.length > 0 ? [...pending, ...group] : group
    const exceedsContext = !fitsContext(candidate)
    const exceedsLegacy = currentCost + groupCost > 20_000 || pending.length + group.length > 24
    if (pending.length > 0 && (exceedsContext || exceedsLegacy)) flush()
    if (group.length > 1 && !fitsContext(group)) {
      for (const item of group) {
        if (pending.length > 0 && (!fitsContext([...pending, item]) || pending.length >= 24)) flush()
        pending.push(item)
      }
    } else {
      pending.push(...group)
    }
  }
  flush()
  if (batches.length === 0) throw new Error('Translation planner produced no batches.')
  const unsupported = capability.contextTokens !== null && warnings.some((warning) => warning.includes('vượt ngân sách context'))
  if (capability.contextTokens === null || capability.outputTokens === null) warnings.push('Provider token limits are unknown; using a bounded compatibility estimate.')
  return { planVersion: 'translation-plan-v2', batches, mapping, warnings, unsupported }
}

function joinTranslatedParts(parts: readonly string[], targetLocale: string): string {
  if (parts.length <= 1) return parts[0] || ''
  if (/^(?:zh|ja)(?:-|$)/iu.test(targetLocale)) return parts.join('')
  return parts.join(' ').replace(/\s+([,.!?;:。！？，。；：])/gu, '$1').trim()
}

/** Restore internally split provider units to the original cue identity. */
export function restoreOriginalCues(
  source: readonly TranslationCue[],
  items: readonly TranslationItem[],
  mappings: readonly TranslationUnitMapping[],
  targetLocale: string
): TranslationItem[] {
  validateLocale(targetLocale)
  const sourceIds = source.map((cue) => cue.id.trim())
  if (source.length === 0 || sourceIds.some((id) => !id) || new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('Cannot restore translation without unique source cue IDs.')
  }
  const byUnit = new Map<string, TranslationItem>()
  for (const item of items) {
    const id = item.id.trim()
    if (!id || byUnit.has(id) || !item.text.trim()) throw new Error(`Invalid or duplicate translation unit ${id || '(empty)'}.`)
    byUnit.set(id, { id, text: item.text.trim() })
  }
  const byOriginal = new Map<string, TranslationUnitMapping[]>()
  const mappingIds = new Set<string>()
  for (const mapping of mappings) {
    if (!mapping.unitId.trim() || mappingIds.has(mapping.unitId) || !sourceIds.includes(mapping.originalId) ||
      !Number.isInteger(mapping.partIndex) || mapping.partIndex < 1 || !Number.isInteger(mapping.startOffset) ||
      !Number.isInteger(mapping.endOffset) || mapping.startOffset < 0 || mapping.endOffset <= mapping.startOffset) {
      throw new Error(`Invalid translation unit mapping for ${mapping.originalId || '(empty)'}.`)
    }
    mappingIds.add(mapping.unitId)
    const list = byOriginal.get(mapping.originalId) || []
    list.push(mapping)
    byOriginal.set(mapping.originalId, list)
  }
  if (mappingIds.size !== byUnit.size || [...mappingIds].some((id) => !byUnit.has(id))) {
    throw new Error('Translation units and mappings are incomplete or inconsistent.')
  }
  return source.map((cue) => {
    const parts = [...(byOriginal.get(cue.id) || [])].sort((a, b) => a.partIndex - b.partIndex)
    if (parts.length === 0 || parts.some((part, index) => part.partIndex !== index + 1)) throw new Error(`Missing translation unit for source cue ${cue.id}.`)
    if (parts[0]!.startOffset !== 0 || parts[parts.length - 1]!.endOffset !== cue.text.length) throw new Error(`Invalid source span for cue ${cue.id}.`)
    if (parts.some((part) => {
      const startsOnLow = part.startOffset > 0 && cue.text.charCodeAt(part.startOffset) >= 0xdc00 && cue.text.charCodeAt(part.startOffset) <= 0xdfff
      const endsOnHigh = part.endOffset < cue.text.length && cue.text.charCodeAt(part.endOffset - 1) >= 0xd800 && cue.text.charCodeAt(part.endOffset - 1) <= 0xdbff
      return startsOnLow || endsOnHigh
    })) throw new Error(`Translation span splits a surrogate pair for cue ${cue.id}.`)
    for (let index = 1; index < parts.length; index++) {
      if (parts[index - 1]!.endOffset !== parts[index]!.startOffset) throw new Error(`Non-contiguous source spans for cue ${cue.id}.`)
    }
    const texts = parts.map((part) => {
      const item = byUnit.get(part.unitId)
      if (!item || !item.text.trim()) throw new Error(`Missing translation unit ${part.unitId}.`)
      return item.text.trim()
    })
    return { id: cue.id, text: joinTranslatedParts(texts, targetLocale) }
  })
}
