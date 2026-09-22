import { isAbsolute, join, parse, resolve, basename, extname } from 'node:path'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import opentype from 'opentype.js'
import {
  AutoShortNormalizedRegion,
  AutoShortThumbnailProgress,
  AutoShortThumbnailRequest,
  AutoShortThumbnailResult,
  AutoShortThumbnailStyle,
  AutoShortThumbnailStyleOrRandom
} from '../shared/types'
import type { CanonicalDisplayGeometry } from './canonicalDisplayGeometry'
import { resolveFfmpeg } from './deps'
import { resolveSttnEngine, resolveFfprobe } from './runtimeResolver'
import { resolveSttnModel } from './inpainting/assets'
import { probeBurnMedia } from './burn'
import { ocrVideoWithVisualTimeline } from './ocr'
import { runSttnRemoval } from './inpainting/runner'
import { getGlobalResourceManager, type AutoShortResourceManager } from './autoShortResourceManager'
import { trackChildProcess, terminateProcessTree } from './processTree'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { deriveCanonicalDisplayGeometry, normalizedRegionToDisplayPixels } from './canonicalDisplayGeometry'
import { appendPortraitFrame } from './portraitFrame'
import { portraitFrame } from '../shared/portraitFrame'
import { hasVideoAdjustments, normalizeVideoAdjustments, videoAdjustmentFilter } from '../shared/videoAdjustments'

export const THUMBNAIL_STYLES: readonly AutoShortThumbnailStyle[] = [
  'douyin_yellow',
  'douyin_black',
  'sticker_red',
  'tiktok_white',
  'neon_cyan',
  'fire_orange',
  'luxury_gold',
  'electric_lime',
  'hot_pink',
  'purple_dream',
  'emerald_green',
  'sunshine_blue'
] as const

export function resolveThumbnailStyle(
  style?: AutoShortThumbnailStyleOrRandom,
  itemIndex?: number
): AutoShortThumbnailStyle {
  if (!style || style === 'random') {
    if (typeof itemIndex === 'number' && Number.isFinite(itemIndex) && itemIndex >= 0) {
      return THUMBNAIL_STYLES[Math.floor(itemIndex) % THUMBNAIL_STYLES.length]
    }
    const randomIndex = Math.floor(Math.random() * THUMBNAIL_STYLES.length)
    return THUMBNAIL_STYLES[randomIndex]
  }
  return THUMBNAIL_STYLES.includes(style) ? style : 'douyin_yellow'
}

async function checkFileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function resolveUniqueThumbnailFilename(
  outputDir: string,
  preferredName: string = 'Thumbnail.jpg'
): Promise<string> {
  const sanitized = preferredName.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim() || 'Thumbnail.jpg'
  const ext = extname(sanitized) || '.jpg'
  const stem = basename(sanitized, ext)
  let candidate = `${stem}${ext}`
  let counter = 1
  while (await checkFileExists(join(outputDir, candidate))) {
    counter++
    candidate = `${stem} (${counter})${ext}`
  }
  return candidate
}
import { resolveSubtitlePlanFont } from './subtitlePlanner'
import { escapeFfmpegFilterPath, readBurnFontPreview, type ResolvedBurnFont } from './fonts'
import { escapeOverlayAssText } from './autoShortOverlays'

export interface AutoShortThumbnailHooks {
  resolveFfmpeg?: typeof resolveFfmpeg
  resolveFfprobe?: typeof resolveFfprobe
  resolveSttnEngine?: typeof resolveSttnEngine
  resolveSttnModel?: () => Promise<string | null>
  probeMedia?: typeof probeBurnMedia
  runVisualOcr?: typeof ocrVideoWithVisualTimeline
  removeSubtitles?: typeof runSttnRemoval
  runMedia?: (executable: string, args: string[], signal: AbortSignal, cwd?: string) => Promise<void>
  resourceManager?: AutoShortResourceManager
}

async function runThumbnailMedia(
  executable: string,
  args: string[],
  signal: AbortSignal,
  cwd?: string
): Promise<void> {
  if (signal.aborted) throw new Error('Đã hủy tạo thumbnail.')
  await new Promise<void>((resolvePromise, reject) => {
    const child = trackChildProcess(
      spawn(
        executable,
        ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args],
        { windowsHide: true, shell: false, ...(cwd ? { cwd } : {}) }
      )
    )
    let diagnostics = ''
    let spawnError: Error | undefined
    const abort = (): void => terminateProcessTree(child)
    child.stdout?.resume()
    child.stderr?.on('data', (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-8192)
    })
    child.once('error', (error: Error) => {
      spawnError = error
    })
    child.once('close', (code: number | null) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(new Error('Đã hủy tạo thumbnail.'))
      else if (spawnError || code !== 0) {
        reject(new Error(`Lỗi xử lý thumbnail (FFmpeg exit ${code}): ${spawnError?.message || diagnostics}`))
      } else resolvePromise()
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function normalizedToPixels(
  region: AutoShortNormalizedRegion | null | undefined,
  geometry: CanonicalDisplayGeometry
) {
  if (!region) return undefined
  return normalizedRegionToDisplayPixels(region, geometry)
}

export function defaultThumbnailOcrRegion(geometry: CanonicalDisplayGeometry): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: 0,
    y0: 0,
    x1: geometry.displayWidth,
    y1: geometry.displayHeight
  }
}

import type { OcrVisualTimeline } from '../shared/ocrVisualTimeline'

export function extractProminentOcrRegion(
  segments: OcrVisualTimeline['segments'] | undefined,
  frameOffset: number
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!segments || segments.length === 0) return null

  // 1. Find segments active at the target frame offset
  const activeSegments = segments.filter(
    (s) => s.start <= frameOffset && frameOffset <= s.end
  )

  // If no active segment at exact frame, pick closest segment in time
  const targetSegments =
    activeSegments.length > 0
      ? activeSegments
      : [
          [...segments].sort((a, b) => {
            const distA = Math.min(Math.abs(a.start - frameOffset), Math.abs(a.end - frameOffset))
            const distB = Math.min(Math.abs(b.start - frameOffset), Math.abs(b.end - frameOffset))
            return distA - distB
          })[0]
        ]

  // 2. Gather all candidate boxes
  const allBoxes: { x0: number; y0: number; x1: number; y1: number }[] = []
  for (const seg of targetSegments) {
    if (seg?.boxes) {
      for (const b of seg.boxes) {
        if (b.x1 > b.x0 && b.y1 > b.y0) {
          allBoxes.push({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })
        }
      }
    }
  }

  if (allBoxes.length === 0) return null
  if (allBoxes.length === 1) return allBoxes[0]

  // 3. Find primary box by maximum area (title text)
  const sortedByArea = [...allBoxes].sort(
    (a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0)
  )
  const primary = sortedByArea[0]
  const primaryHeight = primary.y1 - primary.y0
  const maxGap = Math.max(160, primaryHeight * 1.5)

  // 4. Group boxes that belong to the same multi-line title block
  let minX = primary.x0
  let minY = primary.y0
  let maxX = primary.x1
  let maxY = primary.y1

  for (const b of allBoxes) {
    if (b === primary) continue
    const verticalDist = Math.max(0, Math.max(b.y0 - maxY, minY - b.y1))
    if (verticalDist <= maxGap) {
      if (b.x0 < minX) minX = b.x0
      if (b.y0 < minY) minY = b.y0
      if (b.x1 > maxX) maxX = b.x1
      if (b.y1 > maxY) maxY = b.y1
    }
  }

  return { x0: minX, y0: minY, x1: maxX, y1: maxY }
}

export function formatThumbnailTitleText(text: string, maxPerLine = 16): string {
  const trimmed = text.trim()
  if (trimmed.includes('\n')) {
    return trimmed.split(/\r?\n/).map((s) => escapeOverlayAssText(s.trim())).join('\\N')
  }
  if (trimmed.length > maxPerLine && trimmed.includes(' ')) {
    const words = trimmed.split(/\s+/)
    const mid = Math.ceil(words.length / 2)
    const line1 = words.slice(0, mid).join(' ')
    const line2 = words.slice(mid).join(' ')
    return `${escapeOverlayAssText(line1)}\\N${escapeOverlayAssText(line2)}`
  }
  return escapeOverlayAssText(trimmed)
}

export function calculateThumbnailFontSize(
  text: string,
  canvasWidth: number,
  sizePreset: 'standard' | 'large' | 'huge' = 'large'
): number {
  const lines = text.split(/\r?\n|\\N/)
  const longestLineLen = Math.max(...lines.map((l) => l.trim().length), 1)

  // Target coverage: standard ~75%, large ~86% (Default), huge ~94%
  const targetCoverage = sizePreset === 'huge' ? 0.94 : sizePreset === 'standard' ? 0.75 : 0.86
  const targetLineWidth = canvasWidth * targetCoverage

  // Average bold character aspect ratio ~0.66
  const dynamic = Math.round(targetLineWidth / (longestLineLen * 0.66))

  const minFont = Math.round(canvasWidth * (sizePreset === 'huge' ? 0.105 : sizePreset === 'standard' ? 0.075 : 0.092))
  const maxFont = Math.round(canvasWidth * (sizePreset === 'huge' ? 0.165 : sizePreset === 'standard' ? 0.115 : 0.142))

  return Math.max(minFont, Math.min(maxFont, dynamic))
}

export async function generateThumbnailAssDocument(options: {
  text: string
  style: AutoShortThumbnailStyleOrRandom
  position?: 'ocr' | 'top' | 'center' | 'bottom'
  fontSize?: 'standard' | 'large' | 'huge'
  canvasWidth: number
  canvasHeight: number
  targetBoundingBox?: { x0: number; y0: number; x1: number; y1: number } | null
}): Promise<{ assContent: string; font: ResolvedBurnFont | null }> {
  const { text, style, position = 'ocr', fontSize = 'large', canvasWidth, canvasHeight, targetBoundingBox } = options
  const cues = [{ id: 'thumb', sourceIndex: 1, start: 0, end: 10, text }]
  const font = resolveSubtitlePlanFont(cues, null)
  let assEmScale = 1
  if (font) {
    try {
      const verified = await readBurnFontPreview(font.entry.id)
      const parsed = opentype.parse(verified.data)
      const os2 = parsed.tables.os2
      const winHeight = os2 ? os2.usWinAscent + os2.usWinDescent : 0
      const fontHeight = winHeight > 0 ? winHeight : parsed.ascender - parsed.descender
      if (parsed.unitsPerEm > 0 && fontHeight > 0) {
        assEmScale = fontHeight / parsed.unitsPerEm
      }
    } catch {
      assEmScale = 1
    }
  }

  const fontFamily = (font?.entry.family || 'Arial').replace(/[,\r\n]/g, '')
  const baseFontSize = calculateThumbnailFontSize(text, canvasWidth, fontSize)
  const assFontSize = (baseFontSize * assEmScale).toFixed(2)

  const resolvedStyle = resolveThumbnailStyle(style)

  let primaryColor = '&H0000F5FF' // Vibrant Lemon Yellow
  let outlineColor = '&H000000A8' // Deep Crimson Red
  let shadowColor = '&H20000000'  // 3D Drop Shadow (high opacity)
  let outline = Math.max(6, Math.round(baseFontSize * 0.15))
  let shadow = Math.max(4, Math.round(baseFontSize * 0.07))
  let spacing = 3

  switch (resolvedStyle) {
    case 'douyin_black':
      primaryColor = '&H0000F5FF' // #FFF500
      outlineColor = '&H00000000' // #000000
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 4
      break
    case 'sticker_red':
      primaryColor = '&H00FFFFFF' // #FFFFFF
      outlineColor = '&H001515E0' // #E01515
      shadowColor = '&H25000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.07))
      spacing = 3
      break
    case 'tiktok_white':
      primaryColor = '&H00FFFFFF' // #FFFFFF
      outlineColor = '&H00000000' // #000000
      shadowColor = '&H30000000'
      outline = Math.max(5, Math.round(baseFontSize * 0.14))
      shadow = Math.max(4, Math.round(baseFontSize * 0.07))
      spacing = 3
      break
    case 'neon_cyan':
      primaryColor = '&H00FFF000' // #00F0FF (R=00, G=F0, B=FF)
      outlineColor = '&H00261005' // #051026
      shadowColor = '&H18000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 3
      break
    case 'fire_orange':
      primaryColor = '&H00006BFF' // #FF6B00 (R=FF, G=6B, B=00)
      outlineColor = '&H0000004D' // #4D0000
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 3
      break
    case 'luxury_gold':
      primaryColor = '&H0000D7FF' // #FFD700
      outlineColor = '&H0002162A' // #2A1602
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.15))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 3
      break
    case 'electric_lime':
      primaryColor = '&H0000FF52' // #52FF00
      outlineColor = '&H00000000' // #000000
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 3
      break
    case 'hot_pink':
      primaryColor = '&H00852AFF' // #FF2A85
      outlineColor = '&H001B0026' // #26001B
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 3
      break
    case 'purple_dream':
      primaryColor = '&H00FF6BCF' // #CF6BFF
      outlineColor = '&H0038001E' // #1E0038
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 3
      break
    case 'emerald_green':
      primaryColor = '&H00A3FF00' // #00FFA3
      outlineColor = '&H001B2E00' // #002E1B
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 3
      break
    case 'sunshine_blue':
      primaryColor = '&H0000E6FF' // #FFE600
      outlineColor = '&H00662A00' // #002A66
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.16))
      shadow = Math.max(4, Math.round(baseFontSize * 0.08))
      spacing = 3
      break
    case 'douyin_yellow':
    default:
      primaryColor = '&H0000F5FF'
      outlineColor = '&H000000A8'
      shadowColor = '&H20000000'
      outline = Math.max(6, Math.round(baseFontSize * 0.15))
      shadow = Math.max(4, Math.round(baseFontSize * 0.07))
      spacing = 3
      break
  }

  const targetX = Math.round(canvasWidth / 2)
  let targetY: number

  if (position === 'ocr' && targetBoundingBox) {
    targetY = Math.round((targetBoundingBox.y0 + targetBoundingBox.y1) / 2)
  } else if (position === 'center') {
    targetY = Math.round(canvasHeight * 0.50)
  } else if (position === 'bottom') {
    targetY = Math.round(canvasHeight * 0.82)
  } else {
    // 'top' or 'ocr' fallback when no OCR text was found
    targetY = Math.round(canvasHeight * 0.20)
  }

  targetY = Math.max(Math.round(canvasHeight * 0.08), Math.min(Math.round(canvasHeight * 0.92), targetY))

  const marginL = Math.round(canvasWidth * 0.04)
  const marginR = Math.round(canvasWidth * 0.04)
  const formattedText = formatThumbnailTitleText(text)

  const assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${canvasWidth}
PlayResY: ${canvasHeight}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TitleStyle,${fontFamily},${assFontSize},${primaryColor},&H000000FF,${outlineColor},${shadowColor},1,0,0,0,103,103,${spacing},0,1,${outline},${shadow},5,${marginL},${marginR},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,TitleStyle,,0,0,0,,{\\an5\\b1\\fsp${spacing}\\pos(${targetX},${targetY})}${formattedText}
`

  return { assContent, font }
}

export async function createAutoShortThumbnail(
  request: AutoShortThumbnailRequest,
  onProgress?: (progress: AutoShortThumbnailProgress) => void,
  signal?: AbortSignal,
  hooks: AutoShortThumbnailHooks = {}
): Promise<AutoShortThumbnailResult> {
  const abortSignal = signal || new AbortController().signal
  if (abortSignal.aborted) return { ok: false, error: 'Đã hủy tạo thumbnail.' }

  if (!request.videoPath || !(await stat(request.videoPath).catch(() => null))?.isFile()) {
    return { ok: false, error: 'Tệp video không tồn tại hoặc không hợp lệ.' }
  }
  if (!request.outputDir) {
    return { ok: false, error: 'Chưa chỉ định thư mục lưu thumbnail.' }
  }

  const ffmpeg = await (hooks.resolveFfmpeg || resolveFfmpeg)()
  const ffprobe = await (hooks.resolveFfprobe || resolveFfprobe)()
  if (!ffmpeg || !ffprobe) {
    return { ok: false, error: 'Cần FFmpeg và FFprobe để tạo thumbnail.' }
  }

  const media = hooks.runMedia || runThumbnailMedia
  const resourceManager = hooks.resourceManager || getGlobalResourceManager()

  await mkdir(request.outputDir, { recursive: true })
  const workDir = await mkdtemp(join(request.outputDir, '.thumb-'))
  const emit = (percent: number, message: string): void => {
    onProgress?.({ percent: Math.max(0, Math.min(100, percent)), message })
  }

  try {
    emit(5, 'Đang phân tích thông số video…')
    const probe = hooks.probeMedia || probeBurnMedia
    const meta = await probe(request.videoPath)
    const geometry =
      meta.geometry ??
      deriveCanonicalDisplayGeometry({
        codedWidth: meta.w,
        codedHeight: meta.h,
        rotation: meta.rotation,
        sampleAspectRatio: meta.sampleAspectRatio,
        videoStart: meta.videoStart
      })

    const duration = meta.videoDurationSeconds || meta.giay || 0
    let targetTime = request.mode === 'first_frame' ? 0 : Math.max(0, request.timestampSeconds ?? 0)
    if (duration > 0 && targetTime >= duration) {
      targetTime = Math.max(0, duration - 0.1)
    }

    let frameSource = request.videoPath
    let frameOffsetWithinSource = targetTime
    let cleaned = false
    let provider: 'cuda' | 'cpu' | undefined
    let detectedOcrBBox: { x0: number; y0: number; x1: number; y1: number } | null = null
    let detectedSnippetGeometry: CanonicalDisplayGeometry | null = null

    const shouldClean = request.cleanSubtitles !== false

    if (shouldClean) {
      emit(10, 'Đang kiểm tra AI xóa chữ (STTN)…')
      const sttnExecutable = await (hooks.resolveSttnEngine || resolveSttnEngine)()
      const sttnModel = await (hooks.resolveSttnModel || resolveSttnModel)()
      if (!sttnExecutable || !sttnModel) {
        throw new Error('Chưa cài đặt engine hoặc model STTN để làm sạch chữ.')
      }

      emit(15, 'Đang trích đoạn video để xử lý chữ…')
      const clipStart = Math.max(0, targetTime - 0.2)
      const clipDuration = Math.min(1.2, duration > 0 ? Math.max(0.5, duration - clipStart) : 1.2)
      frameOffsetWithinSource = Math.max(0, targetTime - clipStart)

      const snippetPath = join(workDir, 'snippet.mkv')
      await media(
        ffmpeg,
        [
          '-ss',
          String(clipStart),
          '-i',
          request.videoPath,
          '-t',
          String(clipDuration),
          '-map',
          '0:v:0',
          '-map',
          '0:a:0?',
          '-c:v',
          'ffv1',
          '-level',
          '3',
          '-fps_mode',
          'passthrough',
          '-c:a',
          'pcm_s16le',
          snippetPath
        ],
        abortSignal
      )

      const snippetMeta = await probe(snippetPath)
      const snippetDuration =
        Number.isFinite(snippetMeta.videoDurationSeconds) && (snippetMeta.videoDurationSeconds || 0) > 0
          ? (snippetMeta.videoDurationSeconds as number)
          : (Number.isFinite(snippetMeta.giay) && snippetMeta.giay > 0 ? snippetMeta.giay : clipDuration)
      if (!(snippetDuration > 0)) {
        throw new Error('Không thể xác định thời lượng đoạn trích thumbnail.')
      }

      const snippetGeometry =
        snippetMeta.geometry ??
        deriveCanonicalDisplayGeometry({
          codedWidth: snippetMeta.w,
          codedHeight: snippetMeta.h,
          rotation: snippetMeta.rotation,
          sampleAspectRatio: snippetMeta.sampleAspectRatio,
          videoStart: snippetMeta.videoStart
        })

      emit(30, 'Đang quét nhận diện chữ trong khung hình…')
      const ocrDir = join(workDir, 'ocr')
      await mkdir(ocrDir, { recursive: true })
      const scanRegion =
        normalizedToPixels(request.ocrRegion, snippetGeometry) ||
        defaultThumbnailOcrRegion(snippetGeometry)

      const visualOcr = hooks.runVisualOcr || ocrVideoWithVisualTimeline
      let visual: Awaited<ReturnType<typeof ocrVideoWithVisualTimeline>> | null = null
      try {
        visual = await resourceManager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], abortSignal, async () => {
          return visualOcr(
            {
              input: snippetPath,
              outputDir: ocrDir,
              scanRegion,
              profile: 'accurate',
              geometry: snippetGeometry,
              videoDurationSeconds: snippetDuration,
              sampleFps: 8,
              signal: abortSignal
            },
            (p) => emit(30 + Math.max(0, p.percent) * 0.2, 'Đang quét chữ bằng OCR…')
          )
        })
      } catch (ocrErr: any) {
        const msg = String(ocrErr?.message || ocrErr)
        if (
          msg.includes('không chứa segment hợp lệ') ||
          msg.includes('không chứa bounding box') ||
          msg.includes('không chứa segment nào')
        ) {
          visual = null
        } else {
          throw ocrErr
        }
      }

      if (visual?.timeline?.segments?.length && visual.boxSegmentCount > 0) {
        detectedSnippetGeometry = snippetGeometry
        detectedOcrBBox = extractProminentOcrRegion(visual.timeline.segments, frameOffsetWithinSource)
        emit(55, 'Phát hiện phụ đề, đang dùng STTN làm sạch nền…')
        const cleanedSnippet = join(workDir, 'cleaned_snippet.mkv')
        const removeFn = hooks.removeSubtitles || runSttnRemoval
        const sttnResult = await resourceManager.withLease(
          ['local-gpu-heavy', 'local-cpu-heavy'],
          abortSignal,
          async () => {
            return removeFn({
              videoPath: snippetPath,
              timeline: visual.timeline,
              outputPath: cleanedSnippet,
              ffmpegPath: ffmpeg,
              ffprobePath: ffprobe,
              signal: abortSignal,
              previewSeconds: snippetDuration,
              onProgress: (percent, message) => emit(55 + percent * 0.3, message)
            })
          }
        )
        frameSource = sttnResult.outputPath
        provider = sttnResult.provider
        cleaned = true
      } else {
        emit(80, 'Không phát hiện chữ trong vùng chọn, giữ ảnh gốc sắc nét…')
        frameSource = snippetPath
      }

      if (frameSource !== request.videoPath && snippetDuration > 0 && frameOffsetWithinSource >= snippetDuration) {
        frameOffsetWithinSource = Math.max(0, snippetDuration - 0.05)
      }
    }

    emit(88, 'Đang xuất ảnh thumbnail độ phân giải cao…')
    const preferredFilename = (request.outputFilename?.trim() || 'Thumbnail.jpg').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    const outputFilename = await resolveUniqueThumbnailFilename(request.outputDir, preferredFilename)
    const outputThumbnailPath = resolve(join(request.outputDir, outputFilename))
    await assertContainedParentDirectory(outputThumbnailPath, request.outputDir, 'Thumbnail output')

    const lines: string[] = []
    let currentInput = '0:v'

    const normalizedAdjustments = normalizeVideoAdjustments(request.videoAdjustments)
    if (hasVideoAdjustments(normalizedAdjustments)) {
      const adjFilter = videoAdjustmentFilter(meta, normalizedAdjustments)
      if (adjFilter) {
        lines.push(`[${currentInput}]${adjFilter}[adjusted]`)
        currentInput = 'adjusted'
      }
    }

    if (request.portraitBlur) {
      appendPortraitFrame(lines, currentInput, meta.w, meta.h)
      currentInput = 'out'
    }

    let scaledOcrBBox: { x0: number; y0: number; x1: number; y1: number } | null = null
    if (detectedOcrBBox && detectedSnippetGeometry) {
      if (request.portraitBlur) {
        const frame = portraitFrame(meta.w, meta.h)
        const scaleX = frame.contentWidth / detectedSnippetGeometry.displayWidth
        const scaleY = frame.contentHeight / detectedSnippetGeometry.displayHeight
        scaledOcrBBox = {
          x0: Math.round(frame.x + detectedOcrBBox.x0 * scaleX),
          y0: Math.round(frame.y + detectedOcrBBox.y0 * scaleY),
          x1: Math.round(frame.x + detectedOcrBBox.x1 * scaleX),
          y1: Math.round(frame.y + detectedOcrBBox.y1 * scaleY)
        }
      } else {
        const scaleX = meta.w / detectedSnippetGeometry.displayWidth
        const scaleY = meta.h / detectedSnippetGeometry.displayHeight
        scaledOcrBBox = {
          x0: Math.round(detectedOcrBBox.x0 * scaleX),
          y0: Math.round(detectedOcrBBox.y0 * scaleY),
          x1: Math.round(detectedOcrBBox.x1 * scaleX),
          y1: Math.round(detectedOcrBBox.y1 * scaleY)
        }
      }
    }

    if (request.titleOverlay?.text?.trim()) {
      const canvas = request.portraitBlur ? portraitFrame(meta.w, meta.h) : { width: meta.w, height: meta.h }
      const { assContent, font } = await generateThumbnailAssDocument({
        text: request.titleOverlay.text,
        style: request.titleOverlay.style || 'douyin_yellow',
        position: request.titleOverlay.position || 'ocr',
        fontSize: request.titleOverlay.fontSize || 'large',
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        targetBoundingBox: scaledOcrBBox
      })
      const assPath = join(workDir, 'thumb_title.ass')
      await writeFile(assPath, assContent, 'utf8')
      const assFilter = `ass=${basename(assPath)}${font?.fontsDir ? `:fontsdir=${escapeFfmpegFilterPath(font.fontsDir)}` : ''}`
      lines.push(`[${currentInput}]${assFilter}[with_title]`)
      currentInput = 'with_title'
    }

    const ffmpegArgs: string[] = ['-ss', String(frameOffsetWithinSource), '-i', frameSource]
    if (lines.length > 0) {
      ffmpegArgs.push('-filter_complex', lines.join(';'), '-map', `[${currentInput}]`)
    }
    ffmpegArgs.push('-vframes', '1', '-q:v', '2', outputThumbnailPath)

    await media(ffmpeg, ffmpegArgs, abortSignal, workDir)
    await assertContainedRegularFile(outputThumbnailPath, request.outputDir, 'Thumbnail output')
    if ((await stat(outputThumbnailPath)).size === 0) {
      throw new Error('Ảnh thumbnail tạo ra bị rỗng.')
    }

    emit(100, `Hoàn tất tạo thumbnail${cleaned ? ' (Đã làm sạch STTN)' : ''}!`)
    return {
      ok: true,
      thumbnailPath: outputThumbnailPath,
      timestamp: targetTime,
      provider,
      cleaned,
      detectedOcrRegion: scaledOcrBBox || undefined
    }
  } catch (error) {
    if (abortSignal.aborted) {
      return { ok: false, error: 'Đã hủy tạo thumbnail.' }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Không thể tạo thumbnail.'
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
