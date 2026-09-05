import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveCanonicalDisplayGeometry,
  canonicalOcrExtractionFilter,
  canonicalBurnDisplayFilter,
  normalizedRegionToDisplayPixels,
  parseCanonicalMediaMetadata
} from '../src/main/canonicalDisplayGeometry'

test('canonical extraction filter uses display dimensions and fixed order', () => {
  const pal = deriveCanonicalDisplayGeometry({
    codedWidth: 720,
    codedHeight: 576,
    rotation: 90,
    sampleAspectRatio: '16:15',
    videoStart: 1.25
  })
  assert.equal(pal.displayWidth, 576)
  assert.equal(pal.displayHeight, 768)
  assert.equal(
    canonicalOcrExtractionFilter(pal, 8),
    'setpts=PTS-STARTPTS,scale=576:768:flags=lanczos,setsar=1,fps=8'
  )
})

test('rotation normalizes 0, 90, 180, 270, negative, and angles >= 360', () => {
  assert.equal(deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, rotation: 0 }).rotation, 0)
  assert.equal(deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, rotation: 90 }).rotation, 90)
  assert.equal(deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, rotation: 180 }).rotation, 180)
  assert.equal(deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, rotation: 270 }).rotation, 270)
  assert.equal(deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, rotation: -90 }).rotation, 270)
  assert.equal(deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, rotation: 450 }).rotation, 90)
})

test('rejects non-multiple of 90 degrees, non-finite, and invalid dimensions', () => {
  assert.throws(() => deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, rotation: 45 }), /bội số của 90 độ/iu)
  assert.throws(() => deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, rotation: NaN }), /Góc xoay video không hợp lệ/iu)
  assert.throws(() => deriveCanonicalDisplayGeometry({ codedWidth: 0, codedHeight: 200 }), /Kích thước video không hợp lệ/iu)
  assert.throws(() => deriveCanonicalDisplayGeometry({ codedWidth: -10, codedHeight: 200 }), /Kích thước video không hợp lệ/iu)
  assert.throws(() => deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, sampleAspectRatio: '0:1' }), /Tỷ lệ pixel SAR không hợp lệ/iu)
  assert.throws(() => deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, sampleAspectRatio: '1:0' }), /Tỷ lệ pixel SAR không hợp lệ/iu)
  assert.throws(() => deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, sampleAspectRatio: 'invalid' }), /Tỷ lệ pixel SAR không hợp lệ/iu)
  assert.throws(() => deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 200, videoStart: NaN }), /Thời gian bắt đầu video không hợp lệ/iu)
})

test('preview, OCR, mask and burn project the same normalized region', () => {
  const geometry = deriveCanonicalDisplayGeometry({
    codedWidth: 1920,
    codedHeight: 1080,
    rotation: 90,
    sampleAspectRatio: '1:1',
    videoStart: 0
  })
  // After 90 rotation: displayWidth = 1080, displayHeight = 1920
  assert.equal(geometry.displayWidth, 1080)
  assert.equal(geometry.displayHeight, 1920)
  assert.deepEqual(
    normalizedRegionToDisplayPixels({ x0: 0.1, y0: 0.7, x1: 0.9, y1: 0.95 }, geometry),
    { x0: 108, y0: 1344, x1: 972, y1: 1824 }
  )
})

test('normalizedRegionToDisplayPixels rejects empty or inverted regions', () => {
  const geometry = deriveCanonicalDisplayGeometry({
    codedWidth: 1000,
    codedHeight: 1000
  })
  assert.throws(() => normalizedRegionToDisplayPixels({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.8 }, geometry), /không hợp lệ/iu)
  assert.throws(() => normalizedRegionToDisplayPixels({ x0: 0.8, y0: 0.5, x1: 0.2, y1: 0.8 }, geometry), /không hợp lệ/iu)
})

test('geometry fingerprint is stable 64-character SHA-256 and sensitive to any field change', () => {
  const g1 = deriveCanonicalDisplayGeometry({
    codedWidth: 1920,
    codedHeight: 1080,
    rotation: 0,
    sampleAspectRatio: '1:1',
    videoStart: 0
  })
  const g2 = deriveCanonicalDisplayGeometry({
    codedWidth: 1920,
    codedHeight: 1080,
    rotation: 0,
    sampleAspectRatio: '1:1',
    videoStart: 0
  })
  assert.equal(g1.fingerprint.length, 64)
  assert.equal(g1.fingerprint, g2.fingerprint)

  const gDiffRot = deriveCanonicalDisplayGeometry({ codedWidth: 1920, codedHeight: 1080, rotation: 180 })
  assert.notEqual(g1.fingerprint, gDiffRot.fingerprint)

  const gDiffSar = deriveCanonicalDisplayGeometry({ codedWidth: 1920, codedHeight: 1080, sampleAspectRatio: '4:3' })
  assert.notEqual(g1.fingerprint, gDiffSar.fingerprint)

  const gDiffStart = deriveCanonicalDisplayGeometry({ codedWidth: 1920, codedHeight: 1080, videoStart: 0.5 })
  assert.notEqual(g1.fingerprint, gDiffStart.fingerprint)
})

test('duration selection chooses video stream over container and audio', () => {
  const parsed1 = {
    streams: [
      { codec_type: 'video', width: 1920, height: 1080, duration: '5.0', start_time: '0.0' },
      { codec_type: 'audio', duration: '8.0' }
    ],
    format: { duration: '8.0' }
  }
  const meta1 = parseCanonicalMediaMetadata(parsed1)
  assert.equal(meta1.videoDurationSeconds, 5.0)
  assert.equal(meta1.containerDurationSeconds, 8.0)

  // video duration absent => fallback to format duration
  const parsed2 = {
    streams: [
      { codec_type: 'video', width: 1920, height: 1080, start_time: '0.0' },
      { codec_type: 'audio', duration: '8.0' }
    ],
    format: { duration: '8.0' }
  }
  const meta2 = parseCanonicalMediaMetadata(parsed2)
  assert.equal(meta2.videoDurationSeconds, 8.0)
  assert.equal(meta2.containerDurationSeconds, 8.0)

  // video duration 0 => fallback to format duration
  const parsed3 = {
    streams: [
      { codec_type: 'video', width: 1920, height: 1080, duration: '0', start_time: '0.0' },
      { codec_type: 'audio', duration: '8.0' }
    ],
    format: { duration: '8.0' }
  }
  const meta3 = parseCanonicalMediaMetadata(parsed3)
  assert.equal(meta3.videoDurationSeconds, 8.0)

  // both absent => videoDurationSeconds is null
  const parsed4 = {
    streams: [
      { codec_type: 'video', width: 1920, height: 1080 },
      { codec_type: 'audio', duration: '8.0' }
    ],
    format: {}
  }
  const meta4 = parseCanonicalMediaMetadata(parsed4)
  assert.equal(meta4.videoDurationSeconds, null)
  assert.equal(meta4.containerDurationSeconds, 0)
})

test('canonicalBurnDisplayFilter returns null for square SAR and zero start', () => {
  const square = deriveCanonicalDisplayGeometry({
    codedWidth: 1920,
    codedHeight: 1080,
    rotation: 0,
    sampleAspectRatio: '1:1',
    videoStart: 0
  })
  assert.equal(canonicalBurnDisplayFilter(square), null)

  const nonZeroStart = deriveCanonicalDisplayGeometry({
    codedWidth: 1920,
    codedHeight: 1080,
    videoStart: 1.5
  })
  assert.equal(canonicalBurnDisplayFilter(nonZeroStart), 'setpts=PTS-STARTPTS')

  const nonSquareSar = deriveCanonicalDisplayGeometry({
    codedWidth: 720,
    codedHeight: 576,
    sampleAspectRatio: '16:15',
    videoStart: 0
  })
  assert.equal(
    canonicalBurnDisplayFilter(nonSquareSar),
    'scale=768:576:flags=lanczos,setsar=1'
  )
})
