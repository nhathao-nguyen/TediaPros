import type { TranslationInput, TranslationCue } from '../../shared/translation'
import { groupSourceSpeechCues, SOURCE_SPEECH_GROUP_PREFIX } from '../sourceSpeechGrouping'

/** Preserve established IDs when a retry contains only part of the source. */
export function withSourceSpeechGroups(input: TranslationInput): TranslationInput {
  if (input.mode !== 'dubbing' || input.cues.every(cue => cue.groupId.startsWith(SOURCE_SPEECH_GROUP_PREFIX))) return input
  const groups = groupSourceSpeechCues(input.cues)
  const byId = new Map(groups.flatMap(group => group.cues.map(cue => [cue.id, group.id] as const)))
  return {
    ...input,
    cues: input.cues.map(cue => ({ ...cue, groupId: byId.get(cue.id)! })),
    // Multi-cue groups are bounded by the source grouper. A single enormous
    // source cue is split by the planner and must not be duplicated in full.
    sourceSpeechGroups: groups.filter(group => group.cues.length > 1).map(group => ({
      id: group.id, cues: group.cues.map(cue => ({ ...cue, groupId: group.id }))
    }))
  }
}

/** Keep contiguous source groups intact, including internal long-cue parts. */
export function translationSpeechGroups(cues: readonly TranslationCue[]): TranslationCue[][] {
  const groups: TranslationCue[][] = []
  for (const cue of cues) {
    const previous = groups.at(-1)
    if (previous?.[0].groupId === cue.groupId) previous.push(cue)
    else groups.push([cue])
  }
  return groups
}
