import { basename, dirname, join } from 'node:path'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import type {
  AlignedCue,
  AutoShortConfig,
  AutoShortEvent,
  AutoShortItemResult,
  AutoShortProgress,
  AutoShortQueueItemInput,
  AutoShortStartRequest,
  SubtitleCue,
  TtsModelInfo,
  AutoShortSeparationPreset,
  SeparatorProvider,
  BurnResult,
  WhisperProgress
} from '../shared/types'
import type { TranslationAssessment, TranslationInput, TranslationItem, TranslationIssue } from '../shared/translation'
import type { TranslationBudgetSnapshot } from './translation/budget'
import { parseSrt, serializeSrt } from '../shared/subtitles'
import {
  isAutomaticOcrBlur,
  isSttnRemoval,
  effectiveAutoShortOcrProfile
} from '../shared/autoShortOcrBlur'
import {
  projectOcrTimelineToSubtitleCues,
  validateStabilizedOcrVisualTimeline,
  type OcrVisualTimeline,
  type OcrVisualTransport
} from '../shared/ocrVisualTimeline'
import {
  deriveCanonicalDisplayGeometry,
  normalizedRegionToDisplayPixels
} from './canonicalDisplayGeometry'
import { probeBurnMedia, type burnAutoShort } from './burn'
import { ocrVideo, type ocrVideoWithVisualTimeline } from './ocr'
import { transcribeAudio } from './whisper'
import { validateAutoShortPublicationTimeline } from './autoShortPolicy'
import { fuseWhisperAndOcr, clampAlignedCueTimeline } from '../shared/autoShortAlignment'
import {
  mustRegenerateOcrSource,
  digestCanonicalSourceCues,
  sameOcrSourceCueEvidence,
  type OcrSourceCueEvidence
} from './autoShortOcrCheckpoint'
import type { AutoShortExecutionPolicy } from './autoShortExecutionPolicy'
import {
  createOcrBlurAuditMetadata,
  createSubtitlePlacementAuditMetadata,
  sanitizeAutoShortAuditError
} from './autoShortAudit'
import { resolveAutoShortSubtitlePlacement } from '../shared/autoShortSubtitlePlacement'
import type { writeTimedOcrBlurMask, TimedOcrBlurMask } from './ocrMask'
import {
  translateStrict,
  synthesizeVoice,
  stitchAudioTimeline,
  preserveAutoShortArtifacts,
  buildAutoShortCheckpointFingerprintCandidates,
  serializeAlignedCues,
  alignedFromSrt,
  readWhisperAlignedCues,
  needsCuda,
  normalizedToPixels,
  throwIfAborted,
  fileExists,
  uniqueOutputName,
  defaultAutoShortOcrRegion,
  AUTO_SHORT_CHECKPOINT_VERSION,
  type PreparedAutoShortSeparation,
  type AutoShortArtifactEntry
} from './autoshort'
import type { SeparatorProviderState } from './separation/pipeline'
import { createAutoShortItemScope, type BranchOutcome } from './autoShortItemScope'
import {
  AutoShortResourceManager,
  getGlobalResourceManager,
  type AutoShortResourceType
} from './autoShortResourceManager'
import { resolveAutoShortWhisperLanguage } from './autoShortPolicy'
import { buildStageKey, hashFileSha256 } from './autoShortStageKeys'
import type { ArtifactCache, ArtifactLease } from './autoShortArtifactCache'
import { resolveTranslationSourceLanguage } from './localTranslatePolicy'
import { composeAutoShortNarratedAudio } from './autoShortNarratedAudio'
import { composeAutoShortBackgroundAudio } from './autoShortBackgroundAudio'
import { DubbingVideoExtensionLimitError, type DubbingTimeMap } from './dubbing/timeMap'
import { retimeDubbingMedia } from './dubbing/retimeMedia'
import { validateAutoShortMusicTrack } from './autoShortMusicLibrary'
import { assessContentQuality } from './autoShortContentQuality'
import { separateSourceAudio } from './separation/pipeline'
import { errLabel, logInfo, logWarn, logError } from './logger'
import type { getTtsModels } from './tts'
import { runSttnRemoval } from './inpainting/runner'
import { STTN_MODEL } from './inpainting/assets'
import { buildTranslationIdentity, type TranslationArtifact } from './translation/checkpoint'
import { TRANSLATION_PARSER_VERSION, TRANSLATION_PROMPT_VERSION } from './translation/prompts'
import { cutAutoShortSourceByFramePlan } from './autoShortCutMedia'
import { probeAutoShortFrameIndex, upgradeLegacyTemporalEdit } from './autoShortFrameIndex'
import { compileFrameCutPlan, cutTimeToDecimal } from '../shared/autoShortCutPlan'
import type { CutExecutionPlan } from '../shared/autoShortCutPlan'
import { semanticFrameEditDigest, semanticTemporalSourceDigest } from './autoShortCutIdentity'
import { validatePreparedCut } from './autoShortCutValidation'
import { findCutSeamCueIssues } from '../shared/autoShortCutCues'
import { assessTranslationLanguage, normalizeTranslationLocale } from './translation/language'
import { mapTranslationsStrict } from './translation/response'
import { createInvalidSourceAssessment } from './translation/orchestrator'

import {
  AutoShortTelemetryCollector,
  AutoShortTelemetryJobBudget,
  sanitizeEndpointAlias,
  sanitizeTelemetryPath
} from './autoShortTelemetry'
import type { AutoShortStageInfo } from '../shared/types'

/**
 * OCR and its timed mask are anchored to the video stream.  `Meta.giay` is
 * kept as the legacy/container duration and may include an audio tail that
 * is a few frames longer than the video stream.  Passing that container value
 * to the OCR sidecar makes its stream duration fail exact timeline validation.
 */
function visualVideoDuration(meta: { giay: number; videoDurationSeconds?: number | null }): number {
  return Number.isFinite(meta.videoDurationSeconds) && (meta.videoDurationSeconds || 0) > 0
    ? meta.videoDurationSeconds as number
    : meta.giay
}

/**
 * Merge a partial translation checkpoint with the canonical SRT emitted by
 * the translator.  A successful strict translation writes the complete cue
 * set, so checkpoint entries already present in that SRT must not be appended
 * a second time and fail the identity validator as duplicate IDs.
 */
export function mergeRecoveredTranslationItems(
  reusablePartial: readonly TranslationItem[],
  translated: readonly TranslationItem[]
): TranslationItem[] {
  const translatedIds = new Set(translated.map((item) => item.id.trim()))
  return [
    ...reusablePartial.filter((item) => !translatedIds.has(item.id.trim())),
    ...translated
  ]
}

/**
 * A visual OCR cache is reusable across a stream request and a legacy-disk
 * fallback.  Both transports produce the same display-space timeline contract;
 * the fallback is only an implementation detail of an older installed
 * runtime.  Do not reuse a stream artifact for an explicitly requested legacy
 * run because that request may be a deliberate compatibility choice.
 */
export function isCompatibleOcrTransport(
  requested: OcrVisualTransport,
  cached: OcrVisualTransport | undefined
): boolean {
  const actual = cached || 'legacy-disk'
  if (requested === actual) return true
  return actual === 'legacy-disk' && (requested === 'stream-full' || requested === 'stream-roi')
}

export interface AutoShortItemCoordinatorDeps {
  resolveFfmpeg: () => Promise<string | null>
  resolveFfprobe: () => Promise<string | null>
  probeMedia?: typeof probeBurnMedia
  transcribeAudio?: typeof transcribeAudio
  runVisualOcr: typeof ocrVideoWithVisualTimeline
  writeTimedMask: typeof writeTimedOcrBlurMask
  burn: typeof burnAutoShort
  removeSubtitles?: typeof runSttnRemoval
}

export interface AutoShortItemContext {
  jobId: string
  request: AutoShortStartRequest
  item: AutoShortQueueItemInput
  index: number
  total: number
  recoveryAttempt?: 1 | 2
  signal: AbortSignal
  emit: (event: AutoShortEvent) => void
  checkpointDir: string
  workDir: string
  artifactDir: string
  /** Opaque digest of the effective non-secret AutoShort configuration. */
  batchConfigDigest?: string
  /** Reserved per-video directory under the selected output root. */
  itemOutputDir?: string
  ttsCapabilities?: Awaited<ReturnType<typeof getTtsModels>>
  ttsCapabilitiesUrl?: string
  separation?: PreparedAutoShortSeparation
  separationProviderState: SeparatorProviderState
  telemetry?: AutoShortTelemetryCollector
  telemetryBudget?: AutoShortTelemetryJobBudget
  policy?: AutoShortExecutionPolicy
  resourceManager?: AutoShortResourceManager
  artifactCache?: ArtifactCache
}

function emitProgress(
  context: AutoShortItemContext,
  itemStatus: AutoShortProgress['itemStatus'],
  percent: number,
  message: string,
  outputPath?: string,
  error?: string,
  stageInfo?: AutoShortStageInfo,
  diagnosticsIncomplete?: boolean,
  translationAssessment?: TranslationAssessment,
  translationIdentity?: string
): void {
  context.emit({
    type: 'item-progress',
    jobId: context.jobId,
    taskId: context.item.id,
    itemId: context.item.id,
    itemStatus,
    itemPercent: Math.max(0, Math.min(100, Math.round(percent))),
    itemMessage: message,
    batchIndex: context.index + 1,
    batchTotal: context.total,
    outputPath,
    error,
    stageInfo: stageInfo
      ? {
          ...stageInfo,
          etaText: stageInfo.etaText || 'chưa đủ dữ liệu'
        }
      : undefined,
    diagnosticsIncomplete,
    translationAssessment,
    translationIdentity
  })
}

function parseCachedAlignedArtifact(value: unknown): { language: string | null; cues: AlignedCue[] } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.cues)) return null
  const cues: AlignedCue[] = []
  for (const item of raw.cues) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const cue = item as Record<string, unknown>
    const source = cue.source
    const timingQuality = cue.timingQuality
    if (typeof cue.id !== 'string' || !cue.id.trim() ||
      !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || (cue.end as number) <= (cue.start as number) ||
      typeof cue.text !== 'string' || !cue.text.trim() ||
      (source !== 'whisper' && source !== 'ocr' && source !== 'fused') ||
      (timingQuality !== 'word' && timingQuality !== 'cue' && timingQuality !== 'ocr')) return null
    cues.push({
      id: cue.id,
      start: cue.start as number,
      end: cue.end as number,
      text: cue.text,
      source,
      timingQuality,
      ...(Array.isArray(cue.words) ? { words: cue.words as AlignedCue['words'] } : {}),
      ...(cue.confidence == null || Number.isFinite(cue.confidence) ? { confidence: cue.confidence as number | null | undefined } : {})
    })
  }
  if (cues.length === 0) return null
  return {
    language: typeof raw.language === 'string' && raw.language.trim() ? raw.language : null,
    cues
  }
}

function parseCachedSubtitleArtifact(
  value: unknown,
  expectedKey?: string,
  expectedModelIdentity?: string
): { cues: TranslationItem[]; assessment: TranslationAssessment; modelIdentity: string; key: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 2 || typeof raw.key !== 'string' || !/^[a-f0-9]{64}$/iu.test(raw.key) ||
    (expectedKey && raw.key !== expectedKey) || typeof raw.modelIdentity !== 'string' || !raw.modelIdentity.trim() ||
    (expectedModelIdentity && raw.modelIdentity !== expectedModelIdentity) ||
    !raw.result || typeof raw.result !== 'object' || Array.isArray(raw.result)) return null
  const result = raw.result as Record<string, unknown>
  if (!Array.isArray(result.items) || !result.assessment || typeof result.assessment !== 'object' || Array.isArray(result.assessment)) return null
  const assessment = result.assessment as Record<string, unknown>
  if (assessment.version !== 'translation-assessment-v2' ||
    !['validated', 'with-warnings', 'needs-review'].includes(String(assessment.disposition)) ||
    !Array.isArray(assessment.issues) ||
    !['matched', 'suspect', 'unknown'].includes(String(assessment.languageEvidence)) ||
    (result.modelIdentity !== undefined && result.modelIdentity !== raw.modelIdentity)) return null
  const issues: TranslationIssue[] = []
  const issueCodes = new Set<TranslationIssue['code']>([
    'invalid-source', 'missing-id', 'duplicate-id', 'unknown-id', 'empty-text',
    'unparsed-content', 'truncated-output', 'protected-token-suspect',
    'language-suspect', 'unsupported-capability', 'budget-exhausted',
    'no-progress', 'provider-auth', 'provider-transient', 'provider-protocol', 'cancelled'
  ])
  for (const value of assessment.issues) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Record<string, unknown>
    if (typeof item.code !== 'string' || !issueCodes.has(item.code as TranslationIssue['code']) ||
      (item.severity !== 'error' && item.severity !== 'warning') ||
      (item.confidence !== 'certain' && item.confidence !== 'heuristic' && item.confidence !== 'unknown') ||
      !Array.isArray(item.cueIds) || item.cueIds.some((id) => typeof id !== 'string') ||
      typeof item.message !== 'string' || !item.message.trim()) return null
    issues.push({
      code: item.code as TranslationIssue['code'],
      severity: item.severity as TranslationIssue['severity'],
      confidence: item.confidence as TranslationIssue['confidence'],
      cueIds: [...item.cueIds] as string[],
      message: item.message
    })
  }
  const cues: TranslationItem[] = []
  for (const item of result.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const cue = item as Record<string, unknown>
    if (typeof cue.id !== 'string' || !cue.id.trim() || typeof cue.text !== 'string' || !cue.text.trim()) return null
    cues.push({
      id: cue.id,
      text: cue.text
    })
  }
  if (cues.length === 0) return null
  return {
    cues,
    assessment: {
      version: 'translation-assessment-v2',
      disposition: assessment.disposition as TranslationAssessment['disposition'],
      issues,
      languageEvidence: assessment.languageEvidence as TranslationAssessment['languageEvidence']
    },
    modelIdentity: raw.modelIdentity,
    key: raw.key
  }
}

function buildTranslationInput(
  sourceCues: readonly SubtitleCue[],
  sourceLanguage: string,
  targetLocale: string,
  mode: 'subtitle' | 'dubbing'
): TranslationInput {
  const cues = sourceCues.map((cue, index) => ({
    id: cue.id,
    sourceIndex: Number.isInteger(cue.sourceIndex) ? cue.sourceIndex : index,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    groupId: `cue-${Number.isInteger(cue.sourceIndex) ? cue.sourceIndex : index}`
  }))
  return {
    sourceLanguage: sourceLanguage.trim() || 'auto',
    targetLocale,
    mode,
    cues,
    contextBefore: [],
    contextAfter: [],
    glossary: []
  }
}

function translationModelIdentity(config: AutoShortConfig): { modelIdentity: string; revisionKnown: boolean; profileId: string } {
  if (config.translateProvider === 'local') {
    return {
      modelIdentity: 'llm-default',
      revisionKnown: false,
      profileId: sanitizeEndpointAlias(config.translateServerUrl) || 'local-default'
    }
  }
  return {
    modelIdentity: `${config.translateProvider}:configured-model`,
    revisionKnown: false,
    profileId: `${config.translateProvider}-account`
  }
}

/**
 * Provider SRT adapters historically address cues by their position in the
 * request (`cue-0`, `cue-1`). AutoShort's canonical source IDs also include
 * timing. Normalize the legacy wire IDs at this single boundary so a partial
 * batch can be checkpointed and resumed without positional guessing.
 */
function normalizeProviderBatchItems(
  items: readonly TranslationItem[],
  pendingSourceCues: readonly SubtitleCue[],
  sourceCues: readonly SubtitleCue[]
): TranslationItem[] {
  const byCanonicalId = new Map(sourceCues.map((cue) => [cue.id.trim(), cue.id.trim()]))
  const byLegacyIndex = new Map(pendingSourceCues.map((cue, index) => [`cue-${index}`, cue.id.trim()]))
  return items.map((item) => {
    const rawId = item.id.trim()
    const canonicalId = byCanonicalId.get(rawId) || byLegacyIndex.get(rawId) || rawId
    return { id: canonicalId, text: item.text }
  })
}

function parseCachedVisualArtifact(value: unknown): {
  timeline: OcrVisualTimeline
  engineVersion: string
  transport?: OcrVisualTimeline['transport']
  implementationFingerprint?: string
  ocrProvider?: OcrVisualTimeline['ocrProvider']
  visualSegmentCount: number
  boxSegmentCount: number
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1 || !raw.timeline || typeof raw.timeline !== 'object') return null
  if (typeof raw.engineVersion !== 'string' || !raw.engineVersion.trim() ||
    !Number.isInteger(raw.visualSegmentCount) || (raw.visualSegmentCount as number) <= 0 ||
    !Number.isInteger(raw.boxSegmentCount) || (raw.boxSegmentCount as number) <= 0) return null
  return {
    timeline: raw.timeline as OcrVisualTimeline,
    engineVersion: raw.engineVersion,
    ...(raw.transport === 'legacy-disk' || raw.transport === 'stream-full' || raw.transport === 'stream-roi' ? { transport: raw.transport } : {}),
    ...(typeof raw.implementationFingerprint === 'string' ? { implementationFingerprint: raw.implementationFingerprint } : {}),
    ...(raw.ocrProvider && typeof raw.ocrProvider === 'object' ? { ocrProvider: raw.ocrProvider as OcrVisualTimeline['ocrProvider'] } : {}),
    visualSegmentCount: raw.visualSegmentCount as number,
    boxSegmentCount: raw.boxSegmentCount as number
  }
}

export function createAutoShortItemProcessor(
  deps: AutoShortItemCoordinatorDeps
): (context: AutoShortItemContext) => Promise<AutoShortItemResult> {
  return async function processItem(context: AutoShortItemContext): Promise<AutoShortItemResult> {
    const { jobId, request, item, index, total, signal: parentSignal, checkpointDir, workDir, artifactDir } = context
    const scope = createAutoShortItemScope(parentSignal)
    const signal = scope.signal
    const resourceManager = context.resourceManager || getGlobalResourceManager()
    const artifactCache = context.artifactCache
    const { config } = request
    const itemOutputDir = context.itemOutputDir || config.outputDir
    let sttnWorkDir: string | undefined
    let sttnCacheLease: ArtifactLease | null = null

    await mkdir(workDir, { recursive: true })
    await mkdir(checkpointDir, { recursive: true })
    await mkdir(itemOutputDir, { recursive: true })
    const diagnosticsDir = join(artifactDir, 'diagnostics')
    await mkdir(diagnosticsDir, { recursive: true }).catch(() => {})

    const telemetry = context.telemetry || new AutoShortTelemetryCollector({
      jobId,
      itemId: item.id,
      diagnosticsDir,
      budget: context.telemetryBudget
    })

    const checkpointFile = join(checkpointDir, 'checkpoint.json')
    let checkpoint: {
      version?: number
      fingerprint?: string
      sourceCues?: AlignedCue[]
      ocrSourceEvidence?: OcrSourceCueEvidence
      detectedSourceLanguage?: string | null
      translatedCues?: SubtitleCue[]
      translationKey?: string
      translationModelIdentity?: string
      translationAssessment?: TranslationAssessment
      translationBatches?: Record<string, { items: TranslationItem[]; modelIdentity: string }>
      translationRetryGeneration?: number
      translationAttemptGeneration?: number
      translationBudget?: TranslationBudgetSnapshot
      instrumentalPath?: string
      durationRecovery?: AutoShortItemResult['recovery']
    } = {}

    try {
      checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'))
    } catch {
      checkpoint = {}
    }

    const saveCheckpoint = async (): Promise<void> => {
      // Checkpoint updates are the resume commit point. Write beside the
      // authoritative file and replace it atomically so a crash cannot leave
      // half a JSON document that looks like a valid translation state.
      const temporary = `${checkpointFile}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(checkpoint, null, 2), 'utf8')
        await rename(temporary, checkpointFile)
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
    }

    let extractedCueCount: number | undefined
    let translatedCueCount: number | undefined
    let translationAssessment: TranslationAssessment | undefined = checkpoint.translationAssessment
    let providerTranslationAssessment: TranslationAssessment | undefined
    let translationIdentity: string | undefined = checkpoint.translationKey
    let generatedVoiceCount: number | undefined
    let voice: string | undefined
    let detectedSourceLanguage: string | null = checkpoint.detectedSourceLanguage || null
    let outputName: string | undefined
    let selectedBackgroundMusicPath: string | undefined
    let artifactPath: string | undefined
    let published = false
    let burnResult: BurnResult | undefined

    let separationAuditMetadata: {
      audioMode: 'separate-vocals'
      separationPreset: AutoShortSeparationPreset
      separatorModelId: string
      separatorModelSha256: string
      separatorEngineVersion: string
      requestedProvider: 'auto'
      effectiveProvider: SeparatorProvider
      fallbackReasonCode?: string
      separationElapsedMs: number
    } | undefined

    const artifactEntries: AutoShortArtifactEntry[] = []
    let caughtError: unknown = undefined

    const failInvalidSource = (message: string): never => {
      if (config.translateTarget.trim() !== 'none') {
        translationAssessment = createInvalidSourceAssessment(message)
        checkpoint.translationAssessment = translationAssessment
      }
      // Carry the assessment through the item boundary so the catch handler
      // persists it even when source extraction fails before a provider call.
      throw Object.assign(new Error(message), {
        translationAssessment
      })
    }

    try {
      throwIfAborted(signal)
      const inputInfo = await stat(item.filePath).catch(() => null)
      if (!inputInfo?.isFile() || inputInfo.size <= 0) {
        throw new Error(`Video không hợp lệ: ${basename(item.filePath)}`)
      }

      await telemetry.withStageSpan('validate', {}, async (validateSpan) => {
        validateSpan.updateCounters({ inputBytes: inputInfo.size })
      })

      const { sourceDigest, meta, ffmpeg, ffprobe, geometry } = await telemetry.withStageSpan('metadata', {}, async (span) => {
        const sourceDigest = await hashFileSha256(item.filePath, signal)
        const checkpointFingerprints = buildAutoShortCheckpointFingerprintCandidates(
          item.filePath,
          inputInfo,
          config,
          context.separation,
          sourceDigest,
          item.temporalEdit
        )

        const checkpointFingerprint = checkpointFingerprints[0]

        if (checkpoint.version !== AUTO_SHORT_CHECKPOINT_VERSION || !checkpointFingerprints.includes(checkpoint.fingerprint || '')) {
          if (checkpoint.sourceCues?.length || checkpoint.translatedCues?.length || checkpoint.instrumentalPath) {
            logInfo('[AutoShort] Bỏ checkpoint cũ vì không khớp fingerprint input/cấu hình hiện tại.')
          }
          if (await fileExists(checkpointFile)) {
            await copyFile(checkpointFile, join(checkpointDir, 'checkpoint.previous.json')).catch(() => {})
          }
          await mkdir(checkpointDir, { recursive: true })
          checkpoint = {}
          detectedSourceLanguage = null
        }
        checkpoint.version = AUTO_SHORT_CHECKPOINT_VERSION
        checkpoint.fingerprint = checkpointFingerprint

        const probeFn = deps.probeMedia || probeBurnMedia
        const meta = await probeFn(item.filePath)
        if (!(meta.giay > 0) || !(meta.w > 0) || !(meta.h > 0)) {
          throw new Error('Video không có metadata hợp lệ')
        }
        const ffmpeg = await deps.resolveFfmpeg()
        if (!ffmpeg) throw new Error('Thiếu FFmpeg để xuất video.')
        const ffprobe = await deps.resolveFfprobe()
        if (!ffprobe) throw new Error('Thiếu FFprobe để kiểm tra video.')
        const geometry = meta.geometry ?? deriveCanonicalDisplayGeometry({
          codedWidth: meta.w,
          codedHeight: meta.h,
          rotation: meta.rotation,
          sampleAspectRatio: meta.sampleAspectRatio,
          videoStart: meta.videoStart
        })
        span.updateCounters({ sourceBytes: inputInfo.size, durationMs: Math.round(meta.giay * 1000), width: geometry.displayWidth, height: geometry.displayHeight })
        return { sourceDigest, meta, ffmpeg, ffprobe, geometry }
      })
      let processingPath = item.filePath
      let processingDigest = sourceDigest
      let processingMeta = meta
      let processingGeometry = geometry
      let cutExecutionPlan: CutExecutionPlan | undefined
      if (item.temporalEdit?.removedRanges.length) {
        emitProgress(context, 'extracting_sub', 2, 'Đang chuẩn bị video theo các đoạn đã cắt…')
        const cut = await telemetry.withStageSpan('metadata', {}, async (span) => {
          const frameIndex = await probeAutoShortFrameIndex({
            ffprobePath: ffprobe,
            sourcePath: item.filePath,
            itemId: item.id,
            expectedSourceDigest: sourceDigest,
            signal
          })
          const temporalEdit = item.temporalEdit!.schemaVersion === 1
            ? upgradeLegacyTemporalEdit(item.temporalEdit!, frameIndex)
            : item.temporalEdit!
          const plan = compileFrameCutPlan({
            edit: temporalEdit,
            index: frameIndex,
            identity: {
              sourceDigest,
              editDigest: semanticFrameEditDigest(temporalEdit),
              executorRevision: 'cut-executor-v2',
              runtimeDigest: await hashFileSha256(ffmpeg, signal),
              mediaPolicyDigest: createHash('sha256').update('ffv1-source-pixfmt_pcm-source-format_graph-file-v1').digest('hex')
            }
          })
          const result = await cutAutoShortSourceByFramePlan({
            ffmpeg,
            sourcePath: item.filePath,
            workDir,
            plan,
            hasAudio: meta.hasAudio,
            signal
          })
          const validation = await validatePreparedCut({
            ffmpegPath: ffmpeg,
            ffprobePath: ffprobe,
            sourcePath: item.filePath,
            preparedPath: result.path,
            plan: result.plan,
            signal
          })
          if (!validation.ok) throw new Error(`${validation.code}: ${validation.details}`)
          span.updateCounters({
            removedRangeCount: temporalEdit.removedRanges.length,
            outputDurationMs: Math.round(Number(cutTimeToDecimal(result.plan.editedDuration)) * 1000)
          })
          return { ...result, temporalEdit, validation }
        })
        processingPath = cut.path
        cutExecutionPlan = cut.plan
        processingDigest = semanticTemporalSourceDigest(sourceDigest, cut.temporalEdit)
        processingMeta = await (deps.probeMedia || probeBurnMedia)(processingPath)
        if (!(processingMeta.giay > 0) || !(processingMeta.w > 0) || !(processingMeta.h > 0)) {
          throw new Error('Video sau cắt không có metadata hợp lệ.')
        }
        processingGeometry = processingMeta.geometry ?? deriveCanonicalDisplayGeometry({
          codedWidth: processingMeta.w,
          codedHeight: processingMeta.h,
          rotation: processingMeta.rotation,
          sampleAspectRatio: processingMeta.sampleAspectRatio,
          videoStart: processingMeta.videoStart
        })
        const cutManifestPath = join(workDir, 'cut-plan.json')
        await writeFile(cutManifestPath, JSON.stringify(cut.plan, null, 2), 'utf8')
        artifactEntries.push({ source: cutManifestPath, name: 'cut-plan.json' })
        const validationManifestPath = join(workDir, 'cut-validation.json')
        await writeFile(validationManifestPath, JSON.stringify(cut.validation.manifest, null, 2), 'utf8')
        artifactEntries.push({ source: validationManifestPath, name: 'cut-validation.json' })
      }
      const visualDurationSeconds = visualVideoDuration(processingMeta)

      const ocrRegion = (config.ocrRegion ? normalizedToPixels(config.ocrRegion, processingGeometry) : undefined) || defaultAutoShortOcrRegion(processingMeta, processingGeometry)
      const blurRegions = config.blurRegions.flatMap((r) => {
        try {
          const pixels = normalizedToPixels(r, processingGeometry)
          return pixels ? [{ ...pixels, id: r.id, color: r.color }] : []
        } catch {
          return []
        }
      })

      const rawSrtPath = join(workDir, 'source.srt')
      let sourceCues: SubtitleCue[] = []

      const automaticBlur = isAutomaticOcrBlur(config)
      const sttnRemoval = isSttnRemoval(config)
      const visualOcrRequired = automaticBlur || sttnRemoval
      const effectiveProfile = effectiveAutoShortOcrProfile(config)
      const forceFreshOcr = mustRegenerateOcrSource(config) || (sttnRemoval && config.subtitleMethod !== 'whisper')

      // Exactly one visual OCR promise per item when automatic blur is active
      let visualOcrPromise: Promise<Awaited<ReturnType<typeof deps.runVisualOcr>>> | null = null
      const getVisualOcr = (ocrSignal: AbortSignal = signal) => {
        if (!visualOcrPromise) {
          visualOcrPromise = telemetry.withStageSpan('visual_ocr', { requestedProvider: 'auto' }, async (span) => {
            emitProgress(context, 'extracting_sub', 5, 'Đang quét chữ trong video…', undefined, undefined, { stage: 'visual_ocr', phase: 'running' })
            const ocrDir = join(workDir, 'ocr')
            await mkdir(ocrDir, { recursive: true })
            const requestedTransport = context.policy?.ocrTransport || 'stream-roi'
            const visualCacheKey = buildStageKey('visual-ocr', {
              // Transport is intentionally excluded from the key: a qualified
              // stream runtime and a legacy fallback both emit the same
              // display-space timeline.  The revision invalidates artifacts
              // created before this compatibility rule was introduced.
              cacheRevision: 'ocr-visual-cues-v2',
              sourceDigest: processingDigest,
              profile: effectiveProfile,
              geometryFingerprint: processingGeometry.fingerprint,
              displayWidth: processingGeometry.displayWidth,
              displayHeight: processingGeometry.displayHeight,
              scanRegion: ocrRegion,
              sampleFps: 8
            })

            if (artifactCache) {
              const cached = await artifactCache.get('visual-ocr', visualCacheKey, ocrSignal).catch(() => null)
              if (cached) {
                try {
                  const payload = parseCachedVisualArtifact(JSON.parse(await readFile(cached.path, 'utf8')))
                  const transportMatches = isCompatibleOcrTransport(requestedTransport, payload?.transport)
                  if (payload && transportMatches) {
                    const timeline = validateStabilizedOcrVisualTimeline(payload.timeline, {
                      width: processingGeometry.displayWidth,
                      height: processingGeometry.displayHeight,
                      durationSeconds: visualDurationSeconds,
                      sampleFps: 8,
                      geometryFingerprint: processingGeometry.fingerprint,
                      scanRegion: ocrRegion
                    })
                    const sidecarPath = join(ocrDir, 'visual-cues.json')
                    const sourceSrtPath = join(ocrDir, 'source.srt')
                    await writeFile(sidecarPath, JSON.stringify(timeline, null, 2), 'utf8')
                    await writeFile(sourceSrtPath, serializeSrt(projectOcrTimelineToSubtitleCues(timeline)), 'utf8')
                    span.updateCounters({
                      cacheHit: 1,
                      visualSegments: payload.visualSegmentCount,
                      boxSegments: payload.boxSegmentCount
                    })
                    return {
                      timeline,
                      sourceSrtPath,
                      sidecarPath,
                      engineVersion: payload.engineVersion,
                      engineProtocol: 'ocr-local/1' as const,
                      transport: payload.transport || 'legacy-disk',
                      implementationFingerprint: payload.implementationFingerprint,
                      ocrProvider: payload.ocrProvider,
                      visualSegmentCount: payload.visualSegmentCount,
                      boxSegmentCount: payload.boxSegmentCount
                    }
                  }
                } catch {
                  // Corrupt or stale entries are treated as a cache miss. A
                  // successful fresh run below replaces the entry atomically.
                } finally {
                  cached.release()
                }
              }
            }
            const ocrRes = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], ocrSignal, async (lease) => {
              span.recordResourceWait(lease.waitMs || 0)
              return deps.runVisualOcr(
                {
                  input: processingPath,
                  outputDir: ocrDir,
                  scanRegion: ocrRegion,
                  profile: effectiveProfile,
                  geometry: processingGeometry,
                  videoDurationSeconds: visualDurationSeconds,
                  sampleFps: 8,
                  signal: ocrSignal,
                  ocrTransport: requestedTransport
                },
                (p) => {
                  emitProgress(context, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, 'Đang quét chữ trong video…', undefined, undefined, { stage: 'visual_ocr', phase: 'running' })
                }
              )
            })
            emitProgress(context, 'extracting_sub', 30, 'Đang kiểm tra timeline OCR…', undefined, undefined, { stage: 'visual_ocr', phase: 'validating' })
            if (!ocrRes.timeline || ocrRes.timeline.segments.length === 0 || ocrRes.boxSegmentCount === 0) {
              throw new Error('OCR không phát hiện vùng chữ hợp lệ trong vùng quét.')
            }
            span.updateCounters({
              visualSegments: ocrRes.visualSegmentCount,
              boxSegments: ocrRes.boxSegmentCount
            })
            if (artifactCache) {
              const cacheSource = join(ocrDir, 'visual-cache.json')
              await writeFile(cacheSource, JSON.stringify({
                schemaVersion: 1,
                timeline: ocrRes.timeline,
                engineVersion: ocrRes.engineVersion,
                transport: ocrRes.transport,
                implementationFingerprint: ocrRes.implementationFingerprint,
                ocrProvider: ocrRes.ocrProvider,
                visualSegmentCount: ocrRes.visualSegmentCount,
                boxSegmentCount: ocrRes.boxSegmentCount
              }), 'utf8')
              await artifactCache.put('visual-ocr', visualCacheKey, cacheSource, ocrSignal).catch((error) => {
                logWarn(`[AutoShort] Không lưu cache visual OCR: ${errLabel(error)}`)
              })
            }
            return ocrRes
          })
        }
        return visualOcrPromise
      }

      // Parallel visual processing branch: runs Visual OCR + STTN concurrently with audio / subtitle branch
      type VisualBranchResult = {
        renderVideoPath: string
        timedMask: TimedOcrBlurMask | null
        visualResultForAudit: Awaited<ReturnType<typeof deps.runVisualOcr>> | null
        sttnAudit?: { provider: 'cuda' | 'cpu'; elapsedMs: number }
      }
      let visualBranchOutcomePromise: Promise<BranchOutcome<VisualBranchResult>> | null = null

      const runVisualBranch = async (branchSignal: AbortSignal): Promise<VisualBranchResult> => {
        let branchRenderVideoPath = processingPath
        let branchTimedMask: TimedOcrBlurMask | null = null
        let branchVisualResult: Awaited<ReturnType<typeof deps.runVisualOcr>> | null = null
        let branchSttnAudit: { provider: 'cuda' | 'cpu'; elapsedMs: number } | undefined

        if (visualOcrRequired) {
          branchVisualResult = await getVisualOcr(branchSignal)
        }

        if (sttnRemoval && branchVisualResult) {
          emitProgress(context, 'removing_subtitles', 82, 'Đang xóa chữ bằng STTN…', undefined, undefined, { stage: 'sttn', phase: 'running' })
          const cleaned = await telemetry.withStageSpan('sttn', { requestedProvider: 'cuda' }, async (span) => {
            const sttnCacheKey = buildStageKey('sttn', {
              cacheRevision: 'sttn-inpaint-v2',
              sourceDigest: processingDigest,
              timeline: branchVisualResult!.timeline,
              geometryFingerprint: processingGeometry.fingerprint,
              displayWidth: processingGeometry.displayWidth,
              displayHeight: processingGeometry.displayHeight,
              modelRevision: STTN_MODEL.revision,
              modelSha256: STTN_MODEL.sha256,
              protocol: 'sttn-engine/1',
              provider: 'auto',
              maxFrames: 12
            })
            if (artifactCache) {
              const cached = await artifactCache.get('sttn', sttnCacheKey, branchSignal).catch(() => null)
              if (cached) {
                sttnCacheLease = cached
                span.setProvider('cache', 'cache')
                span.updateCounters({ cacheHit: 1 })
                return { outputPath: cached.path, provider: null, elapsedMs: 0, cacheHit: true }
              }
            }
            sttnWorkDir = await mkdtemp(join(itemOutputDir, '.sttn-'))
            const res = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], branchSignal, async (lease) => {
              span.recordResourceWait(lease.waitMs || 0)
              return (deps.removeSubtitles || runSttnRemoval)({
                videoPath: processingPath,
                timeline: branchVisualResult!.timeline,
                outputPath: join(sttnWorkDir!, 'sttn-cleaned.mkv'),
                ffmpegPath: ffmpeg,
                ffprobePath: ffprobe,
                signal: branchSignal,
                onProgress: (percent, message) => emitProgress(context, 'removing_subtitles', 82 + percent * 0.03, message, undefined, undefined, { stage: 'sttn', phase: 'running' })
              })
            })
            span.setProvider('cuda', res.provider)
            span.updateCounters({ elapsedMs: res.elapsedMs })
            if (artifactCache) {
              await artifactCache.put('sttn', sttnCacheKey, res.outputPath, branchSignal).catch((error) => {
                logWarn(`[AutoShort] Không lưu cache STTN: ${errLabel(error)}`)
              })
            }
            return { ...res, cacheHit: false }
          })
          throwIfAborted(branchSignal)
          branchRenderVideoPath = cleaned.outputPath
          if (cleaned.provider) branchSttnAudit = { provider: cleaned.provider, elapsedMs: cleaned.elapsedMs }
        }

        if (automaticBlur && branchVisualResult) {
          emitProgress(context, 'extracting_sub', 82, 'Đang tạo và kiểm tra mặt nạ OCR…')
          const maskPath = join(workDir, 'ocr-mask.mkv')
          branchTimedMask = await deps.writeTimedMask(branchVisualResult.timeline, {
            ffmpegPath: ffmpeg,
            ffprobePath: ffprobe,
            outputPath: maskPath,
            itemWorkDir: workDir,
            durationSeconds: visualDurationSeconds,
            signal: branchSignal
          })
        }

        return {
          renderVideoPath: branchRenderVideoPath,
          timedMask: branchTimedMask,
          visualResultForAudit: branchVisualResult,
          sttnAudit: branchSttnAudit
        }
      }

      const shouldOverlap = Boolean(context.policy?.overlapIndependentStages)

      // 1. Stage: Subtitle Extraction
      const canReuseCheckpointCues = !forceFreshOcr && Boolean(checkpoint.sourceCues && checkpoint.sourceCues.length > 0)
      if (canReuseCheckpointCues) {
        logInfo(`[AutoShort] Phục hồi ${checkpoint.sourceCues!.length} câu nguồn từ checkpoint.`)
        await writeFile(rawSrtPath, serializeAlignedCues(checkpoint.sourceCues!), 'utf8')
        sourceCues = parseSrt(await readFile(rawSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
        extractedCueCount = sourceCues.length
      } else {
        const runWhisper = async (): Promise<{ cues: AlignedCue[]; language: string | null }> => {
          return telemetry.withStageSpan('asr', { requestedProvider: needsCuda(config) ? 'cuda' : 'cpu', model: config.whisperModel || 'base' }, async (span) => {
            const whisperDir = join(workDir, 'whisper')
            await mkdir(whisperDir, { recursive: true })
            const asrKey = buildStageKey('asr', {
              cacheRevision: 'faster-whisper-aligned-v1',
              sourceDigest: processingDigest,
              model: config.whisperModel || 'base',
              device: needsCuda(config) ? 'cuda' : 'cpu',
              language: resolveAutoShortWhisperLanguage(config.whisperLanguage),
              protocol: 'faster-whisper/1'
            })
            if (artifactCache) {
              const cached = await artifactCache.get('asr', asrKey, signal).catch(() => null)
              if (cached) {
                try {
                  const payload = parseCachedAlignedArtifact(JSON.parse(await readFile(cached.path, 'utf8')))
                  if (payload) {
                    span.updateCounters({ cacheHit: 1, cueCount: payload.cues.length })
                    return payload
                  }
                } catch {
                  // Treat malformed cache content as a miss and run the
                  // authoritative engine below.
                } finally {
                  cached.release()
                }
              }
            }
            const transcribeFn = deps.transcribeAudio || transcribeAudio
            const asrResources: AutoShortResourceType[] = needsCuda(config)
              ? ['local-gpu-heavy', 'local-cpu-heavy']
              : ['local-cpu-heavy']
            const whisperResult = await resourceManager.withLease(asrResources, signal, async (lease) => {
              span.recordResourceWait(lease.waitMs || 0)
              return transcribeFn(jobId, {
                input: processingPath,
                outputDir: whisperDir,
                model: config.whisperModel || 'base',
                language: resolveAutoShortWhisperLanguage(config.whisperLanguage),
                task: 'transcribe',
                formats: ['srt'],
                device: needsCuda(config) ? 'cuda' : 'cpu',
                diarize: false,
                speakers: 0
              }, (p: WhisperProgress) => {
                emitProgress(context, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, p.line || 'Đang nhận diện giọng nói…', undefined, undefined, { stage: 'asr', phase: 'running' })
              }, signal)
            })
            if (!whisperResult.ok || !whisperResult.outputs.length) {
              throw new Error(whisperResult.error || 'Whisper không tạo được SRT')
            }
            const srtPath = whisperResult.outputs.find((p) => p.toLowerCase().endsWith('.srt')) || whisperResult.outputs[0]
            const cues = await readWhisperAlignedCues(srtPath, whisperResult.alignmentPath)
            if (cues.length === 0) failInvalidSource('Whisper không nhận được câu phụ đề hợp lệ')
            span.updateCounters({ cueCount: cues.length })
            if (artifactCache) {
              const cacheSource = join(whisperDir, 'aligned-cache.json')
              await writeFile(cacheSource, JSON.stringify({
                schemaVersion: 1,
                language: whisperResult.language || null,
                cues
              }), 'utf8')
              await artifactCache.put('asr', asrKey, cacheSource, signal).catch((error) => {
                logWarn(`[AutoShort] Không lưu cache Whisper: ${errLabel(error)}`)
              })
            }
            return { cues, language: whisperResult.language || null }
          })
        }

        const runLegacyOcr = async (): Promise<AlignedCue[]> => {
          const ocrDir = join(workDir, 'ocr')
          await mkdir(ocrDir, { recursive: true })
          const ocrResult = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], signal, async (lease) => {
            return ocrVideo(processingPath, ocrDir, ocrRegion.y0, ocrRegion.y1, ocrRegion.x0, ocrRegion.x1, ['.srt'], (p) => {
              emitProgress(context, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, p.text || 'Đang quét chữ trong video…')
            }, signal, 8)
          })
          if (!ocrResult.ok || !ocrResult.outputs?.length) throw new Error(ocrResult.error || 'OCR không tạo được SRT')
          const cues = parseSrt(await readFile(ocrResult.outputs[0], 'utf8')).cues.filter((cue) => cue.text.trim())
          if (cues.length === 0) failInvalidSource('OCR không nhận được câu phụ đề hợp lệ')
          return alignedFromSrt(cues, 'ocr')
        }

        let extracted: AlignedCue[] = []

        if (config.subtitleMethod === 'ocr') {
          if (visualOcrRequired) {
            const visualRes = await getVisualOcr()
            const projected = projectOcrTimelineToSubtitleCues(visualRes.timeline)
            extracted = alignedFromSrt(projected, 'ocr')
            const nextEvidence: OcrSourceCueEvidence = {
              effectiveOcrProfile: effectiveProfile,
              engineVersion: visualRes.engineVersion,
              engineProtocol: 'ocr-local/1',
              cueDigest: digestCanonicalSourceCues(extracted),
              transport: visualRes.transport,
              implementationFingerprint: visualRes.implementationFingerprint
            }
            if (!sameOcrSourceCueEvidence(checkpoint.ocrSourceEvidence, nextEvidence)) {
              checkpoint.translatedCues = undefined
              await saveCheckpoint()
            }
            checkpoint.ocrSourceEvidence = nextEvidence
          } else {
            extracted = await runLegacyOcr()
          }
        } else if (config.subtitleMethod === 'whisper-ocr') {
          if (visualOcrRequired) {
            const whisperPromise = runWhisper()
            const visualPromise = getVisualOcr()
            const [whisperSettled, visualSettled] = await Promise.allSettled([whisperPromise, visualPromise])
            throwIfAborted(signal)

            if (whisperSettled.status === 'rejected' && visualSettled.status === 'rejected') {
              failInvalidSource('Fast-Whisper và OCR đều không tạo được phụ đề hợp lệ.')
            }
            if (visualSettled.status === 'rejected') {
              throw visualSettled.reason
            }
            const visualRes = visualSettled.value
            const projected = projectOcrTimelineToSubtitleCues(visualRes.timeline)
            const visualCues = alignedFromSrt(projected, 'ocr')

            if (whisperSettled.status === 'fulfilled') {
              const speech = whisperSettled.value.cues
              detectedSourceLanguage = whisperSettled.value.language
              extracted = fuseWhisperAndOcr(speech, visualCues)
            } else {
              logWarn(`[AutoShort] Fast-Whisper không khả dụng: ${sanitizeAutoShortAuditError(whisperSettled.reason, [item.filePath])}`)
              extracted = visualCues
            }

            const nextEvidence: OcrSourceCueEvidence = {
              effectiveOcrProfile: effectiveProfile,
              engineVersion: visualRes.engineVersion,
              engineProtocol: 'ocr-local/1',
              cueDigest: digestCanonicalSourceCues(extracted),
              transport: visualRes.transport,
              implementationFingerprint: visualRes.implementationFingerprint
            }
            if (!sameOcrSourceCueEvidence(checkpoint.ocrSourceEvidence, nextEvidence)) {
              checkpoint.translatedCues = undefined
              await saveCheckpoint()
            }
            checkpoint.ocrSourceEvidence = nextEvidence
            await writeFile(join(workDir, 'source.alignment.json'), JSON.stringify(extracted, null, 2), 'utf8')
          } else {
            const [whisper, ocr] = await Promise.allSettled([runWhisper(), runLegacyOcr()])
            throwIfAborted(signal)
            const speech = whisper.status === 'fulfilled' ? whisper.value.cues : []
            const visual = ocr.status === 'fulfilled' ? ocr.value : []
            detectedSourceLanguage = whisper.status === 'fulfilled' ? whisper.value.language : null
            if (whisper.status === 'rejected') logWarn(`[AutoShort] Fast-Whisper không khả dụng: ${errLabel(whisper.reason)}`)
            if (ocr.status === 'rejected') logWarn(`[AutoShort] OCR không khả dụng: ${errLabel(ocr.reason)}`)
            extracted = speech.length && visual.length ? fuseWhisperAndOcr(speech, visual) : speech.length ? speech : visual
            if (extracted.length === 0) {
              failInvalidSource('Fast-Whisper và OCR đều không tạo được phụ đề hợp lệ.')
            }
            await writeFile(join(workDir, 'source.alignment.json'), JSON.stringify(extracted, null, 2), 'utf8')
          }
        } else {
          // config.subtitleMethod === 'whisper'
          const whisper = await runWhisper()
          extracted = whisper.cues
          detectedSourceLanguage = whisper.language
        }

        const boundedExtracted = clampAlignedCueTimeline(extracted, processingMeta.giay)
        if (boundedExtracted.length === 0) failInvalidSource('SRT nguồn không có câu nằm trong thời lượng video')
        await writeFile(rawSrtPath, serializeAlignedCues(boundedExtracted), 'utf8')
        sourceCues = parseSrt(await readFile(rawSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
        if (sourceCues.length === 0) failInvalidSource('SRT nguồn không có câu hợp lệ')
        extractedCueCount = sourceCues.length

        checkpoint.sourceCues = boundedExtracted
        checkpoint.detectedSourceLanguage = detectedSourceLanguage
        await saveCheckpoint()
      }

      if (cutExecutionPlan) {
        const seamIssues = findCutSeamCueIssues(sourceCues, cutExecutionPlan)
        if (seamIssues.length > 0) {
          const first = seamIssues[0]
          throw new Error(`CUT_SEAM_REVIEW_REQUIRED: Câu ${first.cueId} đi qua mối cắt tại ${first.editedAtSeconds.toFixed(3)} giây. Hãy điều chỉnh điểm cắt vào khoảng lặng hoặc biên câu.`)
        }
      }

      // Whisper supplies the source evidence needed by translation.  Start
      // the independent visual branch only after that evidence is durable so
      // an OCR/STTN failure can still abort translation without an orphaned
      // branch, while allowing the expensive visual work to overlap remote
      // translation and later audio preparation.
      if (shouldOverlap && visualOcrRequired && config.subtitleMethod === 'whisper') {
        visualBranchOutcomePromise = scope.start((s) => runVisualBranch(s))
      }

      artifactEntries.push({ source: rawSrtPath, name: 'source.srt' })

      let targetSrtPath = rawSrtPath
      let targetCues: SubtitleCue[] = sourceCues

      if (config.translateTarget !== 'none') {
        targetSrtPath = join(workDir, 'translated.srt')
        const sourceLanguage = resolveTranslationSourceLanguage(config.whisperLanguage, detectedSourceLanguage)
        const targetLocale = normalizeTranslationLocale(config.translateTarget)
        const translationMode = config.ttsEnabled ? 'dubbing' : 'subtitle'
        const translationInput = buildTranslationInput(sourceCues, sourceLanguage, targetLocale, translationMode)
        translationInput.glossary = config.translationGuidance?.glossary.map(entry => ({ ...entry })) || []
        translationInput.synopsis = config.translationGuidance?.synopsis
        const model = translationModelIdentity(config)
        const translationKey = buildTranslationIdentity(translationInput, {
          provider: config.translateProvider,
          modelIdentity: model.modelIdentity,
          revisionKnown: model.revisionKnown,
          profileId: model.profileId,
          promptVersion: TRANSLATION_PROMPT_VERSION,
          parserVersion: TRANSLATION_PARSER_VERSION,
          plannerVersion: 'translation-plan-v3',
          assessmentVersion: 'translation-assessment-v2',
          options: {
            sourceDigest: processingDigest,
            contextRadius: 2,
            videoDuration: config.ttsEnabled ? processingMeta.giay : undefined,
            mode: translationMode,
            strict: true
          }
        })
        translationIdentity = translationKey
        if (checkpoint.translationKey && checkpoint.translationKey !== translationKey) {
          // A changed source/config/prompt identity starts a fresh translation
          // budget. Never merge batches or retry counters from another artifact.
          checkpoint.translatedCues = undefined
          checkpoint.translationBatches = undefined
          checkpoint.translationBudget = undefined
          checkpoint.translationAssessment = undefined
        }
        const sourceById = new Map(sourceCues.map((cue) => [cue.id.trim(), cue]))
        const collectReusablePartial = (cues: readonly SubtitleCue[] | undefined): TranslationItem[] => {
          if (!cues || cues.length === 0) return []
          const byId = new Map<string, TranslationItem>()
          for (const cue of cues) {
            const id = cue.id.trim()
            if (!sourceById.has(id) || byId.has(id) || !cue.text.trim()) continue
            byId.set(id, { id, text: cue.text.trim() })
          }
          return sourceCues
            .map((cue) => byId.get(cue.id.trim()))
            .filter((item): item is TranslationItem => Boolean(item))
        }

        let reusedTranslation = false
        let reusablePartial: TranslationItem[] = []
        const revalidate = (items: readonly TranslationItem[], requireClean = false): SubtitleCue[] | null => {
          try {
            const mapped = mapTranslationsStrict(sourceCues, items)
            const assessment = assessContentQuality({ sourceCues, targetCues: mapped })
            if (assessment.disposition === 'needs-review' || (requireClean && assessment.disposition !== 'validated')) return null
            targetCues = mapped
            translationAssessment = assessment
            checkpoint.translationAssessment = assessment
            return mapped
          } catch {
            return null
          }
        }

        if (checkpoint.translatedCues && checkpoint.translationKey === translationKey && checkpoint.translationModelIdentity === model.modelIdentity && checkpoint.translationAssessment?.disposition !== 'needs-review') {
          const restored = revalidate(checkpoint.translatedCues.map((cue) => ({ id: cue.id, text: cue.text })), true)
          if (restored) {
            logInfo(`[AutoShort] Phục hồi ${restored.length} câu dịch đã được kiểm tra từ checkpoint.`)
            await writeFile(targetSrtPath, serializeSrt(restored), 'utf8')
            translatedCueCount = restored.length
            reusedTranslation = true
          } else {
            logWarn('[AutoShort] Bỏ qua bản dịch checkpoint vì không vượt qua kiểm tra structural hiện tại.')
            reusablePartial = collectReusablePartial(checkpoint.translatedCues)
          }
        } else if (checkpoint.translatedCues) {
          logWarn('[AutoShort] Bỏ qua bản dịch checkpoint legacy/khác identity; giữ lại source checkpoint và tạo bản dịch mới.')
        }

        const retryGeneration = Number.isInteger(checkpoint.translationRetryGeneration) ? Number(checkpoint.translationRetryGeneration) : 0
        const attemptGeneration = Number.isInteger(checkpoint.translationAttemptGeneration) ? Number(checkpoint.translationAttemptGeneration) : 0
        const needsExplicitRetry = checkpoint.translationAssessment?.disposition === 'needs-review' && retryGeneration <= attemptGeneration
        if (needsExplicitRetry && !reusedTranslation) {
          throw new Error('Bản dịch đang ở trạng thái cần kiểm tra; hãy chuẩn bị một lượt thử lại rõ ràng trước khi chạy lại.')
        }
        if (!reusedTranslation) {
          checkpoint.translationAttemptGeneration = retryGeneration
        }

        const pendingSourceCues = !reusedTranslation && reusablePartial.length > 0
          ? sourceCues.filter((cue) => !reusablePartial.some((item) => item.id === cue.id))
          : sourceCues
        // Keep the full source file as the authoritative input. The provider
        // scheduler filters pending IDs in memory; serializing a subset would
        // reindex SRT timing lines and destroy the canonical source identity.
        const translationInputPath = rawSrtPath
        if (!reusedTranslation && pendingSourceCues.length < sourceCues.length) {
          logInfo(`[AutoShort] Giữ lại ${reusablePartial.length} cue dịch đã có; chỉ dịch lại ${pendingSourceCues.length} cue còn thiếu.`)
        }

        if (!reusedTranslation && artifactCache && model.revisionKnown) {
          const cached = await artifactCache.get('translation', translationKey, signal).catch(() => null)
          if (cached) {
            try {
              const artifact = parseCachedSubtitleArtifact(JSON.parse(await readFile(cached.path, 'utf8')), translationKey, model.modelIdentity)
              const restored = artifact ? revalidate(artifact.cues, true) : null
              if (restored) {
                providerTranslationAssessment = artifact?.assessment
                await writeFile(targetSrtPath, serializeSrt(restored), 'utf8')
                translatedCueCount = restored.length
                reusedTranslation = true
              } else {
                logWarn('[AutoShort] Bỏ qua translation cache vì thiếu identity hoặc không vượt qua validator.')
              }
            } catch {
              // Invalid or stale cache entries are ignored and replaced by the
              // authoritative translator below.
            } finally {
              cached.release()
            }
          }
        }

        if (!reusedTranslation && artifactCache && !model.revisionKnown) {
          logInfo('[AutoShort] Bỏ qua persistent translation cache vì model revision chưa được xác nhận.')
        }

        if (reusedTranslation) {
          await telemetry.withStageSpan('translate', { endpointAlias: sanitizeEndpointAlias(config.translateServerUrl) }, async (span) => {
            span.updateCounters({ cacheHit: 1, cueCount: translatedCueCount || 0 })
          })
        } else {
          checkpoint.translationKey = translationKey
          checkpoint.translationModelIdentity = model.modelIdentity
          checkpoint.translationAssessment = undefined
          await saveCheckpoint()
          emitProgress(context, 'translating', 35, `Đang dịch phụ đề sang ${targetLocale}…`, undefined, undefined, { stage: 'translate', phase: 'running' }, undefined, translationAssessment, translationIdentity)
          await telemetry.withStageSpan('translate', { endpointAlias: sanitizeEndpointAlias(config.translateServerUrl) }, async (span) => {
            const strictResult = await translateStrict(config, translationInputPath, targetSrtPath, (done, count) => {
              const completeDone = reusablePartial.length + done
              emitProgress(context, 'translating', 35 + (sourceCues.length > 0 ? completeDone / sourceCues.length : 0) * 20, `Đang dịch ${completeDone}/${sourceCues.length} câu`, undefined, undefined, { stage: 'translate', phase: 'running', detail: `${completeDone}/${sourceCues.length}` }, undefined, translationAssessment, translationIdentity)
            }, signal, sourceLanguage, async (items, batchIndex) => {
              const normalizedItems = normalizeProviderBatchItems(items, pendingSourceCues, sourceCues)
              const partialById = new Map<string, TranslationItem>()
              for (const cue of checkpoint.translatedCues || []) {
                if (cue.text.trim()) partialById.set(cue.id.trim(), { id: cue.id.trim(), text: cue.text.trim() })
              }
              for (const item of reusablePartial) partialById.set(item.id, item)
              for (const item of normalizedItems) partialById.set(item.id, { id: item.id, text: item.text })
              checkpoint.translationBatches = {
                ...(checkpoint.translationBatches || {}),
                [`provider-batch-${batchIndex + 1}-${Date.now()}`]: {
                  items: normalizedItems.map((item) => ({ id: item.id, text: item.text })),
                  modelIdentity: model.modelIdentity
                }
              }
              checkpoint.translatedCues = sourceCues
                .map((cue) => {
                  const item = partialById.get(cue.id)
                  return item ? { ...cue, text: item.text } : null
                })
                .filter((cue): cue is SubtitleCue => Boolean(cue))
              checkpoint.translationKey = translationKey
              checkpoint.translationModelIdentity = model.modelIdentity
              await saveCheckpoint()
            }, async (budget) => {
              checkpoint.translationBudget = budget
              await saveCheckpoint()
            }, reusablePartial, checkpoint.translationBudget, processingMeta.giay)
            providerTranslationAssessment = strictResult.assessment
            const translated = parseSrt(await readFile(targetSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
            const restored = revalidate(mergeRecoveredTranslationItems(
              reusablePartial,
              translated.map((cue) => ({ id: cue.id, text: cue.text }))
            ))
            if (!restored) throw new Error('SRT đích không vượt qua kiểm tra identity/quality; không ghi đè bằng bản dịch không chắc chắn.')
            await writeFile(targetSrtPath, serializeSrt(restored), 'utf8')
            translatedCueCount = restored.length
            span.updateCounters({ cueCount: translatedCueCount })
          })

          if (artifactCache && model.revisionKnown && translationAssessment && translationAssessment.disposition !== 'needs-review') {
            const cacheSource = join(workDir, 'translated-cache.json')
            const cacheArtifact: TranslationArtifact = {
              schemaVersion: 2,
              key: translationKey,
              modelIdentity: model.modelIdentity,
              result: {
                items: targetCues.map((cue) => ({ id: cue.id, text: cue.text })),
                assessment: translationAssessment,
                modelIdentity: model.modelIdentity
              }
            }
            await writeFile(cacheSource, JSON.stringify(cacheArtifact), 'utf8')
            await artifactCache.put('translation', translationKey, cacheSource, signal).catch((error) => {
              logWarn(`[AutoShort] Không lưu cache bản dịch: ${errLabel(error)}`)
            })
          }
        }

        checkpoint.translatedCues = targetCues
        checkpoint.translationKey = translationKey
        checkpoint.translationModelIdentity = model.modelIdentity
        await saveCheckpoint()
        artifactEntries.push({ source: targetSrtPath, name: 'translated.srt' })
      }

      const contentAssessment = assessContentQuality({ sourceCues, targetCues })
      const languageAssessment = config.translateTarget !== 'none'
        ? assessTranslationLanguage(buildTranslationInput(sourceCues, detectedSourceLanguage || 'auto', normalizeTranslationLocale(config.translateTarget), config.ttsEnabled ? 'dubbing' : 'subtitle'), targetCues.map((cue) => ({ id: cue.id, text: cue.text })))
        : { languageEvidence: 'unknown' as const, issues: [] }
      const combinedTranslationIssues = [
        ...(providerTranslationAssessment?.issues || []),
        ...contentAssessment.issues,
        ...languageAssessment.issues
      ].filter((item, index, all) => all.findIndex((candidate) =>
        candidate.code === item.code && candidate.message === item.message && candidate.cueIds.join(',') === item.cueIds.join(',')) === index)
      const combinedHasErrors = combinedTranslationIssues.some((issue) => issue.severity === 'error')
      translationAssessment = {
        ...contentAssessment,
        disposition: combinedHasErrors
          ? 'needs-review'
          : combinedTranslationIssues.length > 0 ? 'with-warnings' : 'validated',
        issues: combinedTranslationIssues,
        languageEvidence: languageAssessment.languageEvidence === 'suspect'
          ? 'suspect'
          : providerTranslationAssessment?.languageEvidence === 'suspect' ? 'suspect' : languageAssessment.languageEvidence
      }
      checkpoint.translationAssessment = translationAssessment
      await saveCheckpoint()
      if (translationAssessment.disposition === 'needs-review') {
        const firstIssue = translationAssessment.issues.find((issue) => issue.severity === 'error')
        throw new Error(`Kiểm tra nội dung phụ đề thất bại: ${firstIssue?.message || 'cue mapping không hợp lệ.'}`)
      }

      let separatedInstrumentalPath: string | null = null

      if (config.audioMode === 'separate-vocals') {
        throwIfAborted(signal)
        if (!processingMeta.hasAudio) {
          logInfo('[AutoShort] Video nguồn không có audio; sẽ xuất TTS-only.')
          emitProgress(context, 'separating_audio', 45, 'Video nguồn không có audio; sẽ xuất TTS-only.')
        } else {
          const separation = context.separation
          if (!separation) throw new Error('Chưa chuẩn bị tài nguyên tách nhạc.')
          emitProgress(context, 'separating_audio', 45, 'Đang chuẩn bị tách nhạc nền…')

          const sepDir = join(workDir, 'separation')
          await mkdir(sepDir, { recursive: true })
          const cachedInstrumental = checkpoint.instrumentalPath
          const cachedValid = cachedInstrumental && (await fileExists(cachedInstrumental))

          if (cachedValid) {
            logInfo('[AutoShort] Tái sử dụng instrumental stem từ checkpoint.')
            separatedInstrumentalPath = cachedInstrumental
          } else {
            const sepResult = await telemetry.withStageSpan('separation', { requestedProvider: 'auto' }, async (span) => {
              const result = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], signal, async (lease) => {
                span.recordResourceWait(lease.waitMs || 0)
                return separateSourceAudio({
                sourcePath: processingPath,
                videoDurationSeconds: processingMeta.giay,
                workDir: sepDir,
                ffmpegPath: ffmpeg,
                ffprobePath: ffprobe,
                enginePath: separation.enginePath,
                model: separation.model,
                preset: separation.preset,
                providerState: context.separationProviderState,
                signal,
                onProgress: (event) => {
                  const text = event.stage === 'extracting'
                    ? 'Đang trích xuất audio nguồn…'
                    : event.stage === 'cpu-retry'
                      ? 'Đang thử lại bằng CPU…'
                      : event.stage === 'normalizing'
                        ? 'Đang chuẩn hóa track instrumental…'
                        : `Đang tách thoại (${event.percent}%)…`
                  emitProgress(context, 'separating_audio', 45 + (event.percent / 100) * 12, text)
                }
                })
              })
              if (result.kind !== 'no-audio') {
                span.setProvider('auto', result.effectiveProvider, result.fallbackReasonCode)
                span.updateCounters({ elapsedMs: result.elapsedMs })
              }
              return result
            })
            if (sepResult.kind === 'no-audio') {
              logInfo(`[AutoShort] ${sepResult.warning}`)
            } else {
              separatedInstrumentalPath = sepResult.instrumentalPath
              separationAuditMetadata = {
                audioMode: 'separate-vocals',
                separationPreset: separation.preset,
                separatorModelId: separation.model.id,
                separatorModelSha256: separation.model.spec.model.sha256,
                separatorEngineVersion: separation.engineVersion,
                requestedProvider: 'auto',
                effectiveProvider: sepResult.effectiveProvider,
                fallbackReasonCode: sepResult.fallbackReasonCode,
                separationElapsedMs: sepResult.elapsedMs
              }
              await rm(sepResult.vocalsPath, { force: true }).catch(() => {})
              await rm(join(sepDir, 'source.wav'), { force: true }).catch(() => {})
              checkpoint.instrumentalPath = separatedInstrumentalPath
              await saveCheckpoint()
            }
          }

          if (separatedInstrumentalPath) {
            artifactEntries.push({ source: separatedInstrumentalPath, name: 'instrumental.wav' })
          }
        }
      }

      let stitchedAudioPath: string | null = null
      let outputDuration = processingMeta.giay
      let dubbingTimeMap: DubbingTimeMap | undefined
      let renderSrtPath = targetSrtPath
      let renderDisplayStyle = config.subtitleDisplayStyle || 'standard'
      let finalWordTimings: any = undefined

      if (config.ttsEnabled) {
        emitProgress(context, 'generating_tts', 58, 'Đang tạo voice từ SRT đích…', undefined, undefined, { stage: 'tts', phase: 'running' })
        // Adapt context to synthesizeVoice parameter
        const jobAdapter: any = {
          id: jobId,
          controller: { signal },
          emit: context.emit,
          ttsCapabilities: context.ttsCapabilities,
          ttsCapabilitiesUrl: context.ttsCapabilitiesUrl,
          resourceManager
        }
        const synthesized = await telemetry.withStageSpan('tts', { endpointAlias: sanitizeEndpointAlias(config.ttsServerUrl), model: config.ttsModel }, async (span) => {
          const res = await synthesizeVoice(
            jobAdapter,
            item,
            config,
            targetCues,
            sourceCues,
            workDir,
            processingMeta.giay,
            index,
            total,
            detectedSourceLanguage,
            context.policy,
            context.recoveryAttempt || 1
          )
          span.updateCounters({
            cueCount: res.count,
            rephraseCount: res.rephraseCount,
            clipCount: res.clips.length
          })
          for (const requestSpan of res.requestSpans) span.addRequestSpan(requestSpan)
          return res
        })

        outputDuration = synthesized.outputDuration
        dubbingTimeMap = synthesized.timeMap
        if (dubbingTimeMap) {
          logInfo(`[AutoShort:retiming] sourceSeconds=${processingMeta.giay.toFixed(3)} outputSeconds=${outputDuration.toFixed(3)} maxLocalExtension=60% maxSlowdownExtension=20%`)
          const mapPath = join(workDir, 'dubbing-time-map.json')
          await writeFile(mapPath, JSON.stringify({ ...dubbingTimeMap, originalSourceCues: sourceCues }, null, 2), 'utf8')
          artifactEntries.push({ source: mapPath, name: 'dubbing-time-map.json' })
        }
        const syncValidation = validateAutoShortPublicationTimeline(
          synthesized.dubbingUnits,
          outputDuration,
          synthesized.sourceGroupInputs,
          synthesized.targetGroupInputs
        )
        if (!syncValidation.ok) {
          logError(`[AutoShort] Vi phạm đồng bộ semantic timeline:\n${syncValidation.violations.join('\n')}`)
          throw new Error(`Không thể xuất video do vi phạm đồng bộ semantic timeline: ${syncValidation.violations[0]}`)
        }
        if (syncValidation.warnings?.length) {
          logWarn(`[AutoShort] ${syncValidation.warnings.length} câu có giọng đọc nhanh; tốc độ tối đa ${synthesized.maxTempo.toFixed(3)}x. Chi tiết được lưu trong tts-timeline.json.`)
        }

        emitProgress(context, 'stitching_audio', 80, 'Đang căn voice theo timeline phụ đề…', undefined, undefined, { stage: 'audio', phase: 'running' })
        await telemetry.withStageSpan('audio', {}, async (span) => {
          await resourceManager.withLease(['local-audio-dsp'], signal, async (lease) => {
            span.recordResourceWait(lease.waitMs || 0)
            await stitchAudioTimeline(synthesized.clips, outputDuration, workDir, synthesized.path, signal)
          })
          span.updateCounters({ clipCount: synthesized.clips.length })
        })
        stitchedAudioPath = synthesized.path
        generatedVoiceCount = synthesized.count
        voice = synthesized.voice
        renderSrtPath = join(workDir, 'timed.srt')
        await writeFile(renderSrtPath, serializeSrt(synthesized.cues), 'utf8')
        artifactEntries.push({ source: synthesized.path, name: 'tts-timeline.wav' })
        artifactEntries.push({ source: renderSrtPath, name: 'timed.srt' })
        artifactEntries.push(...synthesized.artifacts)
        const timelineManifestPath = join(workDir, 'tts-timeline.json')
        await writeFile(timelineManifestPath, JSON.stringify({
          timeMap: dubbingTimeMap,
          sourceDuration: processingMeta.giay,
          outputDuration,
          timingWarnings: syncValidation.warnings || [],
          language: synthesized.language,
          voice: synthesized.voice,
          paceMode: synthesized.paceMode,
          tempo: synthesized.tempo,
          maxTempo: synthesized.maxTempo,
          averageTempo: synthesized.averageTempo,
          degraded: synthesized.degraded,
          rephraseCount: synthesized.rephraseCount,
          overflowCount: synthesized.overflowCount,
          batchCount: synthesized.batchCount,
          batchCueCount: synthesized.batchCueCount,
          rescueAttemptCount: synthesized.rescueAttemptCount,
          rescueAcceptedCount: synthesized.rescueAcceptedCount,
          phaseWaitMs: synthesized.phaseWaitMs,
          splitCount: synthesized.splitCount,
          predictorSamples: synthesized.predictorSamples,
          fitFirstPassRatio: synthesized.fitFirstPassRatio,
          predictorResidualP90: synthesized.predictorResidualP90,
          prefetchStarted: synthesized.prefetchStarted,
          prefetchUsed: synthesized.prefetchUsed,
          prefetchDiscarded: synthesized.prefetchDiscarded,
          prefetchWaitMs: synthesized.prefetchWaitMs,
          cueCount: synthesized.count,
          cues: synthesized.diagnostics
        }, null, 2), 'utf8')
        artifactEntries.push({ source: timelineManifestPath, name: 'tts-timeline.json' })

        if (synthesized.wordTimings && synthesized.wordTimings.length > 0) {
          finalWordTimings = synthesized.wordTimings
        } else if (renderDisplayStyle !== 'standard') {
          renderDisplayStyle = 'standard'
          logWarn('[AutoShort] Đã chuyển word effect sang standard vì độ tin cậy word timing chưa đủ.')
        }
      }

      let outputAudioPath = stitchedAudioPath
      if (config.audioMode === 'separate-vocals' && separatedInstrumentalPath && stitchedAudioPath) {
        const ffmpeg = await deps.resolveFfmpeg()
        if (!ffmpeg) throw new Error('Thiếu FFmpeg để trộn âm thanh nền với giọng lồng tiếng.')
        outputAudioPath = join(workDir, 'tts-bed-mix.wav')
        artifactEntries.push({ source: outputAudioPath, name: 'tts-bed-mix.wav' })
        emitProgress(context, 'stitching_audio', 83, 'Đang trộn âm thanh nền với giọng lồng tiếng…')
        let bedPath = separatedInstrumentalPath
        const narrationPath = stitchedAudioPath
        const mixOutputPath = outputAudioPath
        await resourceManager.withLease(['local-audio-dsp'], signal, async () => {
          if (dubbingTimeMap) bedPath = await retimeDubbingMedia({ ffmpeg, source: bedPath,
            workDir, name: 'retimed-instrumental', map: dubbingTimeMap, kind: 'audio', signal })
          await composeAutoShortNarratedAudio({
            ffmpegPath: ffmpeg,
            bedPath,
            narrationPath,
            outputPath: mixOutputPath,
            durationSeconds: outputDuration,
            bedMode: 'finite-source',
            bedVolume: 100,
            signal
          })
        })
      } else if (config.backgroundMusic && stitchedAudioPath) {
        const backgroundMusic = config.backgroundMusic
        const assignedMusicPath = backgroundMusic.assignments[item.id]
        selectedBackgroundMusicPath = await validateAutoShortMusicTrack(backgroundMusic.folderPath, assignedMusicPath)
        outputAudioPath = join(workDir, 'tts-background-mix.wav')
        artifactEntries.push({ source: outputAudioPath, name: 'tts-background-mix.wav' })
        emitProgress(context, 'stitching_audio', 83, 'Đang trộn nhạc background với giọng lồng tiếng…')
        const musicPath = selectedBackgroundMusicPath
        const narrationPath = stitchedAudioPath
        const mixOutputPath = outputAudioPath
        await resourceManager.withLease(['local-audio-dsp'], signal, async () => {
          await composeAutoShortBackgroundAudio({
            musicPath,
            narrationPath,
            outputPath: mixOutputPath,
            duration: outputDuration,
            volume: backgroundMusic.volume,
            signal
          })
        })
      }

      throwIfAborted(signal)

      // Await visual processing branch (which was run concurrently with audio/tts/dubbing)
      const visualOutcome = visualBranchOutcomePromise
        ? await visualBranchOutcomePromise
        : await scope.start((s) => runVisualBranch(s))
      if (!visualOutcome.ok) {
        throw visualOutcome.error
      }
      const visualBranch = visualOutcome.value
      let {
        renderVideoPath,
        timedMask,
        visualResultForAudit,
        sttnAudit
      } = visualBranch

      throwIfAborted(signal)
      const subtitlePlacement = resolveAutoShortSubtitlePlacement({
        mode: config.subtitlePlacementMode ?? 'manual',
        timeline: visualResultForAudit?.timeline ?? null,
        fallbackRegion: config.subRegion ?? null
      })
      throwIfAborted(signal)
      const resolvedSubtitleRegion = normalizedToPixels(subtitlePlacement.region, processingGeometry)

      if (dubbingTimeMap) {
        emitProgress(context, 'rendering_video', 84, 'Đang làm chậm nhẹ và chèn hình cho các đoạn thiếu thời gian (tối đa 60%)…')
        await telemetry.withStageSpan('retime', {}, async (span) => {
          await resourceManager.withLease(['local-cpu-heavy'], signal, async (lease) => {
            span.recordResourceWait(lease.waitMs || 0)
            renderVideoPath = await retimeDubbingMedia({ ffmpeg, source: renderVideoPath, workDir,
              name: 'retimed-video', map: dubbingTimeMap!, kind: 'video', hasAudio: processingMeta.hasAudio && config.audioMode === 'mix', audioSource: processingPath,
              frameRate: processingMeta.frameRate, signal })
            if (timedMask) timedMask = { ...timedMask,
              path: await retimeDubbingMedia({ ffmpeg, source: timedMask.path, workDir,
                name: 'retimed-mask', map: dubbingTimeMap!, kind: 'mask', width: timedMask.width, height: timedMask.height, signal }),
              durationSeconds: outputDuration }
          })
          span.updateCounters({ outputDurationMs: Math.round(outputDuration * 1000) })
        })
      }

      const placementMessage = subtitlePlacement.mode === 'ocr-dominant'
        ? subtitlePlacement.reason === 'selected'
          ? 'Đặt phụ đề theo vùng OCR'
          : 'Dùng vị trí phụ đề dự phòng'
        : null
      const renderMsg = automaticBlur
        ? `Đang làm mờ OCR, gắn phụ đề và xuất video…${placementMessage ? ` ${placementMessage}.` : ''}`
        : sttnRemoval
          ? `Đã xóa chữ STTN; đang gắn phụ đề và xuất video…${placementMessage ? ` ${placementMessage}.` : ''}`
          : 'Đang làm mờ, gắn phụ đề và xuất video…'
      emitProgress(context, 'rendering_video', 85, renderMsg, undefined, undefined, { stage: 'render', phase: 'running' })
      outputName = await uniqueOutputName(itemOutputDir, item.filePath)
      const finalOutputPath = join(itemOutputDir, outputName)

      burnResult = await telemetry.withStageSpan('render', {}, async (span) => {
        const res = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], signal, async (lease) => {
          span.recordResourceWait(lease.waitMs || 0)
          return deps.burn(
            {
              video: renderVideoPath,
              srt: renderSrtPath,
              videoTitle: config.videoTitle ? {
                ...config.videoTitle,
                language: config.videoTitle.language === 'auto' && config.translateTarget !== 'none'
                  ? config.translateTarget
                  : config.videoTitle.language
              } : undefined,
              mode: 'burn',
              blurRegions: visualOcrRequired ? [] : blurRegions,
              lamMo: sttnRemoval ? false : config.lamMo,
              portraitBlur: config.portraitBlur === true,
              videoAdjustments: config.videoAdjustments,
              subRegion: resolvedSubtitleRegion,
              fontId: config.fontId,
              textColor: config.textColor,
              outlineColor: config.outlineColor,
              outlinePx: config.outlineScale != null ? Math.max(0.5, Math.round(config.outlineScale * processingMeta.h * 2) / 2) : config.outlinePx,
              bgEnabled: config.bgEnabled,
              bgColor: config.bgColor,
              bgOpacity: config.bgOpacity,
              subtitleDisplayStyle: renderDisplayStyle,
              subtitleFontSize: config.subtitleFontScale != null ? Math.round(config.subtitleFontScale * processingMeta.h) : config.subtitleFontSize,
              subtitleFontScale: config.subtitleFontScale,
              outlineScale: config.outlineScale,
              highlightColor: config.highlightColor,
              subtitleHighlightPop: config.subtitleHighlightPop,
              subtitleLayoutProfile: config.subtitleLayoutProfile || 'vertical',
              subtitleAutoOptimize: config.subtitleAutoOptimize !== false,
              wordTimings: finalWordTimings || (!config.ttsEnabled && config.translateTarget === 'none'
                ? (checkpoint.sourceCues || [])
                    .filter((cue) => Array.isArray(cue.words) && cue.words.length > 0)
                    .map((cue) => ({
                      start: cue.start,
                      end: cue.end,
                      words: (cue.words || []).map((w) => ({
                        text: w.text,
                        start: w.start,
                        end: w.end,
                        probability: w.probability ?? null
                      }))
                    }))
                : undefined),
              batAmThanh: Boolean(outputAudioPath),
              amThanhFile: outputAudioPath || undefined,
              amLuongGoc: config.audioMode === 'mix' ? config.originalAudioVolume : 0
            },
            {
              timedOcrBlurMask: timedMask,
              overlays: config.overlays,
              ffmpegPath: ffmpeg,
              ffprobePath: ffprobe,
              finalOutputPath,
              itemWorkDir: workDir,
              expectedMedia: {
                durationSeconds: outputDuration,
                frameRate: processingMeta.frameRate,
                requireAudio: Boolean(outputAudioPath || (processingMeta.hasAudio && config.audioMode === 'mix')),
                durationToleranceFrames: 3
              },
              signal
            },
            (progress) => {
              emitProgress(context, 'rendering_video', 85 + Math.max(0, progress.percent) * 0.12, progress.message || `Đang xuất video… ${progress.percent}%`, undefined, undefined, { stage: 'render', phase: 'running' })
            }
          )
        })

        if (!res.ok || !res.output || !(await fileExists(res.output))) {
          throw new Error(res.error || 'Render video thất bại')
        }
        span.setProvider('auto', res.selectedEncoder, res.encoderAttempts
          ?.filter(attempt => attempt.result === 'failed')
          .map(attempt => `${attempt.codec}: ${attempt.diagnostic || `exit ${attempt.exitCode ?? 'unknown'}`}`)
          .join('; '))
        span.updateCounters({ encoderAttemptCount: res.encoderAttempts?.length || 0 })
        const outStat = await stat(res.output).catch(() => null)
        if (outStat) span.updateCounters({ outputBytes: outStat.size })
        return res
      })

      // Publication commit point: video is verified and published
      if (!burnResult || !burnResult.output) {
        throw new Error('Render video thất bại: không có file đầu ra.')
      }
      const completedBurn = burnResult
      published = true

      try {
        artifactEntries.push({ source: completedBurn.output!, name: 'output.mp4' })
        if (completedBurn.titlePath) artifactEntries.push({ source: completedBurn.titlePath, name: 'tieude.txt' })

        const ocrAuditMetadata = createOcrBlurAuditMetadata({
          blurMode: config.blurMode || 'manual',
          engineVersion: visualResultForAudit?.engineVersion,
          scanProfile: visualOcrRequired ? effectiveProfile : undefined,
          visualSegmentCount: visualResultForAudit?.visualSegmentCount,
          boxSegmentCount: visualResultForAudit?.boxSegmentCount,
          maskedDurationSeconds: timedMask?.durationSeconds,
          transport: visualResultForAudit?.transport,
          implementationFingerprint: visualResultForAudit?.implementationFingerprint,
          ocrProvider: visualResultForAudit?.ocrProvider
        })

        await telemetry.withStageSpan('artifact_copy', {}, async (span) => {
          artifactPath = await preserveAutoShortArtifacts(artifactDir, artifactEntries, {
            version: 1,
            status: 'done',
            sourceFile: basename(item.filePath),
            sourceDigest,
            configDigest: context.batchConfigDigest,
            outputFile: outputName,
            titleFile: completedBurn.titlePath ? 'tieude.txt' : undefined,
            titleError: completedBurn.titleError,
            sourceLanguage: resolveTranslationSourceLanguage(config.whisperLanguage, detectedSourceLanguage),
            targetLanguage: config.translateTarget,
            extractedCueCount,
            translatedCueCount,
            generatedVoiceCount,
            voice,
            separation: separationAuditMetadata,
            sttn: sttnAudit,
            ocrBlur: ocrAuditMetadata,
            subtitlePlacement: createSubtitlePlacementAuditMetadata(subtitlePlacement),
            encoder: {
              selected: completedBurn.selectedEncoder,
              attempts: completedBurn.encoderAttempts
            }
          })
          span.updateCounters({ artifactCount: artifactEntries.length })
        })
      } catch (auditError) {
        logWarn(`[AutoShort] Lưu audit artifacts thất bại: ${errLabel(auditError)}`)
      }

      // Clean up checkpoint upon successful completion
      await rm(checkpointDir, { recursive: true, force: true }).catch(() => {})

      // Clean up workDir
      await rm(workDir, { recursive: true, force: true }).catch(() => {})

      await telemetry.withStageSpan('publish', {}, async (span) => {
        span.updateCounters({ isPublished: 1 })
      })
      const finalSummary = await telemetry.finalize('succeeded')

      const completionMessage = burnResult.titleError
        ? 'Video đã xuất, chưa tạo được tiêu đề'
        : burnResult.titlePath
          ? 'Đã xuất video và tieude.txt'
          : 'Hoàn tất xuất video'
      emitProgress(context, 'done', 100, completionMessage, burnResult.output, undefined, { stage: 'publish', phase: 'succeeded' }, finalSummary.diagnosticsIncomplete, translationAssessment, translationIdentity)
      return {
        itemId: item.id,
        filePath: item.filePath,
        status: 'done',
        outputPath: burnResult.output,
        artifactDir: artifactPath,
        extractedCueCount,
        translatedCueCount,
        generatedVoiceCount,
        voice,
        title: burnResult.title,
        titlePath: burnResult.titlePath,
        titleError: burnResult.titleError,
        seoMetadata: burnResult.seoMetadata,
        translationAssessment,
        translationIdentity,
        diagnosticsIncomplete: finalSummary.diagnosticsIncomplete
      }
    } catch (error) {
      caughtError = error
      if (published && burnResult?.output) {
        const pubSummary = await telemetry.finalize('succeeded').catch(() => null)
        return {
          itemId: item.id,
          filePath: item.filePath,
          status: 'done',
          outputPath: burnResult.output,
          artifactDir: artifactPath,
          extractedCueCount,
          translatedCueCount,
          generatedVoiceCount,
          voice,
          title: burnResult.title,
          titlePath: burnResult.titlePath,
          titleError: burnResult.titleError,
          seoMetadata: burnResult.seoMetadata,
          translationAssessment,
          translationIdentity,
          diagnosticsIncomplete: pubSummary?.diagnosticsIncomplete
        }
      }

      const isCancelled = parentSignal?.aborted ?? false
      if (!isCancelled && scope.firstError) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        if (errorMsg.includes('Đã hủy') || errorMsg.includes('aborted') || errorMsg.includes('AbortError')) {
          // Preserve the first branch failure while keeping the sanitizer at
          // the boundary that derives both telemetry and the user-facing label.
          error = scope.firstError
        }
      }

      const rawMessage = sanitizeAutoShortAuditError(error, [
        item.filePath,
        config.outputDir,
        itemOutputDir,
        outputName ? join(itemOutputDir, outputName) : undefined,
        workDir,
        checkpointDir
      ])

      const message = errLabel(rawMessage)
      const userMessage = isCancelled
        ? 'Đã hủy tác vụ'
        : message || 'Xử lý video thất bại'

      const recovery = !isCancelled && error instanceof DubbingVideoExtensionLimitError
        ? {
            kind: 'dubbing-duration' as const,
            retryable: (context.recoveryAttempt || 1) === 1,
            attempt: context.recoveryAttempt || 1,
            cueId: error.cueId,
            missingSeconds: error.requiredExtensionSeconds,
            requiredPercent: error.requiredPercent
          }
        : !isCancelled && /audio TTS không hợp lệ|không trả về audio TTS/iu.test(message)
          ? {
              kind: 'tts-quality' as const,
              retryable: (context.recoveryAttempt || 1) === 1,
              attempt: context.recoveryAttempt || 1
            }
          : undefined

      const structuredTranslation = error && typeof error === 'object'
        ? error as { translationAssessment?: TranslationAssessment; translationBudget?: TranslationBudgetSnapshot }
        : undefined
      if (!isCancelled && (recovery || checkpoint.durationRecovery)) {
        checkpoint.durationRecovery = recovery
        await saveCheckpoint().catch((checkpointError) => {
          logWarn(`[AutoShort] Không lưu được trạng thái phục hồi thời lượng: ${errLabel(checkpointError)}`)
        })
      }
      if (!isCancelled && structuredTranslation?.translationAssessment) {
        translationAssessment = structuredTranslation.translationAssessment
        checkpoint.translationAssessment = translationAssessment
        if (structuredTranslation.translationBudget) checkpoint.translationBudget = structuredTranslation.translationBudget
        await saveCheckpoint().catch((checkpointError) => {
          logWarn(`[AutoShort] Không lưu được assessment/budget dịch: ${errLabel(checkpointError)}`)
        })
      }

      // A provider/protocol failure can happen after the translation identity
      // has been committed but before content assessment is written. Preserve
      // that durable identity as an explicit review state so the UI can offer
      // one bounded, user-triggered retry instead of losing the recovery path.
      if (!isCancelled && config.translateTarget.trim() !== 'none' && translationIdentity && !translationAssessment) {
        translationAssessment = {
          version: 'translation-assessment-v2',
          disposition: 'needs-review',
          issues: [{
            code: 'provider-protocol',
            severity: 'error',
            confidence: 'certain',
            cueIds: [],
            message: 'Bản dịch chưa được xác nhận do lỗi nhà cung cấp hoặc định dạng phản hồi; hãy thử lại một lần từ hàng đợi.'
          }],
          languageEvidence: 'unknown'
        }
        checkpoint.translationAssessment = translationAssessment
        await saveCheckpoint().catch((checkpointError) => {
          logWarn(`[AutoShort] Không lưu được trạng thái cần kiểm tra bản dịch: ${errLabel(checkpointError)}`)
        })
      }

      const errSummary = await telemetry.finalize(isCancelled ? 'cancelled' : 'failed', message).catch(() => null)

      if (isCancelled) {
        logWarn(`[AutoShort] Video ${basename(item.filePath)} bị hủy: ${userMessage}`)
      } else {
        logError(`[AutoShort] Lỗi xử lý video ${basename(item.filePath)}: ${rawMessage}`)
      }

      emitProgress(context, isCancelled ? 'cancelled' : 'error', 0, userMessage, undefined, undefined, {
        stage: 'publish',
        phase: isCancelled ? 'cancelled' : 'failed'
      }, errSummary?.diagnosticsIncomplete, translationAssessment, translationIdentity)
      return {
        itemId: item.id,
        filePath: item.filePath,
        status: isCancelled ? 'cancelled' : 'error',
        error: userMessage,
        artifactDir,
        translationAssessment,
        translationIdentity,
        diagnosticsIncomplete: errSummary?.diagnosticsIncomplete,
        recovery
      }
    } finally {
      scope.abort(caughtError)
      await scope.drain()
      ;(sttnCacheLease as ArtifactLease | null)?.release()
      if (sttnWorkDir) await rm(sttnWorkDir, { recursive: true, force: true }).catch(() => {})
      if (!published || !burnResult?.output) {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
      scope.dispose()
      await telemetry.finalize(caughtError ? 'failed' : 'succeeded').catch(() => {})
    }
  }
}
