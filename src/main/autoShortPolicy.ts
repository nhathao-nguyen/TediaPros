import { WHISPER_PROTOCOL } from './engineProtocol'
import type { TtsModelInfo, WhisperEngineStatus } from '../shared/types'

export const AUTO_SHORT_TTS_MIN_GAP_SECONDS = 0.08
export const AUTO_SHORT_TTS_TAIL_SECONDS = 0.50
export const AUTO_SHORT_TTS_END_GUARD_SECONDS = 0.12
export const AUTO_SHORT_TTS_PREFERRED_MAX_TEMPO = 1.10
export const AUTO_SHORT_TTS_NORMAL_MAX_TEMPO = 1.25
export const AUTO_SHORT_TTS_HARD_MAX_TEMPO = 1.35
export const AUTO_SHORT_TTS_MAX_TEMPO = AUTO_SHORT_TTS_HARD_MAX_TEMPO
export const AUTO_SHORT_TTS_SEMANTIC_TOLERANCE_SECONDS = 0.06

/**
 * Policy constants for TTS voice audio processing.
 * All thresholds and durations are language-independent and physically calibrated:
 *
 * - AUTO_SHORT_TTS_SILENCE_START_THRESHOLD_DB (-50 dB):
 *   Sensitivity threshold for detecting onset of speech. -50 dB ensures initial low-energy
 *   phonemes (e.g. unvoiced fricatives /s/, /f/, /h/, or soft nasals /m/, /n/) are not clipped.
 *
 * - AUTO_SHORT_TTS_SILENCE_START_DURATION_SECONDS (0.03s):
 *   Continuous non-silence duration (30ms) required to trigger speech onset, filtering out clicks
 *   while immediately capturing speech starts.
 *
 * - AUTO_SHORT_TTS_SILENCE_END_THRESHOLD_DB (-50 dB):
 *   Sensitivity threshold for detecting speech termination in reversed audio. -50 dB ensures
 *   vocal decay, sentence-final trailing vowels, unvoiced stop releases (/t/, /k/, /p/, /ch/),
 *   and natural breath are fully preserved rather than stripped as silence.
 *
 * - AUTO_SHORT_TTS_SILENCE_END_DURATION_SECONDS (0.02s):
 *   Detection window (20ms) in reversed audio to immediately capture short terminal consonant
 *   bursts and phoneme releases (20-50ms) without discarding them.
 *
 * - AUTO_SHORT_TTS_TAIL_MARGIN_SECONDS (0.12s):
 *   Safety tail margin appended via padding after speech finishes. Prevents abrupt waveform
 *   cuts, preserves natural acoustic resonance and room decay, and is measured into the
 *   natural duration so the timeline planner allocates proper space within cue boundaries.
 */
export const AUTO_SHORT_TTS_SILENCE_START_THRESHOLD_DB = -50
export const AUTO_SHORT_TTS_SILENCE_START_DURATION_SECONDS = 0.03
export const AUTO_SHORT_TTS_SILENCE_END_THRESHOLD_DB = -50
export const AUTO_SHORT_TTS_SILENCE_END_DURATION_SECONDS = 0.02
export const AUTO_SHORT_TTS_TAIL_MARGIN_SECONDS = 0.12

export function buildAutoShortTtsTrimFilter(
  startThresholdDb = AUTO_SHORT_TTS_SILENCE_START_THRESHOLD_DB,
  startDurationSec = AUTO_SHORT_TTS_SILENCE_START_DURATION_SECONDS,
  endThresholdDb = AUTO_SHORT_TTS_SILENCE_END_THRESHOLD_DB,
  endDurationSec = AUTO_SHORT_TTS_SILENCE_END_DURATION_SECONDS,
  tailMarginSec = AUTO_SHORT_TTS_TAIL_MARGIN_SECONDS
): string {
  const startFilter = `silenceremove=start_periods=1:start_duration=${startDurationSec}:start_threshold=${startThresholdDb}dB`
  const endFilter = `silenceremove=start_periods=1:start_duration=${endDurationSec}:start_threshold=${endThresholdDb}dB`
  const padFilter = `apad=pad_dur=${tailMarginSec}`
  const hpFilter = 'highpass=f=40'
  const fadeFilter = 'afade=t=in:ss=0:d=0.008'
  return `${hpFilter},${startFilter},areverse,${endFilter},areverse,${padFilter},${fadeFilter},asetpts=PTS-STARTPTS`
}

export function resolveAutoShortWhisperLanguage(language?: string): string {
  const normalized = language?.trim()
  return normalized || 'auto'
}

/** Readiness is based on the engine protocol, not an unrelated version scheme. */
export function isAutoShortWhisperEngineReady(
  status: Pick<WhisperEngineStatus, 'has' | 'healthy' | 'protocol' | 'engine'> | null | undefined
): boolean {
  return Boolean(
    status?.has &&
    status.healthy === true &&
    status.protocol === WHISPER_PROTOCOL &&
    status.engine === 'whisper.cpp'
  )
}

/**
 * Validate the selected TTS model against the capabilities returned by the
 * configured server. The client does not maintain a second language catalog.
 */
function normalizeTtsLang(code: string): string {
  const c = code.trim().toLowerCase().split(/[-_]/u)[0]
  if (c === 'vie' || c === 'vi') return 'vi'
  if (c === 'zho' || c === 'chi' || c === 'zh') return 'zh'
  if (c === 'eng' || c === 'en') return 'en'
  if (c === 'jpn' || c === 'ja') return 'ja'
  if (c === 'kor' || c === 'ko') return 'ko'
  if (c === 'fra' || c === 'fre' || c === 'fr') return 'fr'
  if (c === 'deu' || c === 'ger' || c === 'de') return 'de'
  if (c === 'spa' || c === 'es') return 'es'
  if (c === 'rus' || c === 'ru') return 'ru'
  return c
}

export function validateAutoShortTtsModel(
  model: Pick<TtsModelInfo, 'id' | 'available' | 'languages'> | undefined,
  language: string
): string | undefined {
  if (!model) return 'Model TTS đã chọn không có trong capability của server.'
  if (model.available === false) return `Model TTS ${model.id} hiện không khả dụng.`

  const normalizedLanguage = normalizeTtsLang(language)
  if (normalizedLanguage === 'auto' || !normalizedLanguage) {
    return undefined
  }
  const supportedLanguages = (model.languages || [])
    .map((item) => normalizeTtsLang(item))
    .filter(Boolean)
  if (supportedLanguages.length > 0 && !supportedLanguages.includes(normalizedLanguage)) {
    return `Model TTS ${model.id} không hỗ trợ ngôn ngữ ${language}.`
  }
  return undefined
}

export interface AutoShortVoiceCueInput {
  id?: string
  start: number
  end?: number
  text?: string
}

export interface AutoShortVoiceCuePlan {
  cueIndex: number
  cueId: string
  start: number
  voiceEnd: number
  duration: number
  subtitleStart: number
  subtitleEnd: number
  naturalDuration: number
  availableDuration: number
  plannedDuration: number
  tempo: number
  slackBefore: number
  slackAfter: number
  semanticOverflowMs: number
  degraded: boolean
}

export interface AutoShortVoiceTimelinePlan {
  tempo: number
  maxTempo: number
  averageTempo: number
  cues: AutoShortVoiceCuePlan[]
  degraded: boolean
}

/**
 * Plan voice timing on a per-cue basis.
 *
 * Invariants:
 * 1. sourceCue.start and sourceCue.end are strict semantic anchors.
 * 2. Voice and subtitle for cue A must remain inside region A of the video.
 * 3. Audio gaps between cues are NOT free slack; they may contain visual scene changes.
 * 4. Subtitle timing strictly matches source semantic cues and is NEVER stretched by voiceEnd.
 * 5. Tempo is adjusted per cue up to maxTempo without global tempo acceleration.
 */
export function planAutoShortVoiceTimeline(
  cues: readonly AutoShortVoiceCueInput[],
  naturalDurations: readonly number[],
  videoDuration: number,
  maxTempo = AUTO_SHORT_TTS_MAX_TEMPO
): AutoShortVoiceTimelinePlan {
  if (cues.length === 0 || cues.length !== naturalDurations.length) {
    throw new Error('Không thể lập timeline voice: số cue và số audio không khớp.')
  }
  if (!(videoDuration > 0) || naturalDurations.some((duration) => !(duration > 0))) {
    throw new Error('Không thể lập timeline voice: thời lượng audio không hợp lệ.')
  }

  const upperTempo = Math.min(Math.max(1, maxTempo), AUTO_SHORT_TTS_HARD_MAX_TEMPO)
  const n = cues.length
  const plannedCues: AutoShortVoiceCuePlan[] = []
  let previousVoiceEnd = 0

  for (let i = 0; i < n; i++) {
    const cue = cues[i]
    const cueId = cue.id || `cue-${i}`
    const naturalDuration = naturalDurations[i]
    const rawStart = Math.max(0, cue.start)
    const rawEnd = Number.isFinite(cue.end) && (cue.end as number) >= rawStart
      ? (cue.end as number)
      : (i < n - 1 ? Math.max(rawStart + 0.1, cues[i + 1].start) : videoDuration)

    // Subtitle timeline strictly anchors to source semantic window
    const subtitleStart = rawStart
    let subtitleEnd = rawEnd
    if (i < n - 1 && cues[i + 1].start > rawStart) {
      subtitleEnd = Math.min(subtitleEnd, Math.max(rawStart + 0.05, cues[i + 1].start))
    }
    subtitleEnd = Math.min(subtitleEnd, videoDuration)

    // Voice timeline must remain within the semantic cue boundary [rawStart, rawEnd]
    const earliestStart = i === 0 ? rawStart : Math.max(rawStart, previousVoiceEnd + AUTO_SHORT_TTS_MIN_GAP_SECONDS)
    const maxAllowedVoiceEnd = Math.min(
      rawEnd,
      i < n - 1 ? Math.max(earliestStart + 0.05, cues[i + 1].start - AUTO_SHORT_TTS_MIN_GAP_SECONDS) : videoDuration - AUTO_SHORT_TTS_END_GUARD_SECONDS
    )

    const availableDuration = Math.max(0.01, maxAllowedVoiceEnd - earliestStart)

    let plannedStart = earliestStart
    let tempo = 1.0
    let plannedDuration = naturalDuration

    if (naturalDuration <= availableDuration + AUTO_SHORT_TTS_SEMANTIC_TOLERANCE_SECONDS) {
      tempo = 1.0
      plannedDuration = naturalDuration
      plannedStart = earliestStart
    } else {
      const neededTempo = Number((naturalDuration / availableDuration).toFixed(4))
      tempo = Math.min(upperTempo, Math.max(1.0, neededTempo))
      plannedDuration = Number((naturalDuration / tempo).toFixed(3))
      plannedStart = earliestStart
    }

    const voiceEnd = plannedStart + plannedDuration
    if (voiceEnd > videoDuration + 0.25) {
      throw new Error(`Không thể lập timeline voice: câu ${i + 1} vượt thời lượng video; không cắt nội dung.`)
    }

    previousVoiceEnd = voiceEnd

    const overflowSec = Math.max(0, voiceEnd - rawEnd)
    const semanticOverflowMs = Math.round(overflowSec * 1000)
    const degraded = tempo > AUTO_SHORT_TTS_NORMAL_MAX_TEMPO || semanticOverflowMs > 80
    const slackBefore = plannedStart - (i === 0 ? 0 : (plannedCues[i - 1]?.voiceEnd ?? 0) + AUTO_SHORT_TTS_MIN_GAP_SECONDS)
    const slackAfter = Math.max(0, maxAllowedVoiceEnd - voiceEnd)

    plannedCues.push({
      cueIndex: i,
      cueId,
      start: plannedStart,
      voiceEnd,
      duration: plannedDuration,
      subtitleStart,
      subtitleEnd,
      naturalDuration,
      availableDuration,
      plannedDuration,
      tempo,
      slackBefore: Math.max(0, slackBefore),
      slackAfter,
      semanticOverflowMs,
      degraded
    })
  }

  const tempos = plannedCues.map((c) => c.tempo)
  const maxPlannedTempo = Math.max(...tempos, 1.0)
  const averageTempo = Number((tempos.reduce((sum, t) => sum + t, 0) / n).toFixed(4))
  const degraded = plannedCues.some((c) => c.degraded)

  return {
    tempo: maxPlannedTempo,
    maxTempo: maxPlannedTempo,
    averageTempo,
    cues: plannedCues,
    degraded
  }
}

export interface TimelineSyncValidationResult {
  ok: boolean
  error?: string
  violations: string[]
}

export function validateAutoShortTimelineSync(
  sourceCues: readonly AutoShortVoiceCueInput[],
  targetCues: readonly AutoShortVoiceCueInput[],
  diagnostics: readonly {
    cueId?: string
    sourceStart?: number
    sourceEnd?: number
    renderSubtitleStart?: number
    renderSubtitleEnd?: number
    voiceStart?: number
    voiceEnd?: number
    semanticOverflowMs?: number
  }[],
  videoDuration: number,
  toleranceSec = 0.08
): TimelineSyncValidationResult {
  const violations: string[] = []

  if (sourceCues.length !== targetCues.length) {
    violations.push(`Số lượng cue nguồn (${sourceCues.length}) và cue đích (${targetCues.length}) không khớp.`)
  }
  if (diagnostics.length !== targetCues.length) {
    violations.push(`Số lượng chẩn đoán (${diagnostics.length}) và cue đích (${targetCues.length}) không khớp.`)
  }

  for (let i = 0; i < Math.min(sourceCues.length, diagnostics.length); i++) {
    const src = sourceCues[i]
    const tgt = targetCues[i]
    const diag = diagnostics[i]

    const srcId = src.id || `cue-${i}`
    const tgtId = tgt.id || `cue-${i}`
    const diagId = diag.cueId || `cue-${i}`

    if (srcId !== diagId || tgtId !== diagId) {
      violations.push(`Cue ${i + 1}: Cue ID không đồng bộ (src=${srcId}, tgt=${tgtId}, diag=${diagId}).`)
    }

    const subStart = diag.renderSubtitleStart ?? src.start
    const subEnd = diag.renderSubtitleEnd ?? src.end ?? src.start
    const srcStart = src.start
    const srcEnd = src.end ?? src.start

    if (Math.abs(subStart - srcStart) > 0.05) {
      violations.push(`Cue ${i + 1} (${diagId}): Subtitle start (${subStart.toFixed(3)}s) lệch khỏi source start (${srcStart.toFixed(3)}s).`)
    }
    if (src.end != null && Math.abs(subEnd - srcEnd) > 0.05) {
      violations.push(`Cue ${i + 1} (${diagId}): Subtitle end (${subEnd.toFixed(3)}s) lệch khỏi source end (${srcEnd.toFixed(3)}s).`)
    }

    const vStart = diag.voiceStart ?? srcStart
    const vEnd = diag.voiceEnd ?? srcEnd

    if (vStart < srcStart - toleranceSec) {
      violations.push(`Cue ${i + 1} (${diagId}): Voice start (${vStart.toFixed(3)}s) bắt đầu trước source cue (${srcStart.toFixed(3)}s).`)
    }
    if (src.end != null && vEnd > srcEnd + toleranceSec) {
      const overflowMs = diag.semanticOverflowMs ?? Math.round((vEnd - srcEnd) * 1000)
      violations.push(`Cue ${i + 1} (${diagId}): Voice end (${vEnd.toFixed(3)}s) tràn quá source cue end (${srcEnd.toFixed(3)}s) (overflow: ${overflowMs}ms).`)
    }
    if (vEnd > videoDuration + 0.1) {
      violations.push(`Cue ${i + 1} (${diagId}): Voice end (${vEnd.toFixed(3)}s) vượt quá thời lượng video (${videoDuration.toFixed(3)}s).`)
    }
  }

  if (violations.length > 0) {
    return { ok: false, error: violations.join(' | '), violations }
  }
  return { ok: true, violations: [] }
}


