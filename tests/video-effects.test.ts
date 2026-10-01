import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { normalizeVideoEffects, VIDEO_EFFECT_PRESETS, type VideoEffect } from '../src/shared/videoEffects'
import { applyOverlayChromaKey } from '../src/shared/overlayChromaKey'
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

  // Test multiply blend filter generation (for dark scratches/noise)
  const linesMultiply = ['[0:v]null[out]']
  appendVideoEffects(linesMultiply, 1080, 1920, [
    { kind: 'custom_overlay', intensity: 75, assetPath: 'C:\\black_noise.mp4', blendMode: 'multiply' }
  ], [{ effectIndex: 0, videoInputIndex: 4, videoPath: 'C:\\black_noise.mp4', blendMode: 'multiply' }])

  const multiplyGraph = linesMultiply.join(';')
  assert.match(multiplyGraph, /\[4:v\]scale=w=1080:h=1920/)
  assert.match(multiplyGraph, /blend=all_mode=multiply:all_opacity=0\.7500/)
})

test('scanCapCutEffects discovers effects and synthesizes image sequences like Nhiễu đen', async () => {
  const { scanCapCutEffects } = await import('../src/main/capcutScanner')
  const results = await scanCapCutEffects()
  assert.ok(Array.isArray(results))
  const nhieuDen = results.find(e => e.name === 'Nhiễu đen' || e.id.includes('7399470796290166022'))
  if (nhieuDen) {
    assert.equal(nhieuDen.blendMode, 'multiply')
    assert.ok(existsSync(nhieuDen.videoPath), 'Synthesized MP4 must exist on disk')
    assert.ok(nhieuDen.videoPath.endsWith('.mp4'), 'Nhiễu đen must synthesize as MP4')
    assert.equal(nhieuDen.name, 'Nhiễu đen')
  }
})

test('chroma key survives normalization and rejects filter injection or invalid numeric settings', () => {
  const keyed = { kind: 'custom_overlay', intensity: 75, assetPath: 'C:\\media\\texture.mp4',
    blendMode: 'chromakey', chromaKey: { color: '#00FF00', similarity: 0.3, blend: 0.12 } }
  assert.deepEqual(normalizeVideoEffects([keyed])?.[0], keyed)
  for (const chromaKey of [
    { ...keyed.chromaKey, color: '#00FF00;movie=secret' },
    { ...keyed.chromaKey, similarity: NaN },
    { ...keyed.chromaKey, similarity: -1 },
    { ...keyed.chromaKey, blend: 2 }
  ]) assert.throws(() => normalizeVideoEffects([{ ...keyed, chromaKey }]))
})

test('CapCut chroma metadata is recognized without depending on the asset name and survives vault save', async () => {
  const { scanCapCutEffects, saveOverlayToVault, getSavedOverlayEffects, resolveOverlayChromaKey, restoreVideoEffectChromaKeys } = await import('../src/main/capcutScanner')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tedia-chroma-fixture-')))
  const oldLocal = process.env.LOCALAPPDATA
  const oldUserData = process.env.TEDIAPROS_TEST_USER_DATA
  try {
    process.env.LOCALAPPDATA = root
    process.env.TEDIAPROS_TEST_USER_DATA = join(root, 'profile')
    const effectRoot = join(root, 'CapCut', 'User Data', 'Cache', 'effect', '123456', 'abc123')
    const videoPath = join(effectRoot, 'AmazingFeature', 'resource', 'video', 'texture.mp4')
    const luaPath = join(effectRoot, 'AmazingFeature', 'lua', 'LumiFamily', 'LumiExportData.lua')
    await mkdir(dirname(videoPath), { recursive: true })
    await mkdir(dirname(luaPath), { recursive: true })
    await writeFile(videoPath, 'fixture')
    await writeFile(luaPath, "local ae_attribute = { ['LumiChromaKey_234-effect1'] = { ['keyColor'] = Amaz.Color(0, 1, 0, 1), ['threshold'] = 0.93, ['smoothness'] = 0 } }")
    const scanned = await scanCapCutEffects()
    assert.equal(scanned.length, 1)
    assert.equal(scanned[0].blendMode, 'chromakey')
    const [restored] = (await restoreVideoEffectChromaKeys([
      { kind: 'custom_overlay', intensity: 22, assetPath: videoPath, blendMode: 'screen', sourceType: 'capcut' }
    ]))!
    assert.equal(restored.blendMode, 'chromakey')
    assert.equal(restored.intensity, 22)
    assert.equal(restored.assetPath, videoPath)
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.mp4'), 'outside allowed cache')
    assert.equal(await resolveOverlayChromaKey(join(outside, 'secret.mp4')), undefined)
    await symlink(outside, join(effectRoot, 'escape'), 'junction')
    await assert.rejects(resolveOverlayChromaKey(join(effectRoot, 'escape', 'secret.mp4')), /ngoài/)
    await assert.rejects(saveOverlayToVault({ ...scanned[0], videoPath: join(outside, 'secret.mp4') }), /ngoài/)
    const saved = await saveOverlayToVault(scanned[0])
    const metaPath = join(dirname(saved.videoPath), 'metadata.json')
    const savedMeta = JSON.parse(await readFile(metaPath, 'utf8'))
    delete savedMeta.chromaKey
    savedMeta.blendMode = 'screen'
    savedMeta.thumbnailFile = 'missing-thumbnail.png'
    await writeFile(metaPath, JSON.stringify(savedMeta))
    const legacyItems = await getSavedOverlayEffects()
    assert.equal(legacyItems.length, 1, 'A missing optional thumbnail must not hide the video')
    const [legacyVault] = legacyItems
    assert.equal(legacyVault.thumbnailPath, undefined)
    assert.equal(legacyVault.blendMode, 'chromakey', 'Old vault metadata can be recovered from the original package')
    assert.equal((await restoreVideoEffectChromaKeys([
      { kind: 'custom_overlay', intensity: 30, assetPath: saved.videoPath, blendMode: 'screen', sourceType: 'saved' }
    ]))?.[0].blendMode, 'chromakey')
    assert.equal(JSON.parse(await readFile(metaPath, 'utf8')).blendMode, 'chromakey', 'Recovered vault metadata must be persisted automatically')
    assert.ok(relative(root, effectRoot).startsWith('CapCut'))
    await rm(effectRoot, { recursive: true, force: true })
    const [reloaded] = await getSavedOverlayEffects()
    assert.equal(reloaded.blendMode, 'chromakey')
    assert.deepEqual((reloaded as unknown as { chromaKey: unknown }).chromaKey,
      (scanned[0] as unknown as { chromaKey: unknown }).chromaKey)
    assert.equal(reloaded.videoPath, saved.videoPath)
  } finally {
    if (oldLocal == null) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = oldLocal
    if (oldUserData == null) delete process.env.TEDIAPROS_TEST_USER_DATA; else process.env.TEDIAPROS_TEST_USER_DATA = oldUserData
    const rel = relative(await realpath(tmpdir()), root)
    assert.ok(rel.startsWith('tedia-chroma-fixture-') && !rel.includes('..'))
    await rm(root, { recursive: true, force: true })
  }
})

test('preview keying matches FFmpeg alpha and spill suppression on decoded RGB pixels', t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const rgba = Buffer.from([0, 255, 0, 255, 20, 230, 20, 255, 128, 200, 128, 255,
    190, 190, 190, 255, 50, 90, 120, 255, 230, 245, 230, 255])
  const key = { color: '#00FF00', similarity: 0.3, blend: 0.12 }
  const preview = new Uint8ClampedArray(rgba)
  applyOverlayChromaKey(preview, key)
  const rendered = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '6x1', '-i', 'pipe:0',
    '-vf', 'colorkey=0x00FF00:0.3:0.12,despill=type=green:green=-1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
  { input: rgba, windowsHide: true, timeout: 10000 })
  assert.equal(rendered.status, 0, rendered.stderr.toString())
  assert.equal(rendered.stdout.length, preview.length)
  for (let i = 0; i < preview.length; i++) assert.ok(Math.abs(preview[i] - rendered.stdout[i]) <= 1, `Preview/export mismatch at channel ${i}`)
  assert.equal(preview[3], 0)
  assert.equal(preview[15], 255)
  assert.equal(preview[13], 190, 'Neutral smoke is not desaturated or erased')
})

test('real chroma render removes the backing, keeps smoke, intensity and frame count', t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const source = ['-f', 'lavfi', '-i', 'color=0x202020:s=160x90:r=4:d=1']
  const texture = ['-f', 'lavfi', '-i', 'color=0x00FF00:s=160x90:r=4:d=2,drawbox=x=60:y=30:w=40:h=30:c=0xC0C0C0:t=fill']
  const output = ['-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
  const baseline = run([...source, ...output])
  const render = (intensity: number) => {
    const lines = ['[0:v]null[out]']
    const effect = { kind: 'custom_overlay', intensity, assetPath: 'texture.mp4', blendMode: 'chromakey',
      chromaKey: { color: '#00FF00', similarity: 0.3, blend: 0.12 } } as unknown as VideoEffect
    appendVideoEffects(lines, 160, 90, [effect], [
      { effectIndex: 0, videoInputIndex: 1, videoPath: 'texture.mp4', blendMode: 'chromakey' } as never
    ])
    return run([...source, ...texture, '-filter_complex', lines.join(';'), '-map', '[out]', ...output])
  }
  const full = render(100)
  const weak = render(25)
  assert.equal(full.length, baseline.length, 'Looping overlay must terminate with the main video')
  assert.equal(weak.length, baseline.length)
  for (const offset of [0, 160 * 90 * 3 * 3]) {
    const corner = offset + (10 * 160 + 10) * 3
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(Math.abs(full[corner + channel] - baseline[corner + channel]) <= 2, 'Green backing must be transparent')
    }
    const smoke = offset + (40 * 160 + 80) * 3
    assert.ok(full[smoke] > 170, 'Neutral smoke must remain visible')
    assert.ok(weak[smoke] > baseline[smoke] + 15 && weak[smoke] < full[smoke] - 70, 'Intensity must affect keyed smoke')
    assert.ok(Math.abs(full[smoke + 1] - full[smoke]) <= 3, 'Smoke must not gain a green tint')
  }
})

test('real CapCut green-backed asset restores an old selection in the production burn pipeline', async t => {
  const asset = process.env.TEDIAPROS_CHROMA_KEY_ASSET
  if (!asset || !existsSync(asset) || !existsSync(ffmpeg)) return t.skip('Set TEDIAPROS_CHROMA_KEY_ASSET to exercise a real CapCut package')
  const root = await mkdtemp(join(tmpdir(), 'tedia-keyed-render-'))
  try {
    const source = join(root, 'source.mp4'), output = join(root, 'output.mp4')
    run(['-f', 'lavfi', '-i', 'color=0x404040:s=360x640:r=12:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
    const result = await burnAutoShort({ video: source, mode: 'burn' }, {
      videoEffects: [{ kind: 'custom_overlay', intensity: 75, assetPath: asset, blendMode: 'screen', sourceType: 'capcut' }],
      ffmpegPath: ffmpeg, ffprobePath: ffprobe, finalOutputPath: output, itemWorkDir: root,
      signal: new AbortController().signal,
      expectedMedia: { durationSeconds: 3, frameRate: 12, requireAudio: true, durationToleranceFrames: 3 }
    }, () => {})
    assert.equal(result.ok, true, JSON.stringify(result))
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true, encoding: 'utf8' })
    assert.equal(probe.status, 0, probe.stderr)
    const media = JSON.parse(probe.stdout)
    const video = media.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')
    assert.equal(video.width, 360); assert.equal(video.height, 640); assert.equal(Number(video.nb_frames), 36)
    assert.ok(Math.abs(Number(media.format.duration) - 3) < 0.1)
    assert.ok(media.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio'))
    const decoded = run(['-i', output, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
    const frameSize = 360 * 640 * 3
    assert.equal(decoded.length, frameSize * 36)
    const corner = (10 * 360 + 10) * 3
    assert.ok(Math.abs(decoded[corner] - 64) <= 4, 'The initial green backing must leave the source visible')
    let greenPixels = 0
    for (let p = 0; p < decoded.length; p += 3) if (decoded[p + 1] > Math.max(decoded[p], decoded[p + 2]) + 10) greenPixels++
    assert.equal(greenPixels, 0, 'No decoded output frame may carry green spill on a neutral source')
    assert.notDeepEqual(decoded.subarray(0, frameSize), decoded.subarray(frameSize * 6, frameSize * 7), 'Real smoke must remain animated')
    assert.deepEqual((await readdir(root)).sort(), ['output.mp4', 'source.mp4'], 'Production render must clean its scratch files')
    if (process.env.TEDIAPROS_CHROMA_EVIDENCE === '1') {
      const evidence = join(process.cwd(), '.ai/tasks/2026-10-01-bursting-smoke-fix')
      await mkdir(evidence, { recursive: true })
      await copyFile(output, join(evidence, 'export.mp4'))
      run(['-ss', '0.5', '-i', output, '-frames:v', '1', join(evidence, 'export.png')])
      await writeFile(join(evidence, 'export-proof.json'), JSON.stringify({ asset, frames: 36, durationSeconds: Number(media.format.duration),
        width: 360, height: 640, hasAudio: true, greenPixels, scratchClean: true }, null, 2))
    }
  } finally {
    const rel = relative(tmpdir(), root)
    assert.ok(rel.startsWith('tedia-keyed-render-') && !rel.includes('..'))
    await rm(root, { recursive: true, force: true })
  }
})

