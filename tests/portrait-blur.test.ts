import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { burnAutoShort, validateBurnRequest, taoFilterComplex, taoFilterComplexAutomatic, type Meta } from '../src/main/burn'
import { planBurnInputs } from '../src/main/burnInputPlanner'
import { portraitFrame } from '../src/shared/portraitFrame'

const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros', 'bin', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobe = process.env.TEDIAPROS_TEST_FFPROBE || join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')

// A lost framing option (including the no-subtitle path) must fail on actual pixels.
test('portrait framing exports a full sharp square with blurred top and bottom', (t) => {
  if (!existsSync(ffmpeg)) return t.skip('Set TEDIAPROS_TEST_FFMPEG or install the managed FFmpeg runtime for media acceptance.')
  const meta: Meta = { w: 320, h: 320, giay: 1, hasAudio: false }
  const graph = taoFilterComplex(meta, [], false, false, 'unused.ass', false, false, 100, null, true)
  const rendered = spawnSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i',
    'color=red:s=320x320:r=1,drawbox=x=0:y=0:w=160:h=320:color=blue:t=fill',
    ...graph, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'
  ], { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(rendered.status, 0, rendered.stderr?.toString())
  assert.equal(rendered.stdout.length, 1080 * 1920 * 3)
  const pixel = (x: number, y: number): number[] => [...rendered.stdout.subarray((y * 1080 + x) * 3, (y * 1080 + x) * 3 + 3)]
  assert.ok(pixel(50, 960)[2] > 220, 'left edge of source remains blue')
  assert.ok(pixel(1030, 960)[0] > 220, 'right edge of source remains red')
  assert.ok(pixel(535, 960)[2] > 220, 'foreground transition stays sharp')
  const blurred = pixel(535, 100)
  assert.ok(blurred[0] > 40 && blurred[2] > 40, 'top padding contains a blurred transition, not black or sharp duplicate')
})

test('automatic OCR mask runs in source coordinates before portrait framing', (t) => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg runtime unavailable for media acceptance.')
  const meta: Meta = { w: 320, h: 180, giay: 1, hasAudio: false }
  const graph = taoFilterComplexAutomatic(meta, planBurnInputs({ sourceVideo: 'source', timedMask: 'mask' }), false, 'unused.ass', false, 100, null, true)
  const rendered = spawnSync(ffmpeg, [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=1',
    '-f', 'lavfi', '-i', 'color=white:s=320x180:r=1',
    ...graph, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'
  ], { maxBuffer: 16 * 1024 * 1024 })
  assert.equal(rendered.status, 0, rendered.stderr?.toString())
  assert.equal(rendered.stdout.length, 1080 * 1920 * 3)
})

test('framing fits landscape, square, portrait and narrow videos without cropping', () => {
  for (const [w, h, cw, ch, x, y] of [
    [1920, 1080, 1080, 606, 0, 657],
    [800, 800, 1080, 1080, 0, 420],
    [720, 1280, 1080, 1920, 0, 0],
    [540, 1920, 540, 1920, 270, 0]
  ]) {
    assert.deepEqual(portraitFrame(w, h), { width: 1080, height: 1920, contentWidth: cw, contentHeight: ch, x, y })
  }
  assert.throws(() => portraitFrame(0, 720))
  const meta: Meta = { w: 640, h: 360, giay: 1, hasAudio: false }
  assert.deepEqual(taoFilterComplex(meta, [], false, false, 'unused', false, false, 100, null, false), [])
})

test('portrait-only export passes public validation and actual burn with audio and duration intact', async (t) => {
  if (!existsSync(ffmpeg) || !existsSync(ffprobe)) return t.skip('FFmpeg/FFprobe runtime unavailable for media acceptance.')
  const root = await mkdtemp(join(tmpdir(), 'tedia-portrait-'))
  try {
    const video = join(root, 'source.mp4')
    const output = join(root, 'portrait.mp4')
    const generated = spawnSync(ffmpeg, [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=10:d=0.4',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4',
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video
    ])
    assert.equal(generated.status, 0, generated.stderr.toString())
    const request = { video, outputDir: root, mode: 'burn', portraitBlur: true } as const
    const valid = await validateBurnRequest(request)
    assert.equal(valid.ok, true)
    if (!valid.ok) throw new Error(valid.error)
    assert.equal(valid.req.portraitBlur, true)
    assert.equal((await validateBurnRequest({ ...request, portraitBlur: 'true' })).ok, false)
    const result = await burnAutoShort(valid.req, {
      ffmpegPath: ffmpeg, ffprobePath: ffprobe,
      finalOutputPath: output, itemWorkDir: root,
      expectedMedia: { durationSeconds: 0.4, frameRate: 10, requireAudio: true, durationToleranceFrames: 2 },
      signal: new AbortController().signal
    }, () => {})
    assert.equal(result.ok, true, result.error)
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', output])
    assert.equal(probe.status, 0, probe.stderr.toString())
    const streams = JSON.parse(probe.stdout.toString()).streams
    const picture = streams.find((stream: any) => stream.codec_type === 'video')
    assert.deepEqual([picture.width, picture.height, picture.sample_aspect_ratio], [1080, 1920, '1:1'])
    assert.equal(Number(picture.nb_frames), 4)
    assert.ok(streams.some((stream: any) => stream.codec_type === 'audio'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('manual blur and subtitles render before placement; background excludes added captions', async (t) => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg runtime unavailable for media acceptance.')
  const root = await mkdtemp(join(tmpdir(), 'tedia-portrait-ass-'))
  try {
    await writeFile(join(root, 'sub.ass'), `[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 320\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,28,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,5,0,0,0,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,TEST\n`)
    const graph = taoFilterComplex({ w: 320, h: 320, giay: 1, hasAudio: false }, [{ x0: 0, y0: 0, x1: 100, y1: 100 }], true, true, 'sub.ass', false, false, 100, null, true)
    const rendered = spawnSync(ffmpeg, [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x320:r=1',
      ...graph, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'
    ], { cwd: root, maxBuffer: 16 * 1024 * 1024 })
    assert.equal(rendered.status, 0, rendered.stderr.toString())
    assert.equal(rendered.stdout.length, 1080 * 1920 * 3)
    assert.ok(rendered.stdout.subarray(800 * 1080 * 3, 1120 * 1080 * 3).some(value => value > 200), 'sharp subtitles are visible in source centre')
    assert.ok(rendered.stdout.subarray(0, 400 * 1080 * 3).every(value => value < 5), 'no enlarged caption copy in background')
  } finally { await rm(root, { recursive: true, force: true }) }
})
