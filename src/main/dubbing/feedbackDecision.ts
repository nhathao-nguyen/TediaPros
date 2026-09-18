export interface FeedbackCandidate {
  hash: string
  text: string
  quality: 'reject' | 'review' | 'eligible'
}

export type FeedbackAction =
  | { type: 'stop'; reason: string }
  | { type: 'synthesize'; candidate: FeedbackCandidate }

export function nextFeedbackAction(
  candidates: readonly FeedbackCandidate[],
  tried: ReadonlySet<string>,
  cancelled: boolean
): FeedbackAction {
  if (cancelled) return { type: 'stop', reason: 'cancelled' }
  const candidate = candidates.find((entry) => entry.quality === 'eligible' && entry.text.trim() && !tried.has(entry.hash))
  return candidate ? { type: 'synthesize', candidate } : { type: 'stop', reason: 'no-progress' }
}
