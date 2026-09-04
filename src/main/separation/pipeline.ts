import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { AutoShortSeparationPreset, SeparatorProvider } from '../../shared/types'
import type { InstalledSeparatorModel } from './modelStore'
import { prepareSourceAudio, validateSeparatorStem, normalizeInstrumentalDuration } from './media'
import { runSeparatorEngine, type SeparatorRunResult } from './runner'

export interface SeparatorProviderState {
  mode: 'auto' | 'cpu'
  fallbackReasonCode?: string
}

export interface SeparationPipelineProgress {
  stage: 'extracting' | 'separating' | 'cpu-retry' | 'normalizing'
  percent: number
}

export type SourceSeparationResult =
  | {
      kind: 'separated'
      instrumentalPath: string
      vocalsPath: string
      requestedProvider: 'auto'
      effectiveProvider: SeparatorProvider
      fallbackReasonCode?: string
      elapsedMs: number
    }
  | { kind: 'no-audio'; warning: string }

export async function separateSourceAudio(input: {
  sourcePath: string
  videoDurationSeconds: number
  workDir: string
  ffmpegPath: string
  ffprobePath: string
  enginePath: string
  model: InstalledSeparatorModel
  preset: AutoShortSeparationPreset
  providerState: SeparatorProviderState
  signal: AbortSignal
  onProgress?: (event: SeparationPipelineProgress) => void
}): Promise<SourceSeparationResult> {
  const {
    sourcePath,
    videoDurationSeconds,
    workDir,
    ffmpegPath,
    ffprobePath,
    enginePath,
    model,
    preset,
    providerState,
    signal,
    onProgress
  } = input

  await mkdir(workDir, { recursive: true })

  // 1. Extract source audio
  onProgress?.({ stage: 'extracting', percent: 10 })
  const sourceWavPath = join(workDir, 'source.wav')
  const prepared = await prepareSourceAudio({
    sourcePath,
    outputPath: sourceWavPath,
    ffmpegPath,
    ffprobePath,
    signal
  })

  if (prepared.kind === 'no-audio') {
    return { kind: 'no-audio', warning: prepared.warning }
  }

  // 2. Separation with single CPU fallback
  const stemOutputDir = join(workDir, 'stems')
  await rm(stemOutputDir, { recursive: true, force: true }).catch(() => {})
  await mkdir(stemOutputDir, { recursive: true })

  let runResult: SeparatorRunResult
  const requestedMode = providerState.mode

  try {
    onProgress?.({ stage: 'separating', percent: 20 })
    runResult = await runSeparatorEngine({
      executablePath: enginePath,
      inputPath: prepared.wavPath,
      outputDir: stemOutputDir,
      model,
      preset,
      provider: requestedMode,
      signal,
      timeoutMs: 600_000,
      onProgress: (pct) => {
        onProgress?.({ stage: 'separating', percent: 20 + Math.floor(pct * 0.6) })
      }
    })
  } catch (err: unknown) {
    const errorObj = err as { retryable?: boolean; code?: string; message?: string }
    const isRetryable = Boolean(errorObj.retryable) ||
      (typeof errorObj.message === 'string' && /directml|provider|cuda|gpu/i.test(errorObj.message))

    if (requestedMode === 'auto' && isRetryable) {
      providerState.mode = 'cpu'
      providerState.fallbackReasonCode = errorObj.code || 'provider_execution_failed'

      onProgress?.({ stage: 'cpu-retry', percent: 20 })
      await rm(stemOutputDir, { recursive: true, force: true }).catch(() => {})
      await mkdir(stemOutputDir, { recursive: true })

      runResult = await runSeparatorEngine({
        executablePath: enginePath,
        inputPath: prepared.wavPath,
        outputDir: stemOutputDir,
        model,
        preset,
        provider: 'cpu',
        signal,
        timeoutMs: 900_000,
        onProgress: (pct) => {
          onProgress?.({ stage: 'cpu-retry', percent: 20 + Math.floor(pct * 0.6) })
        }
      })
    } else {
      throw err
    }
  }

  // 3. Stem validation
  await validateSeparatorStem({
    stemPath: runResult.vocalsPath,
    expectedDurationSeconds: prepared.durationSeconds,
    ffprobePath,
    signal
  })
  await validateSeparatorStem({
    stemPath: runResult.instrumentalPath,
    expectedDurationSeconds: prepared.durationSeconds,
    ffprobePath,
    signal
  })

  // 4. Normalize instrumental duration to match exact video duration
  onProgress?.({ stage: 'normalizing', percent: 90 })
  const normalizedInstPath = join(workDir, 'instrumental_normalized.wav')
  await normalizeInstrumentalDuration({
    inputPath: runResult.instrumentalPath,
    outputPath: normalizedInstPath,
    targetDurationSeconds: videoDurationSeconds,
    ffmpegPath,
    signal
  })

  onProgress?.({ stage: 'normalizing', percent: 100 })

  return {
    kind: 'separated',
    instrumentalPath: normalizedInstPath,
    vocalsPath: runResult.vocalsPath,
    requestedProvider: 'auto',
    effectiveProvider: runResult.provider,
    fallbackReasonCode: providerState.fallbackReasonCode,
    elapsedMs: runResult.elapsedMs
  }
}
