import { createDurationPredictor, type DurationPredictor } from './durationPredictor'
import { chooseDubbingRephrase } from './translation'
import { buildDubbingSubtitle, type DubbingSubtitleCue } from './subtitles'
import {
  DUBBING_LOCAL_TEMPO_DELTA,
  DUBBING_PROTECTED_GAP_SECONDS,
  DUBBING_TIMING_TOLERANCE_SECONDS,
  deriveDubbingWindows,
  selectFixedPace,
  selectSourceAdaptivePace
} from './policy'
import { AUTO_SHORT_TTS_HARD_MAX_TEMPO } from '../autoShortPolicy'
import type { DubbingPlan, DubbingPlanCue } from './plan'
import { selectBootstrapCues } from './durationPredictor'
import { createAutoShortItemScope, type BranchOutcome } from '../autoShortItemScope'

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
  applyTempo(inputPath: string, outputHint: string, targetDuration: number, signal: AbortSignal): Promise<{ path: string; duration: number }>
}

export interface DubbingSynthesisInput {
  plan: DubbingPlan
  language: string
  model: string
  voice?: string | null
  options?: Record<string, unknown>
  fixedTempo?: number
  localTempoDelta?: number
  predictor?: DurationPredictor
  tts: DubbingTtsAdapter
  audio: DubbingAudioAdapter
  rephrase?: (input: { cueId: string; currentText: string; targetDuration: number }, signal: AbortSignal) => Promise<readonly string[]>
  signal?: AbortSignal
  onProgress?: (completed: number, total: number, cueId: string) => void
  prefetchTts?: boolean
}

export interface DubbingSynthesisMetrics {
  rephraseCount: number
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Đã hủy tác vụ')
}

function validDuration(value: number, cueId: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Cue ${cueId} có audio không hợp lệ.`)
  return value
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
  const request: DubbingTtsRequest = {
    cueId: cue.id,
    text,
    language: input.language,
    model: input.model,
    voice: input.voice,
    options: input.options,
    speed: 1,
    cacheMode: 'prefer'
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
  const duration = validDuration(trimmed.duration, cue.id)
  return {
    cue,
    text: text.trim(),
    rawPath: result.path,
    trimmedPath: trimmed.path,
    naturalDuration: duration,
    rephrased: attempt > 0,
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
    const windows = deriveDubbingWindows(sourceCues, plan.videoDuration)
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

    const finalCues: DubbingPlanCue[] = []
    const subtitles: DubbingSubtitleCue[] = []
    const clips: Array<{ start: number; path: string }> = []
    let rephraseCount = 0
    let fitFirstPassCount = 0
    let prefetchStarted = 0
    let prefetchUsed = 0
    let prefetchDiscarded = 0
    let prefetchWaitMs = 0

    interface PendingPrefetch {
      cueId: string
      textFingerprint: string
      outcomePromise: Promise<BranchOutcome<PreparedCue>>
    }
    let pendingPrefetch: PendingPrefetch | null = null

    for (let index = 0; index < plan.cues.length; index++) {
      throwIfAborted(signal)
      const cue = plan.cues[index]
      let current = prepared.get(cue.id)
      if (!current) {
        if (pendingPrefetch && pendingPrefetch.cueId === cue.id) {
          const prefetch = pendingPrefetch
          pendingPrefetch = null
          if (prefetch.textFingerprint === cue.finalSpokenText.trim()) {
            const waitStarted = performance.now()
            const outcome = await prefetch.outcomePromise
            prefetchWaitMs += Math.max(0, performance.now() - waitStarted)
            prefetchUsed++
            if (!outcome.ok) {
              throw outcome.error
            }
            current = outcome.value
          } else {
            prefetchDiscarded++
            // The text may have changed after a rephrase or a resumed
            // checkpoint. An obsolete prefetch is deliberately drained but
            // must not turn into a failure for the replacement request.
            await prefetch.outcomePromise.catch(() => undefined)
          }
        }
        if (!current) {
          current = await prepareNaturalCue(input, cue, cue.finalSpokenText, signal, 0)
        }
        predictor.addSample(current.text, current.naturalDuration, input.language)
      }
      if (current.voice) voice = current.voice

      const window = windows[index]
      const localDelta = Math.max(0, input.localTempoDelta ?? DUBBING_LOCAL_TEMPO_DELTA)
      const localCeiling = globalTempo + localDelta
      if (current.naturalDuration / window.availableDuration > localCeiling + DUBBING_TIMING_TOLERANCE_SECONDS) {
        if (input.rephrase) {
          const candidates = await input.rephrase({
            cueId: cue.id,
            currentText: current.text,
            targetDuration: window.availableDuration * localCeiling
          }, signal)
          let candidate = chooseDubbingRephrase(
            candidates.map((text) => ({ text, predictedSeconds: predictor.estimate(text, { locale: input.language }).seconds })),
            window.availableDuration * localCeiling
          )
          if (!candidate && candidates.length > 0) {
            const ranked = candidates
              .map((text) => ({ text, predictedSeconds: predictor.estimate(text, { locale: input.language }).seconds }))
              .sort((a, b) => a.predictedSeconds - b.predictedSeconds)
            candidate = ranked[0]
          }
          if (candidate) {
            current = await prepareNaturalCue(input, cue, candidate.text, signal, 1)
            if (current.voice) voice = current.voice
            predictor.addSample(current.text, current.naturalDuration, input.language)
            rephraseCount++
          }
        }
      } else {
        fitFirstPassCount++
      }

      // Pipeline synthesis of the next cue while local audio DSP is processing the current cue
      if (input.prefetchTts && index + 1 < plan.cues.length) {
        const nextCue = plan.cues[index + 1]
        if (!prepared.has(nextCue.id) && (!pendingPrefetch || pendingPrefetch.cueId !== nextCue.id)) {
          const text = nextCue.finalSpokenText.trim()
          pendingPrefetch = {
            cueId: nextCue.id,
            textFingerprint: text,
            // A prefetch is speculative. Its failure must be observed by
            // the consumer, but an obsolete request must not abort the
            // active cue or mark the whole item scope failed.
            outcomePromise: scope.start(
              (s) => prepareNaturalCue(input, nextCue, nextCue.finalSpokenText, s, 0),
              { abortOnError: false }
            )
          }
          prefetchStarted++
        }
      }

      const maxLocalCeiling = Math.min(AUTO_SHORT_TTS_HARD_MAX_TEMPO, Math.max(localCeiling, 1.35))
      const rawRequiredTempo = current.naturalDuration / window.availableDuration
      const preferredTempo = Number(Math.min(maxLocalCeiling, Math.max(globalTempo, rawRequiredTempo)).toFixed(4))
      const nextStart = index < plan.cues.length - 1 ? plan.cues[index + 1].sourceStart : plan.videoDuration
      const safeDeadline = Math.min(
        plan.videoDuration,
        windows[index].hardEnd,
        nextStart > cue.start ? nextStart - DUBBING_PROTECTED_GAP_SECONDS : plan.videoDuration
      )
      const safeAvailable = validDuration(safeDeadline - cue.start, cue.id)
      // Include the existing emergency deadline BEFORE processing PCM. Cascading
      // two tempo filters costs another process and needlessly processes audio twice.
      const requiredTempo = current.naturalDuration / safeAvailable
      if (requiredTempo > AUTO_SHORT_TTS_HARD_MAX_TEMPO + DUBBING_TIMING_TOLERANCE_SECONDS) {
        throw new Error(`Cue ${cue.id} cần nhịp ${requiredTempo.toFixed(3)}x, vượt trần ${AUTO_SHORT_TTS_HARD_MAX_TEMPO.toFixed(2)}x; cần rephrase hoặc tách câu, không cắt lời.`)
      }
      const targetDuration = Math.min(current.naturalDuration / preferredTempo, safeAvailable)
      const requestedTempo = current.naturalDuration / targetDuration
      let finalPath = current.trimmedPath
      let actualDuration = current.naturalDuration
      if (Math.abs(requestedTempo - 1) > DUBBING_TIMING_TOLERANCE_SECONDS || actualDuration > safeAvailable) {
        const fitted = await input.audio.applyTempo(current.trimmedPath, `${cue.id}-tempo`, targetDuration, signal)
        finalPath = fitted.path
        actualDuration = validDuration(fitted.duration, cue.id)
      }
      let voiceEnd = cue.start + actualDuration
      if (voiceEnd > safeDeadline + DUBBING_TIMING_TOLERANCE_SECONDS) {
        // Retry only a measured adapter overshoot, always from the original PCM.
        const correctedTarget = Math.max(0.001, targetDuration * safeAvailable / actualDuration - 0.01)
        const corrected = await input.audio.applyTempo(current.trimmedPath, `${cue.id}-correction`, correctedTarget, signal)
        finalPath = corrected.path
        actualDuration = validDuration(corrected.duration, cue.id)
        voiceEnd = cue.start + actualDuration
      }
      if (voiceEnd > safeDeadline + DUBBING_TIMING_TOLERANCE_SECONDS) throw new Error(`Cue ${cue.id} vẫn vượt thời lượng sau khi chỉnh nhịp; không cắt lời.`)
      // Report the measured TOTAL acceleration, including an emergency fit.
      const tempo = Number((current.naturalDuration / actualDuration).toFixed(4))
      const subtitle = buildDubbingSubtitle({
        cueId: cue.id,
        sourceIndex: index,
        start: cue.start,
        end: voiceEnd,
        finalSpokenText: current.text
      })
      subtitles.push(subtitle)
      const effectiveHardEnd = cue.hardEnd
      const effectiveAvailable = effectiveHardEnd - cue.start

      finalCues.push({
        ...cue,
        hardEnd: effectiveHardEnd,
        availableDuration: effectiveAvailable,
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
        subtitles: [subtitle],
        rephrased: current.rephrased
      })
      clips.push({ start: cue.start, path: finalPath })
      input.onProgress?.(index + 1, plan.cues.length, cue.id)
    }

    const tempos = finalCues.map((cue) => cue.tempo)
    const averageTempo = tempos.reduce((sum, tempo) => sum + tempo, 0) / tempos.length
    const outputPlan: DubbingPlan = { ...plan, cues: finalCues }
    return {
      plan: outputPlan,
      clips,
      subtitles,
      voice,
      metrics: {
        rephraseCount,
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
    caughtError = error
    throw error
  } finally {
    scope.abort(caughtError)
    await scope.drain()
    scope.dispose()
  }
}
