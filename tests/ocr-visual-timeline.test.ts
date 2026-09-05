import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validateOcrVisualTimeline,
  stabilizeSingleSampleGaps,
  projectOcrTimelineToSubtitleCues,
  planOcrMaskFrames,
  boxesForMaskFrame,
  type ExpectedOcrTimelineGeometry,
  type OcrVisualTimeline
} from '../src/shared/ocrVisualTimeline'

const EXPECTED: ExpectedOcrTimelineGeometry = {
  width: 100,
  height: 60,
  durationSeconds: 1.0,
  sampleFps: 8,
  geometryFingerprint: 'a'.repeat(64),
  scanRegion: { x0: 0, y0: 0, x1: 100, y1: 60 }
}

function validTimeline(): OcrVisualTimeline {
  return {
    schemaVersion: 1,
    protocol: 'ocr-visual-cues/1',
    video: {
      width: 100,
      height: 60,
      durationSeconds: 1.0,
      sampleFps: 8,
      frameCount: 8,
      geometryFingerprint: 'a'.repeat(64)
    },
    profile: 'accurate',
    scanRegion: { x0: 0, y0: 0, x1: 100, y1: 60 },
    segments: [
      {
        id: 'accurate-2',
        startFrame: 2,
        endFrameExclusive: 3,
        start: 0.25,
        end: 0.375,
        text: 'hello',
        confidence: 0.9,
        boxes: [
          {
            text: 'hello',
            confidence: 0.9,
            x0: 10,
            y0: 10,
            x1: 40,
            y1: 30
          }
        ]
      }
    ]
  }
}

test('valid timeline passes validation', () => {
  const t = validTimeline()
  const validated = validateOcrVisualTimeline(t, EXPECTED)
  assert.equal(validated.schemaVersion, 1)
  assert.equal(validated.segments.length, 1)
})

test('rejects schema, protocol, profile, and fingerprint mismatches', () => {
  const badSchema = validTimeline(); (badSchema as any).schemaVersion = 2
  assert.throws(() => validateOcrVisualTimeline(badSchema, EXPECTED), /schema/iu)

  const badProto = validTimeline(); (badProto as any).protocol = 'ocr-visual-cues/2'
  assert.throws(() => validateOcrVisualTimeline(badProto, EXPECTED), /protocol/iu)

  const badProfile = validTimeline(); (badProfile as any).profile = 'balanced'
  assert.throws(() => validateOcrVisualTimeline(badProfile, EXPECTED), /profile/iu)

  const badFp = validTimeline(); badFp.video.geometryFingerprint = 'b'.repeat(64)
  assert.throws(() => validateOcrVisualTimeline(badFp, EXPECTED), /fingerprint/iu)

  const badWidth = validTimeline(); badWidth.video.width = 120
  assert.throws(() => validateOcrVisualTimeline(badWidth, EXPECTED), /width/iu)

  const badFps = validTimeline(); (badFps.video as any).sampleFps = 10
  assert.throws(() => validateOcrVisualTimeline(badFps, EXPECTED), /fps/iu)
})

test('rejects invalid numbers, fractional frame indexes, and duration violations', () => {
  const nanFrame = validTimeline(); nanFrame.segments[0].startFrame = NaN
  assert.throws(() => validateOcrVisualTimeline(nanFrame, EXPECTED), /startFrame/iu)

  const fracFrame = validTimeline(); fracFrame.segments[0].startFrame = 2.5
  assert.throws(() => validateOcrVisualTimeline(fracFrame, EXPECTED), /startFrame/iu)

  const negFrame = validTimeline(); negFrame.segments[0].startFrame = -1
  assert.throws(() => validateOcrVisualTimeline(negFrame, EXPECTED), /startFrame/iu)

  const invertedTiming = validTimeline()
  invertedTiming.segments[0].startFrame = 4
  invertedTiming.segments[0].endFrameExclusive = 3
  assert.throws(() => validateOcrVisualTimeline(invertedTiming, EXPECTED), /startFrame < endFrameExclusive/iu)

  const wrongStartSec = validTimeline(); wrongStartSec.segments[0].start = 0.5 // should be 0.25
  assert.throws(() => validateOcrVisualTimeline(wrongStartSec, EXPECTED), /start/iu)

  const beyondDuration = validTimeline()
  beyondDuration.segments[0].startFrame = 8
  beyondDuration.segments[0].endFrameExclusive = 10
  beyondDuration.segments[0].start = 1.0
  beyondDuration.segments[0].end = 1.25
  assert.throws(() => validateOcrVisualTimeline(beyondDuration, EXPECTED), /duration/iu)
})

test('rejects duplicate IDs, unordered segments, and raw gap IDs', () => {
  const dup = validTimeline()
  dup.segments.push({
    id: 'accurate-2',
    startFrame: 4,
    endFrameExclusive: 5,
    start: 0.5,
    end: 0.625,
    text: 'world',
    confidence: 0.9,
    boxes: [{ text: 'world', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
  })
  assert.throws(() => validateOcrVisualTimeline(dup, EXPECTED), /ID/iu)

  const unordered = validTimeline()
  unordered.segments = [
    {
      id: 'accurate-4',
      startFrame: 4,
      endFrameExclusive: 5,
      start: 0.5,
      end: 0.625,
      text: 'second',
      confidence: 0.9,
      boxes: [{ text: 'second', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
    },
    {
      id: 'accurate-2',
      startFrame: 2,
      endFrameExclusive: 3,
      start: 0.25,
      end: 0.375,
      text: 'first',
      confidence: 0.9,
      boxes: [{ text: 'first', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
    }
  ]
  assert.throws(() => validateOcrVisualTimeline(unordered, EXPECTED), /thứ tự|unordered/iu)

  const rawGap = validTimeline()
  rawGap.segments[0].id = 'gap-2-left-right'
  assert.throws(() => validateOcrVisualTimeline(rawGap, EXPECTED), /gap-/iu)
})

test('rejects empty text, low confidence, text cap, box cap, and out-of-scan boxes', () => {
  const emptyText = validTimeline(); emptyText.segments[0].text = '   '
  assert.throws(() => validateOcrVisualTimeline(emptyText, EXPECTED), /văn bản|text/iu)

  const lowConf = validTimeline()
  lowConf.segments[0].confidence = 0.5
  lowConf.segments[0].boxes[0].confidence = 0.5
  assert.throws(() => validateOcrVisualTimeline(lowConf, EXPECTED), /confidence/iu)

  const longText = validTimeline()
  longText.segments[0].text = 'a'.repeat(4097)
  longText.segments[0].boxes[0].text = 'a'.repeat(4097)
  assert.throws(() => validateOcrVisualTimeline(longText, EXPECTED), /4096/iu)

  const outOfScan = validTimeline()
  outOfScan.segments[0].boxes[0].x1 = 150 // scan is x1=100
  assert.throws(() => validateOcrVisualTimeline(outOfScan, EXPECTED), /scan/iu)

  const confMismatch = validTimeline()
  confMismatch.segments[0].confidence = 0.8 // box is 0.9
  assert.throws(() => validateOcrVisualTimeline(confMismatch, EXPECTED), /confidence/iu)
})

test('stabilizeSingleSampleGaps fills 1 missing sample with matching text and IoU >= 0.5', () => {
  const t: OcrVisualTimeline = {
    ...validTimeline(),
    segments: [
      {
        id: 'accurate-1',
        startFrame: 1,
        endFrameExclusive: 2,
        start: 0.125,
        end: 0.25,
        text: 'hello',
        confidence: 0.9,
        boxes: [{ text: 'hello', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      },
      {
        id: 'accurate-3',
        startFrame: 3,
        endFrameExclusive: 4,
        start: 0.375,
        end: 0.5,
        text: 'Hello ',
        confidence: 0.85,
        boxes: [{ text: 'Hello ', confidence: 0.85, x0: 12, y0: 10, x1: 42, y1: 30 }]
      }
    ]
  }
  const stabilized = stabilizeSingleSampleGaps(t)
  assert.equal(stabilized.segments.length, 3)
  assert.equal(stabilized.segments[1].id, 'gap-2-accurate-1-accurate-3')
  assert.equal(stabilized.segments[1].startFrame, 2)
  assert.equal(stabilized.segments[1].endFrameExclusive, 3)
  assert.equal(stabilized.segments[1].start, 0.25)
  assert.equal(stabilized.segments[1].end, 0.375)
  assert.equal(stabilized.segments[1].confidence, 0.85)
  // Box is AABB union of (10..40, 10..30) and (12..42, 10..30) => (10..42, 10..30)
  assert.deepEqual(stabilized.segments[1].boxes[0], {
    text: 'hello',
    confidence: 0.85,
    x0: 10,
    y0: 10,
    x1: 42,
    y1: 30
  })
})

test('stabilizeSingleSampleGaps does not fill 2 missing samples or low IoU', () => {
  const twoGaps: OcrVisualTimeline = {
    ...validTimeline(),
    segments: [
      {
        id: 'accurate-1',
        startFrame: 1,
        endFrameExclusive: 2,
        start: 0.125,
        end: 0.25,
        text: 'hello',
        confidence: 0.9,
        boxes: [{ text: 'hello', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      },
      {
        id: 'accurate-4',
        startFrame: 4,
        endFrameExclusive: 5,
        start: 0.5,
        end: 0.625,
        text: 'hello',
        confidence: 0.9,
        boxes: [{ text: 'hello', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      }
    ]
  }
  assert.equal(stabilizeSingleSampleGaps(twoGaps).segments.length, 2)

  const lowIou: OcrVisualTimeline = {
    ...validTimeline(),
    segments: [
      {
        id: 'accurate-1',
        startFrame: 1,
        endFrameExclusive: 2,
        start: 0.125,
        end: 0.25,
        text: 'hello',
        confidence: 0.9,
        boxes: [{ text: 'hello', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      },
      {
        id: 'accurate-3',
        startFrame: 3,
        endFrameExclusive: 4,
        start: 0.375,
        end: 0.5,
        text: 'hello',
        confidence: 0.9,
        boxes: [{ text: 'hello', confidence: 0.9, x0: 50, y0: 10, x1: 80, y1: 30 }] // no overlap => IoU 0
      }
    ]
  }
  assert.equal(stabilizeSingleSampleGaps(lowIou).segments.length, 2)
})

test('projectOcrTimelineToSubtitleCues merges adjacent segments with equivalent text', () => {
  const t: OcrVisualTimeline = {
    ...validTimeline(),
    segments: [
      {
        id: 'accurate-1',
        startFrame: 1,
        endFrameExclusive: 2,
        start: 0.125,
        end: 0.25,
        text: 'Hello',
        confidence: 0.9,
        boxes: [{ text: 'Hello', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      },
      {
        id: 'accurate-2',
        startFrame: 2,
        endFrameExclusive: 3,
        start: 0.25,
        end: 0.375,
        text: 'hello ',
        confidence: 0.9,
        boxes: [{ text: 'hello ', confidence: 0.9, x0: 11, y0: 10, x1: 41, y1: 30 }]
      },
      {
        id: 'accurate-5',
        startFrame: 5,
        endFrameExclusive: 6,
        start: 0.625,
        end: 0.75,
        text: 'World',
        confidence: 0.9,
        boxes: [{ text: 'World', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      }
    ]
  }
  const cues = projectOcrTimelineToSubtitleCues(t)
  assert.equal(cues.length, 2)
  assert.equal(cues[0].id, 'accurate-1')
  assert.equal(cues[0].start, 0.125)
  assert.equal(cues[0].end, 0.375)
  assert.equal(cues[0].text, 'Hello')
  assert.equal(cues[0].sourceIndex, 0)
  assert.equal(cues[1].id, 'accurate-5')
  assert.equal(cues[1].start, 0.625)
  assert.equal(cues[1].end, 0.75)
  assert.equal(cues[1].text, 'World')
  assert.equal(cues[1].sourceIndex, 1)
})

test('planOcrMaskFrames pads boxes by 15% (clamped 4..8), expands 1 sample, and paints black terminal frame', () => {
  const t: OcrVisualTimeline = {
    ...validTimeline(),
    segments: [
      {
        id: 'accurate-2',
        startFrame: 2,
        endFrameExclusive: 4,
        start: 0.25,
        end: 0.5,
        text: 'test',
        confidence: 0.9,
        // Box height is 20 => 15% is 3 => clamped to min 4 px padding
        boxes: [{ text: 'test', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      }
    ]
  }
  const plan = planOcrMaskFrames(t, 1.0)
  assert.equal(plan.sampleFps, 8)
  assert.equal(plan.width, 100)
  assert.equal(plan.height, 60)
  assert.equal(plan.activeFrameCount, 8)
  assert.equal(plan.totalFrameCount, 9)

  // Segment was [2, 4), expanded by 1 sample => [1, 5)
  assert.equal(plan.segments.length, 1)
  assert.equal(plan.segments[0].startFrame, 1)
  assert.equal(plan.segments[0].endFrameExclusive, 5)

  // Padded box: 10-4=6, 10-4=6, 40+4=44, 30+4=34
  assert.deepEqual(plan.segments[0].boxes, [{ x0: 6, y0: 6, x1: 44, y1: 34 }])

  // Test boxesForMaskFrame
  assert.equal(boxesForMaskFrame(plan, 0).length, 0)
  assert.equal(boxesForMaskFrame(plan, 1).length, 1)
  assert.equal(boxesForMaskFrame(plan, 4).length, 1)
  assert.equal(boxesForMaskFrame(plan, 5).length, 0)
  // Terminal frame (index 8) is ALWAYS black (empty boxes)
  assert.equal(boxesForMaskFrame(plan, 8).length, 0)
})

test('planOcrMaskFrames clamps endFrameExclusive to activeFrameCount and never paints terminal frame', () => {
  const t: OcrVisualTimeline = {
    ...validTimeline(),
    segments: [
      {
        id: 'accurate-7',
        startFrame: 7,
        endFrameExclusive: 8,
        start: 0.875,
        end: 1.0,
        text: 'end',
        confidence: 0.9,
        boxes: [{ text: 'end', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      }
    ]
  }
  const plan = planOcrMaskFrames(t, 1.0)
  // [7, 8) expanded by 1 sample clamped to activeFrameCount=8 => [6, 8)
  assert.equal(plan.segments[0].startFrame, 6)
  assert.equal(plan.segments[0].endFrameExclusive, 8)
  assert.equal(boxesForMaskFrame(plan, 7).length, 1)
  assert.equal(boxesForMaskFrame(plan, 8).length, 0)
})
