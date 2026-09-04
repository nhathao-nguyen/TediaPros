import {
  deriveDubbingWindow,
  type DubbingPaceMode,
  type DubbingSourceCue,
  type DubbingTimingCue,
  type DubbingWindow
} from './plan'

export const DUBBING_PROTECTED_GAP_SECONDS = 0.5
export const DUBBING_FINAL_GUARD_SECONDS = 0.12
export const DUBBING_ADAPTIVE_MIN_TEMPO = 0.9
export const DUBBING_ADAPTIVE_MAX_TEMPO = 1.25
export const DUBBING_FIXED_MIN_TEMPO = 0.5
export const DUBBING_FIXED_MAX_TEMPO = 2
export const DUBBING_LOCAL_TEMPO_DELTA = 0.03
export const DUBBING_TIMING_TOLERANCE_SECONDS = 0.005

export interface DubbingTimingPlan {
  paceMode: DubbingPaceMode
  globalTempo: number
  averageTempo: number
  maxTempo: number
  degraded: boolean
  cues: DubbingTimingCue[]
}

export interface DubbingTimingInput {
  cues: readonly DubbingSourceCue[]
  naturalDurations: readonly number[]
  videoDuration: number
  paceMode: DubbingPaceMode
  globalTempo: number
  localTempoDelta?: number
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} không hợp lệ.`)
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function selectSourceAdaptivePace(
  predictedDurations: readonly number[],
  windows: readonly Pick<DubbingWindow, 'availableDuration'>[]
): number {
  const ratios: Array<{ ratio: number; weight: number }> = []
  const count = Math.min(predictedDurations.length, windows.length)
  for (let index = 0; index < count; index++) {
    const predicted = predictedDurations[index]
    const available = windows[index].availableDuration
    if (Number.isFinite(predicted) && predicted > 0 && Number.isFinite(available) && available > 0) {
      ratios.push({ ratio: predicted / available, weight: available })
    }
  }
  if (ratios.length === 0) return 1
  ratios.sort((left, right) => left.ratio - right.ratio)
  const totalWeight = ratios.reduce((sum, item) => sum + item.weight, 0)
  let accumulated = 0
  for (const item of ratios) {
    accumulated += item.weight
    if (accumulated >= totalWeight / 2) {
      return Number(clamp(item.ratio, DUBBING_ADAPTIVE_MIN_TEMPO, DUBBING_ADAPTIVE_MAX_TEMPO).toFixed(4))
    }
  }
  return Number(clamp(ratios[ratios.length - 1].ratio, DUBBING_ADAPTIVE_MIN_TEMPO, DUBBING_ADAPTIVE_MAX_TEMPO).toFixed(4))
}

export function selectFixedPace(ttsSpeed: number): number {
  finitePositive(ttsSpeed, 'Tốc độ TTS cố định')
  return Number(clamp(ttsSpeed, DUBBING_FIXED_MIN_TEMPO, DUBBING_FIXED_MAX_TEMPO).toFixed(4))
}

export function deriveDubbingWindows(
  cues: readonly DubbingSourceCue[],
  videoDuration: number
): DubbingWindow[] {
  return cues.map((cue, index) => deriveDubbingWindow(
    cue,
    index < cues.length - 1 ? cues[index + 1].start : null,
    videoDuration,
    DUBBING_PROTECTED_GAP_SECONDS,
    DUBBING_FINAL_GUARD_SECONDS
  ))
}

export function planDubbingAudioWindows(input: DubbingTimingInput): DubbingTimingPlan {
  if (input.cues.length === 0 || input.cues.length !== input.naturalDurations.length) {
    throw new Error('Không thể lập timeline dubbing: số cue và audio không khớp.')
  }
  const windows = deriveDubbingWindows(input.cues, input.videoDuration)
  const localDelta = Math.max(0, input.localTempoDelta ?? DUBBING_LOCAL_TEMPO_DELTA)
  const globalTempo = input.paceMode === 'fixed'
    ? selectFixedPace(input.globalTempo)
    : Number(clamp(input.globalTempo, DUBBING_ADAPTIVE_MIN_TEMPO, DUBBING_ADAPTIVE_MAX_TEMPO).toFixed(4))
  const maxAllowedTempo = input.paceMode === 'fixed'
    ? Math.min(DUBBING_FIXED_MAX_TEMPO, globalTempo + localDelta)
    : Math.min(DUBBING_ADAPTIVE_MAX_TEMPO + localDelta, globalTempo + localDelta)

  const cues = input.cues.map((sourceCue, index) => {
    const naturalDuration = finitePositive(input.naturalDurations[index], `Thời lượng audio cue ${sourceCue.id}`)
    const window = windows[index]
    const requiredTempo = naturalDuration / window.availableDuration
    if (requiredTempo > maxAllowedTempo + DUBBING_TIMING_TOLERANCE_SECONDS) {
      throw new Error(`Cue ${sourceCue.id} cần nhịp ${requiredTempo.toFixed(3)}x, vượt giới hạn cục bộ ${maxAllowedTempo.toFixed(3)}x; cần sửa text, không cắt lời.`)
    }
    const tempo = Number(Math.min(maxAllowedTempo, Math.max(globalTempo, requiredTempo)).toFixed(4))
    const plannedDuration = naturalDuration / tempo
    const voiceEnd = window.start + plannedDuration
    if (voiceEnd > window.hardEnd + DUBBING_TIMING_TOLERANCE_SECONDS) {
      throw new Error(`Cue ${sourceCue.id} vượt hardEnd ${window.hardEnd.toFixed(3)}s; không cắt lời.`)
    }
    return {
      ...window,
      predictedDuration: null,
      naturalDuration,
      actualDuration: null,
      tempo,
      plannedDuration: Number(plannedDuration.toFixed(4)),
      voiceEnd: Number(voiceEnd.toFixed(4)),
      localTempoAdjustment: Number((tempo - globalTempo).toFixed(4))
    }
  })
  const averageTempo = cues.length > 0
    ? cues.reduce((sum, cue) => sum + cue.tempo, 0) / cues.length
    : globalTempo
  return {
    paceMode: input.paceMode,
    globalTempo,
    averageTempo: Number(averageTempo.toFixed(4)),
    maxTempo: Math.max(globalTempo, ...cues.map((cue) => cue.tempo)),
    degraded: cues.some((cue) => Math.abs(cue.localTempoAdjustment) > 0.0001),
    cues
  }
}

export function validateDubbingPlanTiming(plan: DubbingTimingPlan): string[] {
  const violations: string[] = []
  let previousEnd = Number.NEGATIVE_INFINITY
  for (const cue of plan.cues) {
    if (cue.start < previousEnd - DUBBING_TIMING_TOLERANCE_SECONDS) {
      violations.push(`Cue ${cue.cueId} bị overlap với cue trước.`)
    }
    if (cue.voiceEnd == null || cue.voiceEnd > cue.hardEnd + DUBBING_TIMING_TOLERANCE_SECONDS) {
      violations.push(`Cue ${cue.cueId} vượt hardEnd.`)
    }
    if (cue.tempo < DUBBING_FIXED_MIN_TEMPO || cue.tempo > DUBBING_FIXED_MAX_TEMPO + DUBBING_TIMING_TOLERANCE_SECONDS) {
      violations.push(`Cue ${cue.cueId} có tempo ngoài phạm vi.`)
    }
    previousEnd = cue.voiceEnd ?? previousEnd
  }
  return violations
}
