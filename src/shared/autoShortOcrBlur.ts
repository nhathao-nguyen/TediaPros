import type { AutoShortBlurMode, AutoShortConfig, AutoShortOcrBlurProfile } from './types'

export function isSttnRemoval(config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>): boolean {
  return config.lamMo === true && config.blurMode === 'sttn'
}

/** Modes that need OCR boxes/timing in addition to subtitle text. */
export function isAutomaticOcrProcessing(config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>): boolean {
  return isAutomaticOcrBlur(config) || isSttnRemoval(config)
}

export function isAutomaticOcrBlur(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>
): boolean {
  return config.lamMo === true && config.blurMode === 'ocr-auto'
}

export function autoShortNeedsOcr(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean {
  return isAutomaticOcrProcessing(config) ||
    config.subtitleMethod === 'ocr' ||
    config.subtitleMethod === 'whisper-ocr'
}

/** Use only when selecting an Auto Short OCR invocation/checkpoint profile. */
export function effectiveAutoShortOcrProfile(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode' | 'ocrBlurProfile'>
): AutoShortOcrBlurProfile {
  return isSttnRemoval(config) ? 'accurate' : isAutomaticOcrBlur(config) ? config.ocrBlurProfile : 'fast'
}

export function normalizeAutoShortBlurMode(value: unknown): AutoShortBlurMode {
  return value === 'sttn' || value === 'ocr-auto' ? value : 'manual'
}

export function normalizeAutoShortOcrBlurProfile(value: unknown): AutoShortOcrBlurProfile {
  return value === 'fast' ? 'fast' : 'accurate'
}
