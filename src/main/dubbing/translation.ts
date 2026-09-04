import { buildTranslationContext, type TranslationCueContext } from '../translate-shared'
import type { DubbingPlan, DubbingPlanCue } from './plan'

export interface DubbingTranslationCue extends TranslationCueContext {
  sourceStart: number
  sourceEnd: number
  preferredEnd: number
  hardEnd: number
}

export interface DubbingTranslationRequest {
  planVersion: number
  videoDuration: number
  paceMode: DubbingPlan['paceMode']
  cues: DubbingTranslationCue[]
  contextBefore: DubbingTranslationCue[]
  contextAfter: DubbingTranslationCue[]
}

function toTranslationCue(cue: DubbingPlanCue, sourceIndex: number): DubbingTranslationCue {
  return {
    id: cue.id,
    sourceIndex,
    text: cue.sourceText,
    start: cue.sourceStart,
    end: cue.sourceEnd,
    duration: Math.max(0, cue.sourceEnd - cue.sourceStart),
    contextBefore: [],
    contextAfter: [],
    sourceStart: cue.sourceStart,
    sourceEnd: cue.sourceEnd,
    preferredEnd: cue.preferredEnd,
    hardEnd: cue.hardEnd
  }
}

/**
 * Build a provider-neutral translation request from the plan. Context is
 * read-only metadata; the returned cue list is always one item per source cue.
 */
export function buildDubbingTranslationRequest(
  plan: DubbingPlan,
  contextRadius = 1
): DubbingTranslationRequest {
  const base = plan.cues.map(toTranslationCue)
  const contextual = buildTranslationContext(base, contextRadius)
  const cues: DubbingTranslationCue[] = contextual.map((cue, index) => ({
    ...base[index],
    contextBefore: cue.contextBefore,
    contextAfter: cue.contextAfter
  }))
  const first = cues[0]
  const last = cues[cues.length - 1]
  const contextBefore = first
    ? cues.slice(0, Math.max(0, cues.findIndex((cue) => cue.id === first.id)))
    : []
  const lastIndex = last ? cues.findIndex((cue) => cue.id === last.id) : -1
  const contextAfter = lastIndex >= 0
    ? cues.slice(lastIndex + 1)
    : []

  return {
    planVersion: plan.version,
    videoDuration: plan.videoDuration,
    paceMode: plan.paceMode,
    cues,
    contextBefore,
    contextAfter
  }
}

function cloneCue(cue: DubbingPlanCue): DubbingPlanCue {
  return { ...cue, sourceCueIds: [...cue.sourceCueIds], subtitles: cue.subtitles.map((subtitle) => ({ ...subtitle })) }
}

/** Apply an identity-validated translation result while preserving all source timing. */
export function applyDubbingTranslations(
  plan: DubbingPlan,
  items: readonly { id: string; text: string }[]
): DubbingPlan {
  if (items.length !== plan.cues.length) throw new Error('Kết quả dịch không đủ cue theo DubbingPlan.')
  const byId = new Map<string, string>()
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || !item.text.trim()) {
      throw new Error('Kết quả dịch có cue rỗng hoặc không hợp lệ.')
    }
    if (byId.has(item.id)) throw new Error(`Kết quả dịch trùng cue ${item.id}.`)
    byId.set(item.id, item.text.trim())
  }
  for (const cue of plan.cues) {
    if (!byId.has(cue.id)) throw new Error(`Kết quả dịch thiếu cue ${cue.id}.`)
  }
  return {
    ...plan,
    cues: plan.cues.map((cue) => {
      const translatedText = byId.get(cue.id) as string
      return { ...cloneCue(cue), translatedText, finalSpokenText: translatedText, rephrased: false }
    })
  }
}

export interface DubbingRephraseCandidate {
  text: string
  predictedSeconds: number
}

/**
 * Prefer the shortest semantically reviewed candidate that the predictor says
 * fits. If the predictor rejects every valid candidate, return the shortest
 * valid one anyway: measured TTS duration is authoritative and the synthesis
 * stage will reject it without truncating audio if it still cannot fit.
 */
export function chooseDubbingRephrase(
  candidates: readonly DubbingRephraseCandidate[],
  targetDuration: number
): DubbingRephraseCandidate | null {
  const valid = candidates
    .filter((candidate) => typeof candidate.text === 'string' && candidate.text.trim() && Number.isFinite(candidate.predictedSeconds) && candidate.predictedSeconds > 0)
    .sort((left, right) => left.predictedSeconds - right.predictedSeconds)
  const eligible = valid.find((candidate) => candidate.predictedSeconds <= targetDuration)
  const selected = eligible || valid[0]
  return selected ? { ...selected, text: selected.text.trim() } : null
}
