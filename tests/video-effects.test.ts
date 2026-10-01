import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { normalizeVideoEffects, VIDEO_EFFECT_PRESETS, type VideoEffect } from '../src/shared/videoEffects'
import { validateAutoShortStartRequest } from '../src/shared/autoShortContract'
import { appendVideoEffects, resolveFilmGrungePath } from '../src/main/videoEffects'
import { burnAutoShort, taoFilterComplex, taoFilterComplexAutomatic } from '../src/main/burn'
import { planBurnInputs } from '../src/main/burnInputPlanner'
import type { AutoShortConfig } from '../src/shared/types'

const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros', 'bin', 'ffmpeg.exe')
const ffprobe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const config: AutoShortConfig = {
  subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu', blurRegions: [], lamMo: false,
  blurMode: 'manual', ocrBlurProfile: 'accurate', translateTarget: 'none', translateProvider: 'local',
  ttsEnabled: false, voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 20, outputDir: 'C:\\media\\out'
}
const effects: VideoEffect[] = VIDEO_EFFECT_PRESETS.map(({ kind }) => ({ kind, intensity: 80 }))
function validate(videoEffects?: unknown) {
  return validateAutoShortStartRequest({ items: [{ id: 'a', filePath: 'C:\\media\\in.mp4' }], config: { ...config, videoEffects } })
}
function run(args: string[], cwd?: string) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true, maxBuffer: 30 * 1024 * 1024, timeout: 45000 })
  assert.equal(result.status, 0, result.error?.message || result.stderr.toString())
  return result.stdout
}
test('IPC preserves legacy config and rejects malformed, duplicate or injected effect parameters', () => {
  for (const input of [undefined, [], [{ kind: 'grain', intensity: 0 }]]) {
    const result = validate(input)
    assert.equal(result.ok, true)
    if (result.ok) assert.equal(Object.hasOwn(result.value.config, 'videoEffects'), false)
  }
  for (const input of [{}, 'noise', [null], [{ kind: 'noise;movie=x', intensity: 40 }],
    [{ kind: 'grain', intensity: NaN }], [{ kind: 'grain', intensity: '50' }], [{ kind: 'dust', intensity: -1 }],
    [{ kind: 'analog', intensity: 101 }], [effects[0], effects[0]], [...effects, effects[0]]]) {
    assert.equal(validate(input).ok, false, JSON.stringify(input))
  }
  const result = validate(effects)
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value.config.videoEffects, effects)
  assert.deepEqual(normalizeVideoEffects([...effects].reverse()), [...effects].reverse())
})

test('resolveFilmGrungePath resolves to bundled resource and contains no hardcoded drive path', () => {
  const resolved = resolveFilmGrungePath()
  assert.notEqual(resolved, null, 'Film grunge video asset must resolve')
  assert.ok(resolved!.endsWith('film_grunge.mp4'), `Expected film_grunge.mp4, got ${resolved}`)
  assert.equal(existsSync(resolved!), true, 'Resolved path must exist on disk')
  assert.equal(resolved!.toLowerCase().includes('0928.mp4'), false, 'Must not reference local scratch media')
})

test('zero strength leaves graph unchanged; manual blur and OCR both retain effects before branding', () => {
  const lines = ['[0:v]null[out]']
  appendVideoEffects(lines, 320, 180, [{ kind: 'grain', intensity: 0 }])
  assert.deepEqual(lines, ['[0:v]null[out]'])
  const meta = { w: 320, h: 180, giay: 1, hasAudio: false }
  const overlay = { textFilter: 'null' }
  const manual = taoFilterComplex(meta, [{ id: 'blur-1', x0: 0, y0: 0, x1: 80, y1: 40 }], true, false, '', false, false, 100, null, false, undefined, overlay, effects).join(' ')
  const automatic = taoFilterComplexAutomatic(meta, planBurnInputs({ sourceVideo: 'source', timedMask: 'mask' }), false, '', false, 100, null, true, undefined, overlay, effects).join(' ')
  for (const graph of [manual, automatic]) {
    assert.ok(graph.indexOf('noise=') < graph.indexOf('[overlay_base]null[out]'))
    assert.match(graph, /effect_1_texture/)
  }
  assert.match(automatic, /format=gbrp/)
  assert.ok(automatic.indexOf('maskedmerge') < automatic.indexOf('noise='))
  assert.ok(automatic.indexOf('[portrait_fg]overlay') < automatic.indexOf('noise='))
})

for (const effect of effects) test(`FFmpeg ${effect.kind}: visible on first/last frames, animated, deterministic and same frame count`, t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const meta = { w: 320, h: 180, giay: 1, hasAudio: false }
  const graph = taoFilterComplex(meta, [], false, false, '', false, false, 100, null, false, undefined, undefined, [effect])
  const source = ['-f', 'lavfi', '-i', 'color=gray:s=320x180:r=6:d=1']
  const output = ['-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
  const baseline = run([...source, ...output])
  const pixels = run([...source, ...graph, ...output])
  assert.equal(pixels.length, baseline.length)
  assert.deepEqual(pixels, run([...source, ...graph, ...output]))
  const size = 320 * 180 * 3
  for (const offset of [0, size * 5]) {
    let changed = 0
    for (let p = offset; p < offset + size; p += 3) if (Math.abs(pixels[p] - baseline[p]) > 2) changed++
    assert.ok(changed > 20, `Visible effect required; got ${changed} changed pixels`)
  }
  assert.notDeepEqual(pixels.subarray(0, size), pixels.subarray(size * 5), 'Effect must animate')
})

test('real OCR + portrait render applies effects on padding and keeps branding above them', t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const graph = taoFilterComplexAutomatic({ w: 320, h: 180, giay: 1, hasAudio: false },
    planBurnInputs({ sourceVideo: 'source', timedMask: 'mask' }), false, '', false, 100, null, true, undefined,
    { textFilter: 'drawbox=x=0:y=0:w=100:h=100:c=red:t=fill' }, effects)
  const pixels = run(['-f', 'lavfi', '-i', 'color=gray:s=320x180:r=2:d=1',
    '-f', 'lavfi', '-i', 'color=white:s=320x180:r=2:d=1', ...graph, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
  const frameSize = 1080 * 1920 * 3
  assert.equal(pixels.length, frameSize * 2)
  for (const offset of [0, frameSize]) {
    const p = offset + (20 * 1080 + 20) * 3
    assert.ok(pixels[p] > 245 && pixels[p + 1] < 8 && pixels[p + 2] < 8, 'Branding must not receive noise')
  }
  const firstPadding = pixels.subarray(1080 * 120 * 3, 1080 * 240 * 3)
  const lastPadding = pixels.subarray(frameSize + 1080 * 120 * 3, frameSize + 1080 * 240 * 3)
  assert.notDeepEqual(firstPadding, lastPadding, 'Effects must animate on portrait padding too')
})

test('real stacked render with manual blur retains frames, audio, dimensions and cleans scratch; cancellation does not publish', async t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const root = await mkdtemp(join(tmpdir(), 'tedia-effects-'))
  try {
    const source = join(root, 'source.mp4'); const output = join(root, 'result.mp4')
    run(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=12:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
    const options = { videoEffects: effects, ffmpegPath: ffmpeg, ffprobePath: ffprobe, finalOutputPath: output, itemWorkDir: root, signal: new AbortController().signal,
      expectedMedia: { durationSeconds: 1, frameRate: 12, requireAudio: true, durationToleranceFrames: 3 } }
    const result = await burnAutoShort({ video: source, mode: 'burn', lamMo: true, blurRegions: [{ id: 'blur-1', x0: 0, y0: 0, x1: 80, y1: 40 }] }, options, () => {})
    assert.equal(result.ok, true, JSON.stringify(result))
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true, encoding: 'utf8' })
    assert.equal(probe.status, 0, probe.stderr)
    const media = JSON.parse(probe.stdout)
    const video = media.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')
    assert.equal(video.width, 320); assert.equal(video.height, 180); assert.equal(Number(video.nb_frames), 12)
    assert.ok(Math.abs(Number(media.format.duration) - 1) < 0.1)
    assert.ok(media.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'))
    assert.deepEqual((await readdir(root)).sort(), ['result.mp4', 'source.mp4'])
    // A second render with only effects exercises the no-subtitle/no-blur entry gate.
    assert.equal((await burnAutoShort({ video: source, mode: 'burn' }, { ...options, finalOutputPath: join(root, 'only.mp4') }, () => {})).ok, true)
    const abort = new AbortController(); abort.abort()
    await assert.rejects(burnAutoShort({ video: source, mode: 'burn' }, { ...options, finalOutputPath: join(root, 'cancelled.mp4'), signal: abort.signal }, () => {}), /huỷ/)
    assert.equal(existsSync(join(root, 'cancelled.mp4')), false)
  } finally {
    const rel = relative(tmpdir(), root)
    assert.ok(rel.startsWith('tedia-effects-') && !rel.includes('..'))
    await rm(root, { recursive: true, force: true })
  }
})

test('normalizes custom_overlay effects and rejects invalid paths, duplicates and out-of-range intensity', () => {
  const validCustom: VideoEffect = {
    kind: 'custom_overlay',
    intensity: 75,
    assetPath: 'C:\\media\\effect.mp4',
    mattePath: 'C:\\media\\matte.mp4',
    blendMode: 'alphamerge',
    name: 'Nhiễu trắng',
    sourceType: 'capcut'
  }

  const normalized = normalizeVideoEffects([validCustom])
  assert.equal(normalized?.length, 1)
  assert.equal(normalized?.[0].kind, 'custom_overlay')
  assert.equal(normalized?.[0].name, 'Nhiễu trắng')
  assert.equal(normalized?.[0].blendMode, 'alphamerge')

  // Reject empty path or null char
  assert.throws(() => normalizeVideoEffects([{ kind: 'custom_overlay', intensity: 50, assetPath: '' }]))
  assert.throws(() => normalizeVideoEffects([{ kind: 'custom_overlay', intensity: 50, assetPath: 'C:\\bad\0.mp4' }]))
  assert.throws(() => normalizeVideoEffects([{ kind: 'custom_overlay', intensity: 50, assetPath: 'C:\\ok.mp4', mattePath: '\0' }]))
  // Reject duplicates
  assert.throws(() => normalizeVideoEffects([validCustom, validCustom]))
})

test('planVideoEffectInputs and appendVideoEffects support custom_overlay with both screen and alphamerge', () => {
  // Test alphamerge filter generation
  const linesAlpha = ['[0:v]null[out]']
  appendVideoEffects(linesAlpha, 1080, 1920, [
    { kind: 'custom_overlay', intensity: 80, assetPath: 'C:\\effect.mp4', mattePath: 'C:\\matte.mp4', blendMode: 'alphamerge' }
  ], [{ effectIndex: 0, videoInputIndex: 1, matteInputIndex: 2, videoPath: 'C:\\effect.mp4', mattePath: 'C:\\matte.mp4', blendMode: 'alphamerge' }])

  const alphaGraph = linesAlpha.join(';')
  assert.match(alphaGraph, /\[1:v\]\[2:v\]alphamerge/)
  assert.match(alphaGraph, /scale=w=1080:h=1920:force_original_aspect_ratio=increase/)
  assert.match(alphaGraph, /overlay=shortest=1\[out\]/)

  // Test screen blend filter generation
  const linesScreen = ['[0:v]null[out]']
  appendVideoEffects(linesScreen, 1080, 1920, [
    { kind: 'custom_overlay', intensity: 65, assetPath: 'C:\\sparkles.mp4', blendMode: 'screen' }
  ], [{ effectIndex: 0, videoInputIndex: 3, videoPath: 'C:\\sparkles.mp4', blendMode: 'screen' }])

  const screenGraph = linesScreen.join(';')
  assert.match(screenGraph, /\[3:v\]scale=w=1080:h=1920/)
  assert.match(screenGraph, /blend=c0_mode=screen:c0_opacity=0\.6500/)
})

