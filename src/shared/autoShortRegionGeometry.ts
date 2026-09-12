import type { AutoShortNormalizedRegion, PixelRegion } from './types'

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

function hasValidVideoSize(width: number, height: number): boolean {
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
}

export function clampAutoShortNormalizedRegion(
  region: AutoShortNormalizedRegion
): AutoShortNormalizedRegion | null {
  const values = [region.x0, region.y0, region.x1, region.y1]
  if (!values.every(Number.isFinite)) return null

  const clamped = {
    x0: clamp01(region.x0),
    y0: clamp01(region.y0),
    x1: clamp01(region.x1),
    y1: clamp01(region.y1)
  }
  return clamped.x1 > clamped.x0 && clamped.y1 > clamped.y0 ? clamped : null
}

export function pixelRegionToAutoShortNormalized(
  region: PixelRegion,
  videoWidth: number,
  videoHeight: number
): AutoShortNormalizedRegion | null {
  if (!hasValidVideoSize(videoWidth, videoHeight)) return null
  return clampAutoShortNormalizedRegion({
    x0: region.x0 / videoWidth,
    y0: region.y0 / videoHeight,
    x1: region.x1 / videoWidth,
    y1: region.y1 / videoHeight
  })
}

export function autoShortNormalizedRegionToPixels(
  region: AutoShortNormalizedRegion,
  videoWidth: number,
  videoHeight: number
): PixelRegion | null {
  if (!hasValidVideoSize(videoWidth, videoHeight)) return null
  const normalized = clampAutoShortNormalizedRegion(region)
  if (!normalized) return null

  const pixels = {
    x0: Math.round(normalized.x0 * videoWidth),
    y0: Math.round(normalized.y0 * videoHeight),
    x1: Math.round(normalized.x1 * videoWidth),
    y1: Math.round(normalized.y1 * videoHeight)
  }
  return pixels.x1 > pixels.x0 && pixels.y1 > pixels.y0 ? pixels : null
}

export function videoPixelsFromReferenceHeight(
  pixels: number,
  videoHeight: number,
  referenceHeight = 1920
): number {
  if (!Number.isFinite(pixels) || !hasValidVideoSize(1, videoHeight) || !Number.isFinite(referenceHeight) || referenceHeight <= 0) {
    return pixels
  }
  return pixels * videoHeight / referenceHeight
}

export function referencePixelsFromVideoHeight(
  pixels: number,
  videoHeight: number,
  referenceHeight = 1920
): number {
  if (!Number.isFinite(pixels) || !hasValidVideoSize(1, videoHeight) || !Number.isFinite(referenceHeight) || referenceHeight <= 0) {
    return pixels
  }
  return pixels * referenceHeight / videoHeight
}
