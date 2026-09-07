import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  planBurnInputs,
  blurSigmaForDisplayHeight,
  ocrBlurSigmaForDisplayHeight
} from '../src/main/burnInputPlanner'
import {
  taoFilterComplex,
  taoFilterComplexAutomatic,
  validateBurnRequest,
  burnAutoShort,
  type Meta
} from '../src/main/burn'
import type { TimedOcrBlurMask } from '../src/main/ocrMask'

test('planBurnInputs orders inputs deterministically across all four combinations', () => {
  // Row 1: no narration, no mask
  const p1 = planBurnInputs({ sourceVideo: 'source.mp4' })
  assert.deepEqual(p1.inputArgs, ['-i', 'source.mp4'])
  assert.equal(p1.sourceVideoIndex, 0)
  assert.equal(p1.narrationAudioIndex, null)
  assert.equal(p1.maskVideoIndex, null)

  // Row 2: narration, no mask
  const p2 = planBurnInputs({ sourceVideo: 'source.mp4', narrationAudio: 'narr.wav' })
  assert.deepEqual(p2.inputArgs, ['-i', 'source.mp4', '-i', 'narr.wav'])
  assert.equal(p2.sourceVideoIndex, 0)
  assert.equal(p2.narrationAudioIndex, 1)
  assert.equal(p2.maskVideoIndex, null)

  // Row 3: no narration, mask
  const p3 = planBurnInputs({ sourceVideo: 'source.mp4', timedMask: 'mask.mkv' })
  assert.deepEqual(p3.inputArgs, ['-i', 'source.mp4', '-i', 'mask.mkv'])
  assert.equal(p3.sourceVideoIndex, 0)
  assert.equal(p3.narrationAudioIndex, null)
  assert.equal(p3.maskVideoIndex, 1)

  // Row 4: narration and mask
  const p4 = planBurnInputs({ sourceVideo: 'source.mp4', narrationAudio: 'narr.wav', timedMask: 'mask.mkv' })
  assert.deepEqual(p4.inputArgs, ['-i', 'source.mp4', '-i', 'narr.wav', '-i', 'mask.mkv'])
  assert.equal(p4.sourceVideoIndex, 0)
  assert.equal(p4.narrationAudioIndex, 1)
  assert.equal(p4.maskVideoIndex, 2)
})

test('manual blur keeps its existing display-height profile', () => {
  assert.equal(blurSigmaForDisplayHeight(266), 32)
  assert.equal(blurSigmaForDisplayHeight(720), 86)
  assert.equal(blurSigmaForDisplayHeight(1080), 130)
})

test('ocrBlurSigmaForDisplayHeight uses a bounded privacy profile', () => {
  // Keep the OCR glyph unreadable without averaging a bright background into
  // a flat white rectangle on tall portrait videos.
  assert.equal(ocrBlurSigmaForDisplayHeight(266), 16)
  assert.equal(ocrBlurSigmaForDisplayHeight(720), 29)
  assert.equal(ocrBlurSigmaForDisplayHeight(1080), 43)
  assert.equal(ocrBlurSigmaForDisplayHeight(1920), 64)
})

test('freeze manual graph regressions before refactoring', () => {
  const meta: Meta = { w: 1280, h: 720, giay: 10, hasAudio: true }

  // Manual no-audio
  const g1 = taoFilterComplex(meta, [], false, false, 'sub.ass', false)
  assert.deepEqual(g1, [])

  // Manual narration replace
  const g2 = taoFilterComplex(meta, [], false, false, 'sub.ass', true, true, 0)
  assert.ok(g2.length > 0)
  assert.match(g2.join(' '), /volume=1\.0/u)

  // Manual narration mix (ducking)
  const g3 = taoFilterComplex(meta, [], false, false, 'sub.ass', true, true, 40)
  assert.match(g3.join(' '), /sidechaincompress=threshold=0\.06/u)

  // Two manual rectangles plus ASS
  const g4 = taoFilterComplex(
    meta,
    [
      { x0: 10, y0: 10, x1: 100, y1: 50 },
      { x0: 200, y0: 300, x1: 400, y1: 350 }
    ],
    true,
    true,
    'sub.ass'
  )
  const str4 = g4.join(' ')
  assert.match(str4, /split=3/u)
  assert.match(str4, /crop=/u)
  assert.match(str4, /overlay=/u)
  assert.match(str4, /ass=sub\.ass/u)
})

test('taoFilterComplexAutomatic generates exact video filter chain and bounded sigma', () => {
  const meta: Meta = { w: 576, h: 266, giay: 1.0, hasAudio: false }
  const plan = planBurnInputs({ sourceVideo: 'src.mp4', narrationAudio: 'narr.wav', timedMask: 'mask.mkv' })

  const filterArgs = taoFilterComplexAutomatic(meta, plan, true, 'sub.ass', false)
  const filterStr = filterArgs.join(' ')

  // Check filter nodes
  assert.match(filterStr, /\[0:v\]null,format=gbrp\[display\]/u)
  assert.match(filterStr, /\[display\]split=2\[base\]\[blur_source\]/u)
  assert.match(filterStr, /\[blur_source\]gblur=sigma=16:steps=6\[blurred\]/u)
  assert.match(filterStr, /\[2:v\]format=gray,settb=AVTB,setpts=PTS-STARTPTS\[mask\]/u)
  assert.match(filterStr, /\[base\]\[blurred\]\[mask\]maskedmerge,trim=duration=1\.000\[masked\]/u)
  assert.match(filterStr, /\[masked\]ass=sub\.ass\[out\]/u)

  // For 1080p, the bounded privacy sigma must be 43.
  const meta1080: Meta = { w: 1920, h: 1080, giay: 1.0, hasAudio: false }
  const f1080 = taoFilterComplexAutomatic(meta1080, plan, true, 'sub.ass', false).join(' ')
  assert.match(f1080, /gblur=sigma=43:steps=6/u)
})

test('automatic graph is constant size and forbids repeatlast/eof_action/shortest', () => {
  const meta: Meta = { w: 1280, h: 720, giay: 2.0, hasAudio: false }
  const plan = planBurnInputs({ sourceVideo: 'src.mp4', timedMask: 'mask.mkv' })

  const filterArgs = taoFilterComplexAutomatic(meta, plan, true, 'sub.ass', false)
  const filterStr = filterArgs.join(' ')

  // Must NOT contain forbidden flags
  assert.doesNotMatch(filterStr, /repeatlast/u)
  assert.doesNotMatch(filterStr, /eof_action/u)
  assert.doesNotMatch(filterStr, /shortest/u)
})

test('automatic audio filter uses narration audio index from plan and never mask index', () => {
  const meta: Meta = { w: 1280, h: 720, giay: 2.0, hasAudio: true }
  // Mask is index 2, narration is index 1
  const plan = planBurnInputs({ sourceVideo: 'src.mp4', narrationAudio: 'narr.wav', timedMask: 'mask.mkv' })
  assert.equal(plan.narrationAudioIndex, 1)
  assert.equal(plan.maskVideoIndex, 2)

  // REPLACE mode (audioVolume = 0)
  const replaceArgs = taoFilterComplexAutomatic(meta, plan, false, 'sub.ass', true, 0).join(' ')
  assert.match(replaceArgs, /\[1:a\]asetpts/u)
  assert.doesNotMatch(replaceArgs, /\[2:a\]/u)

  // MIX mode (audioVolume = 50)
  const mixArgs = taoFilterComplexAutomatic(meta, plan, false, 'sub.ass', true, 50).join(' ')
  assert.match(mixArgs, /\[0:a\]asetpts/u)
  assert.match(mixArgs, /\[1:a\]asetpts/u)
  assert.doesNotMatch(mixArgs, /\[2:a\]/u)
})

test('validateBurnRequest rejects sensitive internal keys and uses explicit allowlist', async () => {
  const sensitiveKeys = ['timedOcrBlurMask', 'maskPath', 'visualCuesPath', 'visualTimeline']
  for (const key of sensitiveKeys) {
    const res = await validateBurnRequest({
      video: 'dummy.mp4',
      mode: 'burn',
      [key]: 'injected-val'
    })
    assert.equal(res.ok, false)
    assert.match(res.error || '', /không được phép/u)
  }
})

test('burnAutoShort validates no-clobber and rejects pre-existing final file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-burn-noclobber-'))
  try {
    const finalFile = join(root, 'final.mp4')
    await writeFile(finalFile, 'existing content')

    await assert.rejects(
      async () => burnAutoShort(
        {
          video: 'dummy.mp4',
          mode: 'burn',
          blurRegions: [],
          lamMo: false,
          batAmThanh: false,
          amLuongGoc: 100
        },
        {
          ffmpegPath: 'ffmpeg',
          ffprobePath: 'ffprobe',
          finalOutputPath: finalFile,
          itemWorkDir: root,
          expectedMedia: {
            durationSeconds: 1.0,
            requireAudio: false,
            durationToleranceFrames: 2
          },
          signal: new AbortController().signal
        },
        () => {}
      ),
      /tồn tại/u
    )

    // Existing file content must be preserved untouched
    const content = await import('node:fs/promises').then((fs) => fs.readFile(finalFile, 'utf8'))
    assert.equal(content, 'existing content')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('burnAutoShort rejects combination of timed mask and manual blur rectangles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-burn-mask-rect-'))
  try {
    const finalFile = join(root, 'out.mp4')
    const maskPath = join(root, 'mask.mkv')
    await writeFile(maskPath, 'mask data')

    const fakeMask: TimedOcrBlurMask = {
      path: maskPath,
      width: 64,
      height: 48,
      durationSeconds: 1.0,
      sampleFps: 8,
      visualCueCount: 1,
      boxSegmentCount: 1
    }

    await assert.rejects(
      async () => burnAutoShort(
        {
          video: 'dummy.mp4',
          mode: 'burn',
          blurRegions: [{ x0: 10, y0: 10, x1: 50, y1: 50 }],
          lamMo: true,
          batAmThanh: false,
          amLuongGoc: 100
        },
        {
          timedOcrBlurMask: fakeMask,
          ffmpegPath: 'ffmpeg',
          ffprobePath: 'ffprobe',
          finalOutputPath: finalFile,
          itemWorkDir: root,
          expectedMedia: {
            durationSeconds: 1.0,
            requireAudio: false,
            durationToleranceFrames: 2
          },
          signal: new AbortController().signal
        },
        () => {}
      ),
      /thủ công/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
