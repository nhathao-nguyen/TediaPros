import type { VideoAdjustments } from './types'

export const DEFAULT_VIDEO_ADJUSTMENTS: VideoAdjustments = {
  zoom: 100,
  brightness: 0,
  saturation: 100,
  contrast: 100
}

const LIMITS = {
  zoom: [100, 120],
  brightness: [-20, 20],
  saturation: [0, 200],
  contrast: [50, 150]
} as const

export function normalizeVideoAdjustments(value: Partial<VideoAdjustments> | null | undefined): VideoAdjustments {
  const normalized = { ...DEFAULT_VIDEO_ADJUSTMENTS, ...(value || {}) }
  for (const key of Object.keys(LIMITS) as Array<keyof VideoAdjustments>) {
    const current = normalized[key]
    const [min, max] = LIMITS[key]
    if (!Number.isFinite(current) || current < min || current > max) {
      throw new Error(`Thông số ${key} không hợp lệ.`)
    }
  }
  return normalized
}

export function hasVideoAdjustments(value: Partial<VideoAdjustments> | null | undefined): boolean {
  const normalized = normalizeVideoAdjustments(value)
  return (Object.keys(DEFAULT_VIDEO_ADJUSTMENTS) as Array<keyof VideoAdjustments>)
    .some((key) => normalized[key] !== DEFAULT_VIDEO_ADJUSTMENTS[key])
}

function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded - 1
}

export function videoAdjustmentFilter(
  dimensions: { w: number; h: number },
  value: Partial<VideoAdjustments> | null | undefined
): string | null {
  const adjustments = normalizeVideoAdjustments(value)
  if (!hasVideoAdjustments(adjustments)) return null

  const filters: string[] = []
  if (adjustments.zoom !== 100) {
    const ratio = adjustments.zoom / 100
    const cropWidth = evenDimension(dimensions.w / ratio)
    const cropHeight = evenDimension(dimensions.h / ratio)
    const x = Math.floor((dimensions.w - cropWidth) / 2)
    const y = Math.floor((dimensions.h - cropHeight) / 2)
    filters.push(
      `crop=${cropWidth}:${cropHeight}:${x}:${y}`,
      `scale=${evenDimension(dimensions.w)}:${evenDimension(dimensions.h)}:flags=lanczos`,
      'setsar=1'
    )
  }
  if (adjustments.brightness !== 0 || adjustments.saturation !== 100 || adjustments.contrast !== 100) {
    filters.push(
      `eq=brightness=${formatRatio(adjustments.brightness / 100)}` +
      `:saturation=${formatRatio(adjustments.saturation / 100)}` +
      `:contrast=${formatRatio(adjustments.contrast / 100)}`
    )
  }
  return filters.join(',')
}

export function videoAdjustmentPreviewStyle(value: Partial<VideoAdjustments> | null | undefined): {
  transform: string
  filter: string
} {
  const adjustments = normalizeVideoAdjustments(value)
  return {
    transform: `scale(${formatRatio(adjustments.zoom / 100)})`,
    filter: `brightness(${formatRatio(1 + adjustments.brightness / 100)}) ` +
      `saturate(${formatRatio(adjustments.saturation / 100)}) ` +
      `contrast(${formatRatio(adjustments.contrast / 100)})`
  }
}

export function videoAdjustmentPreviewCoordinate(value: number, extent: number, zoom: number): number {
  if (!Number.isFinite(extent) || extent <= 0) return 0
  return Number((((value / extent - 0.5) * (zoom / 100) + 0.5) * 100).toFixed(6))
}

export function videoAdjustmentPreviewSize(value: number, extent: number, zoom: number): number {
  if (!Number.isFinite(extent) || extent <= 0) return 0
  return Number((value / extent * (zoom / 100) * 100).toFixed(6))
}

export function videoAdjustmentSourceDelta(
  previewDelta: number,
  sourceExtent: number,
  previewExtent: number,
  zoom: number
): number {
  if (!Number.isFinite(previewExtent) || previewExtent <= 0 || !Number.isFinite(zoom) || zoom <= 0) return 0
  return previewDelta * sourceExtent / previewExtent / (zoom / 100)
}

function formatRatio(value: number): string {
  return Number(value.toFixed(2)).toString()
}
