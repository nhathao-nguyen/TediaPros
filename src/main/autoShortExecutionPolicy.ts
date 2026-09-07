export interface AutoShortExecutionPolicy {
  maxActiveItems: 1 | 2
  overlapIndependentStages: boolean
  prefetchTts: boolean
  ocrTransport: 'legacy-disk' | 'stream-full' | 'stream-roi'
}

export const CONSERVATIVE_POLICY: Readonly<AutoShortExecutionPolicy> = Object.freeze({
  maxActiveItems: 1,
  overlapIndependentStages: false,
  prefetchTts: false,
  ocrTransport: 'legacy-disk'
})

export function resolveExecutionPolicy(
  overrides?: Partial<AutoShortExecutionPolicy> | null
): AutoShortExecutionPolicy {
  if (!overrides) {
    return { ...CONSERVATIVE_POLICY }
  }
  const maxActive = overrides.maxActiveItems === 2 ? 2 : 1
  const overlap = Boolean(overrides.overlapIndependentStages)
  const prefetch = Boolean(overrides.prefetchTts)
  const transport =
    overrides.ocrTransport === 'stream-roi' || overrides.ocrTransport === 'stream-full'
      ? overrides.ocrTransport
      : 'legacy-disk'

  return {
    maxActiveItems: maxActive,
    overlapIndependentStages: overlap,
    prefetchTts: prefetch,
    ocrTransport: transport
  }
}
