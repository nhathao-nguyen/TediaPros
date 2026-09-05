import type { AutoShortBlurMode, AutoShortConfig, AutoShortOcrBlurProfile } from './types'

export function isAutomaticOcrBlur(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>
): boolean {
  return config.lamMo === true && config.blurMode === 'ocr-auto'
}

export function autoShortNeedsOcr(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean {
  return isAutomaticOcrBlur(config) ||
    config.subtitleMethod === 'ocr' ||
    config.subtitleMethod === 'whisper-ocr'
}

/** Use only when selecting an Auto Short OCR invocation/checkpoint profile. */
export function effectiveAutoShortOcrProfile(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode' | 'ocrBlurProfile'>
): AutoShortOcrBlurProfile {
  return isAutomaticOcrBlur(config) ? config.ocrBlurProfile : 'fast'
}

export function normalizeAutoShortBlurMode(value: unknown): AutoShortBlurMode {
  return value === 'ocr-auto' ? 'ocr-auto' : 'manual'
}

export function normalizeAutoShortOcrBlurProfile(value: unknown): AutoShortOcrBlurProfile {
  return value === 'fast' ? 'fast' : 'accurate'
}
