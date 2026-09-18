import { AUTO_SHORT_TTS_HARD_MAX_TEMPO } from '../autoShortPolicy'
import type { DubbingWindow } from '../dubbing/plan'

export interface SpeechBudget {
  unitId: string
  revision: number
  availableSeconds: number
  targetNaturalSeconds: number
  hardMaxNaturalSeconds: number
}

/**
 * Materialize one source-derived window once. Callers must not subtract the
 * protected gap again or pre-spend video-extension headroom in this budget.
 */
export function makeSpeechBudget(
  unitId: string,
  revision: number,
  window: Pick<DubbingWindow, 'start' | 'hardEnd'>,
  targetTempo: number,
  hardTempo: number
): SpeechBudget {
  const availableSeconds = window.hardEnd - window.start
  if (!unitId.trim() || !Number.isSafeInteger(revision) || revision < 1
    || ![window.start, window.hardEnd, targetTempo, hardTempo].every(Number.isFinite)
    || availableSeconds <= 0 || targetTempo < 1 || hardTempo < targetTempo
    || hardTempo > AUTO_SHORT_TTS_HARD_MAX_TEMPO + 1e-9) {
    throw new Error('invalid-speech-budget')
  }
  return {
    unitId: unitId.trim(),
    revision,
    availableSeconds,
    targetNaturalSeconds: availableSeconds * targetTempo,
    hardMaxNaturalSeconds: availableSeconds * hardTempo
  }
}
