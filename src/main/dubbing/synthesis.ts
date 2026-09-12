import { createDurationPredictor, type DurationPredictor } from './durationPredictor'
import { compactEnglishDubbingQuestion, dubbingSpeakingDurations } from './translation'
import { buildDubbingSubtitle, buildDubbingSubtitleSegments, type DubbingSubtitleCue } from './subtitles'
import {
  DUBBING_LOCAL_TEMPO_DELTA,
  DUBBING_PROTECTED_GAP_SECONDS,
  DUBBING_TIMING_TOLERANCE_SECONDS,
  deriveDubbingWindows,
  selectFixedPace,
  selectSourceAdaptivePace
} from './policy'
import { AUTO_SHORT_TTS_HARD_MAX_TEMPO, validateVoiceAudioCompleteness } from '../autoShortPolicy'
import { containsRephraseLabel } from '../translation/response'
import { DUBBING_MAX_EARLY_START_SECONDS, deriveDubbingWindow, type DubbingPlan, type DubbingPlanCue } from './plan'
import { selectBootstrapCues } from './durationPredictor'
import { createAutoShortItemScope, type BranchOutcome } from '../autoShortItemScope'
import { planDubbingTimeMap, mapDubbingTime, DubbingVideoExtensionLimitError, type DubbingTimeMap } from './timeMap'
import { validateRephraseSemanticPreservation } from '../autoShortContentQuality'

export interface DubbingTtsRequest {
  cueId: string
  text: string
  language: string
  model: string
  voice?: string | null
  options?: Record<string, unknown>
  /** The server is always called at standard speed; pacing is applied once locally. */
  speed: 1
  cacheMode?: 'prefer' | 'bypass'
}

export interface DubbingTtsAdapter {
  synthesize(request: DubbingTtsRequest, signal: AbortSignal): Promise<{ path: string; voice?: string; fromCache?: boolean }>
}

export interface DubbingAudioAdapter {
  trim(inputPath: string, outputHint: string, signal: AbortSignal): Promise<{ path: string; duration: number }>
  applyTempo(
    inputPath: string,
    outputHint: string,
    targetDuration: number,
    signal: AbortSignal,
    measuredInputDuration?: number
  ): Promise<{ path: string; duration: number }>
}

export type DubbingPhase = 'measure' | 'batch-rephrase' | 'rescue' | 'finalize'

export interface DubbingOverflowRequest {
  cueId: string
  currentText: string
  sourceText?: string
  targetDuration: number
  measuredDuration: number
  maxDuration: number
  contextBefore: string[]
  contextAfter: string[]
  recoveryAttempt?: 1 | 2
}

export interface DubbingRephraseAdapter {
  rephraseBatch(
    requests: readonly DubbingOverflowRequest[],
    signal: AbortSignal
  ): Promise<ReadonlyMap<string, readonly string[]>>
}

export interface DubbingSynthesisInput {
  allowVideoExtension?: boolean
  /** One automatic retry after the rest of the queue finishes. */
  recoveryAttempt?: 1 | 2
  plan: DubbingPlan
  language: string
  model: string
  voice?: string | null
  options?: Record<string, unknown>
  fixedTempo?: number
  localTempoDelta?: number
  /** Enabled only when source dialogue is absent from the rendered mix. */
  maxEarlyStartSeconds?: number
  /** Internal bounded retry: split one measured-overflow speech unit at source boundaries. */
  structuralSplitDepth?: number
  predictor?: DurationPredictor
  tts: DubbingTtsAdapter
  audio: DubbingAudioAdapter
  rephraseBatch?: DubbingRephraseAdapter['rephraseBatch']
  /** @deprecated Compatibility bridge for callers not yet migrated to the batch adapter. */
  rephrase?: (input: DubbingOverflowRequest, signal: AbortSignal) => Promise<readonly string[]>
  onRephrase?: (event: {
    cueId: string
    phase: 'batch-rephrase' | 'rescue'
    outcome: 'batch-received' | 'accepted' | 'improved-overflow' | 'no-candidate' | 'invalid-candidate' | 'unchanged' | 'no-improvement' | 'incomplete-audio'
    candidateCount: number
    batchSize?: number
    previousSeconds?: number
    candidateSeconds?: number
  }) => void
  onStructuralSplit?: (event: { cueId: string; sourceCueIds: readonly string[]; partCount: number }) => void
  signal?: AbortSignal
  onProgress?: (completed: number, total: number, cueId: string, phase?: DubbingPhase) => void
  prefetchTts?: boolean
}

export interface DubbingSynthesisMetrics {
  rephraseCount: number
  overflowCount: number
  batchCount: number
  batchCueCount: number
  rescueAttemptCount: number
  rescueAcceptedCount: number
  phaseWaitMs: number
  fitFirstPassCount: number
  fitFirstPassRatio: number
  predictorSamples: number
  predictorResidualP90: number
  globalTempo: number
  averageTempo: number
  maxTempo: number
  degraded: boolean
  /** Bounded one-cue lookahead counters used to decide whether prefetch is useful. */
  prefetchStarted: number
  prefetchUsed: number
  prefetchDiscarded: number
  prefetchWaitMs: number
}

export interface DubbingSynthesisResult {
  timeMap?: DubbingTimeMap
  plan: DubbingPlan
  clips: Array<{ start: number; path: string }>
  subtitles: DubbingSubtitleCue[]
  voice?: string
  metrics: DubbingSynthesisMetrics
}

interface PreparedCue {
  cue: DubbingPlanCue
  text: string
  rawPath: string
  trimmedPath: string
  naturalDuration: number
  rephrased: boolean
  voice?: string
}

interface MeasuredSpeechSlot {
  start: number
  deadline: number
  availableDuration: number
  maximumAvailableDuration: number
}

interface MeasuredCueState {
  cue: DubbingPlanCue
  current: PreparedCue
  measuredText: string
  safeAvailable: number
  measuredSlot: MeasuredSpeechSlot
  overflowRequest?: DubbingOverflowRequest
  provisionalPath?: string
  provisionalDuration?: number
  provisionalTargetDuration?: number
  provisionalError?: unknown
}

type MeasuredDecision = 'fit' | 'overflow' | 'deferred'

function classifyMeasuredCue(
  naturalDuration: number,
  provisionalAvailable: number,
  optimisticAvailable: number,
  unresolvedPredecessor: boolean,
  tolerance: number
): MeasuredDecision {
  if (naturalDuration <= provisionalAvailable * AUTO_SHORT_TTS_HARD_MAX_TEMPO + tolerance) return 'fit'
  if (unresolvedPredecessor && naturalDuration <= optimisticAvailable * AUTO_SHORT_TTS_HARD_MAX_TEMPO + tolerance) {
    return 'deferred'
  }
  return 'overflow'
}

const MAX_STRUCTURAL_SPLIT_DEPTH = 8

class DubbingStructuralSplitRequired extends Error {
  constructor(
    readonly splitPlan: DubbingPlan,
    readonly cueId: string,
    readonly sourceCueIds: readonly string[],
    readonly partCount: number
  ) {
    super(`Cue ${cueId} cần tách thành ${partCount} đoạn thoại theo ranh giới source.`)
    this.name = 'DubbingStructuralSplitRequired'
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Đã hủy tác vụ')
}

function validDuration(value: number, cueId: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Cue ${cueId} có audio không hợp lệ.`)
  return value
}

function measuredSpeechSlot(
  input: DubbingSynthesisInput,
  cue: DubbingPlanCue,
  anchoredAvailableDuration: number,
  naturalDuration: number,
  previousVoiceEnd: number | null | undefined
): MeasuredSpeechSlot {
  const configuredEarlyStart = Number.isFinite(input.maxEarlyStartSeconds)
    ? Math.max(0, Math.min(DUBBING_MAX_EARLY_START_SECONDS, input.maxEarlyStartSeconds || 0))
    : 0
  const earliestByLeadIn = Math.max(0, cue.sourceStart - configuredEarlyStart)
  const earliestByPreviousVoice = previousVoiceEnd == null
    ? 0
    : previousVoiceEnd + DUBBING_PROTECTED_GAP_SECONDS
  const earliestStart = Math.max(earliestByLeadIn, earliestByPreviousVoice)
  const maximumEarlyLead = Math.max(0, cue.sourceStart - earliestStart)
  const deadline = cue.sourceStart + anchoredAvailableDuration
  const requiredLead = Math.max(0, naturalDuration / AUTO_SHORT_TTS_HARD_MAX_TEMPO - anchoredAvailableDuration)
  const earlyLead = Math.min(maximumEarlyLead, requiredLead)
  const start = cue.sourceStart - earlyLead
  return {
    start,
    deadline,
    availableDuration: deadline - start,
    maximumAvailableDuration: anchoredAvailableDuration + maximumEarlyLead
  }
}

function splitTranslatedSentences(text: string): string[] {
  return (text.match(/[^.!?。！？…]+(?:[.!?。！？…]+|$)/gu) || [])
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * A grouped unit may contain several complete translated sentences. If its
 * measured WAV still overflows, split only at the immutable source cue
 * boundaries instead of asking the model to delete meaning from the group.
 */
function buildStructuralSplitPlan(plan: DubbingPlan, cue: DubbingPlanCue, spokenText: string): DubbingPlan | null {
  if (cue.sourceCueIds.length < 2) return null
  const parts = splitTranslatedSentences(spokenText)
  if (parts.length !== cue.sourceCueIds.length) return null
  const sourceCues = plan.sourceCues
  if (!sourceCues?.length) return null
  const sourceById = new Map(sourceCues.map((source) => [source.id, source]))
  const sourceIndex = new Map(sourceCues.map((source, index) => [source.id, index]))
  const children = cue.sourceCueIds.map((sourceId, index) => {
    const source = sourceById.get(sourceId)
    const position = sourceIndex.get(sourceId)
    if (!source || position == null) return null
    const next = sourceCues[position + 1]?.start ?? null
    const window = deriveDubbingWindow(source, next, plan.videoDuration)
    return {
      ...cue,
      id: source.id,
      start: window.start,
      preferredEnd: window.preferredEnd,
      hardEnd: window.hardEnd,
      availableDuration: window.availableDuration,
      sourceCueIds: [source.id],
      sourceText: source.text,
      sourceStart: source.start,
      sourceEnd: source.end,
      translatedText: parts[index],
      finalSpokenText: parts[index],
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
  if (children.some((child): child is null => child === null)) return null
  return {
    ...plan,
    globalTempo: null,
    cues: plan.cues.flatMap((item) => item.id === cue.id ? children as DubbingPlanCue[] : [item])
  }
}

function clonePlan(plan: DubbingPlan): DubbingPlan {
  return {
    ...plan,
    cues: plan.cues.map((cue) => ({
      ...cue,
      sourceCueIds: [...cue.sourceCueIds],
      subtitles: cue.subtitles.map((subtitle) => ({ ...subtitle }))
    }))
  }
}

function estimateDurations(plan: DubbingPlan, predictor: DurationPredictor): number[] {
  return plan.cues.map((cue) => predictor.estimate(cue.finalSpokenText, {
    sourceText: cue.sourceText,
    sourceDuration: Math.max(0.1, cue.sourceEnd - cue.sourceStart)
  }).seconds)
}

function selectGlobalTempo(
  plan: DubbingPlan,
  predictedDurations: readonly number[],
  fixedTempo: number | undefined
): number {
  if (plan.paceMode === 'fixed') return selectFixedPace(fixedTempo ?? 1)
  return selectSourceAdaptivePace(predictedDurations, deriveDubbingWindows(plan.cues.map((cue) => ({
    id: cue.id,
    start: cue.sourceStart,
    end: cue.sourceEnd,
    text: cue.sourceText
  })), plan.videoDuration))
}

async function prepareNaturalCue(
  input: DubbingSynthesisInput,
  cue: DubbingPlanCue,
  text: string,
  signal: AbortSignal,
  attempt: number
): Promise<PreparedCue> {
  throwIfAborted(signal)
  if (containsRephraseLabel(text, input.plan.cues.map((item) => item.id))) {
    throw new Error(`Cue ${cue.id} chứa nhãn rephrase trong lời đọc; dừng trước TTS.`)
  }
  const request: DubbingTtsRequest = {
    cueId: cue.id,
    text,
    language: input.language,
    model: input.model,
    voice: input.voice,
    options: input.options,
    speed: 1,
    cacheMode: input.recoveryAttempt === 2 ? 'bypass' : 'prefer'
  }
  let result = await input.tts.synthesize(request, signal)
  if (!result?.path) throw new Error(`Cue ${cue.id} không trả về audio TTS.`)
  let trimmed: { path: string; duration: number }
  try {
    trimmed = await input.audio.trim(result.path, `${cue.id}-trim-${attempt}`, signal)
  } catch (error) {
    if (!result.fromCache) throw error
    // A stale/corrupt cache entry is recoverable: bypass it once and let the
    // adapter replace the same key with fresh server output.
    result = await input.tts.synthesize({ ...request, cacheMode: 'bypass' }, signal)
    if (!result?.path) throw new Error(`Cue ${cue.id} không trả về audio TTS sau khi làm mới cache.`)
    trimmed = await input.audio.trim(result.path, `${cue.id}-trim-${attempt}-fresh`, signal)
  }
  let duration = validDuration(trimmed.duration, cue.id)
  let completeness = validateVoiceAudioCompleteness(text, duration)
  if (!completeness.ok && attempt === 0) {
    // A syntactically valid cache entry may still contain repeated/hallucinated
    // speech. Replace that exact key once and measure the replacement before
    // any tempo or video-extension decision is made.
    result = await input.tts.synthesize({ ...request, cacheMode: 'bypass' }, signal)
    if (!result?.path) throw new Error(`Cue ${cue.id} không trả về audio TTS sau khi làm mới audio bất thường.`)
    trimmed = await input.audio.trim(result.path, `${cue.id}-trim-${attempt}-quality-refresh`, signal)
    duration = validDuration(trimmed.duration, cue.id)
    completeness = validateVoiceAudioCompleteness(text, duration)
    if (!completeness.ok) {
      throw new Error(`Cue ${cue.id} có audio TTS không hợp lệ: ${completeness.error || 'không đủ bằng chứng phát âm đầy đủ.'}`)
    }
  }
  return {
    cue,
    text: text.trim(),
    rawPath: result.path,
    trimmedPath: trimmed.path,
    naturalDuration: duration,
    rephrased: cue.rephrased || attempt > 0,
    voice: result.voice
  }
}

/**
 * Synthesize one source-anchored plan. Server work is intentionally serialized;
 * only local audio adapters decide whether they can pipeline their own work.
 */
export async function synthesizeDubbingPlan(input: DubbingSynthesisInput): Promise<DubbingSynthesisResult> {
  const scope = createAutoShortItemScope(input.signal)
  const signal = scope.signal
  let caughtError: unknown = undefined
  try {
    const plan = clonePlan(input.plan)
    if (plan.cues.length === 0) throw new Error('DubbingPlan không có cue để tạo voice.')
    const predictor = input.predictor || createDurationPredictor()
    const sourceCues = plan.cues.map((cue) => ({ id: cue.id, start: cue.sourceStart, end: cue.sourceEnd, text: cue.sourceText }))
    const speakingDurations = dubbingSpeakingDurations(sourceCues, plan.videoDuration)
    // The predictor selects an initial pace only. It must never edit text
    // before a real WAV exists: a cold or stale duration profile turns a
    // prediction-first pass into unnecessary LLM work and semantic churn.
    // Recovery is therefore strictly driven by a measured overflow below.
    const predicted = estimateDurations(plan, predictor)
    let globalTempo = selectGlobalTempo(plan, predicted, input.fixedTempo)
    const prepared = new Map<string, PreparedCue>()
    let voice = input.voice || undefined

    const bootstrap = predictor.profile.samples === 0
      ? selectBootstrapCues(plan.cues.map((cue) => ({ id: cue.id, text: cue.finalSpokenText })), 3)
      : []
    for (const bootstrapCue of bootstrap) {
      throwIfAborted(signal)
      const cue = plan.cues.find((candidate) => candidate.id === bootstrapCue.id) as DubbingPlanCue
      const current = await prepareNaturalCue(input, cue, cue.finalSpokenText, signal, 0)
      prepared.set(cue.id, current)
      if (current.voice) voice = current.voice
      predictor.addSample(current.text, current.naturalDuration, input.language)
    }

    // Bootstrap audio is real output and has already updated the profile. Lock
    // the shared pace once before synthesizing all remaining cues.
    if (bootstrap.length > 0) globalTempo = selectGlobalTempo(plan, estimateDurations(plan, predictor), input.fixedTempo)
    plan.globalTempo = globalTempo

    const measuredStates: MeasuredCueState[] = []
    let rephraseCount = plan.cues.filter((cue) => cue.rephrased).length
    let fitFirstPassCount = 0
    let overflowCount = 0
    let batchCount = 0
    let batchCueCount = 0
    let rescueAttemptCount = 0
    let rescueAcceptedCount = 0
    let phaseWaitMs = 0
    let prefetchStarted = 0
    let prefetchUsed = 0
    let prefetchDiscarded = 0
    let prefetchWaitMs = 0

    interface PendingPrefetch {
      cueId: string
      textFingerprint: string
      outcomePromise: Promise<BranchOutcome<PreparedCue>>
    }
    const pendingPrefetch: { value: PendingPrefetch | null } = { value: null }

    const fitPreparedCue = async (
      cue: DubbingPlanCue,
      current: PreparedCue,
      slot: MeasuredSpeechSlot,
      outputHint: string
    ): Promise<{ path: string; duration: number; targetDuration: number; tempo: number; voiceEnd: number }> => {
      const localDelta = Math.max(0, input.localTempoDelta ?? DUBBING_LOCAL_TEMPO_DELTA)
      const localCeiling = Math.min(AUTO_SHORT_TTS_HARD_MAX_TEMPO, globalTempo + localDelta)
      const maxLocalCeiling = Math.min(AUTO_SHORT_TTS_HARD_MAX_TEMPO, Math.max(localCeiling, 1.35))
      const safeAvailable = slot.availableDuration
      const safeDeadline = slot.deadline
      const requiredTempo = current.naturalDuration / safeAvailable
      if (requiredTempo > AUTO_SHORT_TTS_HARD_MAX_TEMPO + DUBBING_TIMING_TOLERANCE_SECONDS) {
        throw new Error(`Cue ${cue.id} cần nhịp ${requiredTempo.toFixed(3)}x, vượt trần ${AUTO_SHORT_TTS_HARD_MAX_TEMPO.toFixed(2)}x; cần rephrase hoặc tách câu, không cắt lời.`)
      }
      const preferredTempo = Number(Math.min(maxLocalCeiling, Math.max(globalTempo, requiredTempo)).toFixed(4))
      const targetDuration = Math.min(current.naturalDuration / preferredTempo, safeAvailable)
      const requestedTempo = current.naturalDuration / targetDuration
      let finalPath = current.trimmedPath
      let actualDuration = current.naturalDuration
      if (Math.abs(requestedTempo - 1) > DUBBING_TIMING_TOLERANCE_SECONDS || actualDuration > safeAvailable) {
        const fitted = await input.audio.applyTempo(current.trimmedPath, outputHint, targetDuration, signal, current.naturalDuration)
        finalPath = fitted.path
        actualDuration = validDuration(fitted.duration, cue.id)
      }
      let voiceEnd = slot.start + actualDuration
      // Calibrate both undershoot and overshoot from the original PCM. A
      // requested tempo is not proof of the tempo actually produced by DSP.
      const minimumDuration = current.naturalDuration / AUTO_SHORT_TTS_HARD_MAX_TEMPO
      let calibratedTarget = targetDuration
      for (let attempt = 0; attempt < 3; attempt++) {
        const tooFast = current.naturalDuration / actualDuration > AUTO_SHORT_TTS_HARD_MAX_TEMPO
        const tooLong = voiceEnd > safeDeadline + DUBBING_TIMING_TOLERANCE_SECONDS
        if (!tooFast && !tooLong) break
        const desiredDuration = Math.min(safeAvailable, Math.max(minimumDuration, targetDuration))
        calibratedTarget *= desiredDuration / actualDuration
        const corrected = await input.audio.applyTempo(
          current.trimmedPath, `${outputHint}-calibration-${attempt + 1}`, calibratedTarget, signal, current.naturalDuration
        )
        finalPath = corrected.path
        actualDuration = validDuration(corrected.duration, cue.id)
        voiceEnd = slot.start + actualDuration
      }
      if (voiceEnd > safeDeadline + DUBBING_TIMING_TOLERANCE_SECONDS) throw new Error(`Cue ${cue.id} vẫn vượt thời lượng sau khi chỉnh nhịp; không cắt lời.`)
      const tempo = Number((current.naturalDuration / actualDuration).toFixed(4))
      if (tempo > AUTO_SHORT_TTS_HARD_MAX_TEMPO + DUBBING_TIMING_TOLERANCE_SECONDS) {
        throw new Error(`Cue ${cue.id} có tempo đo được ${tempo.toFixed(3)}x vượt trần ${AUTO_SHORT_TTS_HARD_MAX_TEMPO.toFixed(2)}x; không chấp nhận audio bị tăng tốc quá mức.`)
      }
      return { path: finalPath, duration: actualDuration, targetDuration, tempo, voiceEnd }
    }

    const schedulePrefetch = (index: number): void => {
      if (!input.prefetchTts || index + 1 >= plan.cues.length) return
      const nextCue = plan.cues[index + 1]
      if (prepared.has(nextCue.id) || (pendingPrefetch.value && pendingPrefetch.value.cueId === nextCue.id)) return
      const text = nextCue.finalSpokenText.trim()
      pendingPrefetch.value = {
        cueId: nextCue.id,
        textFingerprint: text,
        outcomePromise: scope.start(
          (s) => prepareNaturalCue(input, nextCue, nextCue.finalSpokenText, s, 0),
          { abortOnError: false }
        )
      }
      prefetchStarted++
    }

    let measuredPreviousVoiceEnd: number | null = null
    let unresolvedPredecessor = false
    // Phase 1: synthesize and trim every original cue before any LLM call.
    for (let index = 0; index < plan.cues.length; index++) {
      throwIfAborted(signal)
      const cue = plan.cues[index]
      let current = prepared.get(cue.id)
      if (!current) {
        const prefetched = pendingPrefetch.value
        if (prefetched && prefetched.cueId === cue.id) {
          const prefetch = prefetched
          pendingPrefetch.value = null
          if (prefetch.textFingerprint === cue.finalSpokenText.trim()) {
            const waitStarted = performance.now()
            const outcome = await prefetch.outcomePromise
            prefetchWaitMs += Math.max(0, performance.now() - waitStarted)
            prefetchUsed++
            if (!outcome.ok) throw outcome.error
            current = outcome.value
          } else {
            prefetchDiscarded++
            await prefetch.outcomePromise.catch(() => undefined)
          }
        }
        if (!current) current = await prepareNaturalCue(input, cue, cue.finalSpokenText, signal, 0)
        predictor.addSample(current.text, current.naturalDuration, input.language)
      }
      if (current.voice) voice = current.voice

      const localDelta = Math.max(0, input.localTempoDelta ?? DUBBING_LOCAL_TEMPO_DELTA)
      const localCeiling = Math.min(AUTO_SHORT_TTS_HARD_MAX_TEMPO, globalTempo + localDelta)
      const safeAvailable = validDuration(speakingDurations[index], cue.id)
      const slot = measuredSpeechSlot(input, cue, safeAvailable, current.naturalDuration, measuredPreviousVoiceEnd)
      const optimisticSlot = unresolvedPredecessor
        ? measuredSpeechSlot(input, cue, safeAvailable, current.naturalDuration, null)
        : slot
      const decision = classifyMeasuredCue(
        current.naturalDuration,
        slot.maximumAvailableDuration,
        optimisticSlot.maximumAvailableDuration,
        unresolvedPredecessor,
        DUBBING_TIMING_TOLERANCE_SECONDS
      )
      const overflow = decision === 'overflow'
      if (decision === 'overflow' && !input.allowVideoExtension) {
        const splitDepth = input.structuralSplitDepth || 0
        const splitPlan = splitDepth < MAX_STRUCTURAL_SPLIT_DEPTH
          ? buildStructuralSplitPlan(plan, cue, current.text)
          : null
        const splitDurations = splitPlan
          ? dubbingSpeakingDurations(splitPlan.cues.map((child) => ({
            id: child.id,
            start: child.sourceStart,
            end: child.sourceEnd,
            text: child.sourceText
          })), splitPlan.videoDuration)
          : []
        if (splitPlan && splitDurations.every((duration) => Number.isFinite(duration) && duration > 0)) {
          input.onStructuralSplit?.({ cueId: cue.id, sourceCueIds: cue.sourceCueIds, partCount: splitPlan.cues.length - plan.cues.length + 1 })
          throw new DubbingStructuralSplitRequired(splitPlan, cue.id, cue.sourceCueIds, splitPlan.cues.length - plan.cues.length + 1)
        }
      }

      schedulePrefetch(index)
      const state: MeasuredCueState = {
        cue,
        current,
        measuredText: current.text,
        safeAvailable,
        measuredSlot: slot
      }
      if (decision !== 'fit') {
        if (overflow) {
          overflowCount++
          state.overflowRequest = {
            cueId: cue.id,
            currentText: current.text,
            sourceText: cue.sourceText,
            targetDuration: slot.maximumAvailableDuration * Math.min(1.1, localCeiling),
            measuredDuration: current.naturalDuration,
            maxDuration: slot.maximumAvailableDuration * AUTO_SHORT_TTS_HARD_MAX_TEMPO,
            contextBefore: index > 0 ? [plan.cues[index - 1].sourceText] : [],
            contextAfter: index + 1 < plan.cues.length ? [plan.cues[index + 1].sourceText] : [],
            recoveryAttempt: input.recoveryAttempt || 1
          }
        }
        // A deferred cue fits its source-anchored window if the unresolved
        // predecessor is finalized with available tempo headroom. Keep the
        // measured original and let phase 3b reflow the predecessor first.
        measuredPreviousVoiceEnd = Math.min(slot.deadline, slot.start + current.naturalDuration / AUTO_SHORT_TTS_HARD_MAX_TEMPO)
        unresolvedPredecessor = true
      } else {
        fitFirstPassCount++
        if (input.prefetchTts) {
          const provisional = await fitPreparedCue(cue, current, slot, `${cue.id}-tempo-measured`)
          state.provisionalPath = provisional.path
          state.provisionalDuration = provisional.duration
          state.provisionalTargetDuration = provisional.targetDuration
          measuredPreviousVoiceEnd = provisional.voiceEnd
        } else {
          measuredPreviousVoiceEnd = slot.start + Math.min(current.naturalDuration / globalTempo, slot.availableDuration)
        }
      }
      measuredStates.push(state)
      input.onProgress?.(index + 1, plan.cues.length, cue.id, 'measure')
    }

    const overflowRequests = measuredStates
      .map((state) => state.overflowRequest)
      .filter((request): request is DubbingOverflowRequest => Boolean(request))
    const candidatesByCue = new Map<string, readonly string[]>()
    if (overflowRequests.length > 0) {
      input.onProgress?.(0, overflowRequests.length, 'batch-rephrase', 'batch-rephrase')
      const phaseStarted = performance.now()
      try {
        if (input.rephraseBatch) {
          batchCount = Math.ceil(overflowRequests.length / 8)
          const result = await input.rephraseBatch(overflowRequests, signal)
          for (const request of overflowRequests) {
            const candidates = result.get(request.cueId)
            if (candidates?.length) candidatesByCue.set(request.cueId, [...candidates])
          }
        } else if (input.rephrase) {
          batchCount = 1
          for (const request of overflowRequests) {
            const candidates = await input.rephrase(request, signal)
            if (candidates.length) candidatesByCue.set(request.cueId, [...candidates])
          }
        }
      } catch (error) {
        if (signal.aborted) throw error
      } finally {
        phaseWaitMs += Math.max(0, performance.now() - phaseStarted)
      }
      if (batchCount === 0) batchCount = 1
      batchCueCount = overflowRequests.length
      for (const request of overflowRequests) {
        const candidates = candidatesByCue.get(request.cueId) || []
        input.onRephrase?.({
          cueId: request.cueId,
          phase: 'batch-rephrase',
          outcome: candidates.length ? 'batch-received' : 'no-candidate',
          candidateCount: candidates.length,
          batchSize: overflowRequests.length,
          previousSeconds: request.measuredDuration
        })
      }
      input.onProgress?.(overflowRequests.length, overflowRequests.length, 'batch-rephrase', 'batch-rephrase')
    }

    // Phase 3a: measure only candidates returned by the completed batch.
    let rescueIndex = 0
    for (const state of measuredStates) {
      const request = state.overflowRequest
      if (!request) continue
      throwIfAborted(signal)
      const candidates = candidatesByCue.get(request.cueId) || []
      const compactQuestions = [state.current.text, ...candidates]
        .map((text) => compactEnglishDubbingQuestion(text, input.language))
        .filter((text): text is string => text !== null)
      const semanticBasis = input.recoveryAttempt === 2 && state.cue.sourceText.trim()
        ? state.cue.sourceText
        : state.current.text
      const validTexts = [...new Set([...compactQuestions, ...candidates]
        .map((text) => text.trim())
        .filter((text) => text && !containsRephraseLabel(text, [state.cue.id])))].filter((text) =>
          text === state.current.text.trim() || validateRephraseSemanticPreservation(semanticBasis, text, input.language).ok)
      const ranked = validTexts
        .filter((text) => text !== state.current.text.trim())
        .map((text) => ({ text, predictedSeconds: predictor.estimate(text, { locale: input.language }).seconds }))
        .filter((candidate) => Number.isFinite(candidate.predictedSeconds) && candidate.predictedSeconds > 0)
        .sort((left, right) => left.predictedSeconds - right.predictedSeconds)
        .slice(0, 3)
      const original = state.current
      let best = original
      let accepted = false
      for (const [attempt, candidate] of ranked.entries()) {
        throwIfAborted(signal)
        rescueAttemptCount++
        const replacement = await prepareNaturalCue(input, state.cue, candidate.text, signal, attempt + 1)
        const complete = validateVoiceAudioCompleteness(replacement.text, replacement.naturalDuration).ok
        const improved = replacement.naturalDuration < best.naturalDuration - DUBBING_TIMING_TOLERANCE_SECONDS
        const fits = replacement.naturalDuration <= state.measuredSlot.maximumAvailableDuration * AUTO_SHORT_TTS_HARD_MAX_TEMPO
        input.onRephrase?.({
          cueId: state.cue.id,
          phase: 'rescue',
          outcome: !complete ? 'incomplete-audio' : !improved ? 'no-improvement' : fits ? 'accepted' : 'improved-overflow',
          candidateCount: candidates.length,
          previousSeconds: best.naturalDuration,
          candidateSeconds: replacement.naturalDuration
        })
        if (complete && improved) {
          best = replacement
          predictor.addSample(replacement.text, replacement.naturalDuration, input.language)
        }
        if (complete && improved && fits) {
          state.current = replacement
          state.provisionalPath = undefined
          state.provisionalDuration = undefined
          state.provisionalTargetDuration = undefined
          if (replacement.voice) voice = replacement.voice
          accepted = true
          rescueAcceptedCount++
          if (!state.cue.rephrased) rephraseCount++
          break
        }
      }
      if (!accepted && best !== original) state.current = best
      if (!ranked.length) {
        input.onRephrase?.({
          cueId: state.cue.id,
          phase: 'rescue',
          candidateCount: candidates.length,
          outcome: validTexts.includes(original.text.trim()) ? 'unchanged' : candidates.length && !validTexts.length ? 'invalid-candidate' : 'no-candidate'
        })
      }
      rescueIndex++
      input.onProgress?.(rescueIndex, overflowRequests.length, state.cue.id, 'rescue')
    }

    const finalCues: DubbingPlanCue[] = []
    let timeMap: DubbingTimeMap | undefined
    if (input.allowVideoExtension) {
      let candidateMap: DubbingTimeMap
      try {
        candidateMap = planDubbingTimeMap(plan.videoDuration, measuredStates.map((state) => ({
          id: state.cue.id, start: state.cue.sourceStart, sourceEnd: state.cue.sourceEnd,
          naturalDuration: state.current.naturalDuration, availableDuration: state.safeAvailable
        })), AUTO_SHORT_TTS_HARD_MAX_TEMPO)
      } catch (error) {
        // Preserve grouped speech through rephrase and bounded extension first:
        // splitting adds a protected gap and can make a feasible group impossible.
        if (error instanceof DubbingVideoExtensionLimitError && (input.structuralSplitDepth || 0) < MAX_STRUCTURAL_SPLIT_DEPTH) {
          const state = measuredStates.find((state) => state.cue.id === error.cueId)
          const splitPlan = state ? buildStructuralSplitPlan(plan, state.cue, state.current.text) : null
          if (splitPlan && state) {
            const partCount = splitPlan.cues.length - plan.cues.length + 1
            input.onStructuralSplit?.({ cueId: state.cue.id, sourceCueIds: state.cue.sourceCueIds, partCount })
            throw new DubbingStructuralSplitRequired(splitPlan, state.cue.id, state.cue.sourceCueIds, partCount)
          }
        }
        throw error
      }
      if (candidateMap.outputDuration > plan.videoDuration + 0.000001) {
        timeMap = candidateMap
        plan.videoDuration = timeMap.outputDuration
        plan.sourceCues = plan.sourceCues?.map((cue) => ({ ...cue,
          start: mapDubbingTime(candidateMap, cue.start), end: mapDubbingTime(candidateMap, cue.end) }))
        for (const state of measuredStates) {
          state.cue.sourceStart = mapDubbingTime(candidateMap, state.cue.sourceStart)
          state.cue.sourceEnd = mapDubbingTime(candidateMap, state.cue.sourceEnd)
          state.provisionalPath = undefined
          state.provisionalDuration = undefined
        }
        const mappedSources = measuredStates.map(({ cue }) => ({ id: cue.id, start: cue.sourceStart, end: cue.sourceEnd, text: cue.sourceText }))
        const mappedWindows = deriveDubbingWindows(mappedSources, plan.videoDuration)
        const mappedDurations = dubbingSpeakingDurations(mappedSources, plan.videoDuration)
        measuredStates.forEach((state, i) => {
          Object.assign(state.cue, mappedWindows[i])
          state.safeAvailable = mappedDurations[i]
        })
      }
    }

    const subtitles: DubbingSubtitleCue[] = []
    const clips: Array<{ start: number; path: string }> = []
    let previousVoiceEnd: number | null = null

    /**
     * A measured rescue can shorten a cue after its predecessor was already
     * finalized. If the protected gap is the only thing making the rescue
     * impossible, spend verified tempo headroom on that predecessor and then
     * fit the current cue again. This keeps the 0.50s gap and never exceeds the
     * physical hard ceiling; an actually impossible predecessor is left alone
     * so the normal, lossless diagnostic is still raised.
     */
    const reflowPredecessorForCue = async (
      index: number,
      cue: DubbingPlanCue,
      current: PreparedCue,
      state: MeasuredCueState
    ): Promise<number | null> => {
      if (index <= 0) return null
      const previous = finalCues[index - 1]
      const previousState = measuredStates[index - 1]
      if (!previous || !previousState || previous.voiceEnd == null) return null

      const configuredEarlyStart = Number.isFinite(input.maxEarlyStartSeconds)
        ? Math.max(0, Math.min(DUBBING_MAX_EARLY_START_SECONDS, input.maxEarlyStartSeconds || 0))
        : 0
      const earliestByLeadIn = Math.max(0, cue.sourceStart - configuredEarlyStart)
      const requiredLead = Math.max(0, current.naturalDuration / AUTO_SHORT_TTS_HARD_MAX_TEMPO - state.safeAvailable)
      const requiredStart = cue.sourceStart - requiredLead
      if (requiredStart < earliestByLeadIn - DUBBING_TIMING_TOLERANCE_SECONDS) return null

      // Leave a small measurement guard so a one-frame DSP rounding difference
      // cannot consume the protected gap again.
      const desiredPreviousEnd = requiredStart - DUBBING_PROTECTED_GAP_SECONDS - 0.01
      const targetDuration = desiredPreviousEnd - previous.start
      const naturalDuration = previousState.current.naturalDuration
      const minimumDuration = naturalDuration / AUTO_SHORT_TTS_HARD_MAX_TEMPO
      const previousActual = previous.actualDuration ?? naturalDuration
      if (!(targetDuration > 0) || targetDuration >= previousActual - DUBBING_TIMING_TOLERANCE_SECONDS
        || targetDuration < minimumDuration - DUBBING_TIMING_TOLERANCE_SECONDS) return null
      if (previous.start + targetDuration > previous.hardEnd + DUBBING_TIMING_TOLERANCE_SECONDS) return null

      const prospectivePreviousEnd = previous.start + targetDuration
      const prospectiveSlot = measuredSpeechSlot(
        input,
        cue,
        state.safeAvailable,
        current.naturalDuration,
        prospectivePreviousEnd
      )
      if (current.naturalDuration > prospectiveSlot.availableDuration * AUTO_SHORT_TTS_HARD_MAX_TEMPO
        + DUBBING_TIMING_TOLERANCE_SECONDS) return null

      const fitted = await input.audio.applyTempo(
        previousState.current.trimmedPath,
        `${previous.id}-tempo-reflow-${cue.id}`,
        targetDuration,
        signal,
        naturalDuration
      )
      const actualDuration = validDuration(fitted.duration, previous.id)
      const tempo = Number((naturalDuration / actualDuration).toFixed(4))
      const voiceEnd = previous.start + actualDuration
      if (tempo > AUTO_SHORT_TTS_HARD_MAX_TEMPO + DUBBING_TIMING_TOLERANCE_SECONDS
        || voiceEnd > previous.hardEnd + DUBBING_TIMING_TOLERANCE_SECONDS) return null
      const actualSlot = measuredSpeechSlot(input, cue, state.safeAvailable, current.naturalDuration, voiceEnd)
      if (current.naturalDuration > actualSlot.availableDuration * AUTO_SHORT_TTS_HARD_MAX_TEMPO
        + DUBBING_TIMING_TOLERANCE_SECONDS) return null

      const originalSourceIndex = plan.sourceCues?.findIndex((source) => source.id === previous.sourceCueIds[0]) ?? -1
      const subtitleInput = {
        cueId: previous.id,
        sourceIndex: originalSourceIndex >= 0 ? (plan.sourceCues![originalSourceIndex].sourceIndex ?? originalSourceIndex) : index - 1,
        start: previous.start,
        end: voiceEnd,
        finalSpokenText: previous.finalSpokenText
      }
      const cueSubtitles = previous.sourceCueIds.length > 1
        ? buildDubbingSubtitleSegments(subtitleInput) : [buildDubbingSubtitle(subtitleInput)]
      subtitles.splice(Math.max(0, subtitles.length - previous.subtitles.length), previous.subtitles.length, ...cueSubtitles)
      finalCues[index - 1] = {
        ...previous,
        actualDuration,
        plannedDuration: targetDuration,
        voiceEnd,
        tempo,
        localTempoAdjustment: Number((tempo - globalTempo).toFixed(4)),
        audioPath: fitted.path,
        subtitles: cueSubtitles
      }
      clips[index - 1] = { start: previous.start, path: fitted.path }
      previousState.provisionalPath = fitted.path
      previousState.provisionalDuration = actualDuration
      previousState.provisionalTargetDuration = targetDuration
      return voiceEnd
    }

    // Phase 3b: finalize all cues against the post-rescue source ledger.
    for (let index = 0; index < measuredStates.length; index++) {
      throwIfAborted(signal)
      const state = measuredStates[index]
      const cue = state.cue
      const current = state.current
      let slot = measuredSpeechSlot(input, cue, state.safeAvailable, current.naturalDuration, previousVoiceEnd)
      let finalPath = state.provisionalPath || current.trimmedPath
      let actualDuration = state.provisionalDuration || current.naturalDuration
      let targetDuration = state.provisionalTargetDuration || current.naturalDuration
      let reusable = Boolean(
        state.provisionalPath && current.text === state.measuredText
        && current.naturalDuration / actualDuration <= AUTO_SHORT_TTS_HARD_MAX_TEMPO + DUBBING_TIMING_TOLERANCE_SECONDS
        && slot.start + actualDuration <= slot.deadline + DUBBING_TIMING_TOLERANCE_SECONDS
      )
      if (!reusable) {
        if (previousVoiceEnd != null
          && current.naturalDuration > slot.availableDuration * AUTO_SHORT_TTS_HARD_MAX_TEMPO + DUBBING_TIMING_TOLERANCE_SECONDS) {
          const reflowedPreviousEnd = await reflowPredecessorForCue(index, cue, current, state)
          if (reflowedPreviousEnd != null) {
            previousVoiceEnd = reflowedPreviousEnd
            slot = measuredSpeechSlot(input, cue, state.safeAvailable, current.naturalDuration, previousVoiceEnd)
            reusable = Boolean(
              state.provisionalPath && current.text === state.measuredText
              && current.naturalDuration / actualDuration <= AUTO_SHORT_TTS_HARD_MAX_TEMPO + DUBBING_TIMING_TOLERANCE_SECONDS
              && slot.start + actualDuration <= slot.deadline + DUBBING_TIMING_TOLERANCE_SECONDS
            )
          }
        }
      }
      if (!reusable) {
        const fitted = await fitPreparedCue(cue, current, slot, `${cue.id}-tempo`)
        finalPath = fitted.path
        actualDuration = fitted.duration
        targetDuration = fitted.targetDuration
      }
      const voiceEnd = slot.start + actualDuration
      const tempo = Number((current.naturalDuration / actualDuration).toFixed(4))
      const originalSourceIndex = plan.sourceCues?.findIndex((source) => source.id === cue.sourceCueIds[0]) ?? -1
      const subtitleInput = {
        cueId: cue.id,
        sourceIndex: originalSourceIndex >= 0 ? (plan.sourceCues![originalSourceIndex].sourceIndex ?? originalSourceIndex) : index,
        start: slot.start,
        end: voiceEnd,
        finalSpokenText: current.text
      }
      const cueSubtitles = cue.sourceCueIds.length > 1
        ? buildDubbingSubtitleSegments(subtitleInput) : [buildDubbingSubtitle(subtitleInput)]
      subtitles.push(...cueSubtitles)
      finalCues.push({
        ...cue,
        start: slot.start,
        hardEnd: cue.hardEnd,
        availableDuration: slot.availableDuration,
        translatedText: cue.translatedText,
        finalSpokenText: current.text,
        predictedDuration: predictor.estimate(current.text, { locale: input.language }).seconds,
        predictionUncertainty: predictor.estimate(current.text, { locale: input.language }).uncertaintySeconds,
        naturalDuration: current.naturalDuration,
        actualDuration,
        tempo,
        plannedDuration: targetDuration,
        voiceEnd,
        localTempoAdjustment: Number((tempo - globalTempo).toFixed(4)),
        audioPath: finalPath,
        subtitles: cueSubtitles,
        rephrased: current.rephrased
      })
      clips.push({ start: slot.start, path: finalPath })
      previousVoiceEnd = voiceEnd
      input.onProgress?.(index + 1, measuredStates.length, cue.id, 'finalize')
    }

    const tempos = finalCues.map((cue) => cue.tempo)
    const averageTempo = tempos.reduce((sum, tempo) => sum + tempo, 0) / tempos.length
    const outputPlan: DubbingPlan = { ...plan, cues: finalCues }
    return {
      plan: outputPlan,
      timeMap,
      clips,
      subtitles,
      voice,
      metrics: {
        rephraseCount,
        overflowCount,
        batchCount,
        batchCueCount,
        rescueAttemptCount,
        rescueAcceptedCount,
        phaseWaitMs: Math.round(phaseWaitMs),
        fitFirstPassCount,
        fitFirstPassRatio: Number((fitFirstPassCount / finalCues.length).toFixed(3)),
        predictorSamples: predictor.profile.samples,
        predictorResidualP90: predictor.profile.residualP90,
        globalTempo,
        averageTempo: Number(averageTempo.toFixed(4)),
        maxTempo: Math.max(...tempos),
        degraded: finalCues.some((cue) => Math.abs(cue.localTempoAdjustment) > 0.0001),
        prefetchStarted,
        prefetchUsed,
        prefetchDiscarded,
        prefetchWaitMs: Math.round(prefetchWaitMs)
      }
    }
  } catch (error) {
    if (error instanceof DubbingStructuralSplitRequired
      && (input.structuralSplitDepth || 0) < MAX_STRUCTURAL_SPLIT_DEPTH) {
      return synthesizeDubbingPlan({
        ...input,
        plan: error.splitPlan,
        structuralSplitDepth: (input.structuralSplitDepth || 0) + 1
      })
    }
    caughtError = error
    throw error
  } finally {
    scope.abort(caughtError)
    await scope.drain()
    scope.dispose()
  }
}
