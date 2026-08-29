export interface AudioMixGains {
  original: number
  dub: number
}

export const AUDIO_MIX_DROPOUT_TRANSITION_SECONDS = 2

export function originalAudioGain(percent: number): number {
  const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 100
  return Math.pow(safePercent / 100, 2)
}

/**
 * Controlled audio mixer gains for preview & playback.
 * Dub narration maintains full clarity (gain 1.0), while background audio
 * is controlled directly by the calibrated source volume without uncontrolled halving.
 */
export function audioMixGains(options: {
  enabled: boolean
  sourceVolume: number
  hasOriginalAudio: boolean
  hasDubAudio: boolean
  dubIsActive: boolean
}): AudioMixGains {
  if (!options.enabled) return { original: options.hasOriginalAudio ? 1 : 0, dub: 0 }

  const original = options.hasOriginalAudio ? originalAudioGain(options.sourceVolume) : 0
  if (!options.hasDubAudio || !options.dubIsActive) return { original, dub: 0 }
  if (!options.hasOriginalAudio) return { original: 0, dub: 1 }
  return { original, dub: 1 }
}
