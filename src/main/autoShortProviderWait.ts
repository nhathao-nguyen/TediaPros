import type { ProviderWaitStage } from '../shared/autoShortBatchJournal'

export interface ProviderWaitState {
  operationId: string
  stage: ProviderWaitStage
  reason: string
  nextEligibleAtUtc: string | null
}

export function shouldWakeProviderWait(wait: ProviderWaitState, nowMs: number, cancelled: boolean): boolean {
  if (cancelled || wait.nextEligibleAtUtc === null) return false
  const deadline = Date.parse(wait.nextEligibleAtUtc)
  return Number.isFinite(deadline) && nowMs >= deadline
}

export function calculateProviderWaitRemainingMs(wait: ProviderWaitState, nowMs: number): number {
  if (!wait.nextEligibleAtUtc) return 0
  const deadline = Date.parse(wait.nextEligibleAtUtc)
  if (!Number.isFinite(deadline)) return 0
  return Math.max(0, deadline - nowMs)
}
