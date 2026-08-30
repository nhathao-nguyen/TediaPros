import { WHISPER_PROTOCOL } from './engineProtocol'
import type { SubtitleCue, TtsModelInfo, WhisperEngineStatus } from '../shared/types'

export const AUTO_SHORT_TTS_MIN_GAP_SECONDS = 0.08
export const AUTO_SHORT_TTS_TAIL_SECONDS = 0.50
export const AUTO_SHORT_TTS_END_GUARD_SECONDS = 0.12
export const AUTO_SHORT_TTS_PREFERRED_MAX_TEMPO = 1.10
export const AUTO_SHORT_TTS_NORMAL_MAX_TEMPO = 1.25
export const AUTO_SHORT_TTS_HARD_MAX_TEMPO = 1.35
export const AUTO_SHORT_TTS_MAX_TEMPO = AUTO_SHORT_TTS_HARD_MAX_TEMPO
export const AUTO_SHORT_TTS_SEMANTIC_TOLERANCE_SECONDS = 0.06

/**
 * Decide whether a semantic group should be split before timeline planning.
 *
 * A multi-cue group can be safely split at a cue boundary when its complete
 * narration cannot fit at the hard tempo limit. A single cue must remain an
 * explicit failure so content is never silently discarded.
 */
export function shouldSplitAutoShortVoiceGroup(
  cueCount: number,
  naturalDuration: number,
  availableDuration: number,
  maxTempo = AUTO_SHORT_TTS_MAX_TEMPO
): boolean {
  if (cueCount < 2 || !(naturalDuration > 0) || !(availableDuration > 0)) return false
  const upperTempo = Math.min(Math.max(1, maxTempo), AUTO_SHORT_TTS_HARD_MAX_TEMPO)
  return naturalDuration > availableDuration * upperTempo + AUTO_SHORT_TTS_SEMANTIC_TOLERANCE_SECONDS
}

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
    status.healthy !== false &&
    status.protocol === WHISPER_PROTOCOL && status.engine === 'faster-whisper'
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

export interface AutoShortWordTiming {
  text: string
  start: number
  end: number
  probability?: number
}

export interface AutoShortDubbingUnit {
  id: string
  sourceCueIds: string[]
  sourceStart: number
  sourceEnd: number
  sourceText: string

  translatedText: string
  finalSpokenText: string
  rephrased: boolean

  rawAudioPath?: string
  rawDuration?: number
  trimmedAudioPath?: string
  naturalDuration: number

  finalAudioPath?: string
  finalDuration?: number

  plannedStart: number
  plannedEnd: number
  plannedDuration: number
  tempo: number

  words: AutoShortWordTiming[]
  alignmentConfidence: number
  alignmentQuality: 'word' | 'fallback'

  subtitles: SubtitleCue[]
}

/**
 * Calculate a robust global voice tempo across all semantic groups / cues.
 * Distributes tempo smoothly so trailing cues are not compressed into video overflow.
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
 * Plan voice timing for semantic groups with global baseline tempo and lookahead budgeting.
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

  // Global estimate of speech load vs video window
  const totalSpeechDuration = naturalDurations.reduce((sum, d) => sum + d, 0)
  const totalVideoSpan = Math.max(0.1, videoDuration - cues[0].start - AUTO_SHORT_TTS_END_GUARD_SECONDS)
  const roughGlobalRatio = Math.max(1.0, totalSpeechDuration / totalVideoSpan)

  let prevEnd = 0
  for (let i = 0; i < n; i++) {
    const cue = cues[i]
    const cueId = cue.id || `cue-${i}`
    const naturalDuration = naturalDurations[i]
    const rawStart = Math.max(0, cue.start)
    const rawEnd = Number.isFinite(cue.end) && (cue.end as number) >= rawStart
      ? (cue.end as number)
      : (i < n - 1 ? Math.max(rawStart + 0.1, cues[i + 1].start) : videoDuration)

    const estimatedStepDuration = naturalDuration / Math.min(upperTempo, Math.max(1.0, roughGlobalRatio))
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
    prevEnd = earliestStart + estimatedStepDuration
  }

  // Calculate robust global voice tempo
  const baselineCandidate = calculateGlobalVoiceTempo(preliminary.map((p) => p.requiredTempo))
  const globalTempo = Math.min(upperTempo, Math.max(baselineCandidate, roughGlobalRatio > 1.05 ? Math.min(AUTO_SHORT_TTS_NORMAL_MAX_TEMPO, Number(roughGlobalRatio.toFixed(3))) : 1.0))

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

    // Safety lookback adjustment if end of video is reached
    if (i === n - 1 && plannedStart + plannedDuration > videoDuration + 0.25) {
      const remainingTime = Math.max(0.1, videoDuration - AUTO_SHORT_TTS_END_GUARD_SECONDS - plannedStart)
      const finalNeededTempo = Number((p.naturalDuration / remainingTime).toFixed(4))
      if (finalNeededTempo <= upperTempo + 0.05) {
        tempo = Math.min(upperTempo, Math.max(globalTempo, finalNeededTempo))
        plannedDuration = Number((p.naturalDuration / tempo).toFixed(3))
      }
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

/**
 * Clean text for comparison and phonetic matching (removes punctuation, lowercases).
 */
export function normalizeSpokenWord(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

export interface KnownTextAlignmentResult {
  words: AutoShortWordTiming[]
  confidence: number
  coverage: number
  quality: 'word' | 'fallback'
  expectedCount: number
  matchedCount: number
}

/**
 * Align known final spoken text with ASR word timestamps from the final synthesized audio.
 * Uses monotonic known-text alignment with interpolation for unmatched intermediate tokens.
 */
export function alignKnownTextWithAsrWords(
  finalSpokenText: string,
  asrWords: readonly AutoShortWordTiming[],
  plannedStart: number,
  plannedDuration: number,
  isRelativeAudio = true
): KnownTextAlignmentResult {
  const rawTokens = finalSpokenText.trim().split(/\s+/).filter(Boolean)
  if (rawTokens.length === 0) {
    return {
      words: [],
      confidence: 1.0,
      coverage: 1.0,
      quality: 'word',
      expectedCount: 0,
      matchedCount: 0
    }
  }

  const expectedCount = rawTokens.length
  const offset = isRelativeAudio ? plannedStart : 0

  // Fallback helper to distribute duration across tokens
  const buildFallbackWords = (): AutoShortWordTiming[] => {
    const totalChars = rawTokens.reduce((sum, t) => sum + Math.max(1, t.length), 0)
    let currentOffset = plannedStart
    const stepDuration = plannedDuration / Math.max(1, expectedCount)

    return rawTokens.map((token, index) => {
      const charRatio = Math.max(1, token.length) / totalChars
      const dur = Math.max(0.08, plannedDuration * charRatio)
      const wStart = Number(currentOffset.toFixed(3))
      const wEnd = Number(Math.min(plannedStart + plannedDuration, wStart + dur).toFixed(3))
      currentOffset = wEnd
      return {
        text: token,
        start: wStart,
        end: index === expectedCount - 1 ? Number((plannedStart + plannedDuration).toFixed(3)) : wEnd,
        probability: 0.5
      }
    })
  }

  if (!asrWords || asrWords.length === 0) {
    return {
      words: buildFallbackWords(),
      confidence: 0,
      coverage: 0,
      quality: 'fallback',
      expectedCount,
      matchedCount: 0
    }
  }

  // Monotonic matching
  const normalizedTokens = rawTokens.map((t) => normalizeSpokenWord(t))
  const normalizedAsr = asrWords.map((w) => ({
    rawText: w.text,
    clean: normalizeSpokenWord(w.text),
    start: Number((w.start + offset).toFixed(3)),
    end: Number((w.end + offset).toFixed(3)),
    probability: w.probability ?? 1.0
  }))

  const matches: Array<{ tokenIndex: number; asrIndex: number; start: number; end: number; prob: number }> = []
  let asrCursor = 0

  for (let i = 0; i < expectedCount; i++) {
    const target = normalizedTokens[i]
    if (!target) continue

    let bestMatchIdx = -1
    for (let j = asrCursor; j < Math.min(normalizedAsr.length, asrCursor + 8); j++) {
      const candidate = normalizedAsr[j].clean
      if (candidate === target || candidate.startsWith(target) || target.startsWith(candidate)) {
        bestMatchIdx = j
        break
      }
    }

    if (bestMatchIdx !== -1) {
      matches.push({
        tokenIndex: i,
        asrIndex: bestMatchIdx,
        start: Math.max(plannedStart, normalizedAsr[bestMatchIdx].start),
        end: Math.min(plannedStart + plannedDuration + 0.15, normalizedAsr[bestMatchIdx].end),
        prob: normalizedAsr[bestMatchIdx].probability
      })
      asrCursor = bestMatchIdx + 1
    }
  }

  const matchedCount = matches.length
  const coverage = matchedCount / expectedCount

  if (coverage < 0.60 || matchedCount === 0) {
    return {
      words: buildFallbackWords(),
      confidence: Number(coverage.toFixed(3)),
      coverage: Number(coverage.toFixed(3)),
      quality: 'fallback',
      expectedCount,
      matchedCount
    }
  }

  // Construct aligned words with smooth interpolation for gaps
  const alignedWords: AutoShortWordTiming[] = new Array(expectedCount)
  const matchMap = new Map(matches.map((m) => [m.tokenIndex, m]))

  let lastKnownEnd = plannedStart
  let nextMatchIdx = 0

  for (let i = 0; i < expectedCount; i++) {
    const exact = matchMap.get(i)
    if (exact) {
      alignedWords[i] = {
        text: rawTokens[i],
        start: exact.start,
        end: exact.end,
        probability: exact.prob
      }
      lastKnownEnd = exact.end
      while (nextMatchIdx < matches.length && matches[nextMatchIdx].tokenIndex <= i) {
        nextMatchIdx++
      }
    } else {
      // Unmatched token: interpolate between lastKnownEnd and the next matched token's start
      const nextMatch = matches[nextMatchIdx]
      const targetEnd = nextMatch ? nextMatch.start : plannedStart + plannedDuration
      const gapTokens = nextMatch ? nextMatch.tokenIndex - i : expectedCount - i
      const gapDuration = Math.max(0.05, targetEnd - lastKnownEnd)
      const tokenDuration = gapDuration / Math.max(1, gapTokens)

      const wStart = Number(lastKnownEnd.toFixed(3))
      const wEnd = Number((lastKnownEnd + tokenDuration).toFixed(3))
      alignedWords[i] = {
        text: rawTokens[i],
        start: wStart,
        end: wEnd,
        probability: 0.7
      }
      lastKnownEnd = wEnd
    }
  }

  // Ensure strict monotonic timing
  for (let i = 0; i < expectedCount; i++) {
    if (i > 0 && alignedWords[i].start < alignedWords[i - 1].end) {
      alignedWords[i].start = alignedWords[i - 1].end
    }
    if (alignedWords[i].end <= alignedWords[i].start) {
      alignedWords[i].end = alignedWords[i].start + 0.05
    }
  }

  return {
    words: alignedWords,
    confidence: Number(coverage.toFixed(3)),
    coverage: Number(coverage.toFixed(3)),
    quality: 'word',
    expectedCount,
    matchedCount
  }
}

/**
 * Segment a dubbing unit's final spoken text into readable subtitle cues based on
 * actual spoken word timings, clause punctuation, and natural voice pauses.
 */
export function segmentDubbingSubtitles(
  unit: Pick<AutoShortDubbingUnit, 'id' | 'sourceCueIds' | 'finalSpokenText' | 'words' | 'plannedStart' | 'plannedEnd'>,
  maxCharsPerChunk = 42,
  minDurationSec = 0.5
): SubtitleCue[] {
  const words = unit.words
  if (!words || words.length === 0) {
    return [{
      id: `${unit.id}-sub-0`,
      sourceIndex: 1,
      start: unit.plannedStart,
      end: unit.plannedEnd,
      text: unit.finalSpokenText
    }]
  }

  const chunks: Array<{ words: AutoShortWordTiming[]; text: string }> = []
  let currentWords: AutoShortWordTiming[] = []
  let currentChars = 0

  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    currentWords.push(w)
    currentChars += w.text.length + 1

    const isLast = i === words.length - 1
    const endsWithTerminal = /[.!?。！？…]$/u.test(w.text)
    const endsWithClause = /[,;:\-—]$/u.test(w.text) && currentChars >= 20
    const hasVoicePause = !isLast && words[i + 1].start - w.end >= 0.35 && currentChars >= 15
    const isOverLength = currentChars >= maxCharsPerChunk

    if (isLast || endsWithTerminal || endsWithClause || hasVoicePause || isOverLength) {
      chunks.push({
        words: [...currentWords],
        text: currentWords.map((item) => item.text).join(' ')
      })
      currentWords = []
      currentChars = 0
    }
  }

  const subtitles: SubtitleCue[] = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const firstWord = chunk.words[0]
    const lastWord = chunk.words[chunk.words.length - 1]

    const subStart = Math.max(unit.plannedStart, Number((firstWord.start - 0.04).toFixed(3)))
    let subEnd = Math.min(unit.plannedEnd, Number((lastWord.end + 0.06).toFixed(3)))
    if (subEnd - subStart < minDurationSec) {
      subEnd = Math.min(unit.plannedEnd, Number((subStart + minDurationSec).toFixed(3)))
    }

    subtitles.push({
      id: `${unit.id}-sub-${i}`,
      sourceIndex: i + 1,
      start: subStart,
      end: subEnd,
      text: chunk.text
    })
  }

  // Adjust overlap between consecutive chunks
  for (let i = 0; i < subtitles.length - 1; i++) {
    if (subtitles[i].end > subtitles[i + 1].start) {
      subtitles[i].end = subtitles[i + 1].start
    }
  }

  return subtitles
}

export interface TimelineSyncValidationResult {
  ok: boolean
  error?: string
  violations: string[]
}

/**
 * Validate target dubbing timeline synchronization across all semantic units.
 * Checks semantic integrity, content integrity, timeline bounds, and voice/subtitle sync.
 * Also supports legacy signature for backward compatibility.
 */
export function validateAutoShortTimelineSync(
  dubbingUnitsOrSource: readonly any[],
  videoDurationOrTarget: any,
  diagnosticsOrTol?: any,
  legacyVideoDuration?: any,
  legacyTolerance = 0.25
): TimelineSyncValidationResult {
  const violations: string[] = []

  // Check if called with modern DubbingUnit array
  const isModern = Array.isArray(dubbingUnitsOrSource) &&
    dubbingUnitsOrSource.length > 0 &&
    typeof (dubbingUnitsOrSource[0] as AutoShortDubbingUnit).finalSpokenText === 'string'

  if (isModern) {
    const units = dubbingUnitsOrSource as readonly AutoShortDubbingUnit[]
    const videoDuration = typeof videoDurationOrTarget === 'number' ? videoDurationOrTarget : 0
    const tolerance = typeof diagnosticsOrTol === 'number' ? diagnosticsOrTol : 0.25

    if (units.length === 0) {
      return { ok: false, error: 'Danh sách dubbing unit rỗng.', violations: ['Danh sách dubbing unit rỗng.'] }
    }

    for (let i = 0; i < units.length; i++) {
      const u = units[i]
      const unitId = u.id || `unit-${i}`

      if (!u.finalSpokenText || !u.finalSpokenText.trim()) {
        violations.push(`Unit ${i + 1} (${unitId}): finalSpokenText bị rỗng.`)
      }

      // Content integrity: subtitle concatenation must equal finalSpokenText
      if (!u.subtitles || u.subtitles.length === 0) {
        violations.push(`Unit ${i + 1} (${unitId}): Không có subtitle cue nào được tạo.`)
      } else {
        const subConcat = u.subtitles.map((s) => s.text.trim()).join(' ')
        const normSub = normalizeSpokenWord(subConcat)
        const normSpoken = normalizeSpokenWord(u.finalSpokenText)
        if (normSub !== normSpoken && !normSub.includes(normSpoken) && !normSpoken.includes(normSub)) {
          violations.push(`Unit ${i + 1} (${unitId}): Subtitle text không khớp finalSpokenText (sub="${subConcat}", spoken="${u.finalSpokenText}").`)
        }
      }

      // Timeline integrity
      if (u.plannedStart < 0) {
        violations.push(`Unit ${i + 1} (${unitId}): plannedStart âm (${u.plannedStart.toFixed(3)}s).`)
      }
      if (u.plannedEnd <= u.plannedStart) {
        violations.push(`Unit ${i + 1} (${unitId}): plannedEnd (${u.plannedEnd.toFixed(3)}s) <= plannedStart (${u.plannedStart.toFixed(3)}s).`)
      }
      if (videoDuration > 0 && u.plannedEnd > videoDuration + tolerance) {
        violations.push(`Unit ${i + 1} (${unitId}): plannedEnd (${u.plannedEnd.toFixed(3)}s) vượt quá thời lượng video (${videoDuration.toFixed(3)}s).`)
      }

      // Monotonic sequence
      if (i > 0 && u.plannedStart < units[i - 1].plannedStart) {
        violations.push(`Unit ${i + 1} (${unitId}): plannedStart (${u.plannedStart.toFixed(3)}s) bắt đầu trước unit trước (${units[i - 1].plannedStart.toFixed(3)}s).`)
      }
    }
  } else {
    // Legacy compatibility path: (sourceCues, targetCues, diagnostics, videoDuration, tolerance)
    const sourceCues = (dubbingUnitsOrSource || []) as readonly AutoShortVoiceCueInput[]
    const targetCues = (videoDurationOrTarget || []) as readonly AutoShortVoiceCueInput[]
    const diagnostics = (diagnosticsOrTol || []) as readonly any[]
    const videoDuration = typeof legacyVideoDuration === 'number' ? legacyVideoDuration : 0
    const toleranceSec = legacyTolerance

    if (sourceCues.length !== targetCues.length) {
      violations.push(`Số lượng cue nguồn (${sourceCues.length}) và cue đích (${targetCues.length}) không khớp.`)
    }

    for (let i = 0; i < Math.min(sourceCues.length, targetCues.length); i++) {
      const src = sourceCues[i]
      const tgt = targetCues[i]
      if (src && tgt && (Math.abs((src.start ?? 0) - (tgt.start ?? 0)) > 0.05 || Math.abs((src.end ?? 0) - (tgt.end ?? 0)) > 0.05)) {
        violations.push(`Cue ${i + 1} (${tgt.id || src.id || i}): Lệch thời gian đích (target timing drift: src=${src.start}-${src.end}, tgt=${tgt.start}-${tgt.end}).`)
      }
    }

    for (let i = 0; i < Math.min(sourceCues.length, diagnostics.length); i++) {
      const src = sourceCues[i]
      const diag = diagnostics[i]
      const diagId = diag.cueId || `cue-${i}`
      const srcId = src.id || `cue-${i}`
      if (diag.cueId && src.id && diag.cueId !== src.id) {
        violations.push(`Cue ${i + 1}: Cue ID mismatch (${srcId} !== ${diagId}).`)
      }
      const vEnd = diag.voiceEnd ?? src.end ?? src.start
      const subEnd = diag.renderSubtitleEnd ?? src.end ?? vEnd

      if (diag.semanticOverflowMs && diag.semanticOverflowMs > toleranceSec * 1000) {
        violations.push(`Cue ${i + 1} (${diagId}): Voice tràn quá giới hạn (${diag.semanticOverflowMs}ms > ${(toleranceSec * 1000).toFixed(0)}ms).`)
      } else if (vEnd > subEnd + toleranceSec) {
        violations.push(`Cue ${i + 1} (${diagId}): Voice end (${vEnd.toFixed(3)}s) tràn quá subtitle end (${subEnd.toFixed(3)}s).`)
      }

      if (videoDuration > 0 && vEnd > videoDuration + toleranceSec) {
        violations.push(`Cue ${i + 1} (${diagId}): Voice end (${vEnd.toFixed(3)}s) vượt quá thời lượng video (${videoDuration.toFixed(3)}s).`)
      }
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
