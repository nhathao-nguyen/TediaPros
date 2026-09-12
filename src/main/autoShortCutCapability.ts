import type { AutoShortQueueItemInput } from '../shared/types'

/** Main remains the authority even when an older Renderer submits a job. */
export const AUTO_SHORT_TEMPORAL_CUT_CORE_VERIFIED = true

export class AutoShortCutCapabilityError extends Error {
  readonly code = 'CUT_CORE_NOT_VERIFIED' as const

  constructor() {
    super('Cắt đoạn đang được hoàn thiện để bảo đảm đồng bộ hình và tiếng. Bản chỉnh sửa vẫn được giữ; video không cắt vẫn chạy bình thường.')
    this.name = 'AutoShortCutCapabilityError'
  }
}

export function requestHasTemporalCut(items: readonly Pick<AutoShortQueueItemInput, 'temporalEdit'>[]): boolean {
  return items.some((item) => Boolean(item.temporalEdit?.removedRanges.length))
}

export function assertCutRunCapability(hasCut: boolean, coreVerified = AUTO_SHORT_TEMPORAL_CUT_CORE_VERIFIED): void {
  if (hasCut && !coreVerified) throw new AutoShortCutCapabilityError()
}

export function autoShortTemporalCutCapability(coreVerified = AUTO_SHORT_TEMPORAL_CUT_CORE_VERIFIED): {
  editing: true
  execution: boolean
  reason?: 'CUT_CORE_NOT_VERIFIED'
} {
  return coreVerified
    ? { editing: true, execution: true }
    : { editing: true, execution: false, reason: 'CUT_CORE_NOT_VERIFIED' }
}
