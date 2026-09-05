import { basename, dirname, join } from 'node:path'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
  effectiveAutoShortOcrProfile
} from '../shared/autoShortOcrBlur'
import { projectOcrTimelineToSubtitleCues } from '../shared/ocrVisualTimeline'
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
import { resolveAutoShortWhisperLanguage } from './autoShortPolicy'
import { resolveTranslationSourceLanguage } from './localTranslatePolicy'
import { composeAutoShortNarratedAudio } from './autoShortNarratedAudio'
import { composeAutoShortBackgroundAudio } from './autoShortBackgroundAudio'
import { validateAutoShortMusicTrack } from './autoShortMusicLibrary'
import { separateSourceAudio } from './separation/pipeline'
import { errLabel, logInfo, logWarn, logError } from './logger'
import type { getTtsModels } from './tts'

export interface AutoShortItemCoordinatorDeps {
  resolveFfmpeg: () => Promise<string | null>
  resolveFfprobe: () => Promise<string | null>
  probeMedia?: typeof probeBurnMedia
  transcribeAudio?: typeof transcribeAudio
  runVisualOcr: typeof ocrVideoWithVisualTimeline
  writeTimedMask: typeof writeTimedOcrBlurMask
  burn: typeof burnAutoShort
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
  ttsCapabilities?: Awaited<ReturnType<typeof getTtsModels>>
  ttsCapabilitiesUrl?: string
  separation?: PreparedAutoShortSeparation
  separationProviderState: SeparatorProviderState
}

function emitProgress(
  context: AutoShortItemContext,
  itemStatus: AutoShortProgress['itemStatus'],
  percent: number,
  message: string,
  outputPath?: string,
  error?: string
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
    error
  })
}

export function createAutoShortItemProcessor(
  deps: AutoShortItemCoordinatorDeps
): (context: AutoShortItemContext) => Promise<AutoShortItemResult> {
  return async function processItem(context: AutoShortItemContext): Promise<AutoShortItemResult> {
    const { jobId, request, item, index, total, signal, checkpointDir, workDir, artifactDir } = context
    const { config } = request

    await mkdir(workDir, { recursive: true })
    await mkdir(checkpointDir, { recursive: true })

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

    try {
      throwIfAborted(signal)
      const inputInfo = await stat(item.filePath).catch(() => null)
      if (!inputInfo?.isFile() || inputInfo.size <= 0) {
        throw new Error(`Video không hợp lệ: ${basename(item.filePath)}`)
      }

      const checkpointFingerprint = buildAutoShortCheckpointFingerprint(
        item.filePath,
        inputInfo,
        config,
        context.separation
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
      const effectiveProfile = effectiveAutoShortOcrProfile(config)
      const forceFreshOcr = mustRegenerateOcrSource(config)

      // Exactly one visual OCR promise per item when automatic blur is active
      let visualOcrPromise: Promise<Awaited<ReturnType<typeof deps.runVisualOcr>>> | null = null
      const getVisualOcr = () => {
        if (!visualOcrPromise) {
          visualOcrPromise = (async () => {
            emitProgress(context, 'extracting_sub', 5, 'Đang quét chữ trong video…')
            const ocrDir = join(workDir, 'ocr')
            await mkdir(ocrDir, { recursive: true })
            const ocrRes = await deps.runVisualOcr(
              {
                input: item.filePath,
                outputDir: ocrDir,
                scanRegion: ocrRegion,
                profile: effectiveProfile,
                geometry,
                videoDurationSeconds: meta.giay,
                sampleFps: 8,
                signal
              },
              (p) => {
                emitProgress(context, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, 'Đang quét chữ trong video…')
              }
            )
            emitProgress(context, 'extracting_sub', 30, 'Đang kiểm tra timeline OCR…')
            if (!ocrRes.timeline || ocrRes.timeline.segments.length === 0 || ocrRes.boxSegmentCount === 0) {
              throw new Error('OCR không phát hiện vùng chữ hợp lệ trong vùng quét.')
            }
            return ocrRes
          })()
        }
        return visualOcrPromise
      }

      // 1. Stage: Subtitle Extraction
      const canReuseCheckpointCues = !forceFreshOcr && Boolean(checkpoint.sourceCues && checkpoint.sourceCues.length > 0)
      if (canReuseCheckpointCues) {
        logInfo(`[AutoShort] Phục hồi ${checkpoint.sourceCues!.length} câu nguồn từ checkpoint.`)
        await writeFile(rawSrtPath, serializeAlignedCues(checkpoint.sourceCues!), 'utf8')
        sourceCues = parseSrt(await readFile(rawSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
        extractedCueCount = sourceCues.length
      } else {
        const runWhisper = async (): Promise<{ cues: AlignedCue[]; language: string | null }> => {
          const whisperDir = join(workDir, 'whisper')
          await mkdir(whisperDir, { recursive: true })
          const transcribeFn = deps.transcribeAudio || transcribeAudio
          const whisperResult = await transcribeFn(jobId, {
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
            emitProgress(context, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, p.line || 'Đang nhận diện giọng nói…')
          }, signal)
          if (!whisperResult.ok || !whisperResult.outputs.length) {
            throw new Error(whisperResult.error || 'Whisper không tạo được SRT')
          }
          const srtPath = whisperResult.outputs.find((p) => p.toLowerCase().endsWith('.srt')) || whisperResult.outputs[0]
          const cues = await readWhisperAlignedCues(srtPath, whisperResult.alignmentPath)
          if (cues.length === 0) throw new Error('Whisper không nhận được câu phụ đề hợp lệ')
          return { cues, language: whisperResult.language || null }
        }

        const runLegacyOcr = async (): Promise<AlignedCue[]> => {
          const ocrDir = join(workDir, 'ocr')
          await mkdir(ocrDir, { recursive: true })
          const ocrResult = await ocrVideo(item.filePath, ocrDir, ocrRegion.y0, ocrRegion.y1, ocrRegion.x0, ocrRegion.x1, ['.srt'], (p) => {
            emitProgress(context, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, p.text || 'Đang quét chữ trong video…')
          }, signal, 8)
          if (!ocrResult.ok || !ocrResult.outputs?.length) throw new Error(ocrResult.error || 'OCR không tạo được SRT')
          const cues = parseSrt(await readFile(ocrResult.outputs[0], 'utf8')).cues.filter((cue) => cue.text.trim())
          if (cues.length === 0) throw new Error('OCR không nhận được câu phụ đề hợp lệ')
          return alignedFromSrt(cues, 'ocr')
        }

        let extracted: AlignedCue[] = []

        if (config.subtitleMethod === 'ocr') {
          if (automaticBlur) {
            const visualRes = await getVisualOcr()
            const projected = projectOcrTimelineToSubtitleCues(visualRes.timeline)
            extracted = alignedFromSrt(projected, 'ocr')
            const nextEvidence: OcrSourceCueEvidence = {
              effectiveOcrProfile: effectiveProfile,
              engineVersion: visualRes.engineVersion,
              engineProtocol: 'ocr-local/1',
              cueDigest: digestCanonicalSourceCues(extracted)
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
          if (automaticBlur) {
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
              cueDigest: digestCanonicalSourceCues(extracted)
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

      artifactEntries.push({ source: rawSrtPath, name: 'source.srt' })

      let targetSrtPath = rawSrtPath
      let targetCues: SubtitleCue[] = sourceCues

      if (config.translateTarget !== 'none') {
        targetSrtPath = join(workDir, 'translated.srt')
        if (checkpoint.translatedCues && checkpoint.translatedCues.length === sourceCues.length) {
          logInfo(`[AutoShort] Phục hồi ${checkpoint.translatedCues.length} câu dịch từ checkpoint.`)
          await writeFile(targetSrtPath, serializeSrt(checkpoint.translatedCues), 'utf8')
          targetCues = checkpoint.translatedCues
          translatedCueCount = targetCues.length
        } else {
          emitProgress(context, 'translating', 35, `Đang dịch phụ đề sang ${config.translateTarget}…`)
          const sourceLanguage = resolveTranslationSourceLanguage(config.whisperLanguage, detectedSourceLanguage)
          await translateStrict(config, rawSrtPath, targetSrtPath, (done, count) => {
            emitProgress(context, 'translating', 35 + (count > 0 ? done / count : 0) * 20, `Đang dịch ${done}/${count} câu`)
          }, signal, sourceLanguage)
          targetCues = parseSrt(await readFile(targetSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
          if (targetCues.length !== sourceCues.length) throw new Error('SRT đích không khớp số câu SRT nguồn')
          translatedCueCount = targetCues.length

          checkpoint.translatedCues = targetCues
          await saveCheckpoint()
        }
        artifactEntries.push({ source: targetSrtPath, name: 'translated.srt' })
      }

      let separatedInstrumentalPath: string | null = null

      if (config.audioMode === 'separate-vocals') {
        throwIfAborted(signal)
        if (!meta.hasAudio) {
          logInfo('[AutoShort] Video nguồn không có audio; sẽ xuất TTS-only.')
          emitProgress(context, 'separating_audio', 45, 'Video nguồn không có audio; sẽ xuất TTS-only.')
        } else {
          if (!context.separation) throw new Error('Chưa chuẩn bị tài nguyên tách nhạc.')
          emitProgress(context, 'separating_audio', 45, 'Đang chuẩn bị tách nhạc nền…')

          const sepDir = join(workDir, 'separation')
          await mkdir(sepDir, { recursive: true })
          const cachedInstrumental = checkpoint.instrumentalPath
          const cachedValid = cachedInstrumental && (await fileExists(cachedInstrumental))

          if (cachedValid) {
            logInfo('[AutoShort] Tái sử dụng instrumental stem từ checkpoint.')
            separatedInstrumentalPath = cachedInstrumental
          } else {
            const sepResult = await separateSourceAudio({
              sourcePath: item.filePath,
              videoDurationSeconds: meta.giay,
              workDir: sepDir,
              ffmpegPath: ffmpeg,
              ffprobePath: ffprobe,
              enginePath: context.separation.enginePath,
              model: context.separation.model,
              preset: context.separation.preset,
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
            if (sepResult.kind === 'no-audio') {
              logInfo(`[AutoShort] ${sepResult.warning}`)
            } else {
              separatedInstrumentalPath = sepResult.instrumentalPath
              separationAuditMetadata = {
                audioMode: 'separate-vocals',
                separationPreset: context.separation.preset,
                separatorModelId: context.separation.model.id,
                separatorModelSha256: context.separation.model.spec.model.sha256,
                separatorEngineVersion: context.separation.engineVersion,
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
        emitProgress(context, 'generating_tts', 58, 'Đang tạo voice từ SRT đích…')
        // Adapt context to synthesizeVoice parameter
        const jobAdapter: any = {
          id: jobId,
          controller: { signal },
          emit: context.emit,
          ttsCapabilities: context.ttsCapabilities,
          ttsCapabilitiesUrl: context.ttsCapabilitiesUrl
        }
        const synthesized = await synthesizeVoice(
          jobAdapter,
          item,
          config,
          targetCues,
          sourceCues,
          workDir,
          meta.giay,
          index,
          total,
          detectedSourceLanguage
        )

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

        emitProgress(context, 'stitching_audio', 80, 'Đang căn voice theo timeline phụ đề…')
        await stitchAudioTimeline(synthesized.clips, meta.giay, workDir, synthesized.path, signal)
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
        await composeAutoShortNarratedAudio({
          ffmpegPath: ffmpeg,
          bedPath: separatedInstrumentalPath,
          narrationPath: stitchedAudioPath,
          outputPath: outputAudioPath,
          durationSeconds: meta.giay,
          bedMode: 'finite-source',
          bedVolume: 100,
          signal
        })
      } else if (config.backgroundMusic) {
        const backgroundMusic = config.backgroundMusic
        const assignedMusicPath = backgroundMusic.assignments[item.id]
        selectedBackgroundMusicPath = await validateAutoShortMusicTrack(backgroundMusic.folderPath, assignedMusicPath)
        outputAudioPath = join(workDir, 'tts-background-mix.wav')
        artifactEntries.push({ source: outputAudioPath, name: 'tts-background-mix.wav' })
        emitProgress(context, 'stitching_audio', 83, 'Đang trộn nhạc background với giọng lồng tiếng…')
        await composeAutoShortBackgroundAudio({
          musicPath: selectedBackgroundMusicPath,
          narrationPath: stitchedAudioPath!,
          outputPath: outputAudioPath,
          duration: meta.giay,
          volume: backgroundMusic.volume,
          signal
        })
      }

      throwIfAborted(signal)

      // Timed mask generation if automatic blur
      let timedMask: TimedOcrBlurMask | null = null
      let visualResultForAudit: Awaited<ReturnType<typeof deps.runVisualOcr>> | null = null
      if (automaticBlur) {
        emitProgress(context, 'extracting_sub', 82, 'Đang tạo và kiểm tra mặt nạ OCR…')
        const visualRes = await getVisualOcr()
        visualResultForAudit = visualRes
        const maskPath = join(workDir, 'ocr-mask.mkv')
        timedMask = await deps.writeTimedMask(visualRes.timeline, {
          ffmpegPath: ffmpeg,
          ffprobePath: ffprobe,
          outputPath: maskPath,
          itemWorkDir: workDir,
          durationSeconds: meta.giay,
          signal
        })
      }

      const renderMsg = automaticBlur
        ? 'Đang làm mờ OCR, gắn phụ đề và xuất video…'
        : 'Đang làm mờ, gắn phụ đề và xuất video…'
      emitProgress(context, 'rendering_video', 85, renderMsg)
      outputName = await uniqueOutputName(config.outputDir, item.filePath)
      const finalOutputPath = join(config.outputDir, outputName)

      burnResult = await deps.burn(
        {
          video: item.filePath,
          srt: renderSrtPath,
          videoTitle: config.videoTitle ? {
            ...config.videoTitle,
            language: config.translateTarget !== 'none' ? config.translateTarget : 'auto'
          } : undefined,
          mode: 'burn',
          blurRegions: automaticBlur ? [] : blurRegions,
          lamMo: config.lamMo,
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
          emitProgress(context, 'rendering_video', 85 + Math.max(0, progress.percent) * 0.12, progress.message || `Đang xuất video… ${progress.percent}%`)
        }
      )

      if (!burnResult.ok || !burnResult.output || !(await fileExists(burnResult.output))) {
        throw new Error(burnResult.error || 'Render video thất bại')
      }

      // Publication commit point: video is verified and published
      published = true

      try {
        artifactEntries.push({ source: burnResult.output, name: 'output.mp4' })
        if (burnResult.titlePath) artifactEntries.push({ source: burnResult.titlePath, name: 'tieude.txt' })

        const ocrAuditMetadata = createOcrBlurAuditMetadata({
          blurMode: config.blurMode || 'manual',
          engineVersion: visualResultForAudit?.engineVersion,
          scanProfile: automaticBlur ? effectiveProfile : undefined,
          visualSegmentCount: visualResultForAudit?.visualSegmentCount,
          boxSegmentCount: visualResultForAudit?.boxSegmentCount,
          maskedDurationSeconds: timedMask?.durationSeconds
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
          ocrBlur: ocrAuditMetadata
        })
      } catch (auditError) {
        logWarn(`[AutoShort] Lưu audit artifacts thất bại: ${errLabel(auditError)}`)
      }

      // Clean up checkpoint upon successful completion
      await rm(checkpointDir, { recursive: true, force: true }).catch(() => {})

      // Clean up workDir
      await rm(workDir, { recursive: true, force: true }).catch(() => {})

      const completionMessage = burnResult.titleError
        ? 'Video đã xuất, chưa tạo được tiêu đề'
        : burnResult.titlePath
          ? 'Đã xuất video và tieude.txt'
          : 'Hoàn tất xuất video'
      emitProgress(context, 'done', 100, completionMessage, burnResult.output)
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
        titleError: burnResult.titleError
      }
    } catch (error) {
      if (published && burnResult?.output) {
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
          titleError: burnResult.titleError
        }
      }

      await rm(workDir, { recursive: true, force: true }).catch(() => {})

      const rawMessage = sanitizeAutoShortAuditError(error, [
        item.filePath,
        config.outputDir,
        outputName ? join(config.outputDir, outputName) : undefined,
        workDir,
        checkpointDir
      ])

      const isCancelled = signal.aborted
      const message = errLabel(rawMessage)
      const userMessage = isCancelled
        ? 'Đã hủy tác vụ'
        : message || 'Xử lý video thất bại'

      if (isCancelled) {
        logWarn(`[AutoShort] Video ${basename(item.filePath)} bị hủy: ${userMessage}`)
      } else {
        logError(`[AutoShort] Lỗi xử lý video ${basename(item.filePath)}: ${rawMessage}`)
      }

      emitProgress(context, isCancelled ? 'cancelled' : 'error', 0, userMessage)
      return {
        itemId: item.id,
        filePath: item.filePath,
        status: isCancelled ? 'cancelled' : 'error',
        error: userMessage
      }
    }
  }
}
