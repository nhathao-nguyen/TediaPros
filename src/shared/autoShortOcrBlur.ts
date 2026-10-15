import type { AutoShortBlurMode, AutoShortConfig, AutoShortOcrBlurProfile } from './types'

export function isSttnRemoval(config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>): boolean {
  return config.lamMo === true && (config.blurMode === 'sttn' || config.blurMode === 'sttn-region')
}

export function isAlphaRemoval(config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>): boolean {
  return config.lamMo === true && config.blurMode === 'gemini-alpha'
}

/** Modes that show an erasure scan region in the editor. */
export function isAutomaticOcrProcessing(config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>): boolean {
  return isAutomaticOcrBlur(config) || isSttnRemoval(config) || isAlphaRemoval(config)
}

export function isAutomaticOcrBlur(
  config: Pick<AutoShortConfig, 'lamMo' | 'blurMode'>
): boolean {
  return config.lamMo === true && config.blurMode === 'ocr-auto'
}

export function autoShortNeedsOcr(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'lamMo' | 'blurMode'>
): boolean {
  return (isAutomaticOcrProcessing(config) && config.blurMode !== 'sttn-region' && config.blurMode !== 'gemini-alpha') ||
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
  return value === 'sttn' || value === 'sttn-region' || value === 'gemini-alpha' || value === 'ocr-auto' ? value : 'manual'
}

export function normalizeAutoShortOcrBlurProfile(value: unknown): AutoShortOcrBlurProfile {
  return value === 'fast' ? 'fast' : 'accurate'
}
