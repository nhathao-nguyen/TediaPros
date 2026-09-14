import type { AutoShortItemResult } from '../shared/types'
import { EdgeTtsError, retryableEdgeFailure } from './edgeTtsRecovery'

type Recovery = NonNullable<AutoShortItemResult['recovery']>

export function classifyAutoShortTtsRecovery(
  error: unknown,
  message: string,
  attempt: 1 | 2
): Recovery | undefined {
  if (error instanceof EdgeTtsError && retryableEdgeFailure(error)) {
    return { kind: 'provider-transient', retryable: attempt === 1, attempt }
  }
  if (/audio TTS không hợp lệ|không trả về audio TTS/iu.test(message)) {
    return { kind: 'tts-quality', retryable: attempt === 1, attempt }
  }
  return undefined
}
