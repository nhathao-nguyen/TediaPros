import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autoShortNormalizedRegionToPixels,
  clampAutoShortNormalizedRegion,
  pixelRegionToAutoShortNormalized,
  referencePixelsFromVideoHeight,
  videoPixelsFromReferenceHeight
} from '../src/shared/autoShortRegionGeometry'

test('one normalized layout keeps the same relative geometry at 1080p and 4K portrait', () => {
  const normalized = pixelRegionToAutoShortNormalized(
    { x0: 86, y0: 1498, x1: 994, y1: 1728 },
    1080,
    1920
  )
  assert.ok(normalized)

  assert.deepEqual(autoShortNormalizedRegionToPixels(normalized, 1080, 1920), {
    x0: 86,
    y0: 1498,
    x1: 994,
    y1: 1728
  })
  assert.deepEqual(autoShortNormalizedRegionToPixels(normalized, 2160, 3840), {
    x0: 172,
    y0: 2996,
    x1: 1988,
    y1: 3456
  })
})

test('pixel edits round-trip without accumulating resolution-switch drift', () => {
  const initial = pixelRegionToAutoShortNormalized(
    { x0: 123, y0: 1401, x1: 987, y1: 1799 },
    1080,
    1920
  )
  assert.ok(initial)

  const on4k = autoShortNormalizedRegionToPixels(initial, 2160, 3840)
  assert.ok(on4k)
  const after4kEdit = pixelRegionToAutoShortNormalized(on4k, 2160, 3840)
  assert.ok(after4kEdit)
  const backOn1080 = autoShortNormalizedRegionToPixels(after4kEdit, 1080, 1920)
  assert.deepEqual(backOn1080, { x0: 123, y0: 1401, x1: 987, y1: 1799 })
})

test('normalized regions clamp to bounds and reject invalid geometry', () => {
  assert.deepEqual(
    clampAutoShortNormalizedRegion({ x0: -0.2, y0: 0.1, x1: 1.4, y1: 0.9 }),
    { x0: 0, y0: 0.1, x1: 1, y1: 0.9 }
  )
  assert.equal(clampAutoShortNormalizedRegion({ x0: 0.8, y0: 0.1, x1: 0.2, y1: 0.9 }), null)
  assert.equal(clampAutoShortNormalizedRegion({ x0: 0.1, y0: NaN, x1: 0.8, y1: 0.9 }), null)
  assert.equal(pixelRegionToAutoShortNormalized({ x0: 0, y0: 0, x1: 10, y1: 10 }, 0, 100), null)
  assert.equal(autoShortNormalizedRegionToPixels({ x0: 0, y0: 0, x1: 1, y1: 1 }, 100, 0), null)
})

test('manual font and outline pixels use a stable 1920-high reference', () => {
  assert.equal(videoPixelsFromReferenceHeight(32, 1920), 32)
  assert.equal(videoPixelsFromReferenceHeight(32, 3840), 64)
  assert.equal(videoPixelsFromReferenceHeight(2, 1080), 1.125)
  assert.equal(referencePixelsFromVideoHeight(32, 1080), 32 * 1920 / 1080)
  assert.equal(
    videoPixelsFromReferenceHeight(referencePixelsFromVideoHeight(32, 1080), 1080),
    32
  )
})
