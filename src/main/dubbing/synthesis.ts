import { createDurationPredictor, type DurationPredictor } from './durationPredictor'
import { chooseDubbingRephrase } from './translation'
import { buildDubbingSubtitle, type DubbingSubtitleCue } from './subtitles'
import {
  DUBBING_LOCAL_TEMPO_DELTA,
  DUBBING_TIMING_TOLERANCE_SECONDS,
  deriveDubbingWindows,
  selectFixedPace,
  selectSourceAdaptivePace
} from './policy'
import type { DubbingPlan, DubbingPlanCue } from './plan'
import { selectBootstrapCues } from './durationPredictor'

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
  predictor?: DurationPredictor
  tts: DubbingTtsAdapter
  audio: DubbingAudioAdapter
  rephrase?: (input: { cueId: string; currentText: string; targetDuration: number }, signal: AbortSignal) => Promise<readonly string[]>
  signal?: AbortSignal
  onProgress?: (completed: number, total: number, cueId: string) => void
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
  const signal = input.signal || new AbortController().signal
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

  for (let index = 0; index < plan.cues.length; index++) {
    throwIfAborted(signal)
    const cue = plan.cues[index]
    let current = prepared.get(cue.id)
    if (!current) {
      current = await prepareNaturalCue(input, cue, cue.finalSpokenText, signal, 0)
      predictor.addSample(current.text, current.naturalDuration, input.language)
    }
    if (current.voice) voice = current.voice

    const window = windows[index]
    const localCeiling = globalTempo + DUBBING_LOCAL_TEMPO_DELTA
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

    const maxLocalCeiling = Math.min(1.45, Math.max(localCeiling, 1.35))
    const rawRequiredTempo = current.naturalDuration / window.availableDuration
    const tempo = Number(Math.min(maxLocalCeiling, Math.max(globalTempo, rawRequiredTempo)).toFixed(4))
    const targetDuration = current.naturalDuration / tempo
    let finalPath = current.trimmedPath
    let actualDuration = current.naturalDuration
    if (Math.abs(tempo - 1) > DUBBING_TIMING_TOLERANCE_SECONDS) {
      const fitted = await input.audio.applyTempo(current.trimmedPath, `${cue.id}-tempo`, targetDuration, signal)
      finalPath = fitted.path
      actualDuration = validDuration(fitted.duration, cue.id)
    }
    let voiceEnd = cue.start + actualDuration
    const nextStart = index < plan.cues.length - 1 ? plan.cues[index + 1].sourceStart : plan.videoDuration
    const safeDeadline = Math.min(plan.videoDuration, nextStart > cue.start ? nextStart - 0.02 : plan.videoDuration)

    if (voiceEnd > safeDeadline) {
      // Emergency elastic fit so voice strictly finishes before nextStart without colliding or shifting start anchor
      const emergencyAvailable = Math.max(0.08, safeDeadline - cue.start)
      if (emergencyAvailable < actualDuration) {
        const emergencyFitted = await input.audio.applyTempo(finalPath, `${cue.id}-emergency`, emergencyAvailable, signal)
        finalPath = emergencyFitted.path
        actualDuration = validDuration(emergencyFitted.duration, cue.id)
        voiceEnd = cue.start + actualDuration
      }
    }
    const subtitle = buildDubbingSubtitle({
      cueId: cue.id,
      sourceIndex: index,
      start: cue.start,
      end: voiceEnd,
      finalSpokenText: current.text
    })
    subtitles.push(subtitle)
    const effectiveHardEnd = Math.max(cue.hardEnd, voiceEnd)
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
      degraded: finalCues.some((cue) => Math.abs(cue.localTempoAdjustment) > 0.0001)
    }
  }
}
