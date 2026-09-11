import type { SubtitleCue } from '../../shared/subtitles'
import { joinGroupText } from '../semanticGrouping'
import { groupSourceSpeechCues } from '../sourceSpeechGrouping'

export const DUBBING_PLAN_VERSION = 3 as const
/**
 * A rendered narration may begin this far into verified leading silence when
 * original dialogue is absent. The source identity/timing remains immutable.
 */
export const DUBBING_MAX_EARLY_START_SECONDS = 0.35

export type DubbingPaceMode = 'source-adaptive' | 'fixed'

export interface DubbingSourceCue {
  id: string
  sourceIndex?: number
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
  /** Immutable source ledger; speech units may cover several consecutive cues. */
  sourceCues?: DubbingSourceCue[]
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
  if (cue.sourceIndex != null && (!Number.isInteger(cue.sourceIndex) || cue.sourceIndex < 0)) {
    throw new Error(`Cue ${id} có sourceIndex không hợp lệ.`)
  }
  return { id, start, end, text, ...(cue.sourceIndex != null ? { sourceIndex: cue.sourceIndex } : {}) }
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
    sourceCues: cues.map((cue) => ({ ...cue })),
    createdAt: new Date().toISOString()
  }
}

/** Reuse source-only partitions established before translation, retaining every original anchor. */
export function groupDubbingPlanForSpeech(plan: DubbingPlan, locale: string): DubbingPlan {
  if (plan.cues.some((cue) => cue.sourceCueIds.length > 1)) return plan
  const groups = groupSourceSpeechCues(plan.cues.map(cue => ({
    id: cue.id, start: cue.sourceStart, end: cue.sourceEnd, text: cue.sourceText, cue
  }))).map(group => group.cues.map(entry => entry.cue))
  const sourceCues = (plan.sourceCues || plan.cues.map((cue) => ({
    id: cue.id, start: cue.sourceStart, end: cue.sourceEnd, text: cue.sourceText
  }))).map((cue) => ({ ...cue }))
  const groupedSources = groups.map((group) => ({
    id: group[0].id, start: group[0].sourceStart, end: group.at(-1)!.sourceEnd,
    text: joinGroupText(group.map((cue) => ({ text: cue.sourceText })))
  }))
  return {
    ...plan, sourceCues, globalTempo: null,
    cues: groups.map((group, index) => {
      const source = groupedSources[index]
      const window = deriveDubbingWindow(source, groupedSources[index + 1]?.start ?? null, plan.videoDuration)
      const text = joinGroupText(group.map((cue) => ({ text: cue.translatedText })), locale)
      return {
        ...group[0], ...window,
        sourceCueIds: group.flatMap((cue) => cue.sourceCueIds),
        sourceStart: source.start, sourceEnd: source.end, sourceText: source.text,
        translatedText: text, finalSpokenText: text, subtitles: [], rephrased: false,
        naturalDuration: null, actualDuration: null, predictedDuration: null, predictionUncertainty: null,
        tempo: 1, plannedDuration: null, voiceEnd: null, localTempoAdjustment: 0, audioPath: null
      }
    })
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
  const sources = plan.sourceCues || plan.cues.map((cue) => ({ id: cue.id, start: cue.sourceStart, end: cue.sourceEnd, text: cue.sourceText }))
  const sourceById = new Map(sources.map((cue) => [cue.id, cue]))
  const covered = plan.cues.flatMap((cue) => cue.sourceCueIds)
  if (sourceById.size !== sources.length || covered.length !== sources.length || covered.some((id, index) => id !== sources[index]?.id)) {
    violations.push('DubbingPlan làm mất, trùng hoặc đổi thứ tự source cue identity.')
  }
  let previousVoiceEnd = Number.NEGATIVE_INFINITY
  for (const cue of plan.cues) {
    if (seen.has(cue.id)) violations.push(`Cue ${cue.id} bị trùng id.`)
    seen.add(cue.id)
    const members = cue.sourceCueIds.map((id) => sourceById.get(id)).filter((item): item is DubbingSourceCue => Boolean(item))
    if (!cue.sourceCueIds.length || cue.sourceCueIds[0] !== cue.id || members.length !== cue.sourceCueIds.length) {
      violations.push(`Cue ${cue.id} làm mất hoặc đổi source cue identity.`)
    }
    if (members.length && (Math.abs(cue.sourceStart - members[0].start) > 0.005
      || Math.abs(cue.sourceEnd - members.at(-1)!.end) > 0.005
      || normalizedText(cue.sourceText) !== normalizedText(joinGroupText(members)))) {
      violations.push(`Cue ${cue.id} làm thay đổi nội dung hoặc mốc nguồn của nhóm.`)
    }
    const earlyStart = cue.sourceStart - cue.start
    if (cue.start > cue.sourceStart + 0.05 || earlyStart > DUBBING_MAX_EARLY_START_SECONDS + 0.005) {
      violations.push(`Cue ${cue.id} có start ngoài khe thoại cho phép.`)
    }
    if (Math.abs(cue.preferredEnd - cue.sourceEnd) > 0.05) {
      violations.push(`Cue ${cue.id} làm thay đổi preferredEnd nguồn.`)
    }
    if (!(cue.hardEnd > cue.start)) violations.push(`Cue ${cue.id} không có hardEnd khả dụng.`)
    if (cue.voiceEnd != null) {
      if (cue.voiceEnd < cue.start - 0.001) violations.push(`Cue ${cue.id} có voiceEnd trước start.`)
      if (cue.voiceEnd > cue.hardEnd + 0.05) violations.push(`Cue ${cue.id} vượt hardEnd.`)
      if (cue.start < previousVoiceEnd + 0.5 - 0.02) violations.push(`Cue ${cue.id} không giữ khoảng lặng bảo vệ với voice cue trước.`)
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
    }
    if (cue.subtitles.length && normalizedText(cue.subtitles.map((subtitle) => subtitle.text).join(' ')) !== finalText) {
      violations.push(`Subtitle của cue ${cue.id} không khớp finalSpokenText.`)
    }
    if (cue.actualDuration != null && cue.actualDuration > 0 && cue.subtitles.length === 0) {
      violations.push(`Cue ${cue.id} có audio nhưng thiếu subtitle.`)
    }
  }
  return { ok: violations.length === 0, violations }
}
