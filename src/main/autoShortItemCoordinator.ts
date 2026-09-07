import { basename, dirname, join } from 'node:path'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
import { parseSrt, serializeSrt } from '../shared/subtitles'
import {
  isAutomaticOcrBlur,
  isSttnRemoval,
  effectiveAutoShortOcrProfile
} from '../shared/autoShortOcrBlur'
import { projectOcrTimelineToSubtitleCues, validateOcrVisualTimeline, type OcrVisualTimeline } from '../shared/ocrVisualTimeline'
import {
  deriveCanonicalDisplayGeometry,
  normalizedRegionToDisplayPixels
} from './canonicalDisplayGeometry'
import { probeBurnMedia, type burnAutoShort } from './burn'
import { ocrVideo, type ocrVideoWithVisualTimeline } from './ocr'
import { transcribeAudio } from './whisper'
import { validateAutoShortTimelineSync } from './autoShortPolicy'
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
  sanitizeAutoShortAuditError
} from './autoShortAudit'
import type { writeTimedOcrBlurMask, TimedOcrBlurMask } from './ocrMask'
import {
  translateStrict,
  synthesizeVoice,
  stitchAudioTimeline,
  preserveAutoShortArtifacts,
  buildAutoShortCheckpointFingerprint,
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
import type { ArtifactCache } from './autoShortArtifactCache'
import { resolveTranslationSourceLanguage } from './localTranslatePolicy'
import { composeAutoShortNarratedAudio } from './autoShortNarratedAudio'
import { composeAutoShortBackgroundAudio } from './autoShortBackgroundAudio'
import { validateAutoShortMusicTrack } from './autoShortMusicLibrary'
import { validateAutoShortContentQuality } from './autoShortContentQuality'
import { separateSourceAudio } from './separation/pipeline'
import { errLabel, logInfo, logWarn, logError } from './logger'
import type { getTtsModels } from './tts'
import { runSttnRemoval } from './inpainting/runner'

import {
  AutoShortTelemetryCollector,
  AutoShortTelemetryJobBudget,
  sanitizeEndpointAlias,
  sanitizeTelemetryPath
} from './autoShortTelemetry'
import type { AutoShortStageInfo } from '../shared/types'

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
  signal: AbortSignal
  emit: (event: AutoShortEvent) => void
  checkpointDir: string
  workDir: string
  artifactDir: string
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
  diagnosticsIncomplete?: boolean
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
    diagnosticsIncomplete
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

function parseCachedSubtitleArtifact(value: unknown): SubtitleCue[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.cues)) return null
  const cues: SubtitleCue[] = []
  for (const item of raw.cues) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const cue = item as Record<string, unknown>
    if (typeof cue.id !== 'string' || !cue.id.trim() ||
      !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || (cue.end as number) <= (cue.start as number) ||
      typeof cue.text !== 'string' || !cue.text.trim()) return null
    cues.push({
      id: cue.id,
      start: cue.start as number,
      end: cue.end as number,
      text: cue.text,
      sourceIndex: Number.isInteger(cue.sourceIndex) ? cue.sourceIndex as number : cues.length
    })
  }
  return cues.length > 0 ? cues : null
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
      instrumentalPath?: string
    } = {}

    try {
      checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'))
    } catch {
      checkpoint = {}
    }

    const saveCheckpoint = async (): Promise<void> => {
      await writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8')
    }

    let extractedCueCount: number | undefined
    let translatedCueCount: number | undefined
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

    try {
      throwIfAborted(signal)
      const inputInfo = await stat(item.filePath).catch(() => null)
      if (!inputInfo?.isFile() || inputInfo.size <= 0) {
        throw new Error(`Video không hợp lệ: ${basename(item.filePath)}`)
      }

      await telemetry.withStageSpan('validate', {}, async (validateSpan) => {
        validateSpan.updateCounters({ inputBytes: inputInfo.size })
      })

      const sourceDigest = await hashFileSha256(item.filePath, signal)
      const checkpointFingerprint = buildAutoShortCheckpointFingerprint(
        item.filePath,
        inputInfo,
        config,
        context.separation,
        sourceDigest
      )

      if (checkpoint.version !== AUTO_SHORT_CHECKPOINT_VERSION || checkpoint.fingerprint !== checkpointFingerprint) {
        if (checkpoint.sourceCues?.length || checkpoint.translatedCues?.length || checkpoint.instrumentalPath) {
          logInfo('[AutoShort] Bỏ checkpoint cũ vì không khớp fingerprint input/cấu hình hiện tại.')
        }
        await rm(checkpointDir, { recursive: true, force: true }).catch(() => {})
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

      const ocrRegion = (config.ocrRegion ? normalizedToPixels(config.ocrRegion, geometry) : undefined) || defaultAutoShortOcrRegion(meta, geometry)
      const subtitleRegion = normalizedToPixels(config.subRegion, geometry)
      const blurRegions = config.blurRegions.flatMap((r) => {
        try {
          const pixels = normalizedToPixels(r, geometry)
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
            const requestedTransport = context.policy?.ocrTransport || 'legacy-disk'
            const visualCacheKey = buildStageKey('visual-ocr', {
              cacheRevision: 'ocr-visual-cues-v1',
              sourceDigest,
              profile: effectiveProfile,
              requestedTransport,
              geometryFingerprint: geometry.fingerprint,
              displayWidth: geometry.displayWidth,
              displayHeight: geometry.displayHeight,
              scanRegion: ocrRegion,
              sampleFps: 8
            })

            if (artifactCache) {
              const cached = await artifactCache.get('visual-ocr', visualCacheKey, ocrSignal).catch(() => null)
              if (cached) {
                try {
                  const payload = parseCachedVisualArtifact(JSON.parse(await readFile(cached.path, 'utf8')))
                  const transportMatches = (payload?.transport || 'legacy-disk') === requestedTransport
                  if (payload && transportMatches) {
                    const timeline = validateOcrVisualTimeline(payload.timeline, {
                      width: geometry.displayWidth,
                      height: geometry.displayHeight,
                      durationSeconds: meta.giay,
                      sampleFps: 8,
                      geometryFingerprint: geometry.fingerprint,
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
                  input: item.filePath,
                  outputDir: ocrDir,
                  scanRegion: ocrRegion,
                  profile: effectiveProfile,
                  geometry,
                  videoDurationSeconds: meta.giay,
                  sampleFps: 8,
                  signal: ocrSignal,
                  ocrTransport: context.policy?.ocrTransport
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
        let branchRenderVideoPath = item.filePath
        let branchTimedMask: TimedOcrBlurMask | null = null
        let branchVisualResult: Awaited<ReturnType<typeof deps.runVisualOcr>> | null = null
        let branchSttnAudit: { provider: 'cuda' | 'cpu'; elapsedMs: number } | undefined

        if (visualOcrRequired) {
          branchVisualResult = await getVisualOcr(branchSignal)
        }

        if (sttnRemoval && branchVisualResult) {
          emitProgress(context, 'removing_subtitles', 82, 'Đang xóa chữ bằng STTN…', undefined, undefined, { stage: 'sttn', phase: 'running' })
          sttnWorkDir = await mkdtemp(join(itemOutputDir, '.sttn-'))
          const cleaned = await telemetry.withStageSpan('sttn', { requestedProvider: 'cuda' }, async (span) => {
            const res = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], branchSignal, async (lease) => {
              span.recordResourceWait(lease.waitMs || 0)
              return (deps.removeSubtitles || runSttnRemoval)({
                videoPath: item.filePath,
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
            return res
          })
          throwIfAborted(branchSignal)
          branchRenderVideoPath = cleaned.outputPath
          branchSttnAudit = { provider: cleaned.provider, elapsedMs: cleaned.elapsedMs }
        }

        if (automaticBlur && branchVisualResult) {
          emitProgress(context, 'extracting_sub', 82, 'Đang tạo và kiểm tra mặt nạ OCR…')
          const maskPath = join(workDir, 'ocr-mask.mkv')
          branchTimedMask = await deps.writeTimedMask(branchVisualResult.timeline, {
            ffmpegPath: ffmpeg,
            ffprobePath: ffprobe,
            outputPath: maskPath,
            itemWorkDir: workDir,
            durationSeconds: meta.giay,
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
              sourceDigest,
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
                input: item.filePath,
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
            if (cues.length === 0) throw new Error('Whisper không nhận được câu phụ đề hợp lệ')
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
            return ocrVideo(item.filePath, ocrDir, ocrRegion.y0, ocrRegion.y1, ocrRegion.x0, ocrRegion.x1, ['.srt'], (p) => {
              emitProgress(context, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, p.text || 'Đang quét chữ trong video…')
            }, signal, 8)
          })
          if (!ocrResult.ok || !ocrResult.outputs?.length) throw new Error(ocrResult.error || 'OCR không tạo được SRT')
          const cues = parseSrt(await readFile(ocrResult.outputs[0], 'utf8')).cues.filter((cue) => cue.text.trim())
          if (cues.length === 0) throw new Error('OCR không nhận được câu phụ đề hợp lệ')
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
              throw new Error('Fast-Whisper và OCR đều không tạo được phụ đề hợp lệ.')
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
              throw new Error('Fast-Whisper và OCR đều không tạo được phụ đề hợp lệ.')
            }
            await writeFile(join(workDir, 'source.alignment.json'), JSON.stringify(extracted, null, 2), 'utf8')
          }
        } else {
          // config.subtitleMethod === 'whisper'
          const whisper = await runWhisper()
          extracted = whisper.cues
          detectedSourceLanguage = whisper.language
        }

        const boundedExtracted = clampAlignedCueTimeline(extracted, meta.giay)
        if (boundedExtracted.length === 0) throw new Error('SRT nguồn không có câu nằm trong thời lượng video')
        await writeFile(rawSrtPath, serializeAlignedCues(boundedExtracted), 'utf8')
        sourceCues = parseSrt(await readFile(rawSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
        if (sourceCues.length === 0) throw new Error('SRT nguồn không có câu hợp lệ')
        extractedCueCount = sourceCues.length

        checkpoint.sourceCues = boundedExtracted
        checkpoint.detectedSourceLanguage = detectedSourceLanguage
        await saveCheckpoint()
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
        const translationKey = buildStageKey('translation', {
          cacheRevision: 'translated-srt-v1',
          sourceDigest,
          sourceCueCount: sourceCues.length,
          sourceLanguage,
          targetLanguage: config.translateTarget,
          provider: config.translateProvider,
          serverUrl: config.translateServerUrl || '',
          promptVersion: 'translation-v3'
        })
        if (checkpoint.translatedCues && checkpoint.translatedCues.length === sourceCues.length) {
          logInfo(`[AutoShort] Phục hồi ${checkpoint.translatedCues.length} câu dịch từ checkpoint.`)
          await writeFile(targetSrtPath, serializeSrt(checkpoint.translatedCues), 'utf8')
          targetCues = checkpoint.translatedCues
          translatedCueCount = targetCues.length
        } else {
          let reusedTranslation = false
          if (artifactCache) {
            const cached = await artifactCache.get('translation', translationKey, signal).catch(() => null)
            if (cached) {
              try {
                const cachedCues = parseCachedSubtitleArtifact(JSON.parse(await readFile(cached.path, 'utf8')))
                const compatible = Boolean(
                  cachedCues &&
                  cachedCues.length === sourceCues.length &&
                  cachedCues.every((cue, cueIndex) => {
                    const source = sourceCues[cueIndex]
                    return Math.abs(cue.start - source.start) <= 0.05 && Math.abs(cue.end - source.end) <= 0.05
                  })
                )
                if (compatible) {
                  targetCues = cachedCues!
                  await writeFile(targetSrtPath, serializeSrt(targetCues), 'utf8')
                  translatedCueCount = targetCues.length
                  reusedTranslation = true
                }
              } catch {
                // Invalid or stale cache entries are ignored and replaced by
                // the authoritative translator below.
              } finally {
                cached.release()
              }
            }
          }

          if (reusedTranslation) {
            await telemetry.withStageSpan('translate', { endpointAlias: sanitizeEndpointAlias(config.translateServerUrl) }, async (span) => {
              span.updateCounters({ cacheHit: 1, cueCount: translatedCueCount || 0 })
            })
          } else {
            emitProgress(context, 'translating', 35, `Đang dịch phụ đề sang ${config.translateTarget}…`, undefined, undefined, { stage: 'translate', phase: 'running' })
            await telemetry.withStageSpan('translate', { endpointAlias: sanitizeEndpointAlias(config.translateServerUrl) }, async (span) => {
              await translateStrict(config, rawSrtPath, targetSrtPath, (done, count) => {
                emitProgress(context, 'translating', 35 + (count > 0 ? done / count : 0) * 20, `Đang dịch ${done}/${count} câu`, undefined, undefined, { stage: 'translate', phase: 'running', detail: `${done}/${count}` })
              }, signal, sourceLanguage)
              targetCues = parseSrt(await readFile(targetSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
              if (targetCues.length !== sourceCues.length) throw new Error('SRT đích không khớp số câu SRT nguồn')
              translatedCueCount = targetCues.length
              span.updateCounters({ cueCount: translatedCueCount })
            })

            if (artifactCache) {
              const cacheSource = join(workDir, 'translated-cache.json')
              await writeFile(cacheSource, JSON.stringify({ schemaVersion: 1, cues: targetCues }), 'utf8')
              await artifactCache.put('translation', translationKey, cacheSource, signal).catch((error) => {
                logWarn(`[AutoShort] Không lưu cache bản dịch: ${errLabel(error)}`)
              })
            }
          }

          checkpoint.translatedCues = targetCues
          await saveCheckpoint()
        }
        artifactEntries.push({ source: targetSrtPath, name: 'translated.srt' })
      }

      const contentQuality = validateAutoShortContentQuality({ sourceCues, targetCues })
      if (!contentQuality.ok) {
        const firstFinding = contentQuality.findings.find((finding) => finding.severity === 'error')
        throw new Error(`Kiểm tra nội dung phụ đề thất bại: ${firstFinding?.message || 'cue mapping không hợp lệ.'}`)
      }

      let separatedInstrumentalPath: string | null = null

      if (config.audioMode === 'separate-vocals') {
        throwIfAborted(signal)
        if (!meta.hasAudio) {
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
            const sepResult = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], signal, async () => {
              return separateSourceAudio({
                sourcePath: item.filePath,
                videoDurationSeconds: meta.giay,
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
            meta.giay,
            index,
            total,
            detectedSourceLanguage,
            context.policy
          )
          span.updateCounters({
            cueCount: res.count,
            rephraseCount: res.rephraseCount,
            clipCount: res.clips.length
          })
          return res
        })

        const syncValidation = validateAutoShortTimelineSync(
          synthesized.dubbingUnits,
          meta.giay,
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
            await stitchAudioTimeline(synthesized.clips, meta.giay, workDir, synthesized.path, signal)
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
          timingWarnings: syncValidation.warnings || [],
          language: synthesized.language,
          voice: synthesized.voice,
          paceMode: synthesized.paceMode,
          tempo: synthesized.tempo,
          maxTempo: synthesized.maxTempo,
          averageTempo: synthesized.averageTempo,
          degraded: synthesized.degraded,
          rephraseCount: synthesized.rephraseCount,
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
        const bedPath = separatedInstrumentalPath
        const narrationPath = stitchedAudioPath
        const mixOutputPath = outputAudioPath
        await resourceManager.withLease(['local-audio-dsp'], signal, async () => {
          await composeAutoShortNarratedAudio({
            ffmpegPath: ffmpeg,
            bedPath,
            narrationPath,
            outputPath: mixOutputPath,
            durationSeconds: meta.giay,
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
            duration: meta.giay,
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
      const {
        renderVideoPath,
        timedMask,
        visualResultForAudit,
        sttnAudit
      } = visualBranch

      const renderMsg = automaticBlur
        ? 'Đang làm mờ OCR, gắn phụ đề và xuất video…'
        : sttnRemoval ? 'Đã xóa chữ STTN; đang gắn phụ đề và xuất video…' : 'Đang làm mờ, gắn phụ đề và xuất video…'
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
                language: config.translateTarget !== 'none' ? config.translateTarget : 'auto'
              } : undefined,
              mode: 'burn',
              blurRegions: visualOcrRequired ? [] : blurRegions,
              lamMo: sttnRemoval ? false : config.lamMo,
              subRegion: subtitleRegion,
              fontId: config.fontId,
              textColor: config.textColor,
              outlineColor: config.outlineColor,
              outlinePx: config.outlineScale != null ? Math.max(0.5, Math.round(config.outlineScale * meta.h * 2) / 2) : config.outlinePx,
              bgEnabled: config.bgEnabled,
              bgColor: config.bgColor,
              bgOpacity: config.bgOpacity,
              subtitleDisplayStyle: renderDisplayStyle,
              subtitleFontSize: config.subtitleFontScale != null ? Math.round(config.subtitleFontScale * meta.h) : config.subtitleFontSize,
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
              ffmpegPath: ffmpeg,
              ffprobePath: ffprobe,
              finalOutputPath,
              itemWorkDir: workDir,
              expectedMedia: {
                durationSeconds: meta.giay,
                frameRate: meta.frameRate,
                requireAudio: Boolean(outputAudioPath || (meta.hasAudio && config.audioMode === 'mix')),
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
        const outStat = await stat(res.output).catch(() => null)
        if (outStat) span.updateCounters({ outputBytes: outStat.size })
        return res
      })

      // Publication commit point: video is verified and published
      if (!burnResult || !burnResult.output) {
        throw new Error('Render video thất bại: không có file đầu ra.')
      }
      published = true

      try {
        artifactEntries.push({ source: burnResult.output, name: 'output.mp4' })
        if (burnResult.titlePath) artifactEntries.push({ source: burnResult.titlePath, name: 'tieude.txt' })

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

        artifactPath = await preserveAutoShortArtifacts(artifactDir, artifactEntries, {
          version: 1,
          status: 'done',
          sourceFile: basename(item.filePath),
          outputFile: outputName,
          titleFile: burnResult.titlePath ? 'tieude.txt' : undefined,
          titleError: burnResult.titleError,
          sourceLanguage: resolveTranslationSourceLanguage(config.whisperLanguage, detectedSourceLanguage),
          targetLanguage: config.translateTarget,
          extractedCueCount,
          translatedCueCount,
          generatedVoiceCount,
          voice,
          separation: separationAuditMetadata,
          sttn: sttnAudit,
          ocrBlur: ocrAuditMetadata
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
      emitProgress(context, 'done', 100, completionMessage, burnResult.output, undefined, { stage: 'publish', phase: 'succeeded' }, finalSummary.diagnosticsIncomplete)
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

      const errSummary = await telemetry.finalize(isCancelled ? 'cancelled' : 'failed', message).catch(() => null)

      if (isCancelled) {
        logWarn(`[AutoShort] Video ${basename(item.filePath)} bị hủy: ${userMessage}`)
      } else {
        logError(`[AutoShort] Lỗi xử lý video ${basename(item.filePath)}: ${rawMessage}`)
      }

      emitProgress(context, isCancelled ? 'cancelled' : 'error', 0, userMessage, undefined, undefined, {
        stage: 'publish',
        phase: isCancelled ? 'cancelled' : 'failed'
      }, errSummary?.diagnosticsIncomplete)
      return {
        itemId: item.id,
        filePath: item.filePath,
        status: isCancelled ? 'cancelled' : 'error',
        error: userMessage,
        diagnosticsIncomplete: errSummary?.diagnosticsIncomplete
      }
    } finally {
      scope.abort(caughtError)
      await scope.drain()
      if (sttnWorkDir) await rm(sttnWorkDir, { recursive: true, force: true }).catch(() => {})
      if (!published || !burnResult?.output) {
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
      }
      scope.dispose()
      await telemetry.finalize(caughtError ? 'failed' : 'succeeded').catch(() => {})
    }
  }
}
