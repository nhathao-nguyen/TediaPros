import { createHash } from 'node:crypto'
import type { AutoShortNormalizedRegion, PixelRegion } from '../shared/types'

export interface CanonicalDisplayGeometry {
  codedWidth: number
  codedHeight: number
  rotation: 0 | 90 | 180 | 270
  sampleAspectRatio: { numerator: number; denominator: number }
  videoStart: number
  displayWidth: number
  displayHeight: number
  fingerprint: string
  colorPrimaries?: string
  colorSpace?: string
  colorTransfer?: string
}

export interface CanonicalVideoTiming {
  videoDurationSeconds: number
  containerDurationSeconds: number
  frameRate?: number
  averageFrameRate?: number
  isVariableFrameRate?: boolean
}

export interface CanonicalMediaMetadata {
  geometry?: CanonicalDisplayGeometry
  videoDurationSeconds: number | null
  containerDurationSeconds: number
  /** Nominal/container rate from FFprobe `r_frame_rate`. */
  frameRate?: number
  /** Measured stream average from FFprobe `avg_frame_rate`; authoritative for VFR. */
  averageFrameRate?: number
  /** True when nominal and average rates differ materially. */
  isVariableFrameRate?: boolean
  hasAudio: boolean
  audioDurationSeconds?: number
  audioStartSeconds?: number
  colorSpace?: string
  colorPrimaries?: string
  colorTransfer?: string
  // Legacy compatibility fields
  w: number
  h: number
  giay: number
  videoDuration?: number
  audioDuration?: number
  rotation?: number
  sampleAspectRatio?: string
  videoStart?: number
  audioStart?: number
}

export function evenFloor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Kích thước video không hợp lệ.')
  return Math.max(2, Math.floor(value / 2) * 2)
}

export function normalizeRotation(value: number | undefined): 0 | 90 | 180 | 270 {
  const raw = value ?? 0
  if (!Number.isFinite(raw)) throw new Error('Góc xoay video không hợp lệ.')
  const normalized = ((Math.round(raw) % 360) + 360) % 360
  if (normalized !== 0 && normalized !== 90 && normalized !== 180 && normalized !== 270) {
    throw new Error('Góc xoay video phải là bội số của 90 độ.')
  }
  return normalized as 0 | 90 | 180 | 270
}

export function parseSar(sar?: string): { numerator: number; denominator: number } {
  if (!sar) {
    return { numerator: 1, denominator: 1 }
  }
  const parts = sar.split(':').map(Number)
  if (
    parts.length !== 2 ||
    !Number.isFinite(parts[0]) ||
    !Number.isFinite(parts[1]) ||
    parts[0] <= 0 ||
    parts[1] <= 0 ||
    !Number.isInteger(parts[0]) ||
    !Number.isInteger(parts[1])
  ) {
    throw new Error('Tỷ lệ pixel SAR không hợp lệ.')
  }
  return { numerator: parts[0], denominator: parts[1] }
}

export function deriveCanonicalDisplayGeometry(input: {
  codedWidth: number
  codedHeight: number
  rotation?: number
  sampleAspectRatio?: string
  videoStart?: number
  colorPrimaries?: string
  colorSpace?: string
  colorTransfer?: string
}): CanonicalDisplayGeometry {
  if (
    !Number.isFinite(input.codedWidth) ||
    input.codedWidth <= 0 ||
    !Number.isFinite(input.codedHeight) ||
    input.codedHeight <= 0
  ) {
    throw new Error('Kích thước video không hợp lệ.')
  }
  const rawStart = input.videoStart ?? 0
  if (!Number.isFinite(rawStart)) {
    throw new Error('Thời gian bắt đầu video không hợp lệ.')
  }
  const codedWidth = Math.round(input.codedWidth)
  const codedHeight = Math.round(input.codedHeight)
  const rotation = normalizeRotation(input.rotation)
  const sar = parseSar(input.sampleAspectRatio)
  const videoStart = rawStart

  const squareWidth = evenFloor((codedWidth * sar.numerator) / sar.denominator)
  const squareHeight = evenFloor(codedHeight)

  const isSwapped = rotation === 90 || rotation === 270
  const displayWidth = isSwapped ? squareHeight : squareWidth
  const displayHeight = isSwapped ? squareWidth : squareHeight

  const fingerprintPayload = {
    codedWidth,
    codedHeight,
    rotation,
    sarNumerator: sar.numerator,
    sarDenominator: sar.denominator,
    videoStart,
    displayWidth,
    displayHeight
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintPayload)).digest('hex')

  return {
    codedWidth,
    codedHeight,
    rotation,
    sampleAspectRatio: sar,
    videoStart,
    displayWidth,
    displayHeight,
    fingerprint,
    ...(input.colorPrimaries ? { colorPrimaries: input.colorPrimaries } : {}),
    ...(input.colorSpace ? { colorSpace: input.colorSpace } : {}),
    ...(input.colorTransfer ? { colorTransfer: input.colorTransfer } : {})
  }
}

export function isUnsupportedColorParam(value?: string): boolean {
  if (!value) return false
  return /reserved|unknown|unspecified/i.test(value)
}

export function needsColorNormalization(color?: { primaries?: string; space?: string; transfer?: string }): boolean {
  if (!color) return false
  return isUnsupportedColorParam(color.primaries) || isUnsupportedColorParam(color.transfer) || isUnsupportedColorParam(color.space)
}

export function canonicalOcrExtractionFilter(
  geometry: CanonicalDisplayGeometry,
  sampleFps: 8 = 8
): string {
  const needsColor = needsColorNormalization({
    primaries: geometry.colorPrimaries,
    space: geometry.colorSpace,
    transfer: geometry.colorTransfer
  })
  const colorFilter = needsColor ? 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,' : ''
  return `${colorFilter}setpts=PTS-STARTPTS,scale=${geometry.displayWidth}:${geometry.displayHeight}:flags=lanczos,setsar=1,fps=${sampleFps}`
}

export function canonicalBurnDisplayFilter(
  geometry: CanonicalDisplayGeometry
): string | null {
  const needsPts = Math.abs(geometry.videoStart) > 1e-4
  const needsSar = geometry.sampleAspectRatio.numerator !== geometry.sampleAspectRatio.denominator
  const needsColor = needsColorNormalization({
    primaries: geometry.colorPrimaries,
    space: geometry.colorSpace,
    transfer: geometry.colorTransfer
  })
  if (!needsPts && !needsSar && !needsColor) return null

  const filters: string[] = []
  if (needsColor) {
    filters.push('setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709')
  }
  if (needsPts) filters.push('setpts=PTS-STARTPTS')
  if (needsSar) {
    filters.push(
      `scale=${geometry.displayWidth}:${geometry.displayHeight}:flags=lanczos`,
      'setsar=1'
    )
  }
  return filters.join(',')
}

export function normalizedRegionToDisplayPixels(
  region: AutoShortNormalizedRegion,
  geometry: CanonicalDisplayGeometry
): PixelRegion {
  const x0 = Math.max(0, Math.min(geometry.displayWidth, Math.round(region.x0 * geometry.displayWidth)))
  const y0 = Math.max(0, Math.min(geometry.displayHeight, Math.round(region.y0 * geometry.displayHeight)))
  const x1 = Math.max(0, Math.min(geometry.displayWidth, Math.round(region.x1 * geometry.displayWidth)))
  const y1 = Math.max(0, Math.min(geometry.displayHeight, Math.round(region.y1 * geometry.displayHeight)))
  if (x1 <= x0 || y1 <= y0) {
    throw new Error('Vùng chọn có kích thước không hợp lệ.')
  }
  return { x0, y0, x1, y1 }
}

export interface FFprobeRawStream {
  codec_type?: string
  width?: number
  height?: number
  start_time?: string
  duration?: string
  r_frame_rate?: string
  avg_frame_rate?: string
  sample_aspect_ratio?: string
  color_space?: string
  color_primaries?: string
  color_transfer?: string
  tags?: { rotate?: string }
  side_data_list?: Array<{ rotation?: number }>
}

/** Parse an FFprobe rational frame-rate value such as `30000/1001`. */
export function parseFrameRate(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const raw = String(value)
  const [num, den] = raw.split('/').map(Number)
  if (!Number.isFinite(num) || num <= 0 || !Number.isFinite(den) || den <= 0) return undefined
  const rate = num / den
  return Number.isFinite(rate) && rate > 0 ? rate : undefined
}

export interface FFprobeRawJson {
  streams?: FFprobeRawStream[]
  format?: { duration?: string; start_time?: string }
}

export function parseCanonicalMediaMetadata(parsed: FFprobeRawJson): CanonicalMediaMetadata {
  const streams = Array.isArray(parsed.streams) ? parsed.streams : []
  const videoStream = streams.find((stream) => stream.codec_type === 'video')
  const audioStream = streams.find((stream) => stream.codec_type === 'audio')

  const positive = (value: unknown): number | null => {
    const p = Number(value)
    return Number.isFinite(p) && p > 0 ? p : null
  }

  const containerDurationSeconds = positive(parsed.format?.duration) ?? 0
  const videoDurationSeconds = positive(videoStream?.duration) ?? positive(parsed.format?.duration)

  const codedWidth = Number(videoStream?.width) || 0
  const codedHeight = Number(videoStream?.height) || 0
  const sar = videoStream?.sample_aspect_ratio || '1:1'

  const rotationRaw =
    videoStream?.side_data_list?.find((item) => Number.isFinite(item.rotation))?.rotation ??
    Number(videoStream?.tags?.rotate || 0)
  const rotation = Number.isFinite(rotationRaw) ? Math.round(rotationRaw) : 0

  const frameRate = parseFrameRate(videoStream?.r_frame_rate)
  const averageFrameRate = parseFrameRate(videoStream?.avg_frame_rate)
  const isVariableFrameRate = frameRate != null && averageFrameRate != null
    ? Math.abs(frameRate - averageFrameRate) > 0.01
    : undefined

  const videoStart = Number(videoStream?.start_time) || Number(parsed.format?.start_time) || 0
  const audioStart = Number(audioStream?.start_time) || 0

  const colorSpace = typeof videoStream?.color_space === 'string' ? videoStream.color_space.trim().toLowerCase() : undefined
  const colorPrimaries = typeof videoStream?.color_primaries === 'string' ? videoStream.color_primaries.trim().toLowerCase() : undefined
  const colorTransfer = typeof videoStream?.color_transfer === 'string' ? videoStream.color_transfer.trim().toLowerCase() : undefined

  let geometry: CanonicalDisplayGeometry | undefined
  if (codedWidth > 0 && codedHeight > 0) {
    try {
      geometry = deriveCanonicalDisplayGeometry({
        codedWidth,
        codedHeight,
        rotation,
        sampleAspectRatio: sar,
        videoStart,
        colorPrimaries,
        colorSpace,
        colorTransfer
      })
    } catch {
      // If invalid, geometry remains undefined
    }
  }

  const w = geometry ? geometry.displayWidth : codedWidth
  const h = geometry ? geometry.displayHeight : codedHeight

  return {
    geometry,
    videoDurationSeconds,
    containerDurationSeconds,
    frameRate,
    averageFrameRate,
    isVariableFrameRate,
    hasAudio: Boolean(audioStream),
    audioDurationSeconds: positive(audioStream?.duration) ?? undefined,
    audioStartSeconds: audioStart,
    ...(colorSpace ? { colorSpace } : {}),
    ...(colorPrimaries ? { colorPrimaries } : {}),
    ...(colorTransfer ? { colorTransfer } : {}),
    // Legacy Meta compatibility
    w,
    h,
    giay: containerDurationSeconds,
    videoDuration: Number(videoStream?.duration) || 0,
    audioDuration: Number(audioStream?.duration) || 0,
    rotation,
    sampleAspectRatio: sar,
    videoStart,
    audioStart
  }
}
