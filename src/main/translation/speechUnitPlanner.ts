import { AUTO_SHORT_TTS_HARD_MAX_TEMPO, AUTO_SHORT_TTS_PREFERRED_MAX_TEMPO } from '../autoShortPolicy'
import { deriveDubbingWindow } from '../dubbing/plan'
import { extractSpeaker, isSentenceTerminal } from '../semanticGrouping'
import { groupSourceSpeechCues } from '../sourceSpeechGrouping'
import type { TranslationCue } from '../../shared/translation'
import { SPEECH_UNIT_PLAN_VERSION, validateSourcePartition, type SpeechUnit, type SpeechUnitPlan } from '../../shared/speechUnitPlan'
import { makeSpeechBudget } from './speechBudget'

export interface BuildSourceSpeechUnitPlanInput {
  sourceDigest: string
  videoDuration: number
  cues: readonly TranslationCue[]
  revision?: number
}

function validCue(cue: TranslationCue): boolean {
  return Boolean(cue.id.trim() && cue.text.trim()
    && Number.isInteger(cue.sourceIndex) && cue.sourceIndex >= 0
    && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end >= cue.start)
}

function boundaryReason(
  group: readonly TranslationCue[],
  next: readonly TranslationCue[] | undefined
): SpeechUnit['boundaryReason'] {
  if (!next?.length) return 'end-of-source'
  const last = group.at(-1)!
  const following = next[0]!
  if (isSentenceTerminal(last.text)) return 'source-terminal'
  const speaker = extractSpeaker(last.text)
  const nextSpeaker = extractSpeaker(following.text)
  if (speaker !== nextSpeaker && (speaker !== null || nextSpeaker !== null)) return 'speaker-change'
  if (following.start - last.end >= 0.6 - 1e-9) return 'source-pause'
  return 'bounded-source-run'
}

/**
 * Freeze the deterministic source grouping before translation. This plan is an
 * advisory prompt input; final WAV measurement remains the authority for a
 * later TTS recovery, so it never grants permission to discard source meaning.
 */
export function buildSourceSpeechUnitPlan(input: BuildSourceSpeechUnitPlanInput): SpeechUnitPlan {
  const sourceDigest = input.sourceDigest.trim()
  if (!sourceDigest) throw new Error('invalid-speech-unit-source-digest')
  if (!Number.isFinite(input.videoDuration) || input.videoDuration <= 0 || !input.cues.length
    || input.cues.some((cue) => !validCue(cue))
    || new Set(input.cues.map((cue) => cue.id.trim())).size !== input.cues.length) {
    throw new Error('invalid-speech-unit-source')
  }
  const revision = input.revision ?? 1
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('invalid-speech-unit-revision')

  const cues = input.cues.map((cue) => ({ ...cue }))
  const groups = groupSourceSpeechCues(cues)
  const partition = groups.map((group) => group.cues.map((cue) => cue.id))
  const hardBoundaryAfter = groups.slice(0, -1).map((group) => group.cues.at(-1)!.id)
  const validation = validateSourcePartition(cues.map((cue) => cue.id), partition, hardBoundaryAfter)
  if (validation.length) throw new Error(`invalid-speech-unit-partition:${validation.join(',')}`)

  const units: SpeechUnit[] = groups.map((group, index) => {
    const first = group.cues[0]!
    const last = group.cues.at(-1)!
    const next = groups[index + 1]?.cues
    const source = {
      id: group.id,
      start: first.start,
      end: last.end,
      text: group.cues.map((cue) => cue.text).join(' ')
    }
    const window = deriveDubbingWindow(source, next?.[0]?.start ?? null, input.videoDuration)
    const budget = makeSpeechBudget(group.id, revision, window, AUTO_SHORT_TTS_PREFERRED_MAX_TEMPO, AUTO_SHORT_TTS_HARD_MAX_TEMPO)
    return {
      id: group.id,
      memberCueIds: group.cues.map((cue) => cue.id),
      sourceStart: first.start,
      sourceEnd: last.end,
      hardEnd: window.hardEnd,
      boundaryReason: boundaryReason(group.cues, next),
      budget: {
        availableSeconds: budget.availableSeconds,
        targetNaturalSeconds: budget.targetNaturalSeconds,
        hardMaxNaturalSeconds: budget.hardMaxNaturalSeconds
      }
    }
  })

  return { version: SPEECH_UNIT_PLAN_VERSION, revision, sourceDigest, units }
}
