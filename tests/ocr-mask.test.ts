import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ChildProcess } from 'node:child_process'
import {
  rasterizeOcrMaskFrame,
  computeExpectedMaskFrameHashes,
  writeTimedOcrBlurMask,
  validateTimedOcrBlurMask
} from '../src/main/ocrMask'
import { planOcrMaskFrames, boxesForMaskFrame } from '../src/shared/ocrVisualTimeline'
import { resolveFfmpeg } from '../src/main/deps'
import { resolveRuntimeExecutable } from '../src/main/runtimeResolver'
import type { OcrVisualTimeline } from '../src/shared/types'

class MockChildProcess extends EventEmitter {
  stdin = new EventEmitter() as unknown as NodeJS.WritableStream & EventEmitter
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid = 88888
  killed = false

  constructor() {
    super()
    this.stdin.write = () => true
    this.stdin.end = () => {}
    this.stdin.destroy = () => {}
  }

  kill(): boolean {
    this.killed = true
    this.emit('close', 0)
    return true
  }
}

test('rasterizeOcrMaskFrame allocates exact buffer and paints white islands inside black frame', () => {
  const width = 32
  const height = 24

  // Frame with two non-overlapping boxes
  const boxes = [
    { x0: 2, y0: 2, x1: 8, y1: 6 },
    { x0: 16, y0: 2, x1: 22, y1: 6 }
  ]

  const frame = rasterizeOcrMaskFrame(width, height, boxes)
  assert.equal(frame.length, width * height)

  // Pixels inside box 1 are 0xff
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 8; x++) {
      assert.equal(frame[y * width + x], 0xff)
    }
  }

  // Pixels between boxes are 0x00
  for (let y = 2; y < 6; y++) {
    for (let x = 8; x < 16; x++) {
      assert.equal(frame[y * width + x], 0x00)
    }
  }

  // Pixels outside rows are 0x00
  for (let x = 0; x < width; x++) {
    assert.equal(frame[0 * width + x], 0x00)
    assert.equal(frame[10 * width + x], 0x00)
  }

  // Rejects out of bounds
  assert.throws(
    () => rasterizeOcrMaskFrame(width, height, [{ x0: -1, y0: 0, x1: 10, y1: 10 }]),
    /ngoài giới hạn/u
  )
})

test('mask frame planning expands 1 sample, clamps to activeFrameCount, and leaves terminal frame black', () => {
  const width = 32
  const height = 24
  const durationSeconds = 0.5 // 0.5s * 8 fps = 4 active frames (0, 1, 2, 3), total 5 frames (0..4)

  const timeline: OcrVisualTimeline = {
    schemaVersion: 1,
    protocol: 'ocr-visual-cues/1',
    video: {
      width,
      height,
      durationSeconds,
      sampleFps: 8,
      frameCount: 4,
      geometryFingerprint: 'b'.repeat(64)
    },
    profile: 'accurate',
    scanRegion: { x0: 0, y0: 0, x1: width, y1: height },
    segments: [
      {
        id: 'accurate-1',
        startFrame: 1,
        endFrameExclusive: 3,
        start: 1 / 8.0,
        end: 3 / 8.0,
        text: 'test',
        confidence: 0.9,
        boxes: [
          { x0: 4, y0: 4, x1: 12, y1: 10, text: 'test', confidence: 0.9 }
        ]
      }
    ]
  }

  const plan = planOcrMaskFrames(timeline, durationSeconds)
  assert.equal(plan.activeFrameCount, 4)
  assert.equal(plan.totalFrameCount, 5)

  // Segment [1, 3) expanded by 1 sample -> [0, 4)
  // Frames 0, 1, 2, 3 must have boxes
  for (let f = 0; f < 4; f++) {
    const b = boxesForMaskFrame(plan, f)
    assert.ok(b.length > 0)
  }

  // Frame 4 (terminal frame) must have 0 boxes (black)
  const bTerminal = boxesForMaskFrame(plan, 4)
  assert.equal(bTerminal.length, 0)

  // MD5 fixture test: terminal frame hash equals Buffer.alloc(width * height)
  const hashes = computeExpectedMaskFrameHashes(timeline, durationSeconds)
  const blackHash = createHash('md5').update(Buffer.alloc(width * height, 0x00)).digest('hex')
  assert.equal(hashes.expectedHashes[4], blackHash)
  assert.notEqual(hashes.expectedHashes[0], blackHash)
})

test('writeTimedOcrBlurMask rejects timeline with no valid boxes or empty segments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-mask-empty-'))
  try {
    const timeline: OcrVisualTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: {
        width: 32,
        height: 24,
        durationSeconds: 1.0,
        sampleFps: 8,
        frameCount: 8,
        geometryFingerprint: 'b'.repeat(64)
      },
      profile: 'fast',
      scanRegion: { x0: 0, y0: 0, x1: 32, y1: 24 },
      segments: []
    }

    await assert.rejects(
      async () => writeTimedOcrBlurMask(timeline, {
        ffmpegPath: 'ffmpeg',
        ffprobePath: 'ffprobe',
        outputPath: join(root, 'mask.mkv'),
        itemWorkDir: root,
        durationSeconds: 1.0,
        signal: new AbortController().signal
      }),
      /không chứa segment/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('writeTimedOcrBlurMask rejects pre-aborted signal and cleans up work dir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-mask-abort-'))
  try {
    const timeline: OcrVisualTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: {
        width: 32,
        height: 24,
        durationSeconds: 0.5,
        sampleFps: 8,
        frameCount: 4,
        geometryFingerprint: 'b'.repeat(64)
      },
      profile: 'fast',
      scanRegion: { x0: 0, y0: 0, x1: 32, y1: 24 },
      segments: [
        {
          id: 'fast-0-2',
          startFrame: 0,
          endFrameExclusive: 2,
          start: 0,
          end: 0.25,
          text: 'test',
          confidence: 0.9,
          boxes: [{ x0: 2, y0: 2, x1: 10, y1: 10, text: 'test', confidence: 0.9 }]
        }
      ]
    }

    const ac = new AbortController()
    ac.abort()

    await assert.rejects(
      async () => writeTimedOcrBlurMask(timeline, {
        ffmpegPath: 'ffmpeg',
        ffprobePath: 'ffprobe',
        outputPath: join(root, 'mask.mkv'),
        itemWorkDir: root,
        durationSeconds: 0.5,
        signal: ac.signal
      }),
      /huỷ/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('conditional native test: writeTimedOcrBlurMask creates valid FFV1 mask with real managed FFmpeg', async () => {
  const ffmpeg = await resolveFfmpeg()
  if (!ffmpeg) {
    console.log('managed FFmpeg fixture unavailable; native mask assertion skipped.')
    return
  }

  // Sibling ffprobe
  const isWin = process.platform === 'win32'
  const ffprobeName = isWin ? 'ffprobe.exe' : 'ffprobe'
  const ffprobe = join(require('node:path').dirname(ffmpeg), ffprobeName)
  const probeExists = await import('node:fs/promises').then((fs) => fs.access(ffprobe).then(() => true).catch(() => false))
  if (!probeExists) {
    console.log('managed FFmpeg fixture unavailable; native mask assertion skipped.')
    return
  }

  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-mask-native-'))
  const outputPath = join(root, 'timed-mask.mkv')

  try {
    const width = 64
    const height = 48
    const durationSeconds = 0.5 // 4 active frames + 1 terminal frame = 5 frames

    const timeline: OcrVisualTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: {
        width,
        height,
        durationSeconds,
        sampleFps: 8,
        frameCount: 4,
        geometryFingerprint: 'c'.repeat(64)
      },
      profile: 'accurate',
      scanRegion: { x0: 0, y0: 0, x1: width, y1: height },
      segments: [
        {
          id: 'accurate-1',
          startFrame: 1,
          endFrameExclusive: 2,
          start: 0.125,
          end: 0.25,
          text: 'box',
          confidence: 0.95,
          boxes: [{ x0: 10, y0: 10, x1: 30, y1: 25, text: 'box', confidence: 0.95 }]
        }
      ]
    }

    const mask = await writeTimedOcrBlurMask(timeline, {
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe,
      outputPath,
      itemWorkDir: root,
      durationSeconds,
      signal: new AbortController().signal
    })

    assert.equal(mask.path, outputPath)
    assert.equal(mask.width, width)
    assert.equal(mask.height, height)
    assert.equal(mask.sampleFps, 8)

    const fileExists = await import('node:fs/promises').then((fs) => fs.access(outputPath).then(() => true).catch(() => false))
    assert.equal(fileExists, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
