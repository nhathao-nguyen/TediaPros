import type { SubtitleCue } from './subtitles'
import type { CutExecutionPlan } from './autoShortCutPlan'
import { cutTimeToDecimal } from './autoShortCutPlan'

export interface CutSeamCueIssue {
  cueId: string
  joinIndex: number
  editedAtSeconds: number
  code: 'CUT_SEAM_REVIEW_REQUIRED'
}

/**
 * A recognizer cue that spans a hard join may combine speech from two source
 * regions. It must be stopped before translation/TTS rather than presented as
 * continuous source evidence.
 */
export function findCutSeamCueIssues(
  cues: readonly Pick<SubtitleCue, 'id' | 'start' | 'end'>[],
  plan: CutExecutionPlan
): CutSeamCueIssue[] {
  const issues: CutSeamCueIssue[] = []
  for (const [joinIndex, join] of plan.joins.entries()) {
    const editedAtSeconds = Number(cutTimeToDecimal(join.editedAt, 15))
    if (!Number.isFinite(editedAtSeconds)) throw new Error('CUT_TIMELINE_MISMATCH')
    for (const cue of cues) {
      if (cue.start < editedAtSeconds - 1e-9 && cue.end > editedAtSeconds + 1e-9) {
        issues.push({ cueId: cue.id, joinIndex, editedAtSeconds, code: 'CUT_SEAM_REVIEW_REQUIRED' })
      }
    }
  }
  return issues
}
