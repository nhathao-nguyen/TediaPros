/** Shared, source-anchored speech grouping contract. No Node/Electron imports. */
export const SPEECH_UNIT_PLAN_VERSION = 'speech-unit-plan-v1' as const

export interface SpeechUnitBudget {
  availableSeconds: number
  targetNaturalSeconds: number
  hardMaxNaturalSeconds: number
}

export interface SpeechUnit {
  id: string
  memberCueIds: string[]
  sourceStart: number
  sourceEnd: number
  hardEnd: number
  boundaryReason: 'source-terminal' | 'speaker-change' | 'source-pause' | 'bounded-source-run' | 'end-of-source'
  budget: SpeechUnitBudget
}

export interface SpeechUnitPlan {
  version: typeof SPEECH_UNIT_PLAN_VERSION
  revision: number
  sourceDigest: string
  units: SpeechUnit[]
}

/** Reject a proposed plan before it can reorder, duplicate, omit, or cross a source hard edge. */
export function validateSourcePartition(
  sourceIds: readonly string[],
  groups: readonly (readonly string[])[],
  hardBoundaryAfter: readonly string[]
): string[] {
  const errors: string[] = []
  const flat = groups.flat()
  if (new Set(sourceIds).size !== sourceIds.length) errors.push('duplicate-source-id')
  if (groups.some((group) => group.length === 0)) errors.push('empty-group')
  if (flat.length !== sourceIds.length || flat.some((id, index) => id !== sourceIds[index])) errors.push('coverage-or-order')
  const hard = new Set(hardBoundaryAfter)
  if (groups.some((group) => group.slice(0, -1).some((id) => hard.has(id)))) errors.push('crossed-hard-boundary')
  return errors
}
