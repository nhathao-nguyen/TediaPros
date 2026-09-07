export interface BurnInputPlan {
  inputArgs: string[]
  sourceVideoIndex: 0
  narrationAudioIndex: 1 | null
  maskVideoIndex: 1 | 2 | null
}

/**
 * Deterministically plan FFmpeg input arguments and track 0-based stream indexes.
 * Inputs order:
 * 0: source video (always present)
 * 1: narration audio (if present)
 * 1 or 2: timed blur mask video (if present)
 */
export function planBurnInputs(input: {
  sourceVideo: string
  narrationAudio?: string | null
  timedMask?: string | null
}): BurnInputPlan {
  const inputArgs: string[] = ['-i', input.sourceVideo]
  let narrationAudioIndex: 1 | null = null
  let maskVideoIndex: 1 | 2 | null = null

  if (input.narrationAudio) {
    narrationAudioIndex = 1
    inputArgs.push('-i', input.narrationAudio)
  }

  if (input.timedMask) {
    maskVideoIndex = narrationAudioIndex === 1 ? 2 : 1
    inputArgs.push('-i', input.timedMask)
  }

  return {
    inputArgs,
    sourceVideoIndex: 0,
    narrationAudioIndex,
    maskVideoIndex
  }
}

/**
 * Calculate Gaussian blur sigma for a given display height.
 *
 * This is the existing manual blur profile. Automatic OCR blur uses the
 * bounded profile below because it applies one full-frame blur before the
 * timed mask selects individual OCR regions.
 */
export function blurSigmaForDisplayHeight(displayHeight: number): number {
  const height = Number.isFinite(displayHeight) && displayHeight > 0 ? displayHeight : 720
  return Math.max(24, Math.round(height * 0.12))
}

/**
 * Calculate the bounded sigma used by the automatic OCR privacy blur.
 *
 * A full-frame Gaussian blur at very large sigma values averages bright
 * backgrounds into visible flat rectangles inside the mask. The cap keeps
 * OCR glyphs unreadable while preserving the underlying scene texture.
 */
export function ocrBlurSigmaForDisplayHeight(displayHeight: number): number {
  const height = Number.isFinite(displayHeight) && displayHeight > 0 ? displayHeight : 720
  return Math.min(64, Math.max(16, Math.round(height * 0.04)))
}
