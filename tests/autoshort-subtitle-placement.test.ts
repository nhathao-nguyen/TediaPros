import assert from 'node:assert/strict'
import test from 'node:test'
import type { OcrVisualSegment, OcrVisualTimeline } from '../src/shared/ocrVisualTimeline'
import {
  effectiveAutoShortSubtitlePlacementMode,
  resolveAutoShortSubtitlePlacement
} from '../src/shared/autoShortSubtitlePlacement'

const fallback = { x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.52 }

function segment(
  id: string,
  start: number,
  end: number,
  entries: Array<{ text: string; x0: number; y0: number; x1: number; y1: number; confidence?: number }>
): OcrVisualSegment {
  return {
    id,
    startFrame: start * 8,
    endFrameExclusive: end * 8,
    start,
    end,
    text: entries.map((entry) => entry.text).join(' '),
    confidence: Math.min(...entries.map((entry) => entry.confidence ?? 0.95)),
    boxes: entries.map((entry) => ({ ...entry, confidence: entry.confidence ?? 0.95 }))
  }
}

function timeline(segments: OcrVisualSegment[]): OcrVisualTimeline {
  return {
    schemaVersion: 1,
    protocol: 'ocr-visual-cues/1',
    video: {
      width: 1000,
      height: 1000,
      durationSeconds: 10,
      sampleFps: 8,
      frameCount: 80,
      geometryFingerprint: 'f'.repeat(64)
    },
    profile: 'accurate',
    scanRegion: { x0: 100, y0: 200, x1: 900, y1: 900 },
    segments
  }
}

test('selects the only OCR track that is both frequent and large without mutating the timeline', () => {
  const input = timeline([
    segment('s1', 0, 4, [{ text: 'Xin chào mọi người', x0: 220, y0: 700, x1: 780, y1: 750 }]),
    segment('s2', 4, 8, [{ text: 'Hôm nay trời rất đẹp', x0: 210, y0: 700, x1: 790, y1: 750 }])
  ])
  const original = structuredClone(input)

  const result = resolveAutoShortSubtitlePlacement({ mode: 'ocr-dominant', timeline: input, fallbackRegion: fallback })

  assert.equal(result.reason, 'selected')
  assert.equal(result.candidateCount, 1)
  assert.equal(result.coverage, 0.8)
  assert.equal(result.typicalLineHeight, 0.05)
  assert.ok(result.region)
  assert.ok(result.region.y0 >= 0.2 && result.region.y1 <= 0.9)
  assert.ok(result.region.y0 > 0.6)
  assert.deepEqual(input, original)
})

test('rejects a fixed logo even when it is large and visible throughout the video', () => {
  const input = timeline([
    segment('s1', 0, 4, [
      { text: 'THƯƠNG HIỆU', x0: 150, y0: 230, x1: 650, y1: 300 },
      { text: 'Bạn đang xem điều gì', x0: 250, y0: 700, x1: 750, y1: 750 }
    ]),
    segment('s2', 4, 8, [
      { text: 'THƯƠNG HIỆU', x0: 150, y0: 230, x1: 650, y1: 300 },
      { text: 'Hôm nay chúng ta bắt đầu', x0: 250, y0: 700, x1: 750, y1: 750 }
    ])
  ])

  const result = resolveAutoShortSubtitlePlacement({ mode: 'ocr-dominant', timeline: input, fallbackRegion: fallback })

  assert.equal(result.reason, 'selected')
  assert.equal(result.candidateCount, 1)
  assert.ok(result.region && result.region.y0 > 0.6)
})

test('uses the manual fallback when frequency and largest text belong to different tracks', () => {
  const input = timeline([
    segment('s1', 0, 2.5, [{ text: 'Nhỏ một', x0: 300, y0: 720, x1: 700, y1: 750 }]),
    segment('s2', 2.5, 5, [{ text: 'Nhỏ hai', x0: 300, y0: 720, x1: 700, y1: 750 }]),
    segment('s3', 5, 7.5, [{ text: 'Nhỏ ba', x0: 300, y0: 720, x1: 700, y1: 750 }]),
    segment('s4', 7.5, 8.75, [{ text: 'MỘT TIÊU ĐỀ RẤT LỚN', x0: 150, y0: 400, x1: 850, y1: 500 }]),
    segment('s5', 8.75, 10, [{ text: 'NỘI DUNG HOÀN TOÀN KHÁC', x0: 150, y0: 400, x1: 850, y1: 500 }])
  ])

  const result = resolveAutoShortSubtitlePlacement({ mode: 'ocr-dominant', timeline: input, fallbackRegion: fallback })

  assert.equal(result.reason, 'criteria-conflict')
  assert.deepEqual(result.region, fallback)
})

test('never uses text outside the user-selected OCR region', () => {
  const input = timeline([
    segment('s1', 0, 4, [{ text: 'Ngoài vùng một', x0: 0, y0: 920, x1: 1000, y1: 990 }]),
    segment('s2', 4, 8, [{ text: 'Ngoài vùng hai', x0: 0, y0: 920, x1: 1000, y1: 990 }])
  ])

  const result = resolveAutoShortSubtitlePlacement({ mode: 'ocr-dominant', timeline: input, fallbackRegion: fallback })

  assert.equal(result.reason, 'no-candidate')
  assert.deepEqual(result.region, fallback)
})

test('manual mode preserves the configured subtitle region without inspecting OCR', () => {
  const result = resolveAutoShortSubtitlePlacement({ mode: 'manual', timeline: null, fallbackRegion: fallback })
  assert.deepEqual(result, {
    version: 1,
    mode: 'manual',
    reason: 'manual',
    region: fallback,
    candidateCount: 0
  })
})

test('UI request enables OCR placement only while OCR-auto or STTN processing is active', () => {
  assert.equal(effectiveAutoShortSubtitlePlacementMode('ocr-dominant', true), 'ocr-dominant')
  assert.equal(effectiveAutoShortSubtitlePlacementMode('ocr-dominant', false), 'manual')
  assert.equal(effectiveAutoShortSubtitlePlacementMode('manual', true), 'manual')
})

test('resolves placement independently for a batch of 100 items', () => {
  const fallbackSnapshot = structuredClone(fallback)
  const decisions = Array.from({ length: 100 }, (_, index) => {
    const y0 = 300 + (index % 5) * 100
    return resolveAutoShortSubtitlePlacement({
      mode: 'ocr-dominant',
      fallbackRegion: fallback,
      timeline: timeline([
        segment(`a-${index}`, 0, 4, [{ text: `Nội dung đầu tiên số ${index}`, x0: 220, y0, x1: 780, y1: y0 + 50 }]),
        segment(`b-${index}`, 4, 8, [{ text: `Một câu hoàn toàn khác số ${index}`, x0: 210, y0, x1: 790, y1: y0 + 50 }])
      ])
    })
  })

  assert.equal(decisions.length, 100)
  assert.ok(decisions.every((decision) => decision.reason === 'selected'))
  assert.equal(new Set(decisions.map((decision) => decision.region?.y0)).size, 5)
  assert.deepEqual(fallback, fallbackSnapshot)
})
