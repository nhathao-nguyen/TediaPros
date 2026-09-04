import type { SubtitleCue } from '../../shared/subtitles'

export const DUBBING_PLAN_VERSION = 2 as const

export type DubbingPaceMode = 'source-adaptive' | 'fixed'

export interface DubbingSourceCue {
  id: string
  start: number
  end: number
  text: string
}

export interface DubbingWindow {
  cueId: string
  start: number
  preferredEnd: number
  hardEnd: number
  availableDuration: number
}

export interface DubbingTimingCue extends DubbingWindow {
  predictedDuration: number | null
  naturalDuration: number | null
  actualDuration: number | null
  tempo: number
  plannedDuration: number | null
  voiceEnd: number | null
  localTempoAdjustment: number
}

export interface DubbingPlanCue extends DubbingTimingCue {
  id: string
  sourceCueIds: string[]
  sourceText: string
  sourceStart: number
  sourceEnd: number
  translatedText: string
  finalSpokenText: string
  predictionUncertainty: number | null
  audioPath: string | null
  subtitles: SubtitleCue[]
  rephrased: boolean
}

export interface DubbingPlan {
  version: typeof DUBBING_PLAN_VERSION
  paceMode: DubbingPaceMode
  videoDuration: number
  globalTempo: number | null
  cues: DubbingPlanCue[]
  createdAt: string
}

export interface DubbingPlanInput {
  videoDuration: number
  paceMode?: DubbingPaceMode
  cues: readonly DubbingSourceCue[]
}

export interface DubbingPlanValidation {
  ok: boolean
  violations: string[]
}

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} không hợp lệ.`)
  return value
}

function normalizedSourceCue(cue: DubbingSourceCue, index: number): DubbingSourceCue {
  const id = typeof cue.id === 'string' && cue.id.trim() ? cue.id.trim() : `cue-${index}`
  const start = finiteNumber(cue.start, `Cue ${id} start`)
  const end = finiteNumber(cue.end, `Cue ${id} end`)
  if (start < 0 || end < start) throw new Error(`Cue ${id} có mốc nguồn không hợp lệ.`)
  const text = typeof cue.text === 'string' ? cue.text.trim() : ''
  if (!text) throw new Error(`Cue ${id} không có text nguồn.`)
  return { id, start, end, text }
}

export function deriveDubbingWindow(
  cue: DubbingSourceCue,
  nextSourceStart: number | null,
  videoDuration: number,
  protectedGapSeconds = 0.5,
  finalGuardSeconds = 0.12
): DubbingWindow {
  const source = normalizedSourceCue(cue, 0)
  finiteNumber(videoDuration, 'Thời lượng video')
  if (!(videoDuration > 0)) throw new Error('Thời lượng video không hợp lệ.')
  if (source.end > videoDuration + 0.001) throw new Error(`Cue ${source.id} vượt thời lượng video.`)

  const preferredEnd = source.end
  let hardEnd: number
  if (nextSourceStart == null) {
    hardEnd = Math.max(source.start + 0.05, videoDuration - finalGuardSeconds)
  } else {
    const rawGap = Math.max(0, nextSourceStart - source.start)
    const effectiveGap = rawGap >= protectedGapSeconds + 0.05
      ? protectedGapSeconds
      : Math.min(protectedGapSeconds, Math.max(0.02, rawGap * 0.15))
    hardEnd = Math.min(
      videoDuration - finalGuardSeconds,
      Math.max(source.start + Math.min(0.1, rawGap * 0.5), nextSourceStart - effectiveGap)
    )
  }
  if (!(hardEnd > source.start)) {
    hardEnd = Math.max(source.start + 0.05, Math.min(videoDuration - finalGuardSeconds, source.end))
  }
  return {
    cueId: source.id,
    start: source.start,
    preferredEnd,
    hardEnd,
    availableDuration: Math.max(0.05, hardEnd - source.start)
  }
}

export function buildDubbingPlan(input: DubbingPlanInput): DubbingPlan {
  const videoDuration = finiteNumber(input.videoDuration, 'Thời lượng video')
  if (!(videoDuration > 0)) throw new Error('Thời lượng video không hợp lệ.')
  const cues = input.cues.map(normalizedSourceCue)
  const seen = new Set<string>()
  for (const cue of cues) {
    if (seen.has(cue.id)) throw new Error(`Cue nguồn bị trùng id: ${cue.id}.`)
    seen.add(cue.id)
  }

  const planCues = cues.map((cue, index) => {
    const next = index < cues.length - 1 ? cues[index + 1].start : null
    const window = deriveDubbingWindow(cue, next, videoDuration)
    return {
      ...window,
      id: cue.id,
      sourceCueIds: [cue.id],
      sourceText: cue.text,
      sourceStart: cue.start,
      sourceEnd: cue.end,
      translatedText: cue.text,
      finalSpokenText: cue.text,
      predictedDuration: null,
      naturalDuration: null,
      actualDuration: null,
      predictionUncertainty: null,
      tempo: 1,
      plannedDuration: null,
      voiceEnd: null,
      localTempoAdjustment: 0,
      audioPath: null,
      subtitles: [],
      rephrased: false
    } satisfies DubbingPlanCue
  })

  return {
    version: DUBBING_PLAN_VERSION,
    paceMode: input.paceMode || 'source-adaptive',
    videoDuration,
    globalTempo: null,
    cues: planCues,
    createdAt: new Date().toISOString()
  }
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').normalize('NFC')
}

export function validateDubbingPlan(plan: DubbingPlan): DubbingPlanValidation {
  const violations: string[] = []
  if (plan.version !== DUBBING_PLAN_VERSION) violations.push(`Plan version ${String(plan.version)} không được hỗ trợ.`)
  if (!Number.isFinite(plan.videoDuration) || plan.videoDuration <= 0) violations.push('Thời lượng video trong plan không hợp lệ.')

  const seen = new Set<string>()
  let previousVoiceEnd = Number.NEGATIVE_INFINITY
  for (const cue of plan.cues) {
    if (seen.has(cue.id)) violations.push(`Cue ${cue.id} bị trùng id.`)
    seen.add(cue.id)
    if (cue.sourceCueIds.length !== 1 || cue.sourceCueIds[0] !== cue.id) {
      violations.push(`Cue ${cue.id} làm mất hoặc đổi source cue identity.`)
    }
    if (Math.abs(cue.start - cue.sourceStart) > 0.05) {
      violations.push(`Cue ${cue.id} bị dời start khỏi mốc nguồn.`)
    }
    if (Math.abs(cue.preferredEnd - cue.sourceEnd) > 0.05) {
      violations.push(`Cue ${cue.id} làm thay đổi preferredEnd nguồn.`)
    }
    if (!(cue.hardEnd > cue.start)) violations.push(`Cue ${cue.id} không có hardEnd khả dụng.`)
    if (cue.voiceEnd != null) {
      if (cue.voiceEnd < cue.start - 0.001) violations.push(`Cue ${cue.id} có voiceEnd trước start.`)
      if (cue.voiceEnd > cue.hardEnd + 0.05) violations.push(`Cue ${cue.id} vượt hardEnd.`)
      if (cue.start < previousVoiceEnd - 0.02) violations.push(`Cue ${cue.id} bị overlap với voice cue trước.`)
      previousVoiceEnd = cue.voiceEnd
    }
    if (cue.actualDuration != null && cue.voiceEnd != null && Math.abs(cue.actualDuration - (cue.voiceEnd - cue.start)) > 0.02) {
      violations.push(`Cue ${cue.id} có actualDuration không khớp cửa sổ voice.`)
    }
    const finalText = normalizedText(cue.finalSpokenText)
    for (const subtitle of cue.subtitles) {
      if (subtitle.start < cue.start - 0.005 || subtitle.end > cue.hardEnd + 0.05) {
        violations.push(`Subtitle của cue ${cue.id} vượt cửa sổ voice.`)
      }
      if (normalizedText(subtitle.text) !== finalText) {
        violations.push(`Subtitle của cue ${cue.id} không khớp finalSpokenText.`)
      }
    }
    if (cue.actualDuration != null && cue.actualDuration > 0 && cue.subtitles.length === 0) {
      violations.push(`Cue ${cue.id} có audio nhưng thiếu subtitle.`)
    }
  }
  return { ok: violations.length === 0, violations }
}
