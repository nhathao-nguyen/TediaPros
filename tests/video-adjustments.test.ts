import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import test from 'node:test'
import {
  DEFAULT_VIDEO_ADJUSTMENTS,
  normalizeVideoAdjustments,
  videoAdjustmentPreviewCoordinate,
  videoAdjustmentPreviewSize,
  videoAdjustmentSourceDelta,
  videoAdjustmentPreviewStyle,
  videoAdjustmentFilter
} from '../src/shared/videoAdjustments'
import { taoFilterComplex, taoFilterComplexAutomatic, type Meta } from '../src/main/burn'
import { planBurnInputs } from '../src/main/burnInputPlanner'

const meta: Meta = { w: 640, h: 360, giay: 1, hasAudio: false }
const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros', 'bin', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

test('normalizes legacy and bounded video adjustment values', () => {
  assert.deepEqual(normalizeVideoAdjustments(undefined), DEFAULT_VIDEO_ADJUSTMENTS)
  assert.deepEqual(normalizeVideoAdjustments({ zoom: 108, brightness: -5, saturation: 95, contrast: 103 }), {
    zoom: 108,
    brightness: -5,
    saturation: 95,
    contrast: 103
  })
  assert.throws(() => normalizeVideoAdjustments({ zoom: 121, brightness: 0, saturation: 100, contrast: 100 }))
  assert.throws(() => normalizeVideoAdjustments({ zoom: 105, brightness: Number.NaN, saturation: 100, contrast: 100 }))
})

test('builds a centred even crop and FFmpeg eq values', () => {
  assert.equal(videoAdjustmentFilter(meta, DEFAULT_VIDEO_ADJUSTMENTS), null)
  assert.equal(
    videoAdjustmentFilter(meta, { zoom: 110, brightness: 5, saturation: 95, contrast: 103 }),
    'crop=582:326:29:17,scale=640:360:flags=lanczos,setsar=1,eq=brightness=0.05:saturation=0.95:contrast=1.03'
  )
})

test('maps adjustments to a browser preview without changing overlay colour', () => {
  assert.deepEqual(
    videoAdjustmentPreviewStyle({ zoom: 110, brightness: 5, saturation: 95, contrast: 103 }),
    {
      transform: 'scale(1.1)',
      filter: 'brightness(1.05) saturate(0.95) contrast(1.03)'
    }
  )
})

test('projects source regions around the preview centre at the selected zoom', () => {
  assert.equal(videoAdjustmentPreviewCoordinate(0, 640, 110), -5)
  assert.equal(videoAdjustmentPreviewCoordinate(320, 640, 110), 50)
  assert.equal(videoAdjustmentPreviewCoordinate(640, 640, 110), 105)
  assert.equal(videoAdjustmentPreviewSize(100, 640, 110), 17.1875)
  assert.equal(videoAdjustmentSourceDelta(11, 640, 320, 110), 20)
})

test('manual graph adjusts masked source before subtitles and portrait framing', () => {
  const graph = taoFilterComplex(
    meta,
    [{ x0: 0, y0: 0, x1: 100, y1: 80 }],
    true,
    true,
    'sub.ass',
    false,
    false,
    100,
    null,
    true,
    { zoom: 110, brightness: 5, saturation: 95, contrast: 103 }
  ).join(' ')
  assert.match(graph, /overlay=0:0\[v1\];\[v1\]crop=582:326:29:17,scale=640:360:[^;]+\[adjusted\]/)
  assert.match(graph, /\[adjusted\]split=2\[portrait_bg_source\]\[portrait_fg_source\]/)
  assert.match(graph, /\[portrait_fg_source\]ass=sub\.ass,[^;]+\[portrait_fg\]/)
  assert.doesNotMatch(graph, /ass=sub\.ass[^;]+eq=/)
})

test('manual blur without subtitles still reaches video adjustments', () => {
  const graph = taoFilterComplex(
    meta,
    [{ x0: 0, y0: 0, x1: 100, y1: 80 }],
    true,
    false,
    'unused.ass',
    false,
    false,
    100,
    null,
    false,
    { zoom: 105, brightness: 0, saturation: 100, contrast: 100 }
  ).join(' ')
  assert.match(graph, /overlay=0:0\[v1\];\[v1\]crop=/)
  assert.match(graph, /\[adjusted\]null\[out\]/)
})

test('automatic OCR graph adjusts after maskedmerge and before subtitles', () => {
  const graph = taoFilterComplexAutomatic(
    meta,
    planBurnInputs({ sourceVideo: 'source', timedMask: 'mask' }),
    true,
    'sub.ass',
    false,
    100,
    null,
    false,
    { zoom: 105, brightness: -5, saturation: 100, contrast: 100 }
  ).join(' ')
  assert.match(graph, /maskedmerge,[^;]+\[masked\];\[masked\]crop=/)
  assert.match(graph, /\[adjusted\]ass=sub\.ass\[out\]/)
})

test('FFmpeg applies centred zoom while retaining output geometry', (t) => {
  if (!existsSync(ffmpeg)) return t.skip('Managed FFmpeg runtime unavailable.')
  const graph = taoFilterComplex(
    { w: 320, h: 180, giay: 1, hasAudio: false },
    [], false, false, 'unused.ass', false, false, 100, null, false,
    { zoom: 120, brightness: 0, saturation: 100, contrast: 100 }
  )
  const rendered = spawnSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i',
    'color=black:s=320x180:r=1,drawbox=x=0:y=0:w=40:h=180:color=red:t=fill,drawbox=x=40:y=0:w=240:h=180:color=green:t=fill,drawbox=x=280:y=0:w=40:h=180:color=blue:t=fill',
    ...graph, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'
  ], { maxBuffer: 2 * 1024 * 1024 })
  assert.equal(rendered.status, 0, rendered.stderr.toString())
  assert.equal(rendered.stdout.length, 320 * 180 * 3)
  const leftOffset = 20 * 3
  const rightOffset = 299 * 3
  const left = [...rendered.stdout.subarray(leftOffset, leftOffset + 3)]
  const right = [...rendered.stdout.subarray(rightOffset, rightOffset + 3)]
  assert.ok(left[1] > left[0], 'centred zoom moves green content into the original red band')
  assert.ok(right[1] > right[2], 'centred zoom moves green content into the original blue band')
})

test('FFmpeg brightness and saturation move pixels in the configured direction', (t) => {
  if (!existsSync(ffmpeg)) return t.skip('Managed FFmpeg runtime unavailable.')
  const graph = taoFilterComplex(
    { w: 64, h: 64, giay: 1, hasAudio: false },
    [], false, false, 'unused.ass', false, false, 100, null, false,
    { zoom: 100, brightness: 20, saturation: 0, contrast: 100 }
  )
  const rendered = spawnSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'color=color=0x804020:s=64x64:r=1',
    ...graph, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'
  ], { maxBuffer: 128 * 1024 })
  assert.equal(rendered.status, 0, rendered.stderr.toString())
  const [red, green, blue] = rendered.stdout.subarray(0, 3)
  assert.ok(
    Math.max(red, green, blue) - Math.min(red, green, blue) <= 4,
    `zero saturation produces gray, received ${red},${green},${blue}`
  )
  assert.ok(red > 100, 'positive brightness raises the gray output')
})
