import { createHash } from 'node:crypto'
import type { AutoShortConfig, AlignedCue, AutoShortOcrBlurProfile } from '../shared/types'
import { isAutomaticOcrBlur } from '../shared/autoShortOcrBlur'

export interface OcrSourceCueEvidence {
  effectiveOcrProfile: AutoShortOcrBlurProfile
  engineVersion: string
  engineProtocol: 'ocr-local/1'
  cueDigest: string
}

export function mustRegenerateOcrSource(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean {
  return isAutomaticOcrBlur(config) && (config.subtitleMethod === 'ocr' || config.subtitleMethod === 'whisper-ocr')
}

export function digestCanonicalSourceCues(cues: readonly AlignedCue[]): string {
  const sorted = [...cues].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start
    if (a.end !== b.end) return a.end - b.end
    return String(a.id).localeCompare(String(b.id))
  })
  const simplified = sorted.map((c) => ({
    id: c.id,
    text: c.text,
    start: c.start,
    end: c.end,
    source: c.source,
    timingQuality: c.timingQuality
  }))
  return createHash('sha256').update(JSON.stringify(simplified)).digest('hex')
}

export function sameOcrSourceCueEvidence(
  previous: OcrSourceCueEvidence | undefined,
  next: OcrSourceCueEvidence
): boolean {
  if (!previous) return false
  return (
    previous.effectiveOcrProfile === next.effectiveOcrProfile &&
    previous.engineVersion === next.engineVersion &&
    previous.engineProtocol === next.engineProtocol &&
    previous.cueDigest === next.cueDigest
  )
}
