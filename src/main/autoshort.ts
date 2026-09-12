import { app, dialog } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { resolveFfmpeg, installFfmpeg } from './deps'
import {
  isAutoShortWhisperEngineReady,
  calculateSourceAdaptiveTempo,
  deriveAutoShortCueWindows,
  planAutoShortVoiceTimeline,
  segmentScheduledDubbingSubtitles,
  resolveAutoShortWhisperLanguage,
  selectCompatibleAutoShortTtsModel,
  validateAutoShortTtsModel,
  validateAutoShortTimelineSync,
  validateVoiceAudioCompleteness,
  validateRenderedOutputMedia,
  type RenderedMediaProbeInfo,
  type AutoShortVoiceCueInput,
  type AutoShortDubbingUnit,
  AUTO_SHORT_TTS_MAX_TEMPO,
  AUTO_SHORT_TTS_HARD_MAX_TEMPO,
  AUTO_SHORT_TTS_TAIL_MARGIN_SECONDS,
  buildAutoShortTtsTrimFilter
} from './autoShortPolicy'
import { buildSemanticGroups, joinGroupText, type SemanticGroup } from './semanticGrouping'
import { createDurationPredictor, durationProfileKey } from './dubbingDuration'
import { loadDurationProfile, saveDurationProfile } from './dubbing/profileStore'
import { applyDubbingTranslations, dubbingSpeakingDurations } from './dubbing/translation'
import { buildTtsCacheKey, getTtsCacheStore } from './dubbing/cache'
import { synthesizeDubbingPlan } from './dubbing/synthesis'
import type { DubbingTimeMap } from './dubbing/timeMap'
import { buildStageKey, canonicalJson, hashFileSha256 } from './autoShortStageKeys'
import { DUBBING_MAX_EARLY_START_SECONDS, DUBBING_PLAN_VERSION, buildDubbingPlan as buildPlan, groupDubbingPlanForSpeech, validateDubbingPlan, type DubbingPlan } from './dubbing/plan'
import { huongDan, stripOuterQuotes } from './translate-shared'
import { resolveTranslationSourceLanguage } from './localTranslatePolicy'
import { debugRaw, logInfo, logWarn, logError, errLabel } from './logger'
import {
  installCudaPack,
  installWhisperEngine,
  installWhisperModel,
  transcribeAudio,
  whisperCudaProbe,
  whisperCudaStatus,
  whisperEngineStatus,
  whisperModelStatus
} from './whisper'
import { cancelOcr, installOcrEngine, ocrEngineStatus, ocrVideo, ocrVideoWithVisualTimeline } from './ocr'
import { detectGpu } from './gpu'
import { createGeminiTranslationAdapter, loadKey as loadGeminiKey } from './gemini'
import { createOpenAiTranslationAdapter, loadKey as loadOpenAiKey } from './openai'
import { createLocalTranslationAdapter, loadLocalKey, checkLocalTranslateKey } from './localTranslate'
import { generateSpeech, generateVoiceClone, getTtsModels, checkTtsServerHealth } from './tts'
import { cancelBurn, probeBurnMedia, burnAutoShort } from './burn'
import { writeTimedOcrBlurMask } from './ocrMask'
import { createAutoShortItemProcessor } from './autoShortItemCoordinator'
import { composeAutoShortBackgroundAudio } from './autoShortBackgroundAudio'
import { validateAutoShortMusicTrack } from './autoShortMusicLibrary'
import { sanitizeAutoShortAuditError } from './autoShortAudit'
import { cancelVideo2x } from './video2x'
import { terminateProcessTree, terminateTrackedProcessTrees, trackChildProcess } from './processTree'
import { parseSrt, serializeSrt, type SubtitleCue } from '../shared/subtitles'
import { mapTranslationsStrict } from './translation/response'
import { parseRephraseResponse, recoverBatchRephraseResponse } from './translation/response'
import { translateWithAdapter, type TranslationAdapter } from './translation/orchestrator'
import type { TranslationAssessment, TranslationInput, TranslationItem } from '../shared/translation'
import type { TranslationBudgetSnapshot } from './translation/budget'
import { runAutoShortQueue } from './autoShortQueueRunner'
import { AutoShortResourceManager, getGlobalResourceManager } from './autoShortResourceManager'
import { getGlobalAutoShortDiskBudget, type DiskReservation } from './autoShortDiskBudget'
import { AutoShortTelemetryJobBudget } from './autoShortTelemetry'
import { resolveExecutionPolicy, CONSERVATIVE_POLICY, type AutoShortExecutionPolicy } from './autoShortExecutionPolicy'
import { validateAutoShortStartRequest } from '../shared/autoShortContract'
import { readAutoShortOverlayImage } from './autoShortOverlays'
import {
  deriveCanonicalDisplayGeometry,
  normalizedRegionToDisplayPixels,
  type CanonicalDisplayGeometry
} from './canonicalDisplayGeometry'
import { fuseWhisperAndOcr, clampAlignedCueTimeline } from '../shared/autoShortAlignment'
import { isAutomaticOcrBlur, isSttnRemoval, autoShortNeedsOcr } from '../shared/autoShortOcrBlur'
import { getSttnReadiness, installSttnDependencies } from './inpainting/assets'
import { runSttnRemoval } from './inpainting/runner'
import { probeFfmpegOcrMaskCapability } from './ffmpegOcrMaskProbe'
import { resolveSeparatorEngine, resolveFfprobe } from './runtimeResolver'
import { probeRuntimeExecutable } from './runtimeProbes'
import { resolveInstalledSeparatorModel } from './separation/modelStore'
import { probeSeparatorModel } from './separation/runner'
import { fetchSeparatorModelManifest, installSeparatorModel } from './separation/modelInstaller'
import { fetchRuntimeManifest, downloadRuntimeEngineFromManifest } from './runtimeInstaller'
import { modelIdForSeparationPreset, separationPresetConfig, type SeparationPresetConfig } from '../shared/autoShortSeparation'
import { loadSeparatorReleaseStatus, separatorFeatureEnabled } from './separation/releaseGate'
import { validateSeparatorStem } from './separation/media'
import { separateSourceAudio, type SeparatorProviderState } from './separation/pipeline'
import { requiredSeparationWorkspaceBytes } from './separation/disk'
import { composeAutoShortNarratedAudio } from './autoShortNarratedAudio'
import type { InstalledSeparatorModel } from './separation/modelStore'
import { reserveVideoTitleOutputDir } from './videoTitle'
import { createAutoShortArtifactCache, type ArtifactCache } from './autoShortArtifactCache'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { createAutoShortBatchStore, type AutoShortBatchStore } from './autoShortBatchStore'
import {
  isSafeBatchId,
  recoverInterruptedBatch,
  resumeCandidateIds,
  type BatchItemRecord,
  type BatchItemState,
  type BatchSnapshot
} from '../shared/autoShortBatchJournal'
import { buildRephraseMessages } from './translation/prompts'
import { resolveTranslationReadiness } from './translation/language'
import type {
  AutoShortBatchStatusResult,
  AutoShortDependencyConfig,
  AutoShortSeparationPreset,
  AutoShortSeparationReadiness,
  SeparatorProvider
} from '../shared/types'
import {
  DEFAULT_AI_SERVER_URL,
  type AutoShortBatchResult,
  AutoShortDependencyProgress,
  AutoShortDependencyStatus,
  AutoShortReadiness,
  AutoShortBlurRegion,
  AutoShortConfig,
  AutoShortEvent,
  AutoShortItemResult,
  AutoShortNormalizedRegion,
  AutoShortProgress,
  AutoShortRequestSpan,
  AutoShortQueueItemInput,
  AutoShortStartRequest,
  AutoShortResumeRequest,
  AutoShortSttnPreviewResult,
  AutoShortSttnPreviewProgress,
  AlignedCue,
  BurnReq,
  DichKeyStatus,
  TtsModelInfo,
  TtsServerHealth,
  WhisperProgress
} from '../shared/types'

export interface PreparedAutoShortSeparation {
  enginePath: string
  engineVersion: string
  engineProtocol: 'separator-engine/1'
  model: InstalledSeparatorModel
  preset: AutoShortSeparationPreset
  presetConfig: SeparationPresetConfig
}

interface AutoShortJob {
  id: string
  request: AutoShortStartRequest
  controller: AbortController
  emit: (event: AutoShortEvent) => void
  done: Promise<AutoShortBatchResult>
  cancelled: boolean
  shutdownRequested?: boolean
  batchStore: AutoShortBatchStore
  batchSnapshot?: BatchSnapshot
  batchWrite: Promise<void>
  ttsCapabilities?: Awaited<ReturnType<typeof getTtsModels>>
  ttsCapabilitiesUrl?: string
  separation?: PreparedAutoShortSeparation
  separationProviderState: SeparatorProviderState
  resourceManager?: AutoShortResourceManager
  artifactCache?: ArtifactCache
  telemetryBudget?: AutoShortTelemetryJobBudget
}

let activeJob: AutoShortJob | null = null
let sharedArtifactCache: ArtifactCache | null = null

function getAutoShortBatchStore(): AutoShortBatchStore {
  return createAutoShortBatchStore(join(app.getPath('userData'), 'autoshort-batches-v1'))
}

function batchConfigDigest(config: AutoShortConfig): string {
  return createHash('sha256').update(canonicalJson(config)).digest('hex')
}

function itemConfigDigest(config: AutoShortConfig, item: AutoShortQueueItemInput): string {
  return createHash('sha256').update(canonicalJson({ config, temporalEdit: item.temporalEdit })).digest('hex')
}

async function initializeBatchJournal(job: AutoShortJob): Promise<void> {
  const now = new Date().toISOString()
  const items: BatchItemRecord[] = []
  for (const [ordinal, item] of job.request.items.entries()) {
    items.push({
      itemId: item.id,
      inputPath: item.filePath,
      inputDigest: await hashFileSha256(item.filePath, job.controller.signal),
      configDigest: itemConfigDigest(job.request.config, item),
      ...(item.temporalEdit ? { temporalEdit: item.temporalEdit } : {}),
      ordinal,
      attempt: 0,
      state: 'pending'
    })
  }
  const snapshot: BatchSnapshot = {
    schemaVersion: 1,
    jobId: job.id,
    revision: 0,
    createdAtUtc: now,
    updatedAtUtc: now,
    items
  }
  await job.batchStore.save(snapshot, null)
  job.batchSnapshot = snapshot
}

async function updateBatchItem(
  job: AutoShortJob,
  itemId: string,
  update: (item: BatchItemRecord) => BatchItemRecord
): Promise<void> {
  const operation = job.batchWrite.then(async () => {
    const current = job.batchSnapshot
    if (!current) throw new Error('Batch journal chưa được khởi tạo.')
    const index = current.items.findIndex((item) => item.itemId === itemId)
    if (index < 0) throw new Error('Batch journal không có item cần cập nhật.')
    const items = current.items.map((item, itemIndex) => itemIndex === index ? update({ ...item }) : item)
    const next: BatchSnapshot = {
      ...current,
      revision: current.revision + 1,
      updatedAtUtc: new Date().toISOString(),
      items
    }
    await job.batchStore.save(next, current.revision)
    job.batchSnapshot = next
  })
  job.batchWrite = operation.catch(() => undefined)
  await operation
}

async function markBatchRunning(
  job: AutoShortJob,
  itemId: string,
  attempt: 1 | 2,
  reservedOutputDir: string,
  artifactDir: string
): Promise<void> {
  await updateBatchItem(job, itemId, (item) => ({
    ...item,
    attempt,
    state: 'running',
    reservedOutputDir,
    artifactDir,
    outputReceipt: undefined,
    failure: undefined
  }))
}

async function checkpointTerminalResult(job: AutoShortJob, result: AutoShortItemResult): Promise<AutoShortItemResult> {
  let finalResult = result
  let state: BatchItemState
  let outputReceipt: BatchItemRecord['outputReceipt']
  let failure: BatchItemRecord['failure']
  if (result.status === 'done' && result.outputPath) {
    try {
      const [info, sha256, meta] = await Promise.all([
        stat(result.outputPath),
        hashFileSha256(result.outputPath),
        probeBurnMedia(result.outputPath)
      ])
      const durationSeconds = meta.videoDurationSeconds ?? meta.videoDuration ?? meta.giay
      if (!info.isFile() || info.size <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        throw new Error('Biên nhận video đầu ra không hợp lệ.')
      }
      state = result.translationAssessment?.disposition === 'needs-review' ? 'needs-review' : 'succeeded'
      outputReceipt = { path: result.outputPath, sha256, bytes: info.size, durationSeconds }
    } catch (error) {
      state = 'needs-review'
      failure = { code: 'output_receipt_invalid', message: errLabel(error), recoverable: true }
      finalResult = { ...result, status: 'error', error: `Video đã render nhưng chưa xác minh được đầu ra: ${errLabel(error)}` }
    }
  } else if (result.status === 'cancelled') {
    state = job.shutdownRequested ? 'interrupted' : 'cancelled'
    failure = {
      code: job.shutdownRequested ? 'process_interrupted' : 'user_cancelled',
      message: result.error || (job.shutdownRequested ? 'Ứng dụng đã dừng.' : 'Người dùng đã hủy.'),
      recoverable: Boolean(job.shutdownRequested)
    }
  } else {
    state = result.translationAssessment?.disposition === 'needs-review' ? 'needs-review' : 'failed'
    failure = { code: result.recovery?.kind || 'processing_failed', message: result.error || 'Xử lý thất bại.', recoverable: result.recovery?.retryable === true }
  }
  await updateBatchItem(job, result.itemId, (item) => ({
    ...item,
    state,
    ...(outputReceipt ? { outputReceipt } : { outputReceipt: undefined }),
    ...(failure ? { failure } : { failure: undefined })
  }))
  return finalResult
}

interface TranslationRetryEntry {
  itemId: string
  filePath: string
  checkpointFile: string
  checkpointRoot: string
  expectedIdentity: string
  generation: number
  preparedGeneration?: number
  inFlight: boolean
}

// The registry is app-owned: renderer requests select an item ID and opaque
// identity from this map; they never supply a filesystem path or checkpoint
// payload. Entries are kept for the process lifetime so a completed job can be
// explicitly retried without making the normal queue auto-retry itself.
const translationRetryRegistry = new Map<string, TranslationRetryEntry>()

function getAutoShortArtifactCache(): ArtifactCache {
  if (!sharedArtifactCache) {
    sharedArtifactCache = createAutoShortArtifactCache({
      rootDir: join(app.getPath('userData'), 'autoshort-artifact-cache-v1'),
      stageQuotas: {
        asr: 512 * 1024 * 1024,
        translation: 512 * 1024 * 1024,
        'visual-ocr': 1024 * 1024 * 1024,
        'trim-pcm': 1024 * 1024 * 1024
      },
      stageTtlMs: {
        sttn: 7 * 24 * 60 * 60 * 1000
      }
    })
  }
  return sharedArtifactCache
}

export const AUTO_SHORT_CHECKPOINT_VERSION = 5
export const AUTO_SHORT_TRIM_PCM_CACHE_POLICY_VERSION = 'autoshort-tts-trim-v1'

export function buildAutoShortTrimPcmCacheKey(input: {
  rawWavSha256: string
  ffmpegRevision: string
  trimPolicyVersion?: string
  sampleRate?: number
  channels?: number
  sampleFormat?: string
}): string {
  if (!/^[a-f0-9]{64}$/iu.test(input.rawWavSha256)) {
    throw new Error('Trim PCM cache yêu cầu SHA-256 WAV hợp lệ.')
  }
  if (!input.ffmpegRevision.trim()) throw new Error('Trim PCM cache yêu cầu revision FFmpeg.')
  const sampleRate = input.sampleRate ?? 44_100
  const channels = input.channels ?? 2
  const sampleFormat = input.sampleFormat ?? 's16'
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || !Number.isSafeInteger(channels) || channels <= 0 || !sampleFormat.trim()) {
    throw new Error('Trim PCM cache có format audio không hợp lệ.')
  }
  return buildStageKey('trim-pcm', {
    cacheRevision: input.trimPolicyVersion || AUTO_SHORT_TRIM_PCM_CACHE_POLICY_VERSION,
    rawWavSha256: input.rawWavSha256.toLowerCase(),
    ffmpegRevision: input.ffmpegRevision,
    sampleRate,
    channels,
    sampleFormat
  })
}

export function buildAutoShortCheckpointFingerprint(
  filePath: string,
  inputInfo: { size: number; mtimeMs: number },
  config: AutoShortConfig,
  separation?: PreparedAutoShortSeparation,
  sourceDigest?: string,
  temporalEdit?: AutoShortQueueItemInput['temporalEdit']
): string {
  return createHash('sha256').update(stableJson({
    version: AUTO_SHORT_CHECKPOINT_VERSION,
    // Translation prompt/parser revisions belong to the translation identity
    // below. Keeping them out of this outer job fingerprint lets a prompt
    // upgrade reuse an already verified source transcript safely.
    input: {
      filePath,
      size: inputInfo.size,
      mtimeMs: inputInfo.mtimeMs,
      // Metadata is retained for diagnostics; content identity comes from
      // the streamed digest so same-size replacements cannot reuse a job.
      sourceDigest: sourceDigest || 'missing-source-digest'
    },
    temporalEdit,
    subtitleMethod: config.subtitleMethod,
    whisperModel: config.whisperModel,
    whisperDevice: config.whisperDevice,
    whisperLanguage: config.whisperLanguage,
    ocrRegion: config.ocrRegion,
    translateTarget: config.translateTarget,
    translateProvider: config.translateProvider,
    translateServerUrl: config.translateServerUrl,
    translationGuidance: config.translationGuidance,
    paceMode: config.paceMode || 'source-adaptive',
    ttsServerUrl: config.ttsServerUrl,
    ttsModel: config.ttsModel,
    ttsVoice: config.ttsVoice,
    ttsLanguage: config.ttsLanguage,
    ttsSpeed: config.ttsSpeed,
    ttsOptions: config.ttsOptions,
    ttsRefAudioPath: config.ttsRefAudioPath,
    ttsRefTranscript: config.ttsRefTranscript,
    audioMode: config.audioMode,
    separation: separation ? {
      engineVersion: separation.engineVersion,
      engineProtocol: separation.engineProtocol,
      modelId: separation.model.id,
      modelSha256: separation.model.spec.model.sha256,
      catalogSchema: 1,
      preset: separation.preset,
      overlap: separation.presetConfig.overlap,
      batch: 1,
      audio: { codec: 'pcm_s16le', sampleRate: 44100, channels: 2 }
    } : null
  })).digest('hex')
}

function spawnAutoShortChild(command: string, args: string[], options?: Parameters<typeof spawn>[2]): ChildProcess {
  return trackChildProcess(spawn(command, args, options || {}))
}

function needsWhisper(method: AutoShortConfig['subtitleMethod']): boolean {
  return method !== 'ocr'
}

export function needsCuda(config: Pick<AutoShortConfig, 'subtitleMethod' | 'whisperDevice'>): boolean {
  return config.whisperDevice === 'cuda' && config.subtitleMethod !== 'ocr'
}

export function resolveAutoShortTtsLanguage(config: AutoShortConfig, detectedLanguage?: string | null): string {
  const explicit = config.ttsLanguage?.trim()
  if (explicit && explicit !== 'auto') return explicit
  if (config.translateTarget !== 'none') return config.translateTarget.trim()
  return resolveTranslationSourceLanguage(config.whisperLanguage, detectedLanguage)
}

function dependency(
  id: AutoShortDependencyStatus['id'],
  label: string,
  required: boolean,
  ready: boolean,
  downloadBytes?: number,
  message?: string
): AutoShortDependencyStatus {
  return { id, label, required, ready, downloadBytes, message }
}

export interface AutoShortReadinessHooks {
  getSttnReadiness?: typeof getSttnReadiness
  resolveFfmpeg?: typeof resolveFfmpeg
  ocrEngineStatus?: typeof ocrEngineStatus
  probeFfmpegOcrMaskCapability?: typeof probeFfmpegOcrMaskCapability
  whisperEngineStatus?: typeof whisperEngineStatus
  whisperModelStatus?: typeof whisperModelStatus
  resolveSeparatorEngine?: typeof resolveSeparatorEngine
  probeRuntimeExecutable?: typeof probeRuntimeExecutable
  resolveInstalledSeparatorModel?: typeof resolveInstalledSeparatorModel
  probeSeparatorModel?: typeof probeSeparatorModel
  fetchSeparatorModelManifest?: typeof fetchSeparatorModelManifest
  fetchRuntimeManifest?: typeof fetchRuntimeManifest
  detectGpu?: typeof detectGpu
}

export interface AutoShortInstallHooks {
  installSttnDependencies?: typeof installSttnDependencies
  installFfmpeg?: typeof installFfmpeg
  installOcrEngine?: typeof installOcrEngine
  downloadRuntimeEngine?: typeof downloadRuntimeEngineFromManifest
  installSeparatorModel?: typeof installSeparatorModel
  readinessHooks?: AutoShortReadinessHooks
}

/**
 * A single source of truth for the Auto Short dependency modal and the batch
 * preflight. It checks the current Electron userData folder, so dev, packaged
 * and migrated profiles cannot accidentally borrow one another's readiness.
 */
export async function getAutoShortReadiness(
  config: AutoShortDependencyConfig,
  hooks: AutoShortReadinessHooks = {}
): Promise<AutoShortReadiness> {
  const getFfmpeg = hooks.resolveFfmpeg || resolveFfmpeg
  const getOcr = hooks.ocrEngineStatus || ocrEngineStatus
  const probeFfmpegMask = hooks.probeFfmpegOcrMaskCapability || probeFfmpegOcrMaskCapability
  const getWhisperEngine = hooks.whisperEngineStatus || whisperEngineStatus
  const getWhisperModel = hooks.whisperModelStatus || whisperModelStatus
  const resolveSepEngine = hooks.resolveSeparatorEngine || resolveSeparatorEngine
  const probeRuntimeExe = hooks.probeRuntimeExecutable || probeRuntimeExecutable
  const resolveInstalledModel = hooks.resolveInstalledSeparatorModel || resolveInstalledSeparatorModel
  const probeSepModel = hooks.probeSeparatorModel || probeSeparatorModel
  const fetchSepModelManifest = hooks.fetchSeparatorModelManifest || fetchSeparatorModelManifest
  const fetchRtManifest = hooks.fetchRuntimeManifest || fetchRuntimeManifest
  const getGpu = hooks.detectGpu || detectGpu

  const automaticBlur = isAutomaticOcrBlur(config)
  const sttnRemoval = isSttnRemoval(config)
  const visualOcrRequired = automaticBlur || sttnRemoval
  const needsOcr = autoShortNeedsOcr(config)
  const useWhisper = needsWhisper(config.subtitleMethod)
  const useCuda = needsCuda(config)
  const useSeparation = config.audioMode === 'separate-vocals'
  const preset: AutoShortSeparationPreset = config.separationPreset || 'balanced'
  const modelId = modelIdForSeparationPreset(preset)

  const [ff, engine, model, cuda, ocr, gpu, sepEnginePath, sepInstalledModel] = await Promise.all([
    getFfmpeg(),
    useWhisper ? getWhisperEngine() : Promise.resolve(null),
    useWhisper ? getWhisperModel(config.whisperModel || 'base') : Promise.resolve(undefined),
    useCuda ? whisperCudaStatus() : Promise.resolve(null),
    needsOcr ? getOcr() : Promise.resolve(null),
    useCuda || useSeparation ? getGpu() : Promise.resolve(null),
    useSeparation ? resolveSepEngine() : Promise.resolve(null),
    useSeparation ? resolveInstalledModel(modelId) : Promise.resolve(null)
  ])

  let ffmpegMaskHealthy = false
  let ffmpegMaskMessage: string | undefined
  if (ff) {
    if (automaticBlur) {
      try {
        const maskProbe = await probeFfmpegMask(ff)
        ffmpegMaskHealthy = Boolean(maskProbe.healthy && maskProbe.features?.includes('ocr-mask-v1'))
        if (!ffmpegMaskHealthy) {
          ffmpegMaskMessage = 'FFmpeg hiện tại chưa qua kiểm tra mặt nạ OCR.'
        }
      } catch {
        ffmpegMaskHealthy = false
        ffmpegMaskMessage = 'FFmpeg hiện tại chưa qua kiểm tra mặt nạ OCR.'
      }
    } else {
      ffmpegMaskHealthy = true
    }
  }

  const ffmpegReady = ff !== null && (!automaticBlur || ffmpegMaskHealthy)
  const ffmpegMessage = !ff
    ? 'Chưa cài đặt FFmpeg.'
    : !ffmpegReady
      ? (ffmpegMaskMessage || 'FFmpeg hiện tại chưa qua kiểm tra mặt nạ OCR.')
      : undefined

  const cudaProbe = useCuda && engine?.has && engine.healthy && cuda?.has
    ? await whisperCudaProbe(config.whisperModel || 'base', 'cuda')
    : null
  const gpuReady = Boolean(useCuda && gpu?.hasNvidia && gpu.canAccelerate)
  const cudaReady = Boolean(useCuda && cuda?.has && cudaProbe?.ready)
  const dependencies: AutoShortDependencyStatus[] = []

  dependencies.push(dependency(
    'ffmpeg',
    'FFmpeg',
    true,
    ffmpegReady,
    75_000_000,
    ffmpegMessage
  ))

  if (useWhisper) {
    const engineReady = isAutoShortWhisperEngineReady(engine)
    dependencies.push(dependency(
      'whisper-engine',
      'Whisper engine',
      true,
      engineReady,
      undefined,
      !engine?.has
        ? 'Chưa cài Faster-Whisper engine.'
        : engine.healthy === false
          ? 'Engine không khởi động được.'
          : !engineReady
            ? 'Engine không trả về protocol Faster-Whisper hợp lệ.'
            : undefined
    ))
    dependencies.push(dependency(
      'whisper-model',
      `Model Whisper ${config.whisperModel || 'base'}`,
      true,
      Boolean(model?.complete || model?.installed),
      model?.downloadBytes,
      model?.message
    ))
  }
  if (useCuda) {
    dependencies.push(dependency(
      'whisper-cuda',
      'Gói CUDA Faster-Whisper',
      gpuReady,
      cudaReady,
      1_100_000_000,
      !gpuReady
        ? gpu?.reason || 'Không tìm thấy GPU NVIDIA tương thích.'
        : !cuda?.has
          ? 'Chưa tải gói CUDA.'
        : cudaProbe?.message || (gpuReady ? 'CUDA chưa được engine xác nhận.' : 'Không tìm thấy GPU NVIDIA tương thích.')
    ))
  }
  if (needsOcr) {
    const ocrVisualReady = Boolean(
      ocr?.has &&
      ocr.healthy &&
      (!visualOcrRequired || ocr.features?.includes('visual-cues-v1'))
    )
    const ocrMessage = !ocr?.has
      ? 'Chưa cài OCR engine.'
      : !ocr.healthy
        ? (ocr.message || 'OCR engine probe thất bại.')
        : visualOcrRequired && !ocr.features?.includes('visual-cues-v1')
          ? 'OCR engine cần cập nhật để tạo vùng làm mờ theo chữ.'
          : undefined

    dependencies.push(dependency(
      'ocr-engine',
      'OCR engine',
      true,
      ocrVisualReady,
      230_000_000,
      ocrMessage
    ))
  }

  let separationReadiness: AutoShortSeparationReadiness | undefined
  if (useSeparation) {
    const releaseStatus = loadSeparatorReleaseStatus()
    let engineHealthy = false
    let engineMessage: string | undefined
    if (sepEnginePath) {
      const probe = await probeRuntimeExe('separator-engine', sepEnginePath)
      engineHealthy = probe.healthy
      if (!probe.healthy) engineMessage = probe.message || 'Separator engine probe thất bại.'
    } else {
      engineMessage = 'Chưa cài đặt Separator engine.'
    }

    let sepEngineDownloadBytes: number | undefined
    if (!engineHealthy) {
      try {
        const manifest = await fetchRtManifest()
        sepEngineDownloadBytes = manifest?.assets?.['separator-engine']?.bytes
      } catch {
        // offline
      }
    }

    const modelReady = sepInstalledModel !== null
    let modelDownloadBytes: number | undefined
    let modelMessage: string | undefined
    if (!modelReady) {
      modelMessage = 'Chưa tải model tách nhạc.'
      try {
        const modelManifest = await fetchSepModelManifest()
        modelDownloadBytes = modelManifest?.models?.[modelId]?.archiveBytes
      } catch {
        // offline
      }
    }

    const sepEngineDep = dependency(
      'separator-engine',
      'Separator engine',
      true,
      engineHealthy,
      sepEngineDownloadBytes,
      engineMessage
    )
    const sepModelDep = dependency(
      'separator-model',
      `Model tách nhạc ${modelId}`,
      true,
      modelReady,
      modelDownloadBytes,
      modelMessage
    )
    dependencies.push(sepEngineDep, sepModelDep)

    if (engineHealthy && modelReady && sepEnginePath && sepInstalledModel) {
      let effectiveProvider: SeparatorProvider | null = null
      let sepProbeMessage: string | undefined

      const dmlProbe = await probeSepModel({
        executablePath: sepEnginePath,
        model: sepInstalledModel,
        provider: 'directml'
      })

      if (dmlProbe.ready) {
        effectiveProvider = 'directml'
      } else {
        const cpuProbe = await probeSepModel({
          executablePath: sepEnginePath,
          model: sepInstalledModel,
          provider: 'cpu'
        })
        if (cpuProbe.ready) {
          effectiveProvider = 'cpu'
          sepProbeMessage = dmlProbe.message ? `DirectML không khả dụng, sử dụng CPU (${dmlProbe.message})` : undefined
        } else {
          effectiveProvider = null
          sepProbeMessage = `Cả DirectML và CPU đều không khả dụng: ${dmlProbe.message || ''} / ${cpuProbe.message || ''}`.trim()
          sepEngineDep.ready = false
          sepEngineDep.message = sepProbeMessage
        }
      }

      let releaseTier: 'verified' | 'beta' | 'development' = 'development'
      if (effectiveProvider === 'cpu') {
        const v = releaseStatus.vendors.cpu
        releaseTier = v === 'verified' ? 'verified' : v === 'beta' ? 'beta' : 'development'
      } else if (effectiveProvider === 'directml') {
        const vendor = gpu?.hasNvidia ? 'nvidia' : 'amd'
        const v = releaseStatus.vendors[vendor]
        releaseTier = v === 'verified' ? 'verified' : v === 'beta' ? 'beta' : 'development'
      }

      separationReadiness = {
        preset,
        modelId,
        providerPolicy: 'auto',
        effectiveProvider,
        offlineReady: true,
        releaseTier,
        message: sepProbeMessage
      }
    } else {
      separationReadiness = {
        preset,
        modelId,
        providerPolicy: 'auto',
        effectiveProvider: null,
        offlineReady: modelReady,
        releaseTier: 'development',
        message: engineMessage || modelMessage
      }
    }
  }

  if (sttnRemoval) dependencies.push(...await (hooks.getSttnReadiness || getSttnReadiness)())
  const missing = dependencies.filter((item) => item.required && !item.ready)
  const dependencyReady = (id: AutoShortDependencyStatus['id']): boolean => {
    const item = dependencies.find((candidate) => candidate.id === id)
    return item ? item.ready : true
  }
  // Dependency readiness is also used by the configuration modal, where the
  // translation/TTS fields are intentionally absent. Treat absent fields as
  // "not requested" instead of accidentally making an optional stage
  // required during dependency installation.
  const translationRequested = config.translateTarget !== undefined && config.translateTarget !== 'none'
  const ttsRequested = config.ttsEnabled === true
  const stageCapabilities = [
    {
      stage: 'asr' as const,
      required: useWhisper,
      support: !useWhisper ? 'supported' as const : dependencyReady('whisper-engine') && dependencyReady('whisper-model') ? 'supported' as const : 'unsupported' as const,
      qualified: false,
      reason: !useWhisper ? 'Không dùng ASR trong cấu hình này.' : dependencyReady('whisper-engine') && dependencyReady('whisper-model') ? 'Engine/model đã sẵn sàng; chất lượng theo corpus chưa được chứng nhận.' : 'Thiếu engine hoặc model Whisper.'
    },
    {
      stage: 'ocr' as const,
      required: needsOcr,
      support: !needsOcr ? 'supported' as const : dependencyReady('ocr-engine') ? 'supported' as const : 'unsupported' as const,
      qualified: false,
      reason: !needsOcr ? 'Không dùng OCR trong cấu hình này.' : dependencyReady('ocr-engine') ? 'OCR engine đã sẵn sàng; chất lượng theo corpus chưa được chứng nhận.' : 'Thiếu OCR engine.'
    },
    {
      stage: 'translation' as const,
      required: translationRequested,
      support: !translationRequested ? 'supported' as const : 'unknown' as const,
      qualified: false,
      reason: !translationRequested ? 'Không yêu cầu dịch trong cấu hình dependency.' : 'Provider đã chọn nhưng locale/model chưa có qualification live tương ứng.'
    },
    {
      stage: 'tts' as const,
      required: ttsRequested,
      support: !ttsRequested ? 'supported' as const : 'unknown' as const,
      qualified: false,
      reason: !ttsRequested ? 'Không dùng TTS trong cấu hình này.' : 'TTS capability phụ thuộc model/server và cần kiểm tra riêng.'
    },
    {
      stage: 'render' as const,
      required: true,
      support: ffmpegReady ? 'supported' as const : 'unsupported' as const,
      qualified: false,
      reason: ffmpegReady ? 'FFmpeg đã sẵn sàng; media/font qualification vẫn tách riêng.' : (ffmpegMessage || 'FFmpeg chưa sẵn sàng.')
    }
  ]
  const stageReadiness = resolveTranslationReadiness(stageCapabilities)
  const blockingStageMessage = stageReadiness.blocking.length > 0
    ? `Cần chuẩn bị thêm: ${stageReadiness.blocking.map((stage) => stage.stage).join(', ')}.`
    : undefined
  const message = missing.length
    ? `Cần chuẩn bị: ${missing.map((item) => item.label).join(', ')}.`
    : blockingStageMessage
  return {
    ready: missing.length === 0 && stageReadiness.canStart,
    method: config.subtitleMethod,
    requestedDevice: useWhisper ? (useCuda ? 'cuda' : 'cpu') : null,
    effectiveDevice: useWhisper ? (useCuda && cudaReady ? 'cuda' : 'cpu') : null,
    dependencies,
    model,
    separation: separationReadiness,
    stageCapabilities,
    message
  }
}

export async function installAutoShortDependencies(
  config: AutoShortDependencyConfig,
  onProgress: (progress: AutoShortDependencyProgress) => void,
  signal?: AbortSignal,
  hooks: AutoShortInstallHooks = {}
): Promise<AutoShortReadiness> {
  const emit = (
    id: AutoShortDependencyStatus['id'],
    phase: AutoShortDependencyProgress['phase'],
    percent: number,
    message: string,
    receivedBytes?: number,
    totalBytes?: number
  ): void => onProgress({ id, phase, percent, message, receivedBytes, totalBytes })

  let readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  const isMissing = (id: AutoShortDependencyStatus['id']): boolean =>
    readiness.dependencies.some((item) => item.id === id && item.required && !item.ready)
  const aborted = (): void => {
    if (signal?.aborted) throw new Error('Đã hủy tải dependency.')
  }

  const doInstallFfmpeg = hooks.installFfmpeg || installFfmpeg
  const doInstallOcr = hooks.installOcrEngine || installOcrEngine
  const automaticBlur = isAutomaticOcrBlur(config)

  if (isMissing('ffmpeg')) {
    aborted()
    emit('ffmpeg', 'downloading', 0, 'Đang tải gói FFmpeg…')
    await doInstallFfmpeg((p) => {
      emit('ffmpeg', 'downloading', p.percent < 0 ? 0 : p.percent, p.message)
    }, automaticBlur ? { forceCapabilityReinstall: 'ocr-mask-v1' } : undefined)
    emit('ffmpeg', 'verifying', 100, 'Đang kiểm tra FFmpeg…')
    readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  }
  if (isMissing('whisper-engine')) {
    aborted()
    emit('whisper-engine', 'downloading', 0, 'Đang tải Whisper engine…')
    await installWhisperEngine((percent) => emit('whisper-engine', 'downloading', percent, 'Đang tải Whisper engine…'))
    emit('whisper-engine', 'verifying', 100, 'Đang kiểm tra Whisper engine…')
    readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  }
  if (isMissing('whisper-model')) {
    aborted()
    const total = readiness.model?.downloadBytes
    await installWhisperModel(config.whisperModel || 'base', (progress) =>
      emit('whisper-model', 'downloading', progress.percent, progress.message, Math.round((progress.percent / 100) * (total || 1)), total))
    emit('whisper-model', 'verifying', 100, 'Đang kiểm tra model Whisper…')
    readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  }
  if (isMissing('whisper-cuda')) {
    aborted()
    const gpu = await detectGpu()
    if (!gpu.hasNvidia || !gpu.canAccelerate) throw new Error(gpu.reason || 'GPU không hỗ trợ Fast-Whisper.')
    emit('whisper-cuda', 'downloading', 0, 'Đang tải gói CUDA Fast-Whisper…')
    await installCudaPack((percent) => emit('whisper-cuda', 'downloading', percent, 'Đang tải gói CUDA Fast-Whisper…'))
    emit('whisper-cuda', 'verifying', 100, 'Đang kiểm tra CUDA Fast-Whisper…')
    readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  }
  if (isMissing('ocr-engine')) {
    aborted()
    emit('ocr-engine', 'downloading', 0, 'Đang tải OCR engine…')
    await doInstallOcr((percent) => emit('ocr-engine', 'downloading', percent, 'Đang tải OCR engine…'))
    emit('ocr-engine', 'verifying', 100, 'Đang kiểm tra OCR engine…')
    readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  }
  if (isMissing('separator-engine')) {
    aborted()
    emit('separator-engine', 'downloading', 0, 'Đang tải Separator engine…')
    const downloadEngine = hooks.downloadRuntimeEngine || downloadRuntimeEngineFromManifest
    await downloadEngine('separator-engine', (percent, message) => {
      emit('separator-engine', 'downloading', percent, message)
    })
    emit('separator-engine', 'verifying', 100, 'Đang kiểm tra Separator engine…')
    readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  }
  if (isMissing('separator-model')) {
    aborted()
    const preset = config.separationPreset || 'balanced'
    const modelId = modelIdForSeparationPreset(preset)
    emit('separator-model', 'downloading', 0, `Đang tải model tách nhạc ${modelId}…`)
    const installModel = hooks.installSeparatorModel || installSeparatorModel
    await installModel(
      modelId,
      (p) => emit('separator-model', p.phase, p.percent, p.message, p.receivedBytes, p.totalBytes),
      signal
    )
    emit('separator-model', 'verifying', 100, 'Đang kiểm tra model tách nhạc…')
    readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  }
  if (isSttnRemoval(config) && (isMissing('sttn-engine') || isMissing('sttn-model'))) {
    aborted()
    await (hooks.installSttnDependencies || installSttnDependencies)(onProgress, signal)
    readiness = await getAutoShortReadiness(config, hooks.readinessHooks)
  }
  if (!readiness.ready) {
    if (automaticBlur) {
      throw new Error('Sau khi cài đặt FFmpeg/OCR engine, môi trường vẫn chưa hỗ trợ tính năng làm mờ chữ tự động.')
    }
    throw new Error(readiness.message || 'Dependency chưa sẵn sàng.')
  }
  readiness.dependencies.forEach((item) => emit(item.id, 'done', 100, `${item.label} đã sẵn sàng.`))
  return readiness
}

function safeEmit(job: AutoShortJob, event: AutoShortEvent): void {
  try {
    job.emit(event)
  } catch (error) {
    logWarn(`[AutoShort] Không gửi được event: ${errLabel(error)}`)
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Đã hủy tác vụ')
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /hủy tác vụ/i.test(error.message))
}

export function normalizedToPixels(
  region: AutoShortNormalizedRegion | null | undefined,
  geometry: CanonicalDisplayGeometry
) {
  if (!region) return undefined
  return normalizedRegionToDisplayPixels(region, geometry)
}

export function blurRegionsToPixels(
  regions: AutoShortBlurRegion[],
  geometry: CanonicalDisplayGeometry
) {
  return regions.flatMap((region) => {
    try {
      const pixels = normalizedToPixels(region, geometry)
      return pixels ? [{ ...pixels, id: region.id, color: region.color }] : []
    } catch {
      return []
    }
  })
}

export function alignedFromSrt(cues: SubtitleCue[], source: AlignedCue['source']): AlignedCue[] {
  return cues.map((cue) => ({
    id: cue.id,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    source,
    timingQuality: source === 'ocr' ? 'ocr' : 'cue'
  }))
}

export async function readWhisperAlignedCues(srtPath: string, alignmentPath: string | null | undefined): Promise<AlignedCue[]> {
  const cues = parseSrt(await readFile(srtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
  const result = alignedFromSrt(cues, 'whisper')
  if (!alignmentPath || !(await fileExists(alignmentPath))) return result
  try {
    const raw = JSON.parse(await readFile(alignmentPath, 'utf8')) as {
      segments?: Array<Record<string, unknown>>
      cues?: Array<Record<string, unknown>>
    }
    const aligned = Array.isArray(raw.segments)
      ? raw.segments
      : Array.isArray(raw.cues)
        ? raw.cues
        : []
    for (const cue of result) {
      const match = aligned.find((candidate) =>
        (Math.abs(Number(candidate.start) - cue.start) < 0.08 && Math.abs(Number(candidate.end) - cue.end) < 0.08) ||
        (typeof candidate.id === 'string' && candidate.id === cue.id) ||
        (typeof candidate.id === 'number' && `cue-${candidate.id}` === cue.id)
      )
      const words = Array.isArray(match?.words)
        ? match.words.flatMap((word) => {
            const text = typeof word.text === 'string' ? word.text.trim() : ''
            const start = Number(word.start)
            const end = Number(word.end)
            return text && Number.isFinite(start) && Number.isFinite(end) && end > start
              ? [{ text, start, end, probability: typeof word.probability === 'number' ? word.probability : null }]
              : []
          })
        : []
      if (words.length) {
        cue.words = words
        cue.timingQuality = 'word'
      }
    }
  } catch (error) {
    logWarn(`[AutoShort] Không đọc được alignment Whisper: ${errLabel(error)}`)
  }
  return result
}

export function serializeAlignedCues(cues: AlignedCue[]): string {
  return serializeSrt(cues.map((cue, sourceIndex) => ({
    id: cue.id,
    sourceIndex,
    start: cue.start,
    end: cue.end,
    text: cue.text
  })))
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function uniqueOutputName(outputDir: string, sourcePath: string): Promise<string> {
  const base = basename(sourcePath).replace(/\.[^.]+$/, '')
  const stem = `${base}-phude`
  let index = 1
  while (true) {
    const suffix = index === 1 ? '' : `-${index}`
    const candidate = `${stem}${suffix}.mp4`
    if (!(await fileExists(join(outputDir, candidate)))) return candidate
    index += 1
  }
}

function emitProgress(
  job: AutoShortJob,
  item: AutoShortQueueItemInput,
  status: AutoShortProgress['itemStatus'],
  percent: number,
  message: string,
  index: number,
  total: number,
  outputPath?: string,
  error?: string
): void {
  safeEmit(job, {
    type: 'item-progress',
    jobId: job.id,
     taskId: item.id,
    itemId: item.id,
    itemStatus: status,
    itemPercent: Math.max(0, Math.min(100, Math.round(percent))),
    itemMessage: message,
    batchIndex: index + 1,
    batchTotal: total,
    outputPath,
    error
  })
}

function emitTerminal(
  job: AutoShortJob,
  item: AutoShortQueueItemInput,
  index: number,
  total: number,
  result: AutoShortItemResult
): void {
  if (result.status === 'done') {
    safeEmit(job, { type: 'item-done', jobId: job.id, itemId: item.id, batchIndex: index + 1, batchTotal: total, result: result as AutoShortItemResult & { status: 'done' } })
  } else if (result.status === 'cancelled') {
    safeEmit(job, { type: 'item-cancelled', jobId: job.id, itemId: item.id, batchIndex: index + 1, batchTotal: total, result: result as AutoShortItemResult & { status: 'cancelled' } })
  } else {
    safeEmit(job, { type: 'item-error', jobId: job.id, itemId: item.id, batchIndex: index + 1, batchTotal: total, result: result as AutoShortItemResult & { status: 'error' } })
  }
}

async function probeDuration(ffmpeg: string, input: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const ffprobe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    const child = spawnAutoShortChild(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1', input], { windowsHide: true })
    let output = ''
    let abortError: Error | null = null
    const abort = (): void => {
      abortError = new Error('Đã hủy tác vụ')
      terminateProcessTree(child)
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(abortError || error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (abortError) reject(abortError)
      else if (code !== 0) reject(new Error('Không thể đọc thời lượng audio'))
      else resolve(Number(/duration=([\d.]+)/.exec(output)?.[1]) || 0)
    })
  })
}

function tempoFilters(actual: number, target: number): string[] {
  if (!(actual > 0) || !(target > 0)) return []
  let ratio = actual / target
  const filters: string[] = []
  while (ratio > 2) {
    filters.push('atempo=2')
    ratio /= 2
  }
  while (ratio < 0.5) {
    filters.push('atempo=0.5')
    ratio /= 0.5
  }
  if (Math.abs(ratio - 1) > 0.01) filters.push(`atempo=${ratio.toFixed(5)}`)
  return filters
}

async function runAudioFilter(ffmpeg: string, input: string, output: string, filter: string, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const child = spawnAutoShortChild(ffmpeg, ['-y', '-i', input, '-vn', '-ac', '2', '-ar', '44100', '-filter:a', filter, output], { windowsHide: true })
    let abortError: Error | null = null
    const abort = (): void => {
      abortError = new Error('Đã hủy tác vụ')
      terminateProcessTree(child)
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(abortError || error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (abortError) reject(abortError)
      else if (code === 0) resolve()
      else reject(new Error('Không thể chuẩn hóa voice'))
    })
  })
}

async function trimVoiceClip(ffmpeg: string, input: string, output: string, signal: AbortSignal): Promise<number> {
  // Trim outer silence while preserving trailing phoneme decay, breath, and a safe tail margin.
  // The spoken content is never cut to fit a cue.
  await runAudioFilter(
    ffmpeg,
    input,
    output,
    buildAutoShortTtsTrimFilter(),
    signal
  )
  return probeDuration(ffmpeg, output, signal)
}

async function speedUpVoiceClip(
  ffmpeg: string,
  input: string,
  output: string,
  actualDuration: number,
  targetDuration: number,
  signal: AbortSignal
): Promise<number> {
  // The timeline planner has already selected a safe shared tempo. Do not
  // silently clamp it back to the old 1.25x limit here, otherwise a voice can
  // still spill past its source cue after the planner has proved it fits.
  const effectiveTarget = targetDuration
  await runAudioFilter(ffmpeg, input, output, [...tempoFilters(actualDuration, effectiveTarget), 'asetpts=PTS-STARTPTS'].join(','), signal)
  return probeDuration(ffmpeg, output, signal)
}

export async function stitchAudioTimeline(
  clips: Array<{ start: number; path: string }>,
  videoDuration: number,
  workDir: string,
  outputPath: string,
  signal: AbortSignal
): Promise<void> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg || clips.length === 0) throw new Error('Thiếu FFmpeg hoặc không có voice để ghép')
  throwIfAborted(signal)

  const args = ['-y']
  const filters: string[] = []
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]
    args.push('-i', clip.path)
    const delay = Math.max(0, Math.round(clip.start * 1000))
    filters.push(`[${i}:a]aresample=44100:async=1,aformat=channel_layouts=stereo:sample_rates=44100,asetpts=PTS-STARTPTS,adelay=${delay}|${delay}[a${i}]`)
  }
  const inputs = clips.map((_, i) => `[a${i}]`).join('')
  const duration = Math.max(videoDuration, 0.1).toFixed(3)
  if (clips.length === 1) {
    filters.push(`[a0]apad=whole_dur=${duration},atrim=duration=${duration},alimiter=limit=-1dB:attack=5:release=50[a_mix]`)
  } else {
    filters.push(`${inputs}amix=inputs=${clips.length}:duration=longest:dropout_transition=2:normalize=0,apad=whole_dur=${duration},atrim=duration=${duration},alimiter=limit=-1dB:attack=5:release=50[a_mix]`)
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[a_mix]', '-ac', '2', '-ar', '44100', outputPath)

  await new Promise<void>((resolve, reject) => {
    const child = spawnAutoShortChild(ffmpeg, args, { windowsHide: true })
    let abortError: Error | null = null
    const abort = (): void => {
      abortError = new Error('Đã hủy tác vụ')
      terminateProcessTree(child)
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(abortError || error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (abortError) reject(abortError)
      else if (code === 0) resolve()
      else reject(new Error('Không thể ghép timeline voice'))
    })
  })
}

async function requestTranslation(
  config: AutoShortConfig,
  input: string,
  output: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
  sourceLanguage?: string | null,
  onBatch?: (items: readonly { id: string; text: string }[], batchIndex: number) => Promise<void> | void,
  onBudget?: (snapshot: TranslationBudgetSnapshot) => Promise<void> | void,
  resumeItems: readonly TranslationItem[] = [],
  restoredBudget?: TranslationBudgetSnapshot,
  videoDuration?: number
): Promise<{ assessment?: TranslationAssessment; budget?: TranslationBudgetSnapshot }> {
  // AutoShort uses one provider-neutral scheduler. Provider modules only make
  // one request and expose the canonical prompt/response contract; this
  // function owns source identity, resume merging, validation and publication.
  const sourceResult = parseSrt(await readFile(input, 'utf8'))
  if (sourceResult.warnings.length > 0) {
    throw new Error(`SRT nguồn có dòng không hợp lệ; dừng để tránh mất nội dung (${sourceResult.warnings[0]?.message || 'parser warning'}).`)
  }
  const source = sourceResult.cues.filter((cue) => cue.text.trim())
  if (source.length === 0) throw new Error('SRT nguồn không có câu hợp lệ.')
  const sourceIds = new Set(source.map((cue) => cue.id.trim()))
  const reusableById = new Map<string, TranslationItem>()
  for (const item of resumeItems) {
    const id = item.id.trim()
    const text = item.text.trim()
    if (!id || !text || !sourceIds.has(id) || reusableById.has(id)) continue
    reusableById.set(id, { id, text })
  }
  const reusable = source
    .map((cue) => reusableById.get(cue.id.trim()))
    .filter((item): item is TranslationItem => Boolean(item))
  const pendingSource = source.filter((cue) => !reusableById.has(cue.id.trim()))
  // The TTS branch deliberately uses `mode: 'dubbing'`; subtitle-only jobs
  // stay on the lighter subtitle contract and never inherit dubbing rules.
  const mode = config.ttsEnabled ? 'dubbing' as const : 'subtitle' as const
  const targetLocale = config.translateTarget.trim()
  const sourceLocale = sourceLanguage?.trim() || 'auto'

  const toTranslationCue = (cue: SubtitleCue, index: number) => ({
    id: cue.id.trim(),
    sourceIndex: Number.isInteger(cue.sourceIndex) ? cue.sourceIndex : index,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    groupId: `cue-${Number.isInteger(cue.sourceIndex) ? cue.sourceIndex : index}`
  })
  const fullTranslationCues = source.map(toTranslationCue)
  if (mode === 'dubbing') {
    const durations = dubbingSpeakingDurations(fullTranslationCues, videoDuration ?? Math.max(...source.map((cue) => cue.end)) + 0.5)
    fullTranslationCues.forEach((cue, index) => Object.assign(cue, { speakingDuration: durations[index] }))
  }
  const translationInput: TranslationInput = {
    sourceLanguage: sourceLocale,
    targetLocale,
    mode,
    // Keep the complete source in the planner. Resume filtering happens by
    // canonical ID inside the orchestrator, so batch IDs and per-batch quota
    // remain stable when only a tail or an interior cue is missing.
    cues: fullTranslationCues,
    contextBefore: [],
    contextAfter: [],
    glossary: config.translationGuidance?.glossary.map(entry => ({ ...entry })) || [],
    synopsis: config.translationGuidance?.synopsis
  }

  const publish = async (items: readonly TranslationItem[], budget?: TranslationBudgetSnapshot): Promise<SubtitleCue[]> => {
    const mapped = mapTranslationsStrict(source, items)
    try {
      assertTranslatedLanguageShift(source, mapped, sourceLanguage, config.translateTarget)
    } catch (error) {
      const assessment: TranslationAssessment = {
        version: 'translation-assessment-v2',
        disposition: 'needs-review',
        issues: [{
          code: 'language-suspect',
          severity: 'error',
          confidence: 'certain',
          cueIds: source.map((cue) => cue.id),
          message: error instanceof Error ? error.message : 'Bản dịch vẫn ở hệ chữ nguồn; cần kiểm tra trước khi tạo voice.'
        }],
        languageEvidence: 'suspect'
      }
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        translationAssessment: assessment,
        ...(budget ? { translationBudget: budget } : {})
      })
    }
    const temporary = `${output}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, serializeSrt(mapped), 'utf8')
      await rename(temporary, output)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
    return mapped
  }

  if (pendingSource.length === 0) {
    onProgress(source.length, source.length)
    await publish(reusable)
    return {}
  }

  throwIfAborted(signal)
  let adapter: TranslationAdapter
  if (config.translateProvider === 'local') {
    adapter = createLocalTranslationAdapter(await loadLocalKey(), config.translateServerUrl)
  } else if (config.translateProvider === 'openai') {
    const key = await loadOpenAiKey()
    if (!key.trim()) throw new Error('Chưa có API key OpenAI.')
    adapter = await createOpenAiTranslationAdapter(key)
  } else {
    const key = await loadGeminiKey()
    if (!key.trim()) throw new Error('Chưa có API key Gemini.')
    adapter = await createGeminiTranslationAdapter(undefined, signal)
  }
  throwIfAborted(signal)

  const completedIds = new Set(reusable.map((item) => item.id))
  let callbackIndex = 0
  const run = await translateWithAdapter(translationInput, adapter, signal, {
    restoredBudget,
    resumeItems: reusable,
    beforeDispatch: onBudget,
    onBatch: async (_batchId, batch, budget) => {
      await onBudget?.(budget)
      for (const item of batch.items) completedIds.add(item.id)
      onProgress(completedIds.size, source.length)
      await onBatch?.(batch.items, callbackIndex++)
    }
  })
  throwIfAborted(signal)
  if (run.assessment.disposition === 'needs-review') {
    const firstIssue = run.assessment.issues.find((item) => item.severity === 'error')
    throw Object.assign(new Error(firstIssue?.message || 'Bản dịch không vượt qua kiểm tra; không xuất bản kết quả một phần.'), {
      translationAssessment: run.assessment,
      translationBudget: run.budget
    })
  }
  const mergedById = new Map<string, TranslationItem>(reusable.map((item) => [item.id, item]))
  for (const item of run.items) mergedById.set(item.id, item)
  const merged = source
    .map((cue) => mergedById.get(cue.id.trim()))
    .filter((item): item is TranslationItem => Boolean(item))
  if (merged.length !== source.length) throw new Error('SRT dịch không đầy đủ; không xuất bản kết quả một phần.')
  await publish(merged, run.budget)
  return { assessment: run.assessment, budget: run.budget }
}

function scriptMatcher(script: string): RegExp | null {
  switch (script) {
    case 'Latn': return /\p{Script=Latin}/u
    case 'Hans':
    case 'Hant':
    case 'Hani': return /\p{Script=Han}/u
    case 'Cyrl': return /\p{Script=Cyrillic}/u
    case 'Arab': return /\p{Script=Arabic}/u
    case 'Deva': return /\p{Script=Devanagari}/u
    case 'Hang': return /\p{Script=Hangul}/u
    case 'Thai': return /\p{Script=Thai}/u
    case 'Grek': return /\p{Script=Greek}/u
    default: return null
  }
}

function scriptCount(text: string, matcher: RegExp): number {
  return Array.from(text).filter((character) => matcher.test(character)).length
}

function letterCount(text: string): number {
  return Array.from(text).filter((character) => /\p{L}/u.test(character)).length
}

/** Fail before TTS when a provider clearly returned source-script text. */
function assertTranslatedLanguageShift(
  source: readonly SubtitleCue[],
  translated: readonly SubtitleCue[],
  sourceLanguage?: string | null,
  targetLanguage?: string
): void {
  if (!sourceLanguage || !targetLanguage || targetLanguage === 'none') return
  try {
    const sourceScript = new Intl.Locale(sourceLanguage).maximize().script
    const targetScript = new Intl.Locale(targetLanguage).maximize().script
    if (!sourceScript || !targetScript || sourceScript === targetScript) return
    const sourceMatcher = scriptMatcher(sourceScript)
    const targetMatcher = scriptMatcher(targetScript)
    if (!sourceMatcher || !targetMatcher) return

    const sourceText = source.map((cue) => cue.text).join(' ')
    const translatedText = translated.map((cue) => cue.text).join(' ')
    const sourceLetters = letterCount(sourceText)
    const translatedLetters = letterCount(translatedText)
    const sourceScriptLetters = scriptCount(sourceText, sourceMatcher)
    const translatedSourceScriptLetters = scriptCount(translatedText, sourceMatcher)
    const translatedTargetScriptLetters = scriptCount(translatedText, targetMatcher)
    if (
      sourceLetters >= 12 &&
      translatedLetters >= 12 &&
      sourceScriptLetters / sourceLetters >= 0.65 &&
      translatedSourceScriptLetters >= Math.max(12, translatedTargetScriptLetters * 1.5)
    ) {
      throw new Error(`Bản dịch vẫn chủ yếu ở hệ chữ nguồn (${sourceScript}), không đạt ngôn ngữ đích ${targetLanguage}; dừng trước khi sinh voice.`)
    }
  } catch (error) {
    if (error instanceof Error && /Bản dịch vẫn chủ yếu/u.test(error.message)) throw error
    // Unknown/unsupported locale tags should not block a valid translation.
  }
}
export async function translateStrict(
  config: AutoShortConfig,
  input: string,
  output: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
  sourceLanguage?: string | null,
  onBatch?: (items: readonly { id: string; text: string }[], batchIndex: number) => Promise<void> | void,
  onBudget?: (snapshot: TranslationBudgetSnapshot) => Promise<void> | void,
  resumeItems: readonly TranslationItem[] = [],
  restoredBudget?: TranslationBudgetSnapshot,
  videoDuration?: number
): Promise<{ assessment?: TranslationAssessment; budget?: TranslationBudgetSnapshot }> {
  const result = await requestTranslation(config, input, output, onProgress, signal, sourceLanguage, onBatch, onBudget, resumeItems, restoredBudget, videoDuration)
  const source = parseSrt(await readFile(input, 'utf8')).cues
  const translated = parseSrt(await readFile(output, 'utf8')).cues
  // Never infer identity by position or silently copy source text. A
  // cardinality/identity mismatch is a recoverable translation failure and
  // must leave the previous output untouched for the caller to repair.
  const mapped = mapTranslationsStrict(source, translated).map((cue, index) => ({
    ...cue,
    // These fields are copied only from the already validated source array;
    // provider output is still matched by ID inside mapTranslationsStrict.
    id: source[index].id,
    sourceIndex: source[index].sourceIndex,
    start: source[index].start,
    end: source[index].end
  }))
  await writeFile(output, serializeSrt(mapped), 'utf8')
  return result
}

export interface AutoShortCueDiagnostic {
  cueIndex: number
  cueId: string
  sourceStart: number
  sourceEnd: number
  sourceText: string
  translatedText: string
  naturalDuration: number
  tempo: number
  plannedVoiceStart: number
  plannedVoiceEnd: number
  renderSubtitleStart: number
  renderSubtitleEnd: number
  semanticOverflowMs: number
  rephraseAttempted: boolean
  degraded: boolean
  cueStart: number
  cueEnd: number
  rawPath?: string
  rawDuration?: number
  trimmedPath?: string
  trimmedDuration?: number
  tempoPath?: string
  tempoDuration?: number
  voiceStart: number
  voiceEnd: number
  availableDuration: number
  plannedDuration: number
  plannedStart?: number
  plannedEnd?: number
  slackBefore: number
  slackAfter: number
  tailMarginSeconds: number
  cutOffDetected: boolean
  overlap: boolean
}

export interface AutoShortArtifactEntry {
  source: string
  name: string
}

function safeArtifactSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '_').slice(0, 48) || 'item'
}

function spokenTextWithoutSpeakerLabel(text: string): string {
  const clean = text.trim()
  const withoutLabel = clean.replace(/^\s*\[SPEAKER_\d+\]\s*/iu, '').trim()
  return stripOuterQuotes(withoutLabel || clean)
}

export async function preserveAutoShortArtifacts(
  artifactDir: string,
  entries: readonly AutoShortArtifactEntry[],
  manifest: Record<string, unknown>
): Promise<string | undefined> {
  const copied: string[] = []
  for (const entry of entries) {
    if (!(await fileExists(entry.source))) continue
    try {
      await mkdir(artifactDir, { recursive: true })
      await copyFile(entry.source, join(artifactDir, entry.name))
      copied.push(entry.name)
    } catch (error) {
      logWarn(`[AutoShort] Không lưu được artifact ${entry.name}: ${errLabel(error)}`)
    }
  }
  if (copied.length === 0) return undefined
  try {
    await writeFile(join(artifactDir, 'manifest.json'), JSON.stringify({ ...manifest, files: copied }, null, 2), 'utf8')
  } catch (error) {
    logWarn(`[AutoShort] Không lưu được manifest artifact: ${errLabel(error)}`)
  }
  return artifactDir
}

export function extractRephrasedTexts(rawContent: string, cueId: string): string[] {
  const parsed = parseRephraseResponse(rawContent, cueId)
  // A rephrase is a supplemental candidate, never a lossy recovery path.
  // Keep no candidate when the provider left any unparsed/structural content;
  // otherwise a valid-looking first line could silently replace the complete
  // translation while the continuation is lost.
  if (!parsed.complete || parsed.issues.some((item) => item.severity === 'error')) {
    logWarn(`[AutoShort:rephrase] cue=${safeArtifactSegment(cueId)} outcome=invalid-response issues=${[...new Set(parsed.issues.map((item) => item.code))].join(',')}`)
    return []
  }
  const items = parsed.items
  const normalizedId = cueId.trim().toLowerCase()
  const found = items
    .filter((item) => {
      const id = item.id.trim().toLowerCase()
      return id === normalizedId || id.startsWith(`${normalizedId}:`) || id.startsWith(`${normalizedId}-`)
    })
    .map((item) => spokenTextWithoutSpeakerLabel(item.text))
    .filter(Boolean)
  if (found.length > 0) return [...new Set(found)].slice(0, 3)

  // Free-form prose is intentionally rejected. Returning it as a candidate
  // would let an explanatory model response replace the grounded translation.
  return []
}

export async function rephraseDubbingCue(
  config: AutoShortConfig,
  cueId: string,
  currentText: string,
  targetDuration: number,
  targetLanguage: string,
  sourceLanguage?: string | null,
  signal?: AbortSignal,
  sourceText?: string,
  contextBefore: string[] = [],
  contextAfter: string[] = [],
  timing?: { measuredDuration: number; maxDuration: number },
  recoveryAttempt: 1 | 2 = 1
): Promise<string[]> {
  try {
    // The shared rephrase contract explicitly says: giữ nguyên chủ thể, đối tượng, số liệu và phủ định; không thêm đại từ hoặc tác nhân không xuất hiện. This call only supplies source evidence and
    // never lets timing override those semantic anchors.
    const messages = buildRephraseMessages({
      targetLocale: targetLanguage,
      cues: [{ cueId, sourceText, currentText, targetDuration, contextBefore, contextAfter }].map((cue) => ({
        id: cue.cueId,
        sourceText: cue.sourceText,
        currentText: cue.currentText,
        targetDuration: cue.targetDuration,
        ...timing,
        contextBefore: cue.contextBefore,
        contextAfter: cue.contextAfter,
        recoveryAttempt
      }))
    })
    const systemPrompt = messages[0].content
    const userPrompt = messages[1].content

    if (config.translateProvider === 'local') {
      const localKey = await loadLocalKey()
      const serverUrl = config.translateServerUrl || DEFAULT_AI_SERVER_URL
      const base = serverUrl.replace(/\/+$/u, '')
      const content = await getGlobalResourceManager().withLease(['server-inference'], signal, async () => {
        const requestSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
          : AbortSignal.timeout(90_000)
        const res = await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(localKey ? { Authorization: `Bearer ${localKey}` } : {})
          },
          body: JSON.stringify({
            model: 'llm-default',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.3
          }),
          signal: requestSignal
        })
        if (!res.ok) {
          logWarn(`[AutoShort:rephrase] cue=${safeArtifactSegment(cueId)} outcome=http-error status=${res.status}`)
          return null
        }
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> }
        if (data.choices?.[0]?.finish_reason === 'length') {
          logWarn(`[AutoShort:rephrase] cue=${safeArtifactSegment(cueId)} outcome=invalid-response issues=truncated-output`)
          return null
        }
        return data.choices?.[0]?.message?.content?.trim() || null
      })
      if (!content) {
        logWarn(`[AutoShort:rephrase] cue=${safeArtifactSegment(cueId)} outcome=no-content`)
        return []
      }
      return extractRephrasedTexts(content, cueId)
    } else if (config.translateProvider === 'gemini') {
      const { rephraseGeminiCue } = await import('./gemini')
      const text = await getGlobalResourceManager().withLease(['external-title'], signal, () => rephraseGeminiCue(systemPrompt, userPrompt, signal))
      if (!text) return []
      return extractRephrasedTexts(text, cueId)
    } else if (config.translateProvider === 'openai') {
      const { rephraseOpenaiCue } = await import('./openai')
      const text = await getGlobalResourceManager().withLease(['external-title'], signal, () => rephraseOpenaiCue(systemPrompt, userPrompt, signal))
      if (!text) return []
      return extractRephrasedTexts(text, cueId)
    }
  } catch (error) {
    logWarn(`[AutoShort] Rephrase cue ${cueId} không thành công: ${errLabel(error)}`)
  }
  return []
}

interface DubbingRephraseRequest {
  cueId: string
  currentText: string
  targetDuration: number
  measuredDuration?: number
  maxDuration?: number
  sourceText?: string
  contextBefore?: string[]
  contextAfter?: string[]
  recoveryAttempt?: 1 | 2
}

/**
 * Rephrase all predictor outliers in one supplemental translation pass. The
 * local server is commonly CPU-bound, so issuing one request per cue can
 * serialize dozens of expensive calls and make the job appear stuck.
 */
export async function rephraseDubbingCues(
  config: AutoShortConfig,
  requests: readonly DubbingRephraseRequest[],
  targetLanguage: string,
  sourceLanguage?: string | null,
  signal?: AbortSignal
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>()
  if (requests.length === 0) return result

  if (config.translateProvider !== 'local') {
    for (const request of requests) {
      result.set(request.cueId, await rephraseDubbingCue(
        config,
        request.cueId,
        request.currentText,
        request.targetDuration,
        targetLanguage,
        sourceLanguage,
        signal,
        request.sourceText,
        request.contextBefore || [],
        request.contextAfter || [],
        request.measuredDuration != null && request.maxDuration != null
          ? { measuredDuration: request.measuredDuration, maxDuration: request.maxDuration }
          : undefined,
        request.recoveryAttempt || 1
      ))
    }
    return result
  }

  try {
    const localKey = await loadLocalKey()
    const base = (config.translateServerUrl || DEFAULT_AI_SERVER_URL).replace(/\/+$/u, '')
    const deadline = AbortSignal.timeout(90_000)
    const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
    const isMeasuredOverflow = requests.some((request) => Number.isFinite(request.measuredDuration))
    const requestBatch = async (batch: readonly DubbingRephraseRequest[], repair: boolean): Promise<void> => {
      const messages = buildRephraseMessages({
        targetLocale: targetLanguage,
        cues: batch.map((request) => ({
          id: request.cueId,
          sourceText: request.sourceText,
          currentText: request.currentText,
          targetDuration: request.targetDuration,
          measuredDuration: request.measuredDuration,
          maxDuration: request.maxDuration,
          contextBefore: request.contextBefore || [],
          contextAfter: request.contextAfter || [],
          recoveryAttempt: request.recoveryAttempt
        }))
      })
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(localKey ? { Authorization: `Bearer ${localKey}` } : {}) },
        body: JSON.stringify({ model: 'llm-default', messages, temperature: 0.3 }),
        signal: requestSignal
      })
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        throw new Error(`Rephrase HTTP ${res.status}`)
      }
      const data = await res.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> }
      const content = data.choices?.[0]?.message?.content?.trim() || ''
      const parsed = recoverBatchRephraseResponse(content, batch.map((request) => request.cueId))
      const truncated = data.choices?.[0]?.finish_reason === 'length'
      const usable = truncated ? [] : parsed.items
      if (!parsed.complete || !usable.length) {
        const badLabels = [...new Set(parsed.issues.flatMap((item) => item.cueIds))].slice(0, 5).map((id) => safeArtifactSegment(id).slice(0, 80))
        logWarn(`[AutoShort:rephrase] phase=${isMeasuredOverflow ? 'batch-rephrase' : 'preflight'} repair=${repair} cues=${batch.length} outcome=${usable.length ? 'partial-response' : 'invalid-response'} issues=${truncated ? 'truncated-output' : [...new Set(parsed.issues.map((item) => item.code))].join(',') || 'empty-response'} badLabels=${badLabels.join(',')} usableCandidates=${usable.length}`)
      }
      for (const request of batch) {
        const candidates = usable
          .filter((item) => item.id.startsWith(`${request.cueId}:`))
          .map((item) => spokenTextWithoutSpeakerLabel(item.text)).filter(Boolean)
        if (candidates.length) result.set(request.cueId, candidates)
      }
    }
    await getGlobalResourceManager().withLease(['server-inference'], requestSignal, async () => {
      const initialBatchLimit = isMeasuredOverflow ? 8 : requests.length
      for (let offset = 0; offset < requests.length; offset += initialBatchLimit) {
        requestSignal.throwIfAborted()
        await requestBatch(requests.slice(offset, offset + initialBatchLimit), false)
      }
      // One repair pass for missing/ambiguous cues only, within the original
      // deadline. Already usable IDs never re-enter the request or get replaced.
      const missing = requests.filter((request) => !result.has(request.cueId))
      if (missing.length) logInfo(`[AutoShort:rephrase] phase=${isMeasuredOverflow ? 'batch-rephrase' : 'preflight'} outcome=repair-missing cues=${missing.length} kept=${result.size}`)
      for (let offset = 0; offset < missing.length; offset += 8) {
        requestSignal.throwIfAborted()
        await requestBatch(missing.slice(offset, offset + 8), true)
      }
    })
  } catch (error) {
    if (isAbortError(error) && signal?.aborted) throw error
    logWarn(`[AutoShort] Batch rephrase ${requests.length} cue không thành công: ${errLabel(error)}`)
  }
  return result
}

function stableJson(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

async function buildAutoShortTtsCacheKey(input: {
  serverUrl?: string
  text: string
  language: string
  model: string
  voice?: string
  speed: number
  options?: Record<string, unknown>
  referenceAudioPath?: string
  referenceTranscript?: string
}): Promise<string> {
  let referenceStat: { size: number; mtimeMs: number } | null = null
  if (input.referenceAudioPath) {
    const info = await stat(input.referenceAudioPath).catch(() => null)
    if (info) referenceStat = { size: info.size, mtimeMs: info.mtimeMs }
  }
  return createHash('sha256').update(stableJson({
    version: 1,
    serverUrl: input.serverUrl || '',
    text: input.text,
    language: input.language,
    model: input.model,
    voice: input.voice || '',
    speed: input.speed,
    options: input.options || {},
    referenceAudioPath: input.referenceAudioPath || '',
    referenceTranscript: input.referenceTranscript || '',
    referenceStat
  })).digest('hex')
}

function chooseShortestPredictedRephrase(
  candidates: readonly string[],
  estimate: (text: string) => number,
  maxSeconds: number
): string | null {
  const unique = [...new Set(candidates.map((text) => text.trim()).filter(Boolean))]
  const ranked = unique
    .map((text) => ({ text, seconds: estimate(text) }))
    .sort((a, b) => a.seconds - b.seconds)
  return ranked.find((item) => item.seconds <= maxSeconds)?.text || ranked[0]?.text || null
}

async function legacySynthesizeVoice(
  job: AutoShortJob,
  item: AutoShortQueueItemInput,
  config: AutoShortConfig,
  cues: SubtitleCue[],
  sourceCues: SubtitleCue[],
  workDir: string,
  videoDuration: number,
  index: number,
  total: number,
  detectedLanguage?: string | null
): Promise<{
  path: string
  clips: Array<{ start: number; path: string }>
  cues: SubtitleCue[]
  dubbingUnits: AutoShortDubbingUnit[]
  wordTimings?: Array<{ start: number; end: number; words: Array<{ text: string; start: number; end: number; probability?: number | null }> }>
  count: number
  voice?: string
  language: string
  tempo: number
  averageTempo: number
  maxTempo: number
  degraded: boolean
  rephraseCount: number
  overflowCount: number
  batchCount: number
  batchCueCount: number
  rescueAttemptCount: number
  rescueAcceptedCount: number
  phaseWaitMs: number
  splitCount: number
  paceMode: 'source-adaptive' | 'fixed'
  predictorSamples: number
  fitFirstPassRatio: number
  predictorResidualP90: number
  prefetchStarted: number
  prefetchUsed: number
  prefetchDiscarded: number
  prefetchWaitMs: number
  diagnostics: AutoShortCueDiagnostic[]
  sourceGroupInputs: AutoShortVoiceCueInput[]
  targetGroupInputs: AutoShortVoiceCueInput[]
  artifacts: AutoShortArtifactEntry[]
}> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg để chuẩn hóa voice.')

  const sourceMap = new Map(sourceCues.map((c, i) => [c.id || `cue-${i}`, c]))
  const localKey = await loadLocalKey()
  const language = resolveAutoShortTtsLanguage(config, detectedLanguage)
  if (language === 'auto' || !language) throw new Error('Không xác định được ngôn ngữ TTS; hãy chọn ngôn ngữ nguồn hoặc đích.')
  const capabilityUrl = config.ttsServerUrl || ''
  const models = job.ttsCapabilities && job.ttsCapabilitiesUrl === capabilityUrl
    ? job.ttsCapabilities
    : await getTtsModels(config.ttsServerUrl, localKey)
  job.ttsCapabilities = models
  job.ttsCapabilitiesUrl = capabilityUrl
  const selectedModel = selectCompatibleAutoShortTtsModel(models.models, config.ttsModel, language)
  if (!selectedModel) {
    throw new Error(config.ttsModel ? `Model TTS "${config.ttsModel}" không tồn tại trên server.` : 'Không tìm thấy model TTS khả dụng trên server.')
  }
  const ttsCapabilityError = validateAutoShortTtsModel(selectedModel, language)
  if (ttsCapabilityError) throw new Error(ttsCapabilityError)

  const effectiveModel = selectedModel.id
  let effectiveVoice: string | undefined = undefined
  if (selectedModel.supports_named_voice !== false) {
    if (config.ttsVoice && config.ttsVoice !== 'default') {
      if (selectedModel.voices && selectedModel.voices.length > 0 && !selectedModel.voices.includes(config.ttsVoice) && config.ttsVoice !== selectedModel.default_voice) {
        logWarn(`[AutoShort] Voice "${config.ttsVoice}" không nằm trong capability của model ${selectedModel.id}; dùng default voice ${selectedModel.default_voice || 'default'}.`)
        effectiveVoice = selectedModel.default_voice || selectedModel.voices[0]
      } else {
        effectiveVoice = config.ttsVoice
      }
    } else {
      effectiveVoice = selectedModel.default_voice
    }
  }

  // Semantic groups remain useful to the translator, but they must not become
  // one audio clip: every source cue keeps its own start anchor and hard end.
  const semanticGroups = buildSemanticGroups(cues)
  const ttsGroups: SemanticGroup<SubtitleCue>[] = cues.map((cue, cueIndex) => ({
    id: cue.id || `cue-${cueIndex}`,
    cues: [cue],
    text: cue.text,
    start: cue.start,
    end: cue.end
  }))
  const paceMode = config.paceMode || 'source-adaptive'
  const synthesisSpeed = paceMode === 'source-adaptive' ? 1 : (config.ttsSpeed || 1)
  const cueWindows = deriveAutoShortCueWindows(cues, videoDuration)
  const predictor = createDurationPredictor()
  const predictedDurations = ttsGroups.map((group, cueIndex) => {
    const sourceCue = sourceMap.get(group.cues[0]?.id || `cue-${cueIndex}`) || group.cues[0]
    const sourceDuration = Math.max(0.1, (sourceCue?.end ?? group.end ?? videoDuration) - (sourceCue?.start ?? group.start ?? 0))
    return predictor.estimate(spokenTextWithoutSpeakerLabel(joinGroupText(group.cues)), {
      sourceText: sourceCue?.text,
      sourceDuration,
      speed: synthesisSpeed
    }).seconds
  })
  const selectedGlobalTempo = paceMode === 'source-adaptive'
    ? calculateSourceAdaptiveTempo(predictedDurations, cueWindows)
    : 1
  const preflightTextOverrides = new Map<string, string>()
  const preflightRephraseApplied = new Set<string>()
  let preflightCompleted = false
  const bootstrapSampleCount = Math.min(3, ttsGroups.length)
  const applyPreflightRephrase = async (startIndex: number): Promise<void> => {
    if (preflightCompleted) return
    preflightCompleted = true
    const requests: DubbingRephraseRequest[] = []
    for (let cueIndex = startIndex; cueIndex < ttsGroups.length; cueIndex++) {
      const group = ttsGroups[cueIndex]
      const window = cueWindows[cueIndex]
      const currentText = spokenTextWithoutSpeakerLabel(joinGroupText(group.cues))
      const predicted = predictor.estimate(currentText, { locale: language }).seconds
      const localCeiling = Math.min(AUTO_SHORT_TTS_MAX_TEMPO, selectedGlobalTempo + 0.03)
      if (!(predicted > window.availableDuration * localCeiling)) continue
      requests.push({
        cueId: group.id,
        currentText,
        targetDuration: Math.max(0.2, window.availableDuration * localCeiling),
        sourceText: group.cues.map((cue) => cue.text).join(' '),
        contextBefore: cueIndex > 0 ? [ttsGroups[cueIndex - 1]?.text || ''] : [],
        contextAfter: cueIndex + 1 < ttsGroups.length ? [ttsGroups[cueIndex + 1]?.text || ''] : []
      })
    }
    if (requests.length === 0) return
    const rephraseResults = await rephraseDubbingCues(
      config,
      requests,
      language,
      detectedLanguage,
      job.controller.signal
    )
    for (const request of requests) {
      const rephrasedText = chooseShortestPredictedRephrase(
        rephraseResults.get(request.cueId) || [],
        (text) => predictor.estimate(text, { locale: language }).seconds,
        request.targetDuration
      )
      if (rephrasedText && rephrasedText.trim() !== request.currentText.trim()) {
        preflightTextOverrides.set(request.cueId, rephrasedText.trim())
        preflightRephraseApplied.add(request.cueId)
        logInfo(`[AutoShort] Đã điều chỉnh trước TTS cue ${request.cueId} theo duration predictor.`)
      }
    }
  }
  let splitCount = 0
  logInfo(`[AutoShort] Dịch theo ${semanticGroups.length} semantic group; TTS giữ ${ttsGroups.length} mốc cue nguồn.`)

  let voice: string | undefined
  const preparedClips: Array<{
    group: SemanticGroup<SubtitleCue>
    path: string
    rawPath: string
    rawDuration: number
    naturalDuration: number
    rephraseAttempted: boolean
    translatedText: string
    finalSpokenText: string
  }> = []

  const synthesizeGroup = async (group: SemanticGroup<SubtitleCue>, gIndex: number) => {
    const translatedGroupText = joinGroupText(group.cues)
    const groupText = preflightTextOverrides.get(group.id) || spokenTextWithoutSpeakerLabel(translatedGroupText)
    emitProgress(job, item, 'generating_tts', 58 + (gIndex / Math.max(1, ttsGroups.length)) * 20, `Đang tạo voice ${gIndex + 1}/${ttsGroups.length}`, index, total)

    let lastError = 'Không tạo được voice'
    let cachedPathForAttempt: string | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const clipPath = join(workDir, `group-${gIndex}.wav`)
        const request = {
          serverUrl: config.ttsServerUrl,
          text: groupText,
          language,
          model: effectiveModel,
          voice: effectiveVoice,
          speed: synthesisSpeed,
          apiKey: localKey,
          options: config.ttsOptions
        }
        const cacheRoot = join(app.getPath('userData'), 'autoshort-tts-cache-v1')
        const cacheKey = await buildAutoShortTtsCacheKey({
          serverUrl: config.ttsServerUrl,
          text: groupText,
          language,
          model: effectiveModel,
          voice: effectiveVoice,
          speed: synthesisSpeed,
          options: config.ttsOptions,
          referenceAudioPath: config.ttsRefAudioPath,
          referenceTranscript: config.ttsRefTranscript
        })
        const cachedPath = join(cacheRoot, `${cacheKey}.wav`)
        cachedPathForAttempt = cachedPath
        let savedPath = clipPath
        let resultVoice: string | undefined
        if (await fileExists(cachedPath)) {
          await copyFile(cachedPath, clipPath)
        } else {
          await mkdir(cacheRoot, { recursive: true })
          const result = config.ttsRefAudioPath
            ? await generateVoiceClone({ ...request, referenceAudioPath: config.ttsRefAudioPath, referenceTranscript: config.ttsRefTranscript }, job.controller.signal, clipPath)
            : await generateSpeech(request, job.controller.signal, clipPath)
          if (!result.ok || !result.savedPath) throw new Error(result.error || 'Server không trả về audio')
          savedPath = result.savedPath
          resultVoice = result.voice
          await copyFile(savedPath, cachedPath)
        }
        voice = resultVoice || voice
        const rawDuration = await probeDuration(ffmpeg, savedPath, job.controller.signal)
        const completeness = validateVoiceAudioCompleteness(groupText, rawDuration)
        if (!completeness.ok) throw new Error(completeness.error || 'Audio phát âm không đầy đủ nội dung')
        return { group, path: savedPath, rawDuration, text: groupText }
      } catch (error) {
        lastError = errLabel(error)
        // Never retry a corrupt cache entry forever. A server can return a
        // header-only WAV on a failed synthesis; remove it before the next
        // attempt so a fresh request gets a chance to recover.
        if (cachedPathForAttempt) {
          await rm(cachedPathForAttempt, { force: true }).catch(() => undefined)
        }
        if (isAbortError(error)) throw error
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    throw new Error(`Voice đoạn ${gIndex + 1} (${group.id}) thất bại: ${lastError}`)
  }

  const prepareGroup = async (current: Awaited<ReturnType<typeof synthesizeGroup>>, gIndex: number) => {
    throwIfAborted(job.controller.signal)
    const trimmedPath = join(workDir, `group-${gIndex}-trim.wav`)
    let naturalDuration = await trimVoiceClip(ffmpeg, current.path, trimmedPath, job.controller.signal)
    if (!(naturalDuration > 0.05)) throw new Error(`Voice đoạn ${gIndex + 1} không có âm thanh hợp lệ.`)

    const window = cueWindows[gIndex]
    const availableDuration = window.availableDuration
    const localCeiling = Math.min(AUTO_SHORT_TTS_MAX_TEMPO, selectedGlobalTempo + 0.03)
    let rephraseAttempted = preflightRephraseApplied.has(current.group.id)
    let postTtsRephraseAttempted = false
    let finalSpokenText = current.text.trim()
    let finalPath = trimmedPath

    if (naturalDuration > availableDuration * localCeiling && config.ttsEnabled && !postTtsRephraseAttempted) {
      postTtsRephraseAttempted = true
      rephraseAttempted = true
      logInfo(`[AutoShort] Đoạn ${gIndex + 1} (${current.group.id}) thời lượng ${naturalDuration.toFixed(2)}s vượt ${availableDuration.toFixed(2)}s. Đang rephrase giữ trọn nghĩa…`)
      const rephraseCandidates = await rephraseDubbingCue(
        config,
        current.group.id || `group-${gIndex}`,
        current.text,
        availableDuration * localCeiling,
        language,
        detectedLanguage,
        job.controller.signal
      )
      const rephrasedText = chooseShortestPredictedRephrase(
        rephraseCandidates,
        (text) => predictor.estimate(text).seconds,
        availableDuration * localCeiling
      )
      if (rephrasedText && rephrasedText.trim() !== current.text.trim()) {
        try {
          const rephraseRawPath = join(workDir, `group-${gIndex}-rephrase.wav`)
          const rephraseTrimPath = join(workDir, `group-${gIndex}-rephrase-trim.wav`)
          const request = {
            serverUrl: config.ttsServerUrl,
            text: rephrasedText.trim(),
            language,
            model: effectiveModel,
            voice: effectiveVoice,
            speed: synthesisSpeed,
            apiKey: localKey,
            options: config.ttsOptions
          }
          const rephraseCacheKey = await buildAutoShortTtsCacheKey({
            serverUrl: config.ttsServerUrl,
            text: rephrasedText.trim(),
            language,
            model: effectiveModel,
            voice: effectiveVoice,
            speed: synthesisSpeed,
            options: config.ttsOptions,
            referenceAudioPath: config.ttsRefAudioPath,
            referenceTranscript: config.ttsRefTranscript
          })
          const rephraseCachePath = join(app.getPath('userData'), 'autoshort-tts-cache-v1', `${rephraseCacheKey}.wav`)
          let rephraseSavedPath = rephraseRawPath
          if (await fileExists(rephraseCachePath)) {
            await copyFile(rephraseCachePath, rephraseRawPath)
          } else {
            await mkdir(dirname(rephraseCachePath), { recursive: true })
            const repResult = config.ttsRefAudioPath
              ? await generateVoiceClone({ ...request, referenceAudioPath: config.ttsRefAudioPath, referenceTranscript: config.ttsRefTranscript }, job.controller.signal, rephraseRawPath)
              : await generateSpeech(request, job.controller.signal, rephraseRawPath)
            if (!repResult.ok || !repResult.savedPath) throw new Error(repResult.error || 'Server không trả về audio rephrase')
            rephraseSavedPath = repResult.savedPath
            await copyFile(rephraseSavedPath, rephraseCachePath)
          }
          if (rephraseSavedPath) {
            const repNatDur = await trimVoiceClip(ffmpeg, rephraseSavedPath, rephraseTrimPath, job.controller.signal)
            const repCompleteness = validateVoiceAudioCompleteness(rephrasedText.trim(), repNatDur)
            if (repCompleteness.ok && repNatDur > 0.05 && repNatDur < naturalDuration) {
              finalSpokenText = rephrasedText.trim()
              naturalDuration = repNatDur
              finalPath = rephraseTrimPath
              logInfo(`[AutoShort] Đoạn ${gIndex + 1} đã rephrase thành công (${naturalDuration.toFixed(2)}s).`)
            }
          }
        } catch (repErr) {
          logWarn(`[AutoShort] Rephrase audio đoạn ${gIndex + 1} thất bại: ${errLabel(repErr)}`)
        }
      }
    }

    // Calibrate with the duration that will actually enter the timeline after
    // conservative silence handling, not the server's untrimmed response.
    predictor.addSample(finalSpokenText, naturalDuration)

    return {
      group: current.group,
      path: finalPath,
      rawPath: current.path,
      rawDuration: current.rawDuration,
      naturalDuration,
      rephraseAttempted,
      translatedText: joinGroupText(current.group.cues),
      finalSpokenText
    }
  }

  let gIndex = 0
  while (gIndex < ttsGroups.length) {
    throwIfAborted(job.controller.signal)
    if (gIndex === bootstrapSampleCount) {
      // Let up to three real, reusable clips calibrate the endpoint/voice
      // profile before deciding which later cues need a text-only repair.
      await applyPreflightRephrase(gIndex)
    }
    const group = ttsGroups[gIndex]
    const current = await synthesizeGroup(group, gIndex)
    const prepared = await prepareGroup(current, gIndex)
    preparedClips.push(prepared)
    gIndex++
  }

  const targetGroupInputs: AutoShortVoiceCueInput[] = preparedClips.map(({ group, finalSpokenText }) => {
    const start = group.start ?? group.cues[0]?.start ?? 0
    const end = group.end ?? group.cues[group.cues.length - 1]?.end ?? (start + 2.5)
    return { id: group.id, start, end, text: finalSpokenText }
  })
  const sourceGroupInputs: AutoShortVoiceCueInput[] = preparedClips.map(({ group }) => {
    const sourceGroupCues = group.cues
      .map((cue, cueIndex) => sourceMap.get(cue.id || `cue-${cueIndex}`))
      .filter((cue): cue is SubtitleCue => Boolean(cue))
    const first = sourceGroupCues[0]
    const last = sourceGroupCues[sourceGroupCues.length - 1]
    const start = first?.start ?? group.start ?? group.cues[0]?.start ?? 0
    const end = last?.end ?? group.end ?? group.cues[group.cues.length - 1]?.end ?? (start + 2.5)
    return {
      id: group.id,
      start,
      end,
      text: sourceGroupCues.map((cue) => cue.text).join(' ')
    }
  })
  const timing = planAutoShortVoiceTimeline(
    targetGroupInputs,
    preparedClips.map(({ naturalDuration }) => naturalDuration),
    videoDuration,
    AUTO_SHORT_TTS_MAX_TEMPO,
    {
      paceMode,
      globalTempo: selectedGlobalTempo,
      fixedTempo: paceMode === 'fixed' ? 1 : undefined,
      localTempoDelta: 0.03
    }
  )

  logInfo(`[AutoShort] Lập timeline voice hoàn tất. Global tempo: ${timing.globalTempo.toFixed(3)}x, max tempo: ${timing.maxTempo.toFixed(3)}x, avg tempo: ${timing.averageTempo.toFixed(3)}x.`)

  const clips: Array<{ start: number; path: string }> = []
  const dubbingUnits: AutoShortDubbingUnit[] = []
  const timedCues: SubtitleCue[] = []
  const diagnostics: AutoShortCueDiagnostic[] = []
  const artifacts: AutoShortArtifactEntry[] = []

  for (let gIndex = 0; gIndex < preparedClips.length; gIndex++) {
    throwIfAborted(job.controller.signal)
    const current = preparedClips[gIndex]
    const planned = timing.cues[gIndex]
    let path = current.path
    let duration = current.naturalDuration
    let tempoPath: string | undefined

    if (Math.abs(planned.tempo - 1) > 0.001) {
      const fittedPath = join(workDir, `group-${gIndex}-tempo.wav`)
      duration = await speedUpVoiceClip(
        ffmpeg,
        current.path,
        fittedPath,
        current.naturalDuration,
        planned.plannedDuration,
        job.controller.signal
      )
      path = fittedPath
      tempoPath = fittedPath
    }

    const speechEnd = planned.start + duration
    if (gIndex === preparedClips.length - 1 && speechEnd > videoDuration + 0.25) {
      throw new Error('Voice cuối vượt thời lượng video sau khi căn tốc độ; không cắt nội dung.')
    }
    const cutOffDetected = speechEnd > videoDuration + 0.25
    const overlap = gIndex > 0 && planned.start < timing.cues[gIndex - 1].voiceEnd - 0.001
    const effectiveTailMargin = AUTO_SHORT_TTS_TAIL_MARGIN_SECONDS / (planned.tempo > 1.001 ? planned.tempo : 1.0)
    const sourceGroupCues = current.group.cues
      .map((cue, cueIndex) => sourceMap.get(cue.id || `cue-${cueIndex}`))
      .filter((cue): cue is SubtitleCue => Boolean(cue))
    const srcCue = sourceGroupCues[0] || sourceCues[gIndex] || current.group.cues[0]
    const srcGroupEnd = sourceGroupCues[sourceGroupCues.length - 1]?.end ?? srcCue?.end ?? planned.subtitleEnd

    if (speechEnd > planned.hardEnd + 0.01) {
      throw new Error(`Voice cue ${current.group.id} vượt hardEnd ${planned.hardEnd.toFixed(3)}s; không cắt lời.`)
    }

    const unitSubtitles = segmentScheduledDubbingSubtitles({
      id: current.group.id || `group-${gIndex}`,
      sourceCueIds: sourceGroupCues.map((c, idx) => c.id || `cue-${idx}`),
      finalSpokenText: current.finalSpokenText,
      plannedStart: planned.start,
      actualDuration: duration,
      hardEnd: planned.hardEnd
    })

    const dubbingUnit: AutoShortDubbingUnit = {
      id: current.group.id || `group-${gIndex}`,
      sourceCueIds: sourceGroupCues.map((c, idx) => c.id || `cue-${idx}`),
      sourceStart: srcCue ? srcCue.start : planned.subtitleStart,
      sourceEnd: srcGroupEnd,
      sourceText: sourceGroupCues.length > 0 ? sourceGroupCues.map((c) => c.text).join(' ') : current.group.cues.map((c) => c.text).join(' '),
      translatedText: current.translatedText,
      finalSpokenText: current.finalSpokenText,
      rephrased: current.rephraseAttempted && current.finalSpokenText !== current.translatedText,
      rawAudioPath: current.rawPath,
      rawDuration: current.rawDuration,
      trimmedAudioPath: current.path,
      naturalDuration: current.naturalDuration,
      finalAudioPath: path,
      finalDuration: duration,
      plannedStart: planned.start,
      plannedEnd: speechEnd,
      plannedDuration: planned.plannedDuration,
      tempo: planned.tempo,
      preferredEnd: planned.preferredEnd,
      hardEnd: planned.hardEnd,
      words: [],
      alignmentConfidence: 0,
      alignmentQuality: 'cue',
      subtitles: unitSubtitles
    }
    dubbingUnits.push(dubbingUnit)
    timedCues.push(...unitSubtitles)

    diagnostics.push({
      cueIndex: gIndex,
      cueId: current.group.id || `group-${gIndex}`,
      sourceStart: srcCue ? srcCue.start : planned.subtitleStart,
      sourceEnd: srcGroupEnd,
      sourceText: dubbingUnit.sourceText,
      translatedText: current.finalSpokenText,
      cueStart: unitSubtitles[0]?.start ?? planned.subtitleStart,
      cueEnd: unitSubtitles[unitSubtitles.length - 1]?.end ?? planned.subtitleEnd,
      rawPath: current.rawPath,
      rawDuration: current.rawDuration,
      trimmedPath: current.path,
      trimmedDuration: current.naturalDuration,
      naturalDuration: current.naturalDuration,
      availableDuration: planned.availableDuration,
      plannedStart: planned.start,
      plannedEnd: planned.voiceEnd,
      plannedVoiceStart: planned.start,
      plannedVoiceEnd: planned.voiceEnd,
      tempoPath,
      tempoDuration: duration,
      voiceStart: planned.start,
      voiceEnd: speechEnd,
      tempo: planned.tempo,
      renderSubtitleStart: unitSubtitles[0]?.start ?? planned.subtitleStart,
      renderSubtitleEnd: unitSubtitles[unitSubtitles.length - 1]?.end ?? planned.subtitleEnd,
      semanticOverflowMs: planned.semanticOverflowMs,
      rephraseAttempted: current.rephraseAttempted,
      plannedDuration: planned.plannedDuration,
      slackBefore: planned.slackBefore,
      slackAfter: planned.slackAfter,
      tailMarginSeconds: effectiveTailMargin,
      cutOffDetected,
      overlap,
      degraded: planned.degraded
    })

    artifacts.push({ source: current.rawPath, name: `group-${gIndex}-raw.wav` })
    artifacts.push({ source: current.path, name: `group-${gIndex}-trim.wav` })
    if (tempoPath) {
      artifacts.push({ source: tempoPath, name: `group-${gIndex}-tempo.wav` })
    }

    clips.push({ start: planned.start, path })
  }

  const legacyDubbingPlan = {
    version: DUBBING_PLAN_VERSION,
    paceMode,
    globalTempo: timing.globalTempo,
    createdAt: new Date().toISOString(),
    cues: dubbingUnits.map((unit, unitIndex) => ({
      id: unit.id,
      sourceCueIds: unit.sourceCueIds,
      sourceText: unit.sourceText,
      translatedText: unit.translatedText,
      finalSpokenText: unit.finalSpokenText,
      sourceStart: unit.sourceStart,
      preferredEnd: unit.preferredEnd ?? timing.cues[unitIndex].preferredEnd,
      hardEnd: unit.hardEnd ?? timing.cues[unitIndex].hardEnd,
      predictedDuration: predictedDurations[unitIndex] ?? unit.naturalDuration,
      predictionUncertainty: predictor.estimate(unit.finalSpokenText).uncertaintySeconds,
      naturalDuration: unit.naturalDuration,
      actualDuration: unit.finalDuration,
      tempo: unit.tempo,
      localTempoAdjustment: Number((unit.tempo - timing.globalTempo).toFixed(4)),
      audioPath: unit.finalAudioPath,
      subtitles: unit.subtitles,
      timing: timing.cues[unitIndex]
    }))
  }
  const dubbingPlanArtifactPath = join(workDir, 'dubbing-plan.json')
  await writeFile(dubbingPlanArtifactPath, JSON.stringify(legacyDubbingPlan, null, 2), 'utf8')
  artifacts.push({ source: dubbingPlanArtifactPath, name: 'dubbing-plan.json' })

  const anyRephrased = dubbingUnits.some((u) => u.rephrased)
  const rephraseCount = preparedClips.filter((clip) => clip.rephraseAttempted).length
  const fitFirstPassRatio = preparedClips.length > 0
    ? Number(((preparedClips.length - rephraseCount) / preparedClips.length).toFixed(3))
    : 1
  if (anyRephrased) {
    const dubbingSrtPath = join(workDir, 'dubbing.srt')
    await writeFile(dubbingSrtPath, serializeSrt(timedCues), 'utf8')
    artifacts.push({ source: dubbingSrtPath, name: 'dubbing.srt' })
  }

  // Diagnostic artifacts
  const finalSpokenTextArtifactPath = join(workDir, 'final-spoken-text.json')
  await writeFile(
    finalSpokenTextArtifactPath,
    JSON.stringify(
      dubbingUnits.map((u) => ({
        unitId: u.id,
        sourceCueIds: u.sourceCueIds,
        sourceStart: u.sourceStart,
        sourceEnd: u.sourceEnd,
        sourceText: u.sourceText,
        translatedText: u.translatedText,
        finalSpokenText: u.finalSpokenText,
        rephrased: u.rephrased
      })),
      null,
      2
    ),
    'utf8'
  )
  artifacts.push({ source: finalSpokenTextArtifactPath, name: 'final-spoken-text.json' })

  const targetWordTimelineArtifactPath = join(workDir, 'target-word-timeline.json')
  await writeFile(
    targetWordTimelineArtifactPath,
    JSON.stringify(
      dubbingUnits.map((u) => ({
        unitId: u.id,
        plannedStart: u.plannedStart,
        plannedEnd: u.plannedEnd,
        alignmentQuality: u.alignmentQuality,
        alignmentConfidence: u.alignmentConfidence,
        words: u.words
      })),
      null,
      2
    ),
    'utf8'
  )
  artifacts.push({ source: targetWordTimelineArtifactPath, name: 'target-word-timeline.json' })

  const dubbingUnitsArtifactPath = join(workDir, 'dubbing-units.json')
  await writeFile(dubbingUnitsArtifactPath, JSON.stringify(dubbingUnits, null, 2), 'utf8')
  artifacts.push({ source: dubbingUnitsArtifactPath, name: 'dubbing-units.json' })

  // Prepare word timings for subtitle effects if alignment quality is good
  const allWordAligned = dubbingUnits.every((u) => u.alignmentQuality === 'word' && u.alignmentConfidence >= 0.60)
  const wordTimings = allWordAligned
    ? dubbingUnits.map((u) => ({
        start: u.plannedStart,
        end: u.plannedEnd,
        words: u.words.map((w) => ({
          text: w.text,
          start: w.start,
          end: w.end,
          probability: w.probability
        }))
      }))
    : undefined

  return {
    path: join(workDir, 'tts-timeline.wav'),
    clips,
    cues: timedCues,
    dubbingUnits,
    wordTimings,
    count: clips.length,
    voice,
    language,
    tempo: timing.maxTempo,
    averageTempo: timing.averageTempo,
    maxTempo: timing.maxTempo,
    degraded: timing.degraded,
    rephraseCount,
    overflowCount: 0,
    batchCount: 0,
    batchCueCount: 0,
    rescueAttemptCount: 0,
    rescueAcceptedCount: 0,
    phaseWaitMs: 0,
    splitCount,
    paceMode,
    predictorSamples: predictor.profile.samples,
    fitFirstPassRatio,
    predictorResidualP90: predictor.profile.residualP90,
    prefetchStarted: 0,
    prefetchUsed: 0,
    prefetchDiscarded: 0,
    prefetchWaitMs: 0,
    diagnostics,
    sourceGroupInputs,
    targetGroupInputs,
    artifacts
  }
}

/** The coordinator adapter for the source-anchored dubbing modules. */
export async function synthesizeVoice(
  job: AutoShortJob,
  item: AutoShortQueueItemInput,
  config: AutoShortConfig,
  cues: SubtitleCue[],
  sourceCues: SubtitleCue[],
  workDir: string,
  videoDuration: number,
  index: number,
  total: number,
  detectedLanguage?: string | null,
  policy?: AutoShortExecutionPolicy,
  recoveryAttempt: 1 | 2 = 1
): Promise<{
  timeMap?: DubbingTimeMap
  outputDuration: number
  path: string
  clips: Array<{ start: number; path: string }>
  cues: SubtitleCue[]
  dubbingUnits: AutoShortDubbingUnit[]
  wordTimings?: Array<{ start: number; end: number; words: Array<{ text: string; start: number; end: number; probability?: number | null }> }>
  count: number
  voice?: string
  language: string
  tempo: number
  averageTempo: number
  maxTempo: number
  degraded: boolean
  rephraseCount: number
  overflowCount: number
  batchCount: number
  batchCueCount: number
  rescueAttemptCount: number
  rescueAcceptedCount: number
  phaseWaitMs: number
  splitCount: number
  paceMode: 'source-adaptive' | 'fixed'
  predictorSamples: number
  fitFirstPassRatio: number
  predictorResidualP90: number
  prefetchStarted: number
  prefetchUsed: number
  prefetchDiscarded: number
  prefetchWaitMs: number
  diagnostics: AutoShortCueDiagnostic[]
  sourceGroupInputs: AutoShortVoiceCueInput[]
  targetGroupInputs: AutoShortVoiceCueInput[]
  artifacts: AutoShortArtifactEntry[]
  requestSpans: AutoShortRequestSpan[]
}> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg để chuẩn hóa voice.')
  const language = resolveAutoShortTtsLanguage(config, detectedLanguage)
  if (!language || language === 'auto') throw new Error('Không xác định được ngôn ngữ TTS; hãy chọn ngôn ngữ nguồn hoặc đích.')
  const localKey = await loadLocalKey()
  const capabilityUrl = config.ttsServerUrl || ''
  const models = job.ttsCapabilities && job.ttsCapabilitiesUrl === capabilityUrl
    ? job.ttsCapabilities
    : await getTtsModels(config.ttsServerUrl, localKey)
  job.ttsCapabilities = models
  job.ttsCapabilitiesUrl = capabilityUrl
  const selectedModel = selectCompatibleAutoShortTtsModel(models.models, config.ttsModel, language)
  if (!selectedModel) throw new Error(config.ttsModel ? `Model TTS "${config.ttsModel}" không tồn tại trên server.` : 'Không tìm thấy model TTS khả dụng trên server.')
  if (config.ttsModel && selectedModel.id !== config.ttsModel) {
    logWarn(`[AutoShort] Model TTS đã lưu "${config.ttsModel}" không phù hợp ngôn ngữ ${language}; dùng capability tương thích "${selectedModel.id}".`)
  }
  const capabilityError = validateAutoShortTtsModel(selectedModel, language)
  if (capabilityError) throw new Error(capabilityError)
  const effectiveVoice = selectedModel.supports_named_voice === false
    ? undefined
    : config.ttsVoice && config.ttsVoice !== 'default'
      ? config.ttsVoice
      : selectedModel.default_voice
  const stableSourceCues = sourceCues.map((cue, cueIndex) => ({
    id: cue.id?.trim() || `cue-${cue.sourceIndex ?? cueIndex}`,
    sourceIndex: cue.sourceIndex ?? cueIndex,
    start: cue.start,
    end: cue.end,
    text: cue.text
  }))
  const sourcePlan = buildPlan({ videoDuration, paceMode: config.paceMode || 'source-adaptive', cues: stableSourceCues })
  const targetById = new Map(cues.map((cue, cueIndex) => [cue.id?.trim() || `cue-${cue.sourceIndex ?? cueIndex}`, cue]))
  const targetItems = sourcePlan.cues.map((cue) => {
    const target = targetById.get(cue.id)
    if (!target || !target.text.trim()) throw new Error(`Không tìm thấy text dịch cho cue ${cue.id}.`)
    return { id: cue.id, text: spokenTextWithoutSpeakerLabel(target.text) }
  })
  const translatedPlan = groupDubbingPlanForSpeech(applyDubbingTranslations(sourcePlan, targetItems), language)
  logInfo(`[AutoShort] Gom ${sourcePlan.cues.length} mảnh phụ đề thành ${translatedPlan.cues.length} đoạn thoại; giữ đủ source cue ID và khoảng nghỉ giữa các đoạn.`)
  const referenceInfo = config.ttsRefAudioPath
    ? await stat(config.ttsRefAudioPath).then((info) => ({ path: config.ttsRefAudioPath, size: info.size, mtimeMs: info.mtimeMs })).catch(() => ({ path: config.ttsRefAudioPath, size: 0, mtimeMs: 0 }))
    : null
  const referenceBuffer = config.ttsRefAudioPath
    ? await readFile(config.ttsRefAudioPath).catch(() => null)
    : null
  const referenceContentHash = referenceBuffer
    ? createHash('sha256').update(referenceBuffer).digest('hex')
    : null
  const modelRevision = typeof (selectedModel as { revision?: unknown; model_revision?: unknown }).revision === 'string'
    ? (selectedModel as { revision: string }).revision
    : typeof (selectedModel as { model_revision?: unknown }).model_revision === 'string'
      ? (selectedModel as { model_revision: string }).model_revision
      : null
  const profileKey = durationProfileKey({
    endpoint: config.ttsServerUrl,
    model: selectedModel.id,
    voice: effectiveVoice,
    language,
    options: config.ttsOptions,
    referenceAudio: referenceInfo,
    referenceContentHash: referenceContentHash || undefined,
    modelRevision: modelRevision || undefined
  })
  const profileRoot = join(app.getPath('userData'), 'autoshort-duration-profiles')
  const predictor = createDurationPredictor(await loadDurationProfile(profileRoot, profileKey))
  const cacheRoot = join(app.getPath('userData'), 'autoshort-tts-cache-v2')
  const ttsCache = getTtsCacheStore(cacheRoot)
  const attemptByCue = new Map<string, number>()
  const requestSpans: AutoShortRequestSpan[] = []
  const adapter: Parameters<typeof synthesizeDubbingPlan>[0]['tts'] = {
    async synthesize(request, signal) {
      const started = performance.now()
      const attempt = (attemptByCue.get(request.cueId) || 0) + 1
      attemptByCue.set(request.cueId, attempt)
      const safeId = safeArtifactSegment(request.cueId)
      const outputPath = join(workDir, `cue-${safeId}-${attempt}.wav`)
      const cacheKey = buildTtsCacheKey({
        endpoint: config.ttsServerUrl,
        finalSpokenText: request.text,
        language: request.language,
        model: request.model,
        voice: request.voice,
        serverSpeed: 1,
        options: request.options,
        referenceAudio: referenceInfo,
        referenceTranscript: config.ttsRefTranscript,
        contentHash: referenceContentHash,
        modelRevision
      })
      const cacheValue = await ttsCache.getOrCreate(cacheKey, signal, async (producerSignal, producerTempPath) => {
        const requestInput = {
          serverUrl: config.ttsServerUrl,
          text: request.text,
          language: request.language,
          model: request.model,
          voice: request.voice || undefined,
          speed: 1,
          apiKey: localKey,
          options: request.options
        }
        const result = config.ttsRefAudioPath
          ? await generateVoiceClone({
              ...requestInput,
              referenceAudioPath: config.ttsRefAudioPath,
              referenceTranscript: config.ttsRefTranscript,
              referenceAudioBuffer: referenceBuffer || undefined
            }, producerSignal, producerTempPath)
          : await generateSpeech(requestInput, producerSignal, producerTempPath)
        if (result.requestSpans?.length) requestSpans.push(...result.requestSpans)
        if (!result.ok || !result.savedPath) throw new Error(result.error || `TTS không trả audio cho cue ${request.cueId}.`)
        return { path: result.savedPath, voice: result.voice || effectiveVoice }
      }, { bypass: request.cacheMode === 'bypass' })
      await copyFile(cacheValue.path, outputPath)
      logInfo(`[AutoShort:timing] stage=tts cue=${safeId} cache=${cacheValue.fromCache ? 'hit' : 'miss'} elapsedMs=${Math.round(performance.now() - started)}`)
      return { path: outputPath, voice: cacheValue.voice || effectiveVoice, fromCache: cacheValue.fromCache }
    }
  }
  const resourceManager = (job as any).resourceManager || getGlobalResourceManager()
  const audioAdapter: Parameters<typeof synthesizeDubbingPlan>[0]['audio'] = {
    async trim(inputPath, outputHint, signal) {
      const started = performance.now()
      const outputPath = join(workDir, `${safeArtifactSegment(outputHint)}.wav`)
      const artifactCache = job.artifactCache
      let trimKey: string | undefined
      if (artifactCache) {
        const rawWavSha256 = await hashFileSha256(inputPath, signal)
        trimKey = buildAutoShortTrimPcmCacheKey({
          rawWavSha256,
          ffmpegRevision: ffmpeg
        })
        const cached = await artifactCache.get('trim-pcm', trimKey, signal).catch(() => null)
        if (cached) {
          try {
            await copyFile(cached.path, outputPath)
            const duration = await resourceManager.withLease(['local-audio-dsp'], signal, async () => {
              return probeDuration(ffmpeg, outputPath, signal)
            })
            if (!(duration > 0.05)) throw new Error('Trim PCM cache có thời lượng không hợp lệ.')
            logInfo(`[AutoShort:timing] stage=trim cue=${safeArtifactSegment(outputHint)} cache=hit elapsedMs=${Math.round(performance.now() - started)} audioSeconds=${duration.toFixed(3)}`)
            return { path: outputPath, duration }
          } catch (error) {
            if (signal.aborted) throw error
            logWarn(`[AutoShort] Bỏ qua cache trim PCM hỏng cho ${safeArtifactSegment(outputHint)}: ${errLabel(error)}`)
          } finally {
            cached.release()
          }
        }
      }

      const duration = await resourceManager.withLease(['local-audio-dsp'], signal, async () => {
        return trimVoiceClip(ffmpeg, inputPath, outputPath, signal)
      })
      if (trimKey && artifactCache) {
        await artifactCache.put('trim-pcm', trimKey, outputPath, signal).catch((error) => {
          logWarn(`[AutoShort] Không lưu cache trim PCM: ${errLabel(error)}`)
        })
      }
      logInfo(`[AutoShort:timing] stage=trim cue=${safeArtifactSegment(outputHint)} cache=miss elapsedMs=${Math.round(performance.now() - started)} audioSeconds=${duration.toFixed(3)}`)
      return { path: outputPath, duration }
    },
    async applyTempo(inputPath, outputHint, targetDuration, signal, measuredInputDuration) {
      const started = performance.now()
      const outputPath = join(workDir, `${safeArtifactSegment(outputHint)}.wav`)
      const actualDuration = await resourceManager.withLease(['local-audio-dsp'], signal, async () => {
        const inputDuration = measuredInputDuration && measuredInputDuration > 0
          ? measuredInputDuration
          : await probeDuration(ffmpeg, inputPath, signal)
        return speedUpVoiceClip(ffmpeg, inputPath, outputPath, inputDuration, targetDuration, signal)
      })
      logInfo(`[AutoShort:timing] stage=tempo cue=${safeArtifactSegment(outputHint)} elapsedMs=${Math.round(performance.now() - started)} targetSeconds=${targetDuration.toFixed(3)} audioSeconds=${actualDuration.toFixed(3)}`)
      return { path: outputPath, duration: actualDuration }
    }
  }
  logInfo(`[AutoShort] Tạo và đo audio TTS thật trước; chỉ cue vượt giới hạn đo được mới có một lượt rephrase cứu lỗi, giữ trần ${AUTO_SHORT_TTS_HARD_MAX_TEMPO.toFixed(2)}x.`)
  const synthesized = await synthesizeDubbingPlan({
    allowVideoExtension: true,
    recoveryAttempt,
    plan: translatedPlan,
    language,
    model: selectedModel.id,
    voice: effectiveVoice,
    options: config.ttsOptions,
    fixedTempo: config.ttsSpeed || 1,
    localTempoDelta: config.translateProvider === 'local' ? 0.15 : undefined,
    maxEarlyStartSeconds: config.audioMode === 'replace' || config.audioMode === 'separate-vocals'
      ? DUBBING_MAX_EARLY_START_SECONDS
      : 0,
    predictor,
    tts: adapter,
    audio: audioAdapter,
    rephraseBatch: async (requests, signal) => {
      const enrichedRequests = requests.map((request) => {
        const cueIndex = translatedPlan.cues.findIndex((cue) => cue.id === request.cueId)
        return {
          ...request,
          sourceText: request.sourceText || (cueIndex >= 0 ? translatedPlan.cues[cueIndex]?.sourceText : undefined),
          contextBefore: request.contextBefore?.length ? request.contextBefore : (cueIndex > 0 ? [translatedPlan.cues[cueIndex - 1]?.sourceText || ''] : []),
          contextAfter: request.contextAfter?.length ? request.contextAfter : (cueIndex >= 0 && cueIndex + 1 < translatedPlan.cues.length ? [translatedPlan.cues[cueIndex + 1]?.sourceText || ''] : [])
        }
      })
      const results = await rephraseDubbingCues(
        config,
        enrichedRequests,
        language,
        detectedLanguage,
        signal
      )
      return results
    },
    onRephrase: (event) => {
      const measured = event.previousSeconds == null ? ''
        : ` previousSeconds=${event.previousSeconds.toFixed(3)} candidateSeconds=${event.candidateSeconds?.toFixed(3) ?? 'unknown'}`
      const batch = event.batchSize == null ? '' : ` batchSize=${event.batchSize}`
      logInfo(`[AutoShort:rephrase] cue=${safeArtifactSegment(event.cueId)} phase=${event.phase} outcome=${event.outcome} candidates=${event.candidateCount}${batch}${measured}`)
    },
    onStructuralSplit: (event) => {
      logInfo(`[AutoShort:timing] cue=${safeArtifactSegment(event.cueId)} measured-overflow split=${event.partCount} sourceCues=${event.sourceCueIds.length}`)
    },
    signal: job.controller.signal,
    onProgress: (completed, count, cueId, phase = 'measure') => {
      const safeCount = Math.max(1, count)
      const progress = 58 + (completed / safeCount) * 20
      const message = phase === 'batch-rephrase'
        ? `Rút gọn ${completed}/${count} cue quá dài (phase=batch-rephrase)`
        : phase === 'rescue'
          ? `Đo lại voice ${completed}/${count} (phase=rescue; ${cueId})`
          : phase === 'finalize'
            ? `Hoàn tất voice ${completed}/${count} (phase=finalize; ${cueId})`
            : `Đo voice ${completed}/${count} (phase=measure; ${cueId})`
      emitProgress(job, item, 'generating_tts', progress, message, index, total)
    },
    prefetchTts: Boolean(policy?.prefetchTts)
  })
  for (const cue of synthesized.plan.cues) {
    const leadIn = cue.sourceStart - cue.start
    if (leadIn > 0.001) {
      logInfo(`[AutoShort:timing] cue=${safeArtifactSegment(cue.id)} dùng ${leadIn.toFixed(3)}s khoảng lặng dẫn trước; sourceStart=${cue.sourceStart.toFixed(3)} plannedStart=${cue.start.toFixed(3)}`)
    }
  }
  await saveDurationProfile(profileRoot, profileKey, predictor.profile).catch((error) => {
    logWarn(`[AutoShort] Không lưu được duration profile: ${errLabel(error)}`)
  })
  const validation = validateDubbingPlan(synthesized.plan)
  if (!validation.ok) throw new Error(`DubbingPlan không hợp lệ: ${validation.violations[0]}`)
  const artifacts: AutoShortArtifactEntry[] = []
  const dubbingUnits: AutoShortDubbingUnit[] = synthesized.plan.cues.map((cue, cueIndex) => {
    const subtitles = cue.subtitles as SubtitleCue[]
    const unit: AutoShortDubbingUnit = {
      id: cue.id,
      timingPolicy: 'source-anchored-v2',
      sourceCueIds: [...cue.sourceCueIds],
      sourceStart: cue.sourceStart,
      sourceEnd: cue.sourceEnd,
      sourceText: cue.sourceText,
      translatedText: cue.translatedText,
      finalSpokenText: cue.finalSpokenText,
      rephrased: cue.rephrased,
      rawAudioPath: undefined,
      rawDuration: cue.naturalDuration || undefined,
      trimmedAudioPath: cue.audioPath || undefined,
      naturalDuration: cue.naturalDuration || 0,
      finalAudioPath: cue.audioPath || undefined,
      finalDuration: cue.actualDuration || undefined,
      plannedStart: cue.start,
      plannedEnd: cue.voiceEnd || cue.start,
      plannedDuration: cue.plannedDuration || cue.actualDuration || 0,
      tempo: cue.tempo,
      preferredEnd: cue.preferredEnd,
      hardEnd: cue.hardEnd,
      words: [],
      alignmentConfidence: 0,
      alignmentQuality: 'cue',
      subtitles
    }
    if (cue.audioPath) artifacts.push({ source: cue.audioPath, name: `cue-${cueIndex}-audio.wav` })
    return unit
  })
  const diagnostics: AutoShortCueDiagnostic[] = dubbingUnits.map((unit, cueIndex) => {
    const cue = synthesized.plan.cues[cueIndex]
    const end = unit.plannedEnd
    return {
      cueIndex,
      cueId: unit.id,
      sourceStart: unit.sourceStart,
      sourceEnd: unit.sourceEnd,
      sourceText: unit.sourceText,
      translatedText: unit.finalSpokenText,
      naturalDuration: unit.naturalDuration,
      tempo: unit.tempo,
      plannedVoiceStart: unit.plannedStart,
      plannedVoiceEnd: end,
      renderSubtitleStart: unit.subtitles[0]?.start ?? unit.plannedStart,
      renderSubtitleEnd: unit.subtitles[unit.subtitles.length - 1]?.end ?? end,
      semanticOverflowMs: 0,
      rephraseAttempted: unit.rephrased,
      degraded: synthesized.metrics.degraded,
      cueStart: unit.plannedStart,
      cueEnd: end,
      rawPath: unit.rawAudioPath,
      rawDuration: unit.rawDuration,
      trimmedPath: unit.trimmedAudioPath,
      trimmedDuration: unit.naturalDuration,
      tempoPath: unit.finalAudioPath,
      tempoDuration: unit.finalDuration,
      voiceStart: unit.plannedStart,
      voiceEnd: end,
      availableDuration: cue.availableDuration,
      plannedDuration: unit.plannedDuration,
      plannedStart: unit.plannedStart,
      plannedEnd: end,
      slackBefore: 0,
      slackAfter: Math.max(0, cue.hardEnd - end),
      tailMarginSeconds: 0,
      cutOffDetected: false,
      overlap: false
    }
  })
  const planArtifact = join(workDir, 'dubbing-plan.json')
  await writeFile(planArtifact, JSON.stringify({ ...synthesized.plan,
    timelineCoordinateSystem: synthesized.timeMap ? 'output' : 'source',
    originalSourceCues: stableSourceCues, timeMap: synthesized.timeMap }, null, 2), 'utf8')
  artifacts.push({ source: planArtifact, name: 'dubbing-plan.json' })
  const textArtifact = join(workDir, 'final-spoken-text.json')
  await writeFile(textArtifact, JSON.stringify(synthesized.plan.cues.map((cue) => ({
    id: cue.id,
    sourceCueIds: cue.sourceCueIds,
    sourceStart: cue.sourceStart,
    sourceEnd: cue.sourceEnd,
    sourceText: cue.sourceText,
    translatedText: cue.translatedText,
    finalSpokenText: cue.finalSpokenText,
    rephrased: cue.rephrased
  })), null, 2), 'utf8')
  artifacts.push({ source: textArtifact, name: 'final-spoken-text.json' })
  return {
    path: join(workDir, 'tts-timeline.wav'),
    clips: synthesized.clips,
    timeMap: synthesized.timeMap,
    outputDuration: synthesized.plan.videoDuration,
    cues: synthesized.subtitles as SubtitleCue[],
    dubbingUnits,
    wordTimings: undefined,
    count: synthesized.clips.length,
    voice: synthesized.voice,
    language,
    tempo: synthesized.metrics.globalTempo,
    averageTempo: synthesized.metrics.averageTempo,
    maxTempo: synthesized.metrics.maxTempo,
    degraded: synthesized.metrics.degraded,
    rephraseCount: synthesized.metrics.rephraseCount,
    overflowCount: synthesized.metrics.overflowCount,
    batchCount: synthesized.metrics.batchCount,
    batchCueCount: synthesized.metrics.batchCueCount,
    rescueAttemptCount: synthesized.metrics.rescueAttemptCount,
    rescueAcceptedCount: synthesized.metrics.rescueAcceptedCount,
    phaseWaitMs: synthesized.metrics.phaseWaitMs,
    splitCount: 0,
    paceMode: translatedPlan.paceMode,
    predictorSamples: synthesized.metrics.predictorSamples,
    fitFirstPassRatio: synthesized.metrics.fitFirstPassRatio,
    predictorResidualP90: synthesized.metrics.predictorResidualP90,
    prefetchStarted: synthesized.metrics.prefetchStarted,
    prefetchUsed: synthesized.metrics.prefetchUsed,
    prefetchDiscarded: synthesized.metrics.prefetchDiscarded,
    prefetchWaitMs: synthesized.metrics.prefetchWaitMs,
    diagnostics,
    sourceGroupInputs: dubbingUnits.map((unit) => ({ id: unit.id, start: unit.sourceStart, end: unit.sourceEnd, text: unit.sourceText })),
    targetGroupInputs: dubbingUnits.map((unit) => ({ id: unit.id, start: unit.sourceStart, end: unit.sourceEnd, text: unit.finalSpokenText })),
    artifacts,
    requestSpans
  }
}

async function processSingleVideo(
  job: AutoShortJob,
  item: AutoShortQueueItemInput,
  config: AutoShortConfig,
  index: number,
  total: number,
  policy: AutoShortExecutionPolicy = CONSERVATIVE_POLICY,
  reservation?: DiskReservation,
  recoveryAttempt: 1 | 2 = 1,
  existingOutputDir?: string
): Promise<AutoShortItemResult> {
  const workDir = join(app.getPath('temp'), `tblao-autoshort-${job.id}-${item.id.slice(0, 8)}`)
  const checkpointDir = join(app.getPath('userData'), 'autoshort-checkpoints', safeArtifactSegment(item.id))
  let itemOutputDir: string
  try {
    // Reserve the directory atomically before rendering so the MP4, title
    // file, and audit artifacts for one source can never mix with another.
    itemOutputDir = existingOutputDir || await reserveVideoTitleOutputDir(config.outputDir, basename(item.filePath))
  } catch (error) {
    const message = sanitizeAutoShortAuditError(error, [item.filePath, config.outputDir])
    return {
      itemId: item.id,
      filePath: item.filePath,
      status: 'error',
      error: message || 'Không thể tạo thư mục riêng cho video đầu ra.'
    }
  }
  const artifactDir = join(itemOutputDir, `.autoshort-audit-${job.id}-${safeArtifactSegment(item.id)}`)

  const processor = createAutoShortItemProcessor({
    resolveFfmpeg,
    resolveFfprobe,
    runVisualOcr: ocrVideoWithVisualTimeline,
    writeTimedMask: writeTimedOcrBlurMask,
    burn: burnAutoShort
  })

  const result = await processor({
    jobId: job.id,
    request: job.request,
    item,
    index,
    total,
    recoveryAttempt,
    signal: job.controller.signal,
    emit: (event) => safeEmit(job, event),
    checkpointDir,
    workDir,
    artifactDir,
    batchConfigDigest: itemConfigDigest(config, item),
    itemOutputDir,
    ttsCapabilities: job.ttsCapabilities,
    ttsCapabilitiesUrl: job.ttsCapabilitiesUrl,
    separation: job.separation,
    separationProviderState: job.separationProviderState,
    policy,
    resourceManager: job.resourceManager || getGlobalResourceManager(),
    artifactCache: job.artifactCache,
    telemetryBudget: job.telemetryBudget
  })
  if (result.translationIdentity && result.translationAssessment?.disposition === 'needs-review') {
    let generation = 0
    try {
      const persisted = JSON.parse(await readFile(join(checkpointDir, 'checkpoint.json'), 'utf8')) as Record<string, unknown>
      generation = Number.isInteger(persisted.translationRetryGeneration) ? Number(persisted.translationRetryGeneration) : 0
    } catch {
      // The retry action will validate the authoritative checkpoint again.
    }
    translationRetryRegistry.set(item.id, {
      itemId: item.id,
      filePath: item.filePath,
      checkpointFile: join(checkpointDir, 'checkpoint.json'),
      checkpointRoot: join(app.getPath('userData'), 'autoshort-checkpoints'),
      expectedIdentity: result.translationIdentity,
      generation,
      inFlight: false
    })
  } else if (result.status === 'done') {
    translationRetryRegistry.delete(item.id)
  }
  // All known artifacts have been published; no future bytes remain reserved
  // when this item reaches the queue terminal state.
  reservation?.update(0)
  return result
}

export interface AutoShortTranslationRetryRequest {
  itemId: string
  expectedIdentity: string
}

export interface AutoShortTranslationRetryResult {
  ok: boolean
  generation?: number
  error?: string
}

/**
 * Prepare one explicit translation retry. This mutates only the app-owned
 * checkpoint and never starts a provider request; the caller must start a new
 * normal AutoShort job explicitly afterwards.
 */
export async function retryAutoShortTranslation(
  request: AutoShortTranslationRetryRequest
): Promise<AutoShortTranslationRetryResult> {
  if (activeJob) return { ok: false, error: 'Không thể thử lại khi Auto Short đang chạy.' }
  if (!request || typeof request.itemId !== 'string' || !request.itemId.trim() ||
    typeof request.expectedIdentity !== 'string' || !/^[a-f0-9]{64}$/iu.test(request.expectedIdentity)) {
    return { ok: false, error: 'Yêu cầu thử lại bản dịch không hợp lệ.' }
  }
  let entry = translationRetryRegistry.get(request.itemId)
  if (!entry) {
    // Rehydrate the app-owned entry after a main/renderer restart. The
    // renderer still supplies only the opaque item ID and identity; the
    // checkpoint path is derived inside userData and is containment-checked.
    const checkpointRoot = join(app.getPath('userData'), 'autoshort-checkpoints')
    const checkpointFile = join(checkpointRoot, safeArtifactSegment(request.itemId), 'checkpoint.json')
    try {
      await assertContainedParentDirectory(checkpointFile, checkpointRoot, 'translation retry checkpoint')
      const persisted = JSON.parse(await readFile(checkpointFile, 'utf8')) as Record<string, unknown>
      const persistedAssessment = persisted.translationAssessment as { disposition?: unknown } | undefined
      if (persisted.translationKey !== request.expectedIdentity || persistedAssessment?.disposition !== 'needs-review') {
        return { ok: false, error: 'Checkpoint không còn chứa bản dịch cần kiểm tra cho identity này.' }
      }
      const generation = Number.isInteger(persisted.translationRetryGeneration) ? Number(persisted.translationRetryGeneration) : 0
      entry = {
        itemId: request.itemId,
        filePath: '',
        checkpointFile,
        checkpointRoot,
        expectedIdentity: request.expectedIdentity,
        generation,
        inFlight: false
      }
      translationRetryRegistry.set(request.itemId, entry)
    } catch {
      return { ok: false, error: 'Không còn phiên dịch cần kiểm tra trên máy này. Hãy chạy lại video để tạo phiên mới.' }
    }
  }
  if (entry.expectedIdentity !== request.expectedIdentity) return { ok: false, error: 'Identity bản dịch đã thay đổi; yêu cầu cũ không còn hợp lệ.' }
  if (entry.inFlight) return { ok: false, error: 'Đang chuẩn bị lượt thử lại bản dịch này.' }
  entry.inFlight = true
  try {
    await assertContainedParentDirectory(entry.checkpointFile, entry.checkpointRoot, 'translation retry checkpoint')
    const raw = await readFile(entry.checkpointFile, 'utf8')
    const checkpoint = JSON.parse(raw) as Record<string, unknown>
    if (checkpoint.translationKey !== entry.expectedIdentity) return { ok: false, error: 'Checkpoint không còn khớp identity bản dịch.' }
    const persistedGeneration = Number.isInteger(checkpoint.translationRetryGeneration) ? Number(checkpoint.translationRetryGeneration) : 0
    if (entry.preparedGeneration === persistedGeneration + 1 || persistedGeneration > entry.generation) {
      return { ok: false, error: 'Lượt thử lại này đã được chuẩn bị; hãy bấm Bắt đầu chạy lại trước.' }
    }
    const generation = persistedGeneration + 1
    const next = {
      ...checkpoint,
      translationRetryGeneration: generation,
      // Keep any independently validated cue batches. The next coordinator
      // run will strict-revalidate the full set and request only missing or
      // invalid IDs under the same identity.
      translationAssessment: undefined
    }
    const temporary = `${entry.checkpointFile}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
      await rename(temporary, entry.checkpointFile)
    } finally {
      await rm(temporary, { force: true }).catch(() => {})
    }
    entry.preparedGeneration = generation
    entry.expectedIdentity = request.expectedIdentity
    return { ok: true, generation }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    entry.inFlight = false
  }
}

const AUTOSHORT_MIN_FUTURE_BYTES = 512 * 1024 * 1024
const AUTOSHORT_INPUT_WORKING_SET_MULTIPLIER = 3
const AUTOSHORT_FIXED_FUTURE_BYTES = 256 * 1024 * 1024

/**
 * Conservative admission estimate for experimental two-item execution.
 * It represents future writes only; existing input/output files are not
 * counted, and the ledger adds the independent STTN headroom.
 */
export function estimateAutoShortFutureBytes(inputBytes: number): number {
  const normalized = Number.isFinite(inputBytes) && inputBytes > 0 ? inputBytes : 0
  return Math.max(
    AUTOSHORT_MIN_FUTURE_BYTES,
    Math.ceil(normalized * AUTOSHORT_INPUT_WORKING_SET_MULTIPLIER + AUTOSHORT_FIXED_FUTURE_BYTES)
  )
}

export function autoShortVolumeForPath(filePath: string): string {
  const drive = filePath.match(/^([A-Za-z]):(?:[\\/]|$)/)?.[1]
  if (drive) return `${drive.toUpperCase()}:\\`
  return dirname(filePath) || filePath
}

async function preflight(job: AutoShortJob): Promise<void> {
  const { config } = job.request
  const preflightStep = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } catch (error) {
      debugRaw(`[AutoShort] preflight ${name}`, error)
      const raw = error instanceof Error ? error.message : String(error)
      throw new Error(`${name}: ${raw}`)
    }
  }
  const outputInfo = await stat(config.outputDir).catch(() => null)
  if (!outputInfo?.isDirectory()) throw new Error('Thư mục đầu ra không tồn tại hoặc không thể mở')
  if (!(await resolveFfmpeg())) throw new Error('Thiếu FFmpeg. Hãy cài công cụ trước khi chạy Auto Short.')
  const readiness = await getAutoShortReadiness(config)
  if (!readiness.ready) {
    throw new Error(readiness.message || 'Dependency Auto Short chưa sẵn sàng. Hãy tải các thành phần được yêu cầu trước.')
  }
  if (config.audioMode === 'separate-vocals') {
    const preset = config.separationPreset || 'balanced'
    const modelId = modelIdForSeparationPreset(preset)
    const enginePath = await resolveSeparatorEngine()
    if (!enginePath) throw new Error('Thiếu Separator engine.')
    const probe = await probeRuntimeExecutable('separator-engine', enginePath)
    if (!probe.healthy || !probe.version) throw new Error(probe.message || 'Separator engine probe thất bại.')
    const model = await resolveInstalledSeparatorModel(modelId)
    if (!model) throw new Error(`Model tách nhạc ${modelId} chưa được cài đặt hoặc bị lỗi.`)
    const presetConfig = separationPresetConfig(preset)

    job.separation = {
      enginePath,
      engineVersion: probe.version,
      engineProtocol: 'separator-engine/1',
      model,
      preset,
      presetConfig
    }
  }
  if (config.translateTarget !== 'none' && config.translateProvider === 'local') {
    const key = await loadLocalKey()
    const health = await preflightStep<DichKeyStatus>('kiểm tra dịch nội bộ', () => checkLocalTranslateKey(config.translateServerUrl, key))
    if (!health.ok) throw new Error(health.message || 'Không kết nối được server dịch nội bộ')
  }
  if (config.ttsEnabled) {
    const key = await loadLocalKey()
    const health = await preflightStep<TtsServerHealth>('kiểm tra TTS', () => checkTtsServerHealth(config.ttsServerUrl, key))
    if (!health.ok) throw new Error(health.error || 'Không kết nối được server TTS')
    const models = await preflightStep<{ ok: boolean; models: TtsModelInfo[]; error?: string }>('đọc danh sách model TTS', () => getTtsModels(config.ttsServerUrl, key))
    if (models.ok) {
      job.ttsCapabilities = models
      job.ttsCapabilitiesUrl = config.ttsServerUrl || ''
    }
    const ttsLanguage = resolveAutoShortTtsLanguage(config)
    const selectedModel = selectCompatibleAutoShortTtsModel(models.models, config.ttsModel, ttsLanguage)
    if (!models.ok || !selectedModel) {
      throw new Error(models.error || (config.ttsModel ? `Model TTS "${config.ttsModel}" không tồn tại trên server.` : 'Không tìm thấy model TTS khả dụng trên server.'))
    }
    if (selectedModel.available === false) {
      throw new Error(`Model TTS ${selectedModel.id} hiện không khả dụng trên server.`)
    }
    const ttsCapabilityError = validateAutoShortTtsModel(selectedModel, ttsLanguage)
    if (ttsCapabilityError) throw new Error(ttsCapabilityError)
    if (config.ttsRefAudioPath && !(await fileExists(config.ttsRefAudioPath))) throw new Error('File voice clone không tồn tại')
  }
}

async function executeJob(job: AutoShortJob): Promise<AutoShortBatchResult> {
  const total = job.request.items.length
  const results: AutoShortItemResult[] = new Array(total)
  try {
    job.telemetryBudget = new AutoShortTelemetryJobBudget()
    if (!job.batchSnapshot) await initializeBatchJournal(job)
    const overlayImage = job.request.config.overlays?.image
    if (overlayImage) await readAutoShortOverlayImage(overlayImage.path, overlayImage.sha256)
    await preflight(job)
    const policy = resolveExecutionPolicy(job.request.config?.executionPolicy)
    // Two-item execution remains an explicit experimental opt-in. When it is
    // selected, admit each item through the disk ledger before starting any
    // child process; the conservative production default (1) is unchanged.
    const diskBudget = policy.maxActiveItems === 2 ? getGlobalAutoShortDiskBudget() : undefined
    const retryOutputDirs = new Map<string, string>()
    const queueResults = await runAutoShortQueue({
      items: job.request.items,
      maxActiveItems: policy.maxActiveItems,
      signal: job.controller.signal,
      admitItem: diskBudget
        ? async (item, _index, _totalCount, signal) => {
            const inputInfo = await stat(item.filePath).catch(() => null)
            const estimate = estimateAutoShortFutureBytes(inputInfo?.size || 0)
            const volume = autoShortVolumeForPath(job.request.config.outputDir)
            logInfo(`[AutoShort] disk-admission volume=${volume} estimateBytes=${estimate} item=${safeArtifactSegment(item.id)}`)
            return diskBudget.reserve(volume, estimate, signal)
          }
        : undefined,
      processItem: async (item, index, totalCount, reservation, attempt = 1) => {
        const journalItem = job.batchSnapshot?.items.find((entry) => entry.itemId === item.id)
        const itemOutputDir = retryOutputDirs.get(item.id) || journalItem?.reservedOutputDir ||
          await reserveVideoTitleOutputDir(job.request.config.outputDir, basename(item.filePath))
        retryOutputDirs.set(item.id, itemOutputDir)
        const artifactDir = join(itemOutputDir, `.autoshort-audit-${job.id}-${safeArtifactSegment(item.id)}`)
        await markBatchRunning(job, item.id, attempt, itemOutputDir, artifactDir)
        return processSingleVideo(job, item, job.request.config, index, totalCount, policy, reservation,
          attempt, itemOutputDir)
      },
      shouldRetry: (result) => result.status === 'error' && result.recovery?.retryable === true,
      onRetryScheduled: (itemResult, index, item, totalCount) => {
        if (itemResult.artifactDir) retryOutputDirs.set(item.id, dirname(itemResult.artifactDir))
        emitProgress(job, item, 'queued', 0,
          'Đã lưu tiến trình; sẽ tự xử lý lại sau khi hoàn tất hàng đợi.', index, totalCount)
      },
      onTerminal: async (itemResult, index, item, totalCount) => {
        const durableResult = await checkpointTerminalResult(job, itemResult)
        results[index] = durableResult
        emitTerminal(job, item, index, totalCount, durableResult)
      },
      sanitizeError: (item, error) => sanitizeAutoShortAuditError(error, [item.filePath, job.request.config.outputDir])
    })
    for (let i = 0; i < total; i++) {
      if (queueResults[i] && !results[i]) {
        results[i] = queueResults[i]
      }
    }
  } catch (error) {
    const message = errLabel(error)
    logError(`[AutoShort] Preflight thất bại: ${message}`)
    for (let index = 0; index < total; index++) {
      if (!results[index]) {
        const item = job.request.items[index]
        const result: AutoShortItemResult = {
          itemId: item.id,
          filePath: item.filePath,
          status: job.controller.signal.aborted ? 'cancelled' : 'error',
          error: message
        }
        let durableResult = result
        if (job.batchSnapshot) {
          durableResult = await checkpointTerminalResult(job, result).catch((journalError) => ({
            ...result,
            status: 'error' as const,
            error: `${message}; không lưu được batch journal: ${errLabel(journalError)}`
          }))
        }
        results[index] = durableResult
        emitTerminal(job, item, index, total, durableResult)
      }
    }
  }
  const completedCount = results.filter((result) => result?.status === 'done').length
  const errorCount = results.filter((result) => result?.status === 'error').length
  const cancelledCount = results.filter((result) => result?.status === 'cancelled').length
  const warningCount = results.reduce((sum, result) => sum + (result?.translationAssessment?.issues.filter((issue) => issue.severity === 'warning').length || 0), 0)
  const needsReviewCount = results.filter((result) => result?.translationAssessment?.disposition === 'needs-review').length
  const result: AutoShortBatchResult = {
    ok: completedCount > 0 && errorCount === 0 && cancelledCount === 0,
    completedCount,
    totalCount: total,
    warningCount,
    needsReviewCount,
    error: errorCount > 0 ? `${errorCount} video lỗi` : cancelledCount > 0 ? 'Tiến trình đã bị dừng bởi người dùng' : undefined
  }
  safeEmit(job, { type: 'batch-done', jobId: job.id, completedCount, errorCount, cancelledCount, totalCount: total, warningCount, needsReviewCount, results })
  return result
}

function launchAutoShortJob(
  request: AutoShortStartRequest,
  onEvent: (event: AutoShortEvent) => void,
  options?: { jobId?: string; snapshot?: BatchSnapshot }
): { ok: true; jobId: string } | { ok: false; error: string } {
  if (activeJob) return { ok: false, error: 'Đang có một Auto Short job khác chạy.' }
  const job: AutoShortJob = {
    id: options?.jobId || randomUUID(),
    request,
    controller: new AbortController(),
    emit: onEvent,
    cancelled: false,
    batchStore: getAutoShortBatchStore(),
    batchSnapshot: options?.snapshot,
    batchWrite: Promise.resolve(),
    separationProviderState: { mode: 'auto' },
    artifactCache: getAutoShortArtifactCache(),
    done: Promise.resolve({ ok: false, completedCount: 0, totalCount: request.items.length })
  }
  job.done = executeJob(job).finally(() => {
    if (activeJob?.id === job.id) activeJob = null
  })
  activeJob = job
  return { ok: true, jobId: job.id }
}

export function startAutoShortJob(raw: unknown, onEvent: (event: AutoShortEvent) => void): { ok: true; jobId: string } | { ok: false; error: string } {
  const validation = validateAutoShortStartRequest(raw)
  if (!validation.ok) return { ok: false, error: validation.error }
  return launchAutoShortJob(validation.value, onEvent)
}

async function loadRecoveredBatch(jobId?: string): Promise<BatchSnapshot | null> {
  const store = getAutoShortBatchStore()
  const loaded = jobId ? await store.load(jobId) : await store.loadLatest()
  if (!loaded || activeJob?.id === loaded.jobId) return activeJob?.batchSnapshot || loaded
  const recovered = recoverInterruptedBatch(loaded)
  const changed = recovered.items.some((item, index) => item.state !== loaded.items[index]?.state)
  let snapshot = loaded
  if (changed) {
    snapshot = { ...recovered, revision: loaded.revision + 1, updatedAtUtc: new Date().toISOString() }
    await store.save(snapshot, loaded.revision)
  }
  for (const item of snapshot.items.filter((entry) => entry.state === 'interrupted' && entry.artifactDir && entry.reservedOutputDir)) {
    try {
      const manifestPath = join(item.artifactDir!, 'manifest.json')
      await assertContainedRegularFile(manifestPath, item.reservedOutputDir!, 'AutoShort completion manifest')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
      if (manifest.status !== 'done' || manifest.sourceDigest !== item.inputDigest || manifest.configDigest !== item.configDigest ||
        typeof manifest.outputFile !== 'string' || !Array.isArray(manifest.files) || !manifest.files.includes('output.mp4')) {
        throw new Error('Completion manifest không khớp source/config digest.')
      }
      const outputPath = join(item.reservedOutputDir!, manifest.outputFile)
      await assertContainedRegularFile(outputPath, item.reservedOutputDir!, 'AutoShort completed output')
      const [info, sha256, meta] = await Promise.all([stat(outputPath), hashFileSha256(outputPath), probeBurnMedia(outputPath)])
      const durationSeconds = meta.videoDurationSeconds ?? meta.videoDuration ?? meta.giay
      if (!info.isFile() || info.size <= 0 || !(durationSeconds > 0)) throw new Error('Output từ completion manifest không hợp lệ.')
      const current = snapshot
      const items = current.items.map((entry) => entry.itemId === item.itemId ? {
        ...entry,
        state: 'succeeded' as const,
        outputReceipt: { path: outputPath, sha256, bytes: info.size, durationSeconds },
        failure: undefined
      } : entry)
      snapshot = { ...current, revision: current.revision + 1, updatedAtUtc: new Date().toISOString(), items }
      await store.save(snapshot, current.revision)
    } catch (error) {
      logWarn(`[AutoShort] Không reconcile completion cho ${safeArtifactSegment(item.itemId)}: ${errLabel(error)}`)
    }
  }
  for (const item of snapshot.items.filter((entry) => entry.state === 'succeeded' && entry.outputReceipt)) {
    try {
      const info = await stat(item.outputReceipt!.path)
      if (!info.isFile() || info.size !== item.outputReceipt!.bytes || await hashFileSha256(item.outputReceipt!.path) !== item.outputReceipt!.sha256) {
        throw new Error('Kích thước hoặc checksum đầu ra đã thay đổi.')
      }
    } catch (error) {
      const current = snapshot
      const items = current.items.map((entry) => entry.itemId === item.itemId ? {
        ...entry,
        state: 'needs-review' as const,
        failure: { code: 'output_receipt_mismatch', message: errLabel(error), recoverable: false }
      } : entry)
      snapshot = { ...current, revision: current.revision + 1, updatedAtUtc: new Date().toISOString(), items }
      await store.save(snapshot, current.revision)
    }
  }
  return snapshot
}

export async function getAutoShortBatch(jobId?: string): Promise<AutoShortBatchStatusResult> {
  try {
    if (jobId !== undefined && !isSafeBatchId(jobId)) return { ok: false, error: 'Batch job ID không hợp lệ.' }
    return { ok: true, snapshot: await loadRecoveredBatch(jobId) }
  } catch (error) {
    return { ok: false, error: errLabel(error) }
  }
}

export async function resumeAutoShortBatch(
  raw: unknown,
  onEvent: (event: AutoShortEvent) => void
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  if (activeJob) return { ok: false, error: 'Đang có một Auto Short job khác chạy.' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Yêu cầu resume không hợp lệ.' }
  const request = raw as Partial<AutoShortResumeRequest>
  if (typeof request.jobId !== 'string' || !isSafeBatchId(request.jobId) || !Number.isSafeInteger(request.expectedRevision)) {
    return { ok: false, error: 'Job ID hoặc revision resume không hợp lệ.' }
  }
  try {
    const snapshot = await loadRecoveredBatch(request.jobId)
    if (!snapshot) return { ok: false, error: 'Không tìm thấy batch để tiếp tục.' }
    if (snapshot.revision !== request.expectedRevision) return { ok: false, error: 'Batch revision đã thay đổi; hãy tải lại trạng thái.' }
    const candidateIds = new Set(resumeCandidateIds(snapshot))
    if (candidateIds.size === 0) return { ok: false, error: 'Batch không còn video pending/interrupted để tiếp tục.' }
    const candidates = snapshot.items.filter((item) => candidateIds.has(item.itemId)).sort((a, b) => a.ordinal - b.ordinal)
    const validated = validateAutoShortStartRequest({
      config: request.config,
      items: candidates.map((item) => ({ id: item.itemId, filePath: item.inputPath, ...(item.temporalEdit ? { temporalEdit: item.temporalEdit } : {}) }))
    })
    if (!validated.ok) return { ok: false, error: validated.error }
    for (const item of candidates) {
      const candidate = validated.value.items.find((entry) => entry.id === item.itemId)!
      if (item.configDigest !== itemConfigDigest(validated.value.config, candidate)) return { ok: false, error: 'Cấu hình hiện tại khác cấu hình batch đã checkpoint.' }
      if (await hashFileSha256(item.inputPath) !== item.inputDigest) return { ok: false, error: `Video nguồn đã thay đổi: ${basename(item.inputPath)}` }
    }
    return launchAutoShortJob(validated.value, onEvent, { jobId: snapshot.jobId, snapshot })
  } catch (error) {
    return { ok: false, error: errLabel(error) }
  }
}

/** Clear reusable stage artifacts without touching published videos or active work. */
export async function clearAutoShortArtifactCache(): Promise<{ ok: boolean; error?: string }> {
  if (activeJob) return { ok: false, error: 'Không thể xóa cache khi Auto Short đang chạy.' }
  try {
    await getAutoShortArtifactCache().clear(new AbortController().signal)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errLabel(error) }
  }
}

export async function cancelAutoShort(jobId: string): Promise<{ ok: boolean; error?: string }> {
  if (!activeJob) return { ok: false, error: 'Không có Auto Short job đang chạy.' }
  if (activeJob.id !== jobId) return { ok: false, error: 'Job ID không khớp.' }
  activeJob.cancelled = true
  activeJob.controller.abort()
  cancelBurn()
  await activeJob.done
  return { ok: true }
}

/** Stop every child-process owner used by Auto Short before Electron exits. */
export async function shutdownAutoShortRuntime(): Promise<void> {
  await Promise.all([...sttnPreviews.keys()].map((ownerId) => disposeAutoShortSttnPreview(ownerId)))
  const job = activeJob
  if (job) {
    job.shutdownRequested = true
    job.controller.abort()
  }
  cancelBurn()
  cancelOcr()
  cancelVideo2x()
  terminateTrackedProcessTrees()
  if (job) await job.done.catch(() => undefined)
  // A stage may have installed a child between the first cancellation and the
  // job promise settling; repeat the cancellation after the join as a final
  // process-cleanup barrier.
  cancelBurn()
  cancelOcr()
  cancelVideo2x()
  terminateTrackedProcessTrees()
}

interface SttnPreviewHooks {
  resolveFfmpeg?: typeof resolveFfmpeg
  resolveFfprobe?: typeof resolveFfprobe
  probeMedia?: typeof probeBurnMedia
  runVisualOcr?: typeof ocrVideoWithVisualTimeline
  removeSubtitles?: typeof runSttnRemoval
  runMedia?: typeof runSttnPreviewMedia
  resourceManager?: AutoShortResourceManager
}

/** Preview helpers await native process close before callers may remove work files. */
async function runSttnPreviewMedia(executable: string, args: string[], signal: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  await new Promise<void>((resolve, reject) => {
    const child = spawnAutoShortChild(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-n', ...args], { windowsHide: true, shell: false })
    let diagnostics = ''
    let spawnError: Error | undefined
    const abort = (): void => terminateProcessTree(child)
    child.stdout?.resume()
    child.stderr?.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-8192) })
    child.once('error', (error) => { spawnError = error })
    child.once('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(new Error('Đã hủy xem thử STTN.'))
      else if (spawnError || code !== 0) reject(new Error(`Không tạo được video xem thử STTN: ${spawnError?.message || diagnostics}`))
      else resolve()
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

export async function runAutoShortSttnPreview(
  raw: unknown,
  workDir: string,
  signal: AbortSignal,
  onProgress: (progress: AutoShortSttnPreviewProgress) => void,
  hooks: SttnPreviewHooks = {}
): Promise<{ outputPath: string; provider: 'cuda' | 'cpu'; elapsedMs: number }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Yêu cầu xem thử STTN không hợp lệ.')
  const request = raw as Record<string, unknown>
  if (Object.keys(request).some(key => !['videoPath', 'config', 'previewSeconds'].includes(key))) throw new Error('Yêu cầu xem thử chứa tham số không được phép.')
  const seconds = request.previewSeconds ?? 5
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || seconds > 10) throw new Error('Xem thử STTN chỉ hỗ trợ tối đa 10 giây.')
  if (!request.config || typeof request.config !== 'object' || Array.isArray(request.config)) throw new Error('Cấu hình xem thử không hợp lệ.')
  const validated = validateAutoShortStartRequest({
    config: { ...request.config, outputDir: workDir },
    items: [{ id: 'sttn-preview', filePath: request.videoPath }]
  })
  if (!validated.ok) throw new Error(validated.error)
  const { config } = validated.value
  if (!isSttnRemoval(config)) throw new Error('Hãy bật chế độ xóa chữ STTN trước khi xem thử.')
  throwIfAborted(signal)
  const videoPath = validated.value.items[0].filePath
  if (!(await stat(videoPath)).isFile()) throw new Error('Video xem thử không hợp lệ.')
  const ffmpeg = await (hooks.resolveFfmpeg || resolveFfmpeg)()
  const ffprobe = await (hooks.resolveFfprobe || resolveFfprobe)()
  if (!ffmpeg || !ffprobe) throw new Error('Cần FFmpeg/FFprobe để xem thử STTN.')
  const media = hooks.runMedia || runSttnPreviewMedia
  const resourceManager = hooks.resourceManager || getGlobalResourceManager()
  await mkdir(workDir, { recursive: true })
  const sourceClip = join(workDir, 'source-preview.mkv')
  const cleanedPath = join(workDir, 'cleaned-preview.mkv')
  const outputPath = join(workDir, 'preview.mp4')
  onProgress({ percent: 0, message: 'Đang chuẩn bị đoạn xem thử…' })
  await media(ffmpeg, ['-i', videoPath, '-t', String(seconds), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'ffv1', '-level', '3', '-fps_mode', 'passthrough', '-c:a', 'pcm_s16le', sourceClip], signal)
  throwIfAborted(signal)
  const meta = await (hooks.probeMedia || probeBurnMedia)(sourceClip)
  const geometry = meta.geometry ?? deriveCanonicalDisplayGeometry({ codedWidth: meta.w, codedHeight: meta.h, rotation: meta.rotation, sampleAspectRatio: meta.sampleAspectRatio, videoStart: meta.videoStart })
  const scanRegion = normalizedToPixels(config.ocrRegion, geometry)
  if (!scanRegion) throw new Error('Cần chọn vùng OCR để xem thử STTN.')
  const ocrDir = join(workDir, 'ocr')
  await mkdir(ocrDir, { recursive: true })
  const visual = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], signal, async () => {
    return (hooks.runVisualOcr || ocrVideoWithVisualTimeline)({
      input: sourceClip, outputDir: ocrDir, scanRegion, profile: 'accurate', geometry,
      videoDurationSeconds: meta.videoDurationSeconds || meta.giay, sampleFps: 8, signal
    }, p => onProgress({ percent: 5 + Math.max(0, p.percent) * .35, message: 'Đang quét chữ trong đoạn xem thử…' }))
  })
  throwIfAborted(signal)
  if (!visual.timeline?.segments.length || !visual.boxSegmentCount) throw new Error('Không phát hiện chữ trong đoạn xem thử và vùng OCR đã chọn.')
  const result = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], signal, async () => {
    return (hooks.removeSubtitles || runSttnRemoval)({
      videoPath: sourceClip, timeline: visual.timeline, outputPath: cleanedPath,
      ffmpegPath: ffmpeg, ffprobePath: ffprobe, signal, previewSeconds: seconds,
      onProgress: (percent, message) => onProgress({ percent: 40 + percent * .5, message })
    })
  })
  throwIfAborted(signal)
  onProgress({ percent: 92, message: 'Đang tạo MP4 xem thử…' })
  await media(ffmpeg, ['-i', result.outputPath, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-pix_fmt', 'yuv420p', '-fps_mode', 'passthrough', '-c:a', 'aac', '-movflags', '+faststart', outputPath], signal)
  throwIfAborted(signal)
  if (!(await stat(outputPath)).size) throw new Error('Video xem thử STTN trống.')
  await Promise.all([sourceClip, cleanedPath, ocrDir].map(path => rm(path, { recursive: true, force: true })))
  onProgress({ percent: 100, message: `Xem thử STTN hoàn tất (${result.provider.toUpperCase()}).` })
  return { ...result, outputPath }
}

const sttnPreviews = new Map<number, { controller: AbortController; workDir: string; done: Promise<AutoShortSttnPreviewResult>; running: boolean }>()

export async function startAutoShortSttnPreview(ownerId: number, raw: unknown, onProgress: (progress: AutoShortSttnPreviewProgress) => void): Promise<AutoShortSttnPreviewResult> {
  const previous = sttnPreviews.get(ownerId)
  if (previous?.running) return { ok: false, error: 'Đang tạo đoạn xem thử STTN.' }
  const controller = new AbortController()
  const workDir = join(app.getPath('userData'), 'autoshort', 'sttn-previews', randomUUID())
  const entry = { controller, workDir, running: true, done: Promise.resolve<AutoShortSttnPreviewResult>({ ok: false, error: 'Đang chuẩn bị.' }) }
  sttnPreviews.set(ownerId, entry)
  entry.done = (async (): Promise<AutoShortSttnPreviewResult> => {
    try {
      if (previous) await rm(previous.workDir, { recursive: true, force: true })
      const result = await runAutoShortSttnPreview(raw, workDir, controller.signal, onProgress)
      return { ok: true, ...result }
    } catch (error) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
      return { ok: false, error: controller.signal.aborted ? 'Đã hủy xem thử STTN.' : sanitizeAutoShortAuditError(error, [workDir]) }
    } finally { entry.running = false }
  })()
  return entry.done
}

export async function cancelAutoShortSttnPreview(ownerId: number): Promise<void> {
  const preview = sttnPreviews.get(ownerId)
  if (!preview?.running) return
  preview.controller.abort()
  await preview.done
}

export async function disposeAutoShortSttnPreview(ownerId: number): Promise<void> {
  const preview = sttnPreviews.get(ownerId)
  if (!preview) return
  preview.controller.abort()
  await preview.done
  await rm(preview.workDir, { recursive: true, force: true }).catch(() => {})
  if (sttnPreviews.get(ownerId) === preview) sttnPreviews.delete(ownerId)
}

export async function selectAutoShortVideoFiles(): Promise<{ ok: boolean; paths: string[] }> {
  const res = await dialog.showOpenDialog({
    title: 'Chọn các video cần xử lý Auto Short',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'ts', 'flv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  if (res.canceled || !res.filePaths.length) return { ok: false, paths: [] }
  return { ok: true, paths: res.filePaths }
}

export function defaultAutoShortOcrRegion(meta: { w: number; h: number }, geometry: { displayWidth: number; displayHeight: number }): { x0: number; y0: number; x1: number; y1: number } {
  const portrait = meta.h > meta.w
  return {
    x0: 0,
    y0: Math.round(geometry.displayHeight * (portrait ? 0.72 : 0.74)),
    x1: geometry.displayWidth,
    y1: Math.round(geometry.displayHeight * (portrait ? 0.92 : 0.94))
  }
}
