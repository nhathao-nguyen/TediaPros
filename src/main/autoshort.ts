import { app, dialog } from 'electron'
import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveFfmpeg, installFfmpeg } from './deps'
import {
  isAutoShortWhisperEngineReady,
  planAutoShortVoiceTimeline,
  resolveAutoShortWhisperLanguage,
  validateAutoShortTtsModel,
  validateAutoShortTimelineSync,
  validateVoiceAudioCompleteness,
  validateRenderedOutputMedia,
  type RenderedMediaProbeInfo,
  type AutoShortVoiceCueInput,
  AUTO_SHORT_TTS_MAX_TEMPO,
  AUTO_SHORT_TTS_NORMAL_MAX_TEMPO,
  AUTO_SHORT_TTS_TAIL_MARGIN_SECONDS,
  buildAutoShortTtsTrimFilter
} from './autoShortPolicy'
import { buildSemanticGroups, joinGroupText, type SemanticGroup } from './semanticGrouping'
import { huongDan, parseTranslationItems } from './translate-shared'
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
import { installOcrEngine, ocrEngineStatus, ocrVideo } from './ocr'
import { detectGpu } from './gpu'
import { translateSrt as geminiTranslateSrt } from './gemini'
import { translateSrt as openaiTranslateSrt } from './openai'
import { localTranslateSrt, loadLocalKey, checkLocalTranslateKey } from './localTranslate'
import { generateSpeech, generateVoiceClone, getTtsModels, checkTtsServerHealth } from './tts'
import { burnSubtitle, cancelBurn, probeBurnMedia } from './burn'
import { parseSrt, serializeSrt, type SubtitleCue } from '../shared/subtitles'
import { validateAutoShortStartRequest } from '../shared/autoShortContract'
import { fuseWhisperAndOcr, clampAlignedCueTimeline } from '../shared/autoShortAlignment'
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
  AutoShortQueueItemInput,
  AutoShortStartRequest,
  AlignedCue,
  BurnReq,
  DichKeyStatus,
  TtsModelInfo,
  TtsServerHealth,
  WhisperProgress
} from '../shared/types'

interface AutoShortJob {
  id: string
  request: AutoShortStartRequest
  controller: AbortController
  emit: (event: AutoShortEvent) => void
  done: Promise<AutoShortBatchResult>
  cancelled: boolean
}

let activeJob: AutoShortJob | null = null

function needsWhisper(method: AutoShortConfig['subtitleMethod']): boolean {
  return method !== 'ocr'
}

function needsCuda(config: Pick<AutoShortConfig, 'subtitleMethod' | 'whisperDevice'>): boolean {
  return config.whisperDevice === 'cuda' && config.subtitleMethod !== 'ocr'
}

function resolveAutoShortTtsLanguage(config: AutoShortConfig, detectedLanguage?: string | null): string {
  const explicit = config.ttsLanguage?.trim().toLowerCase()
  if (explicit && explicit !== 'auto') return explicit
  if (config.translateTarget !== 'none') return config.translateTarget.trim().toLowerCase()
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

/**
 * A single source of truth for the Auto Short dependency modal and the batch
 * preflight. It checks the current Electron userData folder, so dev, packaged
 * and migrated profiles cannot accidentally borrow one another's readiness.
 */
export async function getAutoShortReadiness(config: Pick<AutoShortConfig, 'subtitleMethod' | 'whisperModel' | 'whisperDevice'>): Promise<AutoShortReadiness> {
  const useWhisper = needsWhisper(config.subtitleMethod)
  const useCuda = needsCuda(config)
  const [ff, engine, model, cuda, ocr, gpu] = await Promise.all([
    resolveFfmpeg(),
    useWhisper ? whisperEngineStatus() : Promise.resolve(null),
    useWhisper ? whisperModelStatus(config.whisperModel || 'base') : Promise.resolve(undefined),
    useCuda ? whisperCudaStatus() : Promise.resolve(null),
    config.subtitleMethod === 'ocr' || config.subtitleMethod === 'whisper-ocr' ? ocrEngineStatus() : Promise.resolve(null),
    useCuda ? detectGpu() : Promise.resolve(null)
  ])
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
    ff !== null,
    75_000_000,
    ff ? undefined : 'Chưa cài đặt FFmpeg.'
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
  if (ocr) {
    dependencies.push(dependency(
      'ocr-engine',
      'OCR engine',
      true,
      Boolean(ocr.has && ocr.healthy),
      230_000_000,
      !ocr.has ? 'Chưa cài OCR engine.' : !ocr.healthy ? (ocr.message || 'OCR engine probe thất bại.') : undefined
    ))
  }
  const missing = dependencies.filter((item) => item.required && !item.ready)
  const message = missing.length
    ? `Cần chuẩn bị: ${missing.map((item) => item.label).join(', ')}.`
    : undefined
  return {
    ready: missing.length === 0,
    method: config.subtitleMethod,
    requestedDevice: useWhisper ? (useCuda ? 'cuda' : 'cpu') : null,
    effectiveDevice: useWhisper ? (useCuda && cudaReady ? 'cuda' : 'cpu') : null,
    dependencies,
    model,
    message
  }
}

export async function installAutoShortDependencies(
  config: Pick<AutoShortConfig, 'subtitleMethod' | 'whisperModel' | 'whisperDevice'>,
  onProgress: (progress: AutoShortDependencyProgress) => void,
  signal?: AbortSignal
): Promise<AutoShortReadiness> {
  const emit = (id: AutoShortDependencyStatus['id'], phase: AutoShortDependencyProgress['phase'], percent: number, message: string, receivedBytes?: number, totalBytes?: number): void =>
    onProgress({ id, phase, percent, message, receivedBytes, totalBytes })
  let readiness = await getAutoShortReadiness(config)
  const isMissing = (id: AutoShortDependencyStatus['id']): boolean =>
    readiness.dependencies.some((item) => item.id === id && item.required && !item.ready)
  const aborted = (): void => {
    if (signal?.aborted) throw new Error('Đã hủy tải dependency.')
  }

  if (isMissing('ffmpeg')) {
    aborted()
    emit('ffmpeg', 'downloading', 0, 'Đang tải gói FFmpeg…')
    await installFfmpeg((p) => {
      emit('ffmpeg', 'downloading', p.percent < 0 ? 0 : p.percent, p.message)
    })
    emit('ffmpeg', 'verifying', 100, 'Đang kiểm tra FFmpeg…')
    readiness = await getAutoShortReadiness(config)
  }
  if (isMissing('whisper-engine')) {
    aborted()
    emit('whisper-engine', 'downloading', 0, 'Đang tải Whisper engine…')
    await installWhisperEngine((percent) => emit('whisper-engine', 'downloading', percent, 'Đang tải Whisper engine…'))
    emit('whisper-engine', 'verifying', 100, 'Đang kiểm tra Whisper engine…')
    readiness = await getAutoShortReadiness(config)
  }
  if (isMissing('whisper-model')) {
    aborted()
    const total = readiness.model?.downloadBytes
    await installWhisperModel(config.whisperModel || 'base', (progress) =>
      emit('whisper-model', 'downloading', progress.percent, progress.message, Math.round((progress.percent / 100) * (total || 1)), total))
    emit('whisper-model', 'verifying', 100, 'Đang kiểm tra model Whisper…')
    readiness = await getAutoShortReadiness(config)
  }
  if (isMissing('whisper-cuda')) {
    aborted()
    const gpu = await detectGpu()
    if (!gpu.hasNvidia || !gpu.canAccelerate) throw new Error(gpu.reason || 'GPU không hỗ trợ Fast-Whisper.')
    emit('whisper-cuda', 'downloading', 0, 'Đang tải gói CUDA Fast-Whisper…')
    await installCudaPack((percent) => emit('whisper-cuda', 'downloading', percent, 'Đang tải gói CUDA Fast-Whisper…'))
    emit('whisper-cuda', 'verifying', 100, 'Đang kiểm tra CUDA Fast-Whisper…')
    readiness = await getAutoShortReadiness(config)
  }
  if (isMissing('ocr-engine')) {
    aborted()
    emit('ocr-engine', 'downloading', 0, 'Đang tải OCR engine…')
    await installOcrEngine((percent) => emit('ocr-engine', 'downloading', percent, 'Đang tải OCR engine…'))
    emit('ocr-engine', 'verifying', 100, 'Đang kiểm tra OCR engine…')
    readiness = await getAutoShortReadiness(config)
  }
  if (!readiness.ready) throw new Error(readiness.message || 'Dependency chưa sẵn sàng.')
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Đã hủy tác vụ')
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /hủy tác vụ/i.test(error.message))
}

function normalizedToPixels(region: AutoShortNormalizedRegion | null | undefined, width: number, height: number) {
  if (!region) return undefined
  return {
    x0: Math.round(region.x0 * width),
    y0: Math.round(region.y0 * height),
    x1: Math.round(region.x1 * width),
    y1: Math.round(region.y1 * height)
  }
}

function blurRegionsToPixels(regions: AutoShortBlurRegion[], width: number, height: number) {
  return regions.flatMap((region) => {
    const pixels = normalizedToPixels(region, width, height)
    return pixels ? [{ ...pixels, id: region.id, color: region.color }] : []
  })
}

function alignedFromSrt(cues: SubtitleCue[], source: AlignedCue['source']): AlignedCue[] {
  return cues.map((cue) => ({
    id: cue.id,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    source,
    timingQuality: source === 'ocr' ? 'ocr' : 'cue'
  }))
}

async function readWhisperAlignedCues(srtPath: string, alignmentPath: string | null | undefined): Promise<AlignedCue[]> {
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

function serializeAlignedCues(cues: AlignedCue[]): string {
  return serializeSrt(cues.map((cue, sourceIndex) => ({
    id: cue.id,
    sourceIndex,
    start: cue.start,
    end: cue.end,
    text: cue.text
  })))
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function uniqueOutputName(outputDir: string, sourcePath: string): Promise<string> {
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
    const child = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1', input], { windowsHide: true })
    let output = ''
    const abort = (): void => {
      try { child.kill() } catch { /* ignore */ }
      reject(new Error('Đã hủy tác vụ'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (code !== 0) reject(new Error('Không thể đọc thời lượng audio'))
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
    const child = spawn(ffmpeg, ['-y', '-i', input, '-vn', '-ac', '2', '-ar', '44100', '-filter:a', filter, output], { windowsHide: true })
    const abort = (): void => {
      try { child.kill() } catch { /* ignore */ }
      reject(new Error('Đã hủy tác vụ'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (code === 0) resolve()
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

async function stitchAudioTimeline(
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
    const child = spawn(ffmpeg, args, { windowsHide: true })
    const abort = (): void => {
      try { child.kill() } catch { /* ignore */ }
      reject(new Error('Đã hủy tác vụ'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (code === 0) resolve()
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
  sourceLanguage?: string | null
): Promise<void> {
  const options = { strict: true, mode: 'dubbing' as const, sourceLanguage, contextRadius: 1, signal }
  let result: { ok: boolean; error?: string; count?: number }
  if (config.translateProvider === 'local') {
    result = await localTranslateSrt(input, output, config.translateTarget, config.translateServerUrl, await loadLocalKey(), onProgress, options)
  } else if (config.translateProvider === 'openai') {
    result = await openaiTranslateSrt(input, output, config.translateTarget, onProgress, options)
  } else {
    result = await geminiTranslateSrt(input, output, config.translateTarget, onProgress, options)
  }
  throwIfAborted(signal)
  if (!result.ok) throw new Error(result.error || 'Dịch phụ đề thất bại')
  const translated = parseSrt(await readFile(output, 'utf8')).cues
  if (translated.length === 0 || (result.count != null && result.count !== translated.length) || translated.some((cue) => !cue.text.trim())) {
    throw new Error('SRT dịch không đầy đủ hoặc có câu rỗng')
  }
}

async function translateStrict(
  config: AutoShortConfig,
  input: string,
  output: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
  sourceLanguage?: string | null
): Promise<void> {
  await requestTranslation(config, input, output, onProgress, signal, sourceLanguage)
  const source = parseSrt(await readFile(input, 'utf8')).cues
  const translated = parseSrt(await readFile(output, 'utf8')).cues
  if (source.length !== translated.length) throw new Error('SRT dịch không khớp SRT nguồn')
  // Providers return only the translated text for each numbered cue. Reapply
  // the source timeline locally so a provider cannot silently reorder or move
  // cues while preserving the full translated text.
  const mapped = translated.map((cue, index) => ({
    ...cue,
    id: source[index].id,
    sourceIndex: source[index].sourceIndex,
    start: source[index].start,
    end: source[index].end
  }))
  await writeFile(output, serializeSrt(mapped), 'utf8')
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

interface AutoShortArtifactEntry {
  source: string
  name: string
}

function safeArtifactSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, '_').slice(0, 48) || 'item'
}

async function preserveAutoShortArtifacts(
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

function extractRephrasedText(rawContent: string, cueId: string): string | null {
  const items = parseTranslationItems(rawContent)
  const found = items.find((item) => item.id === cueId || item.id.toLowerCase() === cueId.toLowerCase())
  if (found?.text?.trim()) return found.text.trim()
  if (items.length === 1 && items[0].text?.trim()) return items[0].text.trim()
  const cleaned = rawContent.replace(/^\[.*?\]\s*/u, '').replace(/^\s*\((?:thời lượng|duration|time)[\s\S]*?\)\s*/iu, '').trim()
  if (cleaned && !cleaned.includes('\n')) return cleaned
  return null
}

async function rephraseDubbingCue(
  config: AutoShortConfig,
  cueId: string,
  currentText: string,
  targetDuration: number,
  targetLanguage: string,
  sourceLanguage?: string | null,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const durationStr = Math.max(0.2, targetDuration).toFixed(1)
    const systemPrompt = huongDan(targetLanguage, { mode: 'dubbing', sourceLanguage })
    const userPrompt = [
      `Câu phụ đề/lồng tiếng sau đây cần nói vừa trong thời lượng tối đa ${durationStr} giây:`,
      `[${cueId}] ${currentText}`,
      '',
      'Yêu cầu diễn đạt lại (rephrase):',
      `1. Hãy viết lại câu trên bằng ${targetLanguage} thật tự nhiên, súc tích và ngắn gọn hơn để người bản ngữ đọc vừa vặn trong ${durationStr} giây.`,
      '2. Giữ nguyên trọn vẹn ý nghĩa cốt lõi, không làm mất hoặc sai lệch thông tin quan trọng.',
      '3. Không thêm bớt thông tin ngoài lề.',
      `4. Trả về đúng định dạng: [${cueId}] câu_viết_lại_ngắn_gọn`
    ].join('\n')

    if (config.translateProvider === 'local') {
      const localKey = await loadLocalKey()
      const serverUrl = config.translateServerUrl || DEFAULT_AI_SERVER_URL
      const base = serverUrl.replace(/\/+$/u, '')
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
        signal
      })
      if (!res.ok) return null
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content?.trim()
      if (!content) return null
      return extractRephrasedText(content, cueId)
    } else if (config.translateProvider === 'gemini') {
      const { rephraseGeminiCue } = await import('./gemini')
      const text = await rephraseGeminiCue(systemPrompt, userPrompt, signal)
      if (!text) return null
      return extractRephrasedText(text, cueId)
    } else if (config.translateProvider === 'openai') {
      const { rephraseOpenaiCue } = await import('./openai')
      const text = await rephraseOpenaiCue(systemPrompt, userPrompt, signal)
      if (!text) return null
      return extractRephrasedText(text, cueId)
    }
  } catch (error) {
    logWarn(`[AutoShort] Rephrase cue ${cueId} không thành công: ${errLabel(error)}`)
  }
  return null
}

async function synthesizeVoice(
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
  count: number
  voice?: string
  language: string
  tempo: number
  averageTempo: number
  maxTempo: number
  degraded: boolean
  diagnostics: AutoShortCueDiagnostic[]
  groupSourceInputs: AutoShortVoiceCueInput[]
  artifacts: AutoShortArtifactEntry[]
}> {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) throw new Error('Thiếu FFmpeg để chuẩn hóa voice.')

  const sourceMap = new Map(sourceCues.map((c, i) => [c.id || `cue-${i}`, c]))
  const localKey = await loadLocalKey()
  const language = resolveAutoShortTtsLanguage(config, detectedLanguage)
  if (language === 'auto' || !language) throw new Error('Không xác định được ngôn ngữ TTS; hãy chọn ngôn ngữ nguồn hoặc đích.')
  const models = await getTtsModels(config.ttsServerUrl, localKey)
  const selectedModel = config.ttsModel
    ? models.models.find((model: TtsModelInfo) => model.id === config.ttsModel)
    : (models.models.find((m) => m.available !== false) || models.models[0])
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

  // 1. Group consecutive cues into semantic groups for natural prosody
  const semanticGroups = buildSemanticGroups(cues)
  logInfo(`[AutoShort] Đã gom ${cues.length} cue thành ${semanticGroups.length} semantic group để lồng tiếng tự nhiên.`)

  let voice: string | undefined
  const generatedGroupClips: Array<{
    group: SemanticGroup<SubtitleCue>
    path: string
    rawDuration: number
    text: string
  }> = []

  // 2. Synthesize each semantic group with completeness validation and retry
  for (let gIndex = 0; gIndex < semanticGroups.length; gIndex++) {
    throwIfAborted(job.controller.signal)
    const group = semanticGroups[gIndex]
    const groupText = joinGroupText(group.cues)
    emitProgress(job, item, 'generating_tts', 58 + (gIndex / semanticGroups.length) * 20, `Đang tạo voice ${gIndex + 1}/${semanticGroups.length}`, index, total)
    
    let lastError = 'Không tạo được voice'
    let wasGenerated = false

    for (let attempt = 0; attempt < 3 && !wasGenerated; attempt++) {
      try {
        const clipPath = join(workDir, `group-${gIndex}.wav`)
        const request = {
          serverUrl: config.ttsServerUrl,
          text: groupText,
          language,
          model: effectiveModel,
          voice: effectiveVoice,
          speed: config.ttsSpeed || 1,
          apiKey: localKey,
          options: config.ttsOptions
        }
        const result = config.ttsRefAudioPath
          ? await generateVoiceClone({ ...request, referenceAudioPath: config.ttsRefAudioPath, referenceTranscript: config.ttsRefTranscript }, job.controller.signal, clipPath)
          : await generateSpeech(request, job.controller.signal, clipPath)
        if (!result.ok || !result.savedPath) throw new Error(result.error || 'Server không trả về audio')
        voice = result.voice || voice
        const rawDuration = await probeDuration(ffmpeg, result.savedPath, job.controller.signal)

        // Validate audio completeness
        const completeness = validateVoiceAudioCompleteness(groupText, rawDuration)
        if (!completeness.ok) {
          throw new Error(completeness.error || 'Audio phát âm không đầy đủ nội dung')
        }

        generatedGroupClips.push({ group, path: result.savedPath, rawDuration, text: groupText })
        wasGenerated = true
      } catch (error) {
        lastError = errLabel(error)
        if (isAbortError(error)) throw error
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
    if (!wasGenerated) throw new Error(`Voice đoạn ${gIndex + 1} (${group.id}) thất bại: ${lastError}`)
  }

  // 3. Trim outer silence and perform duration-aware rephrasing if needed
  const preparedClips: Array<{
    group: SemanticGroup<SubtitleCue>
    path: string
    rawPath: string
    rawDuration: number
    naturalDuration: number
    rephraseAttempted: boolean
    text: string
  }> = []

  for (let gIndex = 0; gIndex < generatedGroupClips.length; gIndex++) {
    throwIfAborted(job.controller.signal)
    const current = generatedGroupClips[gIndex]
    const trimmedPath = join(workDir, `group-${gIndex}-trim.wav`)
    let naturalDuration = await trimVoiceClip(ffmpeg, current.path, trimmedPath, job.controller.signal)
    if (!(naturalDuration > 0.05)) throw new Error(`Voice đoạn ${gIndex + 1} không có âm thanh hợp lệ.`)

    const gStart = current.group.start ?? current.group.cues[0]?.start ?? 0
    const gEnd = current.group.end ?? current.group.cues[current.group.cues.length - 1]?.end ?? (gStart + 2.5)
    const groupNominalDuration = gEnd >= gStart ? gEnd - gStart : 2.5
    const availableDuration = Math.max(0.1, groupNominalDuration)
    let rephraseAttempted = false
    let finalText = current.text
    let finalPath = trimmedPath

    if (naturalDuration > availableDuration * AUTO_SHORT_TTS_NORMAL_MAX_TEMPO && config.ttsEnabled) {
      rephraseAttempted = true
      logInfo(`[AutoShort] Đoạn ${gIndex + 1} (${current.group.id}) thời lượng ${naturalDuration.toFixed(2)}s vượt ${availableDuration.toFixed(2)}s. Đang rephrase giữ trọn nghĩa…`)
      const rephrasedText = await rephraseDubbingCue(
        config,
        current.group.id || `group-${gIndex}`,
        current.text,
        availableDuration,
        language,
        detectedLanguage,
        job.controller.signal
      )
      if (rephrasedText && rephrasedText.trim() && rephrasedText.trim() !== current.text.trim()) {
        try {
          const rephraseRawPath = join(workDir, `group-${gIndex}-rephrase.wav`)
          const rephraseTrimPath = join(workDir, `group-${gIndex}-rephrase-trim.wav`)
          const request = {
            serverUrl: config.ttsServerUrl,
            text: rephrasedText.trim(),
            language,
            model: effectiveModel,
            voice: effectiveVoice,
            speed: config.ttsSpeed || 1,
            apiKey: localKey,
            options: config.ttsOptions
          }
          const repResult = config.ttsRefAudioPath
            ? await generateVoiceClone({ ...request, referenceAudioPath: config.ttsRefAudioPath, referenceTranscript: config.ttsRefTranscript }, job.controller.signal, rephraseRawPath)
            : await generateSpeech(request, job.controller.signal, rephraseRawPath)
          if (repResult.ok && repResult.savedPath) {
            const repNatDur = await trimVoiceClip(ffmpeg, repResult.savedPath, rephraseTrimPath, job.controller.signal)
            if (repNatDur > 0.05 && repNatDur < naturalDuration) {
              finalText = rephrasedText.trim()
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

    preparedClips.push({
      group: current.group,
      path: finalPath,
      rawPath: current.path,
      rawDuration: current.rawDuration,
      naturalDuration,
      rephraseAttempted,
      text: finalText
    })
  }

  // 4. Plan voice timeline for semantic groups using robust global tempo
  const groupSourceInputs: AutoShortVoiceCueInput[] = preparedClips.map(({ group, text }) => {
    const start = group.start ?? group.cues[0]?.start ?? 0
    const end = group.end ?? group.cues[group.cues.length - 1]?.end ?? (start + 2.5)
    return { id: group.id, start, end, text }
  })
  const timing = planAutoShortVoiceTimeline(
    groupSourceInputs,
    preparedClips.map(({ naturalDuration }) => naturalDuration),
    videoDuration,
    AUTO_SHORT_TTS_MAX_TEMPO
  )

  logInfo(`[AutoShort] Lập timeline voice hoàn tất. Global tempo: ${timing.globalTempo.toFixed(3)}x, max tempo: ${timing.maxTempo.toFixed(3)}x, avg tempo: ${timing.averageTempo.toFixed(3)}x.`)

  // 5. Apply tempo speedup per group and redistribute subtitle timing to constituent cues
  const clips: Array<{ start: number; path: string }> = []
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

    if (planned.tempo > 1.001) {
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
    const srcCue = sourceMap.get(current.group.cues[0]?.id || `cue-${gIndex}`) || sourceCues[gIndex] || current.group.cues[0]

    diagnostics.push({
      cueIndex: gIndex,
      cueId: current.group.id || `group-${gIndex}`,
      sourceStart: srcCue ? srcCue.start : planned.subtitleStart,
      sourceEnd: srcCue?.end ?? planned.subtitleEnd,
      sourceText: current.group.cues.map((c) => c.text).join(' '),
      translatedText: current.text,
      cueStart: planned.subtitleStart,
      cueEnd: planned.subtitleEnd,
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
      renderSubtitleStart: planned.subtitleStart,
      renderSubtitleEnd: planned.subtitleEnd,
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

    // Subtitle redistribution for multi-cue groups
    if (current.group.cues.length <= 1) {
      const single = current.group.cues[0] || { id: `cue-${gIndex}`, start: planned.subtitleStart, end: planned.subtitleEnd, text: current.text }
      timedCues.push({
        ...single,
        text: current.text,
        start: planned.subtitleStart,
        end: planned.subtitleEnd
      })
    } else {
      const totalWords = current.group.cues.reduce((sum, c) => sum + Math.max(1, c.text.trim().split(/\s+/).length), 0)
      let offset = planned.subtitleStart
      const totalSubDur = planned.subtitleEnd - planned.subtitleStart

      for (let cIdx = 0; cIdx < current.group.cues.length; cIdx++) {
        const subCue = current.group.cues[cIdx]
        const words = Math.max(1, subCue.text.trim().split(/\s+/).length)
        const subDur = (words / totalWords) * totalSubDur
        const subStart = offset
        const subEnd = cIdx === current.group.cues.length - 1 ? planned.subtitleEnd : offset + subDur
        timedCues.push({
          ...subCue,
          start: Number(subStart.toFixed(3)),
          end: Number(subEnd.toFixed(3))
        })
        offset = subEnd
      }
    }
  }

  const anyRephrased = preparedClips.some((c) => c.rephraseAttempted)
  if (anyRephrased) {
    const dubbingSrtPath = join(workDir, 'dubbing.srt')
    await writeFile(dubbingSrtPath, serializeSrt(timedCues), 'utf8')
    artifacts.push({ source: dubbingSrtPath, name: 'dubbing.srt' })
  }

  return {
    path: join(workDir, 'tts-timeline.wav'),
    clips,
    cues: timedCues,
    count: clips.length,
    voice,
    language,
    tempo: timing.maxTempo,
    averageTempo: timing.averageTempo,
    maxTempo: timing.maxTempo,
    degraded: timing.degraded,
    diagnostics,
    groupSourceInputs,
    artifacts
  }
}

async function probeOutputMediaWithFfprobe(
  ffmpegPath: string,
  outputPath: string,
  ttsExpected = false
): Promise<{ ok: boolean; error?: string }> {
  try {
    const meta = await probeBurnMedia(outputPath).catch(() => ({ giay: 0, w: 0, h: 0, hasAudio: false }))
    const fileStat = await stat(outputPath).catch(() => null)
    const fileSize = fileStat?.size || 0

    let decodeError: string | null = null
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'], { windowsHide: true })
        let err = ''
        child.stderr?.on('data', (d: Buffer) => { err += d.toString() })
        child.on('error', reject)
        child.on('close', (code) => {
          if (code === 0 && !err.trim()) resolve()
          else reject(new Error(err.trim() || `ffmpeg decode exited with code ${code}`))
        })
      })
    } catch (err) {
      decodeError = errLabel(err)
    }

    const probeInfo: RenderedMediaProbeInfo = {
      fileSize,
      videoStream: meta.w > 0 && meta.h > 0 ? { width: meta.w, height: meta.h, duration: meta.giay } : null,
      audioStream: meta.hasAudio ? { channels: 2, sampleRate: 44100, duration: meta.giay } : null,
      formatDuration: meta.giay,
      decodeError,
      ttsExpected
    }

    const res = validateRenderedOutputMedia(probeInfo)
    return { ok: res.ok, error: res.error }
  } catch (error) {
    return { ok: false, error: errLabel(error) }
  }
}

async function processSingleVideo(
  job: AutoShortJob,
  item: AutoShortQueueItemInput,
  config: AutoShortConfig,
  index: number,
  total: number
): Promise<AutoShortItemResult> {
  const workDir = join(app.getPath('temp'), `tblao-autoshort-${job.id}-${item.id.slice(0, 8)}`)
  const checkpointDir = join(app.getPath('userData'), 'autoshort-checkpoints', safeArtifactSegment(item.id))
  const artifactDir = join(config.outputDir, `.autoshort-audit-${job.id}-${safeArtifactSegment(item.id)}`)
  const artifactEntries: AutoShortArtifactEntry[] = []
  await mkdir(workDir, { recursive: true })
  await mkdir(checkpointDir, { recursive: true })

  const checkpointFile = join(checkpointDir, 'checkpoint.json')
  let checkpoint: {
    sourceCues?: AlignedCue[]
    detectedSourceLanguage?: string | null
    translatedCues?: SubtitleCue[]
  } = {}
  try {
    checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'))
  } catch {
    checkpoint = {}
  }

  let extractedCueCount: number | undefined
  let translatedCueCount: number | undefined
  let generatedVoiceCount: number | undefined
  let voice: string | undefined
  let detectedSourceLanguage: string | null = checkpoint.detectedSourceLanguage || null
  let outputName: string | undefined
  let artifactPath: string | undefined

  try {
    throwIfAborted(job.controller.signal)
    const inputInfo = await stat(item.filePath).catch(() => null)
    if (!inputInfo?.isFile() || inputInfo.size <= 0) throw new Error(`Video không hợp lệ: ${basename(item.filePath)}`)
    const meta = await probeBurnMedia(item.filePath)
    if (!(meta.giay > 0) || !(meta.w > 0) || !(meta.h > 0)) throw new Error('Video không có metadata hợp lệ')
    const portrait = meta.h > meta.w
    const ocrRegion = normalizedToPixels(config.ocrRegion, meta.w, meta.h) || {
      x0: 0,
      y0: Math.round(meta.h * (portrait ? 0.72 : 0.74)),
      x1: meta.w,
      y1: Math.round(meta.h * (portrait ? 0.92 : 0.94))
    }
    const subtitleRegion = normalizedToPixels(config.subRegion, meta.w, meta.h)
    const blurRegions = blurRegionsToPixels(config.blurRegions, meta.w, meta.h)

    const rawSrtPath = join(workDir, 'source.srt')
    let sourceCues: SubtitleCue[] = []

    // 1. Stage: Subtitle Extraction (check checkpoint first)
    if (checkpoint.sourceCues && checkpoint.sourceCues.length > 0) {
      logInfo(`[AutoShort] Phục hồi ${checkpoint.sourceCues.length} câu nguồn từ checkpoint.`)
      await writeFile(rawSrtPath, serializeAlignedCues(checkpoint.sourceCues), 'utf8')
      sourceCues = parseSrt(await readFile(rawSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
      extractedCueCount = sourceCues.length
    } else {
      emitProgress(job, item, 'extracting_sub', 5, 'Đang tạo phụ đề SRT…', index, total)
      const runOcr = async (): Promise<AlignedCue[]> => {
        const ocrDir = join(workDir, 'ocr')
        await mkdir(ocrDir, { recursive: true })
        const ocrResult = await ocrVideo(item.filePath, ocrDir, ocrRegion.y0, ocrRegion.y1, ocrRegion.x0, ocrRegion.x1, ['.srt'], (p) => {
          emitProgress(job, item, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, p.text || 'Đang quét chữ trong video…', index, total)
        }, job.controller.signal, 8)
        if (!ocrResult.ok || !ocrResult.outputs?.length) throw new Error(ocrResult.error || 'OCR không tạo được SRT')
        const cues = parseSrt(await readFile(ocrResult.outputs[0], 'utf8')).cues.filter((cue) => cue.text.trim())
        if (cues.length === 0) throw new Error('OCR không nhận được câu phụ đề hợp lệ')
        return alignedFromSrt(cues, 'ocr')
      }
      const runWhisper = async (): Promise<{ cues: AlignedCue[]; language: string | null }> => {
        const whisperDir = join(workDir, 'whisper')
        await mkdir(whisperDir, { recursive: true })
        const whisperResult = await transcribeAudio(job.id, {
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
          emitProgress(job, item, 'extracting_sub', 5 + Math.max(0, p.percent) * 0.25, p.line || 'Đang nhận diện giọng nói…', index, total)
        }, job.controller.signal)
        if (!whisperResult.ok || !whisperResult.outputs.length) throw new Error(whisperResult.error || 'Whisper không tạo được SRT')
        const srtPath = whisperResult.outputs.find((path) => path.toLowerCase().endsWith('.srt')) || whisperResult.outputs[0]
        const cues = await readWhisperAlignedCues(srtPath, whisperResult.alignmentPath)
        if (cues.length === 0) throw new Error('Whisper không nhận được câu phụ đề hợp lệ')
        return { cues, language: whisperResult.language || null }
      }
      let extracted: AlignedCue[] = []
      if (config.subtitleMethod === 'ocr') {
        extracted = await runOcr()
      } else if (config.subtitleMethod === 'whisper-ocr') {
        const [whisper, ocr] = await Promise.allSettled([runWhisper(), runOcr()])
        if (job.controller.signal.aborted) throw new Error('Đã hủy tác vụ')
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
      } else {
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
      await writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8')
    }

    artifactEntries.push({ source: rawSrtPath, name: 'source.srt' })

    // 2. Stage: Translation (check checkpoint first)
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
        emitProgress(job, item, 'translating', 35, `Đang dịch phụ đề sang ${config.translateTarget}…`, index, total)
        const sourceLanguage = resolveTranslationSourceLanguage(config.whisperLanguage, detectedSourceLanguage)
        await translateStrict(config, rawSrtPath, targetSrtPath, (done, count) => {
          emitProgress(job, item, 'translating', 35 + (count > 0 ? done / count : 0) * 20, `Đang dịch ${done}/${count} câu`, index, total)
        }, job.controller.signal, sourceLanguage)
        targetCues = parseSrt(await readFile(targetSrtPath, 'utf8')).cues.filter((cue) => cue.text.trim())
        if (targetCues.length !== sourceCues.length) throw new Error('SRT đích không khớp số câu SRT nguồn')
        translatedCueCount = targetCues.length

        checkpoint.translatedCues = targetCues
        await writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8')
      }
      artifactEntries.push({ source: targetSrtPath, name: 'translated.srt' })
    }

    // 3. Stage: TTS Synthesis & Timeline Stitching
    let stitchedAudioPath: string | null = null
    let renderSrtPath = targetSrtPath
    let renderDisplayStyle = config.subtitleDisplayStyle || 'standard'

    if (config.ttsEnabled) {
      emitProgress(job, item, 'generating_tts', 58, 'Đang tạo voice từ SRT đích…', index, total)
      const synthesized = await synthesizeVoice(job, item, config, targetCues, sourceCues, workDir, meta.giay, index, total, detectedSourceLanguage)
      
      const syncValidation = validateAutoShortTimelineSync(synthesized.groupSourceInputs, synthesized.groupSourceInputs, synthesized.diagnostics, meta.giay)
      if (!syncValidation.ok) {
        logError(`[AutoShort] Vi phạm đồng bộ semantic timeline:\n${syncValidation.violations.join('\n')}`)
        throw new Error(`Không thể xuất video do vi phạm đồng bộ semantic timeline: ${syncValidation.violations[0]}`)
      }

      emitProgress(job, item, 'stitching_audio', 80, 'Đang căn voice theo timeline phụ đề…', index, total)
      await stitchAudioTimeline(synthesized.clips, meta.giay, workDir, synthesized.path, job.controller.signal)
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
        tempo: synthesized.tempo,
        maxTempo: synthesized.maxTempo,
        averageTempo: synthesized.averageTempo,
        degraded: synthesized.degraded,
        cueCount: synthesized.count,
        cues: synthesized.diagnostics
      }, null, 2), 'utf8')
      artifactEntries.push({ source: timelineManifestPath, name: 'tts-timeline.json' })
      if (renderDisplayStyle !== 'standard') {
        renderDisplayStyle = 'standard'
        logWarn('[AutoShort] Đã chuyển word effect sang standard vì TTS chưa trả word timestamp thật.')
      }
    }

    throwIfAborted(job.controller.signal)

    // 4. Stage: Video Rendering
    emitProgress(job, item, 'rendering_video', 85, 'Đang làm mờ, gắn phụ đề và xuất video…', index, total)
    outputName = await uniqueOutputName(config.outputDir, item.filePath)
    const burnReq: BurnReq = {
      video: item.filePath,
      srt: renderSrtPath,
      outputDir: config.outputDir,
      outputName,
      mode: 'burn',
      blurRegions,
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
      wordTimings: !config.ttsEnabled && config.translateTarget === 'none'
        ? (checkpoint.sourceCues || [])
            .filter((cue) => Array.isArray(cue.words) && cue.words.length > 0)
            .map((cue) => ({ start: cue.start, end: cue.end, words: cue.words! }))
        : undefined,
      requireWordTimings: !config.ttsEnabled && renderDisplayStyle !== 'standard',
      batAmThanh: Boolean(stitchedAudioPath),
      amThanhFile: stitchedAudioPath,
      amLuongGoc: config.audioMode === 'mix' ? config.originalAudioVolume : 0
    }
    const burnResult = await burnSubtitle(burnReq, (progress) => {
      emitProgress(job, item, 'rendering_video', 85 + Math.max(0, progress.percent) * 0.12, `Đang xuất video… ${progress.percent}%`, index, total)
    })
    if (!burnResult.ok || !burnResult.output || !(await fileExists(burnResult.output))) {
      await Promise.all([
        rm(join(config.outputDir, outputName), { force: true }),
        burnResult.output ? rm(burnResult.output, { force: true }) : Promise.resolve()
      ])
      throw new Error(burnResult.error || 'Render video thất bại')
    }

    // 5. Stage: Output Media Validation via FFprobe
    const ffmpegPath = await resolveFfmpeg()
    if (!ffmpegPath) throw new Error('Thiếu FFmpeg/FFprobe đã xác minh để kiểm tra video đầu ra.')
    emitProgress(job, item, 'rendering_video', 98, 'Đang kiểm tra chất lượng video đầu ra…', index, total)
    const mediaCheck = await probeOutputMediaWithFfprobe(ffmpegPath, burnResult.output, config.ttsEnabled)
    if (!mediaCheck.ok) {
      logError(`[AutoShort] Kiểm tra video xuất ra thất bại: ${mediaCheck.error}`)
      await rm(burnResult.output, { force: true }).catch(() => {})
      throw new Error(`Video xuất ra không đạt tiêu chuẩn kiểm duyệt: ${mediaCheck.error}`)
    }

    artifactEntries.push({ source: burnResult.output, name: 'output.mp4' })
    artifactPath = await preserveAutoShortArtifacts(artifactDir, artifactEntries, {
      version: 1,
      status: 'done',
      sourceFile: basename(item.filePath),
      outputFile: outputName,
      sourceLanguage: resolveTranslationSourceLanguage(config.whisperLanguage, detectedSourceLanguage),
      targetLanguage: config.translateTarget,
      extractedCueCount,
      translatedCueCount,
      generatedVoiceCount,
      voice
    })

    // Clean up checkpoint upon successful completion
    await rm(checkpointDir, { recursive: true, force: true }).catch(() => {})

    emitProgress(job, item, 'done', 100, 'Hoàn tất xuất video', index, total, burnResult.output)
    return { itemId: item.id, filePath: item.filePath, status: 'done', outputPath: burnResult.output, artifactDir: artifactPath, extractedCueCount, translatedCueCount, generatedVoiceCount, voice }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.stack || error.message : String(error)
    const message = errLabel(error)
    logError(`[AutoShort] ${basename(item.filePath)} thất bại: ${rawMessage}`)
    const cancelled = job.controller.signal.aborted || isAbortError(error)
    const status: 'error' | 'cancelled' = cancelled ? 'cancelled' : 'error'

    try {
      artifactPath = await preserveAutoShortArtifacts(artifactDir, artifactEntries, {
        version: 1,
        status,
        error: message,
        rawMessage,
        sourceFile: basename(item.filePath),
        outputFile: outputName,
        sourceLanguage: resolveTranslationSourceLanguage(config.whisperLanguage, detectedSourceLanguage),
        targetLanguage: config.translateTarget,
        extractedCueCount,
        translatedCueCount,
        generatedVoiceCount,
        voice
      })
    } catch (preserveError) {
      logWarn(`[AutoShort] Không thể lưu failure artifacts: ${errLabel(preserveError)}`)
    }

    emitProgress(job, item, status, 0, cancelled ? 'Đã hủy tác vụ' : `Lỗi: ${message}`, index, total, undefined, message)
    return { itemId: item.id, filePath: item.filePath, status, error: cancelled ? 'Đã hủy tác vụ' : message, artifactDir: artifactPath, extractedCueCount, translatedCueCount, generatedVoiceCount, voice }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
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
    const selectedModel = config.ttsModel
      ? models.models.find((model: TtsModelInfo) => model.id === config.ttsModel)
      : (models.models.find((m) => m.available !== false) || models.models[0])
    if (!models.ok || !selectedModel) {
      throw new Error(models.error || (config.ttsModel ? `Model TTS "${config.ttsModel}" không tồn tại trên server.` : 'Không tìm thấy model TTS khả dụng trên server.'))
    }
    if (selectedModel.available === false) {
      throw new Error(`Model TTS ${selectedModel.id} hiện không khả dụng trên server.`)
    }
    const ttsLanguage = resolveAutoShortTtsLanguage(config)
    const ttsCapabilityError = validateAutoShortTtsModel(selectedModel, ttsLanguage)
    if (ttsCapabilityError) throw new Error(ttsCapabilityError)
    if (config.ttsRefAudioPath && !(await fileExists(config.ttsRefAudioPath))) throw new Error('File voice clone không tồn tại')
  }
}

async function executeJob(job: AutoShortJob): Promise<AutoShortBatchResult> {
  const results: AutoShortItemResult[] = []
  try {
    await preflight(job)
    for (let index = 0; index < job.request.items.length; index++) {
      if (job.controller.signal.aborted) {
        for (let rest = index; rest < job.request.items.length; rest++) {
          const item = job.request.items[rest]
          const result: AutoShortItemResult = { itemId: item.id, filePath: item.filePath, status: 'cancelled', error: 'Đã hủy tác vụ' }
          results.push(result)
          emitTerminal(job, item, rest, job.request.items.length, result)
        }
        break
      }
      const item = job.request.items[index]
      const result = await processSingleVideo(job, item, job.request.config, index, job.request.items.length)
      results.push(result)
      emitTerminal(job, item, index, job.request.items.length, result)
    }
  } catch (error) {
    const message = errLabel(error)
    logError(`[AutoShort] Preflight thất bại: ${message}`)
    for (let index = results.length; index < job.request.items.length; index++) {
      const item = job.request.items[index]
      const result: AutoShortItemResult = { itemId: item.id, filePath: item.filePath, status: job.controller.signal.aborted ? 'cancelled' : 'error', error: message }
      results.push(result)
      emitTerminal(job, item, index, job.request.items.length, result)
    }
  }
  const completedCount = results.filter((result) => result?.status === 'done').length
  const errorCount = results.filter((result) => result?.status === 'error').length
  const cancelledCount = results.filter((result) => result?.status === 'cancelled').length
  const result: AutoShortBatchResult = {
    ok: completedCount > 0 && errorCount === 0 && cancelledCount === 0,
    completedCount,
    totalCount: job.request.items.length,
    error: errorCount > 0 ? `${errorCount} video lỗi` : cancelledCount > 0 ? 'Tiến trình đã bị dừng bởi người dùng' : undefined
  }
  safeEmit(job, { type: 'batch-done', jobId: job.id, completedCount, errorCount, cancelledCount, totalCount: job.request.items.length, results })
  return result
}

export function startAutoShortJob(raw: unknown, onEvent: (event: AutoShortEvent) => void): { ok: true; jobId: string } | { ok: false; error: string } {
  const validation = validateAutoShortStartRequest(raw)
  if (!validation.ok) return { ok: false, error: validation.error }
  if (activeJob) return { ok: false, error: 'Đang có một Auto Short job khác chạy.' }
  const job: AutoShortJob = {
    id: randomUUID(),
    request: validation.value,
    controller: new AbortController(),
    emit: onEvent,
    cancelled: false,
    done: Promise.resolve({ ok: false, completedCount: 0, totalCount: validation.value.items.length })
  }
  job.done = executeJob(job).finally(() => {
    if (activeJob?.id === job.id) activeJob = null
  })
  activeJob = job
  return { ok: true, jobId: job.id }
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
