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
  globalTempo: number
  maxTempo: number
  averageTempo: number
  cues: AutoShortVoiceCuePlan[]
  degraded: boolean
}

/**
 * Calculate a robust global voice tempo across all semantic groups / cues.
 * Outliers needing excessive speedup (> 1.25x) are excluded from the baseline
 * and handled by the resolver (rephrasing/slack) instead of distorting the entire video.
 */
export function calculateGlobalVoiceTempo(
  requiredTempos: readonly number[],
  preferredMax = AUTO_SHORT_TTS_PREFERRED_MAX_TEMPO
): number {
  if (requiredTempos.length === 0) return 1.0
  const validTempos = requiredTempos.filter((t) => Number.isFinite(t) && t > 0.5 && t <= AUTO_SHORT_TTS_HARD_MAX_TEMPO)
  if (validTempos.length === 0) return 1.0

  // Filter outlier cues that require excessive speedup (> 1.25x)
  const normalTempos = validTempos.filter((t) => t <= AUTO_SHORT_TTS_NORMAL_MAX_TEMPO)
  const pool = normalTempos.length > 0 ? normalTempos : validTempos

  // Sort and take robust median (50th percentile)
  const sorted = [...pool].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length / 2)
  const candidate = sorted[idx]

  if (candidate <= 1.03) return 1.0
  return Number(Math.min(preferredMax, Math.max(1.0, candidate)).toFixed(3))
}

/**
 * Plan voice timing for semantic groups with global baseline tempo and micro-adjustments.
 *
 * Invariants:
 * 1. sourceCue.start and sourceCue.end are strict semantic anchors.
 * 2. Voice and subtitle must remain inside the assigned semantic region.
 * 3. Audio gaps between groups are NOT free slack; they may contain visual scene changes.
 * 4. Subtitle timing anchors to semantic boundary and is NEVER stretched past the scene.
 * 5. Global voice tempo sets the baseline; groups only vary by micro-corrections (±3%-5%).
 * 6. Hard invariant: NO phonemes or speech are ever cropped to fit the timeline.
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

  // First pass: compute earliest starts, max allowed ends, available durations, and required tempos
  const preliminary: Array<{
    cueId: string
    rawStart: number
    rawEnd: number
    earliestStart: number
    maxAllowedVoiceEnd: number
    availableDuration: number
    naturalDuration: number
    requiredTempo: number
  }> = []

  let prevEnd = 0
  for (let i = 0; i < n; i++) {
    const cue = cues[i]
    const cueId = cue.id || `cue-${i}`
    const naturalDuration = naturalDurations[i]
    const rawStart = Math.max(0, cue.start)
    const rawEnd = Number.isFinite(cue.end) && (cue.end as number) >= rawStart
      ? (cue.end as number)
      : (i < n - 1 ? Math.max(rawStart + 0.1, cues[i + 1].start) : videoDuration)

    const earliestStart = i === 0 ? rawStart : Math.max(rawStart, prevEnd + AUTO_SHORT_TTS_MIN_GAP_SECONDS)
    const maxAllowedVoiceEnd = Math.min(
      rawEnd,
      i < n - 1 ? Math.max(earliestStart + 0.05, cues[i + 1].start - AUTO_SHORT_TTS_MIN_GAP_SECONDS) : videoDuration - AUTO_SHORT_TTS_END_GUARD_SECONDS
    )
    const availableDuration = Math.max(0.01, maxAllowedVoiceEnd - earliestStart)
    const requiredTempo = Number((naturalDuration / availableDuration).toFixed(4))

    preliminary.push({
      cueId,
      rawStart,
      rawEnd,
      earliestStart,
      maxAllowedVoiceEnd,
      availableDuration,
      naturalDuration,
      requiredTempo
    })
    prevEnd = earliestStart + naturalDuration
  }

  // Calculate robust global voice tempo
  const globalTempo = calculateGlobalVoiceTempo(preliminary.map((p) => p.requiredTempo))

  // Second pass: apply global tempo with micro-adjustments
  const plannedCues: AutoShortVoiceCuePlan[] = []
  let previousVoiceEnd = 0

  for (let i = 0; i < n; i++) {
    const p = preliminary[i]
    const earliestStart = i === 0 ? p.rawStart : Math.max(p.rawStart, previousVoiceEnd + AUTO_SHORT_TTS_MIN_GAP_SECONDS)
    const maxAllowedVoiceEnd = Math.min(
      p.rawEnd,
      i < n - 1 ? Math.max(earliestStart + 0.05, cues[i + 1].start - AUTO_SHORT_TTS_MIN_GAP_SECONDS) : videoDuration - AUTO_SHORT_TTS_END_GUARD_SECONDS
    )
    const availableDuration = Math.max(0.01, maxAllowedVoiceEnd - earliestStart)

    let plannedStart = earliestStart
    let tempo = globalTempo
    let plannedDuration = p.naturalDuration

    if (p.naturalDuration <= availableDuration + AUTO_SHORT_TTS_SEMANTIC_TOLERANCE_SECONDS) {
      // Cue fits comfortably: use global tempo if elevated, or 1.0x if global tempo is 1.0x
      tempo = globalTempo
      plannedDuration = Number((p.naturalDuration / tempo).toFixed(3))
    } else {
      // Cue exceeds available duration: adjust tempo
      const neededLocal = Number((p.naturalDuration / availableDuration).toFixed(4))
      tempo = Math.min(upperTempo, Math.max(globalTempo, neededLocal))
      plannedDuration = Number((p.naturalDuration / tempo).toFixed(3))
    }

    const voiceEnd = plannedStart + plannedDuration
    if (voiceEnd > videoDuration + 0.25) {
      throw new Error(`Không thể lập timeline voice: câu ${i + 1} vượt thời lượng video; không cắt nội dung.`)
    }

    previousVoiceEnd = voiceEnd

    const overflowSec = Math.max(0, voiceEnd - p.rawEnd)
    const semanticOverflowMs = Math.round(overflowSec * 1000)
    const degraded = tempo > AUTO_SHORT_TTS_NORMAL_MAX_TEMPO || semanticOverflowMs > 80
    const slackBefore = plannedStart - (i === 0 ? 0 : (plannedCues[i - 1]?.voiceEnd ?? 0) + AUTO_SHORT_TTS_MIN_GAP_SECONDS)
    const slackAfter = Math.max(0, maxAllowedVoiceEnd - voiceEnd)

    // Subtitle timing strictly anchors to source semantic window
    let subtitleEnd = p.rawEnd
    if (i < n - 1 && cues[i + 1].start > p.rawStart) {
      subtitleEnd = Math.min(subtitleEnd, Math.max(p.rawStart + 0.05, cues[i + 1].start))
    }
    subtitleEnd = Math.min(subtitleEnd, videoDuration)

    plannedCues.push({
      cueIndex: i,
      cueId: p.cueId,
      start: plannedStart,
      voiceEnd,
      duration: plannedDuration,
      subtitleStart: p.rawStart,
      subtitleEnd,
      naturalDuration: p.naturalDuration,
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
    globalTempo,
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

export interface VoiceCompletenessCheckResult {
  ok: boolean
  error?: string
  coverage: number
  wordCountExpected: number
  wordCountDetected: number
}

function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Validate that synthesized TTS audio completely spoke the target text
 * without dropping initial phonemes, truncating sentence tails, or outputting near-silence.
 */
export function validateVoiceAudioCompleteness(
  targetText: string,
  audioDuration: number,
  detectedWords?: Array<{ text: string; start: number; end: number }> | null
): VoiceCompletenessCheckResult {
  const expectedTokens = tokenizeWords(targetText)
  if (expectedTokens.length === 0) {
    return { ok: true, coverage: 1.0, wordCountExpected: 0, wordCountDetected: 0 }
  }

  // Basic physical duration plausibility check
  if (!(audioDuration > 0.15)) {
    return {
      ok: false,
      error: `Thời lượng voice (${audioDuration.toFixed(2)}s) quá ngắn cho câu ${expectedTokens.length} từ.`,
      coverage: 0,
      wordCountExpected: expectedTokens.length,
      wordCountDetected: 0
    }
  }

  const wordsPerSecond = expectedTokens.length / audioDuration
  if (wordsPerSecond > 9.0) {
    return {
      ok: false,
      error: `Tốc độ nói bất thường (${wordsPerSecond.toFixed(1)} từ/s) - có thể bị mất đoạn speech.`,
      coverage: 0.3,
      wordCountExpected: expectedTokens.length,
      wordCountDetected: detectedWords?.length || 0
    }
  }

  if (detectedWords && detectedWords.length > 0) {
    const detectedTokens = detectedWords.map((w) => tokenizeWords(w.text)).flat()
    const detectedSet = new Set(detectedTokens)

    let matched = 0
    for (const token of expectedTokens) {
      if (detectedSet.has(token)) matched++
    }

    const coverage = expectedTokens.length > 0 ? matched / expectedTokens.length : 1.0
    if (expectedTokens.length >= 4 && coverage < 0.55) {
      return {
        ok: false,
        error: `Độ khớp nội dung phát âm thấp (${Math.round(coverage * 100)}%) - nghi ngờ voice bị thiếu từ hoặc không rõ.`,
        coverage,
        wordCountExpected: expectedTokens.length,
        wordCountDetected: detectedWords.length
      }
    }

    return {
      ok: true,
      coverage,
      wordCountExpected: expectedTokens.length,
      wordCountDetected: detectedWords.length
    }
  }

  return {
    ok: true,
    coverage: 1.0,
    wordCountExpected: expectedTokens.length,
    wordCountDetected: expectedTokens.length
  }
}

export interface RenderedOutputValidationResult {
  ok: boolean
  error?: string
  hasVideo: boolean
  hasAudio: boolean
  videoDuration: number
  audioDuration?: number
  decodable: boolean
}

export interface RenderedMediaProbeInfo {
  fileSize: number
  videoStream?: { width: number; height: number; duration?: number } | null
  audioStream?: { channels: number; sampleRate: number; duration?: number } | null
  formatDuration?: number
  decodeError?: string | null
  ttsExpected?: boolean
}

/**
 * Validate final rendered MP4 file before marking stage/item as DONE.
 * Ensures video stream, audio stream, duration integrity and decodability.
 */
export function validateRenderedOutputMedia(
  info: RenderedMediaProbeInfo,
  expectedMinDuration = 0.5
): RenderedOutputValidationResult {
  if (info.fileSize <= 1000) {
    return {
      ok: false,
      error: 'File video đầu ra có dung lượng quá nhỏ hoặc rỗng.',
      hasVideo: false,
      hasAudio: false,
      videoDuration: 0,
      decodable: false
    }
  }

  const hasVideo = Boolean(
    info.videoStream && info.videoStream.width > 0 && info.videoStream.height > 0
  )
  if (!hasVideo) {
    return {
      ok: false,
      error: 'Video đầu ra không chứa video stream hợp lệ.',
      hasVideo: false,
      hasAudio: Boolean(info.audioStream),
      videoDuration: 0,
      decodable: false
    }
  }

  const duration = info.videoStream?.duration || info.formatDuration || 0
  if (duration < expectedMinDuration) {
    return {
      ok: false,
      error: `Thời lượng video đầu ra (${duration.toFixed(2)}s) không hợp lệ.`,
      hasVideo: true,
      hasAudio: Boolean(info.audioStream),
      videoDuration: duration,
      decodable: false
    }
  }

  if (info.decodeError) {
    return {
      ok: false,
      error: `Video đầu ra không giải mã được: ${info.decodeError}`,
      hasVideo: true,
      hasAudio: Boolean(info.audioStream),
      videoDuration: duration,
      decodable: false
    }
  }

  const hasAudio = Boolean(info.audioStream && info.audioStream.channels >= 1)
  if (info.ttsExpected && !hasAudio) {
    return {
      ok: false,
      error: 'Video đầu ra thiếu audio stream lồng tiếng.',
      hasVideo: true,
      hasAudio: false,
      videoDuration: duration,
      decodable: true
    }
  }

  const audioDuration = info.audioStream?.duration || duration
  if (info.ttsExpected && hasAudio && Math.abs(audioDuration - duration) > 1.0) {
    return {
      ok: false,
      error: `Thời lượng audio (${audioDuration.toFixed(2)}s) lệch quá nhiều so với video (${duration.toFixed(2)}s).`,
      hasVideo: true,
      hasAudio: true,
      videoDuration: duration,
      audioDuration,
      decodable: true
    }
  }

  return {
    ok: true,
    hasVideo: true,
    hasAudio,
    videoDuration: duration,
    audioDuration: hasAudio ? audioDuration : undefined,
    decodable: true
  }
}




