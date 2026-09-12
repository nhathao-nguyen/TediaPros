import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { normalizeAutoShortOverlays, overlayImageGeometry, overlayTextGeometry, type AutoShortOverlays } from '../src/shared/autoShortOverlays'
import { validateAutoShortStartRequest } from '../src/shared/autoShortContract'
import { appendAutoShortOverlays, overlayAssDocument, prepareAutoShortOverlays, readAutoShortOverlayImage } from '../src/main/autoShortOverlays'
import { burnAutoShort, taoFilterComplex, taoFilterComplexAutomatic } from '../src/main/burn'
import { planBurnInputs } from '../src/main/burnInputPlanner'
import type { AutoShortConfig } from '../src/shared/types'

const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros', 'bin', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const ffprobe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
const text = { value: 'Xin chào Việt Nam', x: 0.5, y: 0.5, size: 0.1, color: '#ffffff', opacity: 1 }
const image = { path: 'C:\\media\\logo.png', sha256: 'a'.repeat(64), x: 0, y: 0, width: 0.25, opacity: 1 }

function run(args: string[], cwd?: string) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true, maxBuffer: 24 * 1024 * 1024, timeout: 45000 })
  assert.equal(result.status, 0, result.error?.message || result.stderr.toString())
  return result.stdout
}
async function fixture() { return mkdtemp(join(tmpdir(), 'tedia-overlays-')) }
async function cleanup(root: string) {
  const rel = relative(tmpdir(), root)
  assert.ok(rel.startsWith('tedia-overlays-') && !rel.includes('..'))
  await rm(root, { recursive: true, force: true })
}
const config: AutoShortConfig = {
  subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu', blurRegions: [], lamMo: false,
  blurMode: 'manual', ocrBlurProfile: 'accurate', translateTarget: 'none', translateProvider: 'local',
  ttsEnabled: false, voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 20, outputDir: 'C:\\media\\out'
}

test('legacy config remains valid and overlay config is checked at IPC boundary', () => {
  for (const overlays of [undefined, {}, { image }, { text }, { image, text }]) {
    const validated = validateAutoShortStartRequest({ items: [{ id: 'a', filePath: 'C:\\media\\input.mp4' }], config: { ...config, ...(overlays ? { overlays } : {}) } })
    assert.equal(validated.ok, true)
    if ((!overlays || Object.keys(overlays).length === 0) && validated.ok) assert.equal(Object.hasOwn(validated.value.config, 'overlays'), false)
  }
  for (const overlays of [{ text: { ...text, value: '' } }, { image: { ...image, path: '../x.png' } }, { text: { ...text, x: 2 } }]) {
    assert.equal(validateAutoShortStartRequest({ items: [{ id: 'a', filePath: 'C:\\media\\input.mp4' }], config: { ...config, overlays } }).ok, false)
  }
})

test('rejects malformed positions, colors, control characters, image paths and missing checksums', () => {
  for (const invalid of [[], true, { image: { ...image, sha256: '' } }, { image: { ...image, width: NaN } },
    { image: { ...image, path: 'C:\\media\\..\\secret.png' } }, { image: { ...image, path: 'https://a/logo.png' } },
    { image: { ...image, path: 'C:\\logo.svg' } }, { text: { ...text, color: 'red;movie=x' } },
    { text: { ...text, value: 'a\nb' } }, { text: { ...text, value: 'x'.repeat(121) } },
    { text: { ...text, opacity: 0 } }]) assert.throws(() => normalizeAutoShortOverlays(invalid))
  assert.equal(normalizeAutoShortOverlays({ text: { ...text, value: '' } }, true)?.text?.value, '')
})

test('image retains aspect ratio and remains contained at every edge of landscape and portrait canvas', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
    for (const [iw, ih] of [[100, 100], [1000, 100], [100, 2000]]) {
      for (const [x, y] of [[0, 0], [1, 1], [0.5, 0.5]]) {
        const g = overlayImageGeometry(w, h, iw, ih, { ...image, width: 1, x, y })
        assert.ok(g.x >= 0 && g.y >= 0 && g.x + g.width <= w && g.y + g.height <= h)
        assert.ok(g.height <= h * 0.8)
        assert.ok(Math.abs(g.width / g.height - iw / ih) < 0.03)
      }
    }
  }
})

test('long text is fitted without dropping characters and stays inside the output canvas', () => {
  const long = { ...text, value: 'a'.repeat(120), x: 1, y: 1 }
  const g = overlayTextGeometry(320, 180, long, (s, size) => s.length * size / 2)
  assert.ok(g.size < 18 && g.x >= 0 && g.y >= 0 && g.x + g.width <= 320 && g.y + g.height <= 180)
  const ass = overlayAssDocument(320, 180, 2.031, long, 'Arial', (s, size) => s.length * size / 2)
  assert.ok(ass.includes(long.value))
  assert.match(ass, /0:00:02\.04/)
})

test('image asset checks missing files, fake extensions and replacement after selection', async () => {
  const root = await fixture()
  try {
    const path = join(root, 'ảnh.png')
    await assert.rejects(readAutoShortOverlayImage(path))
    await writeFile(path, 'not an image')
    await assert.rejects(readAutoShortOverlayImage(path), /không phải PNG/)
    // Tiny valid PNG fixture; no external runtime required for identity validation.
    await writeFile(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n9sAAAAASUVORK5CYII=', 'base64'))
    const selected = await readAutoShortOverlayImage(path)
    assert.equal(selected.asset.sha256.length, 64)
    await writeFile(path, Buffer.concat([selected.bytes, Buffer.from('changed')]))
    await assert.rejects(readAutoShortOverlayImage(path, selected.asset.sha256), /đã thay đổi/)
  } finally { await cleanup(root) }
})

test('automatic OCR + narration indexes stay stable and decoration follows RGB mask and portrait frame', () => {
  const plan = planBurnInputs({ sourceVideo: 'video', narrationAudio: 'audio', timedMask: 'mask' })
  const graph = taoFilterComplexAutomatic({ w: 320, h: 180, giay: 2, hasAudio: false }, plan, false, 'none', true, 0, null, true, undefined,
    { image: { ...image, inputIndex: 3 } }).join(' ')
  assert.match(graph, /format=gbrp/)
  assert.match(graph, /\[2:v\]format=gray/)
  assert.ok(graph.indexOf('maskedmerge') < graph.indexOf('[3:v]'))
  assert.ok(graph.indexOf('[portrait_fg]overlay') < graph.indexOf('[3:v]'))
  assert.match(graph, /scale=w=270:h=1536/)
  assert.match(graph, /eof_action=repeat:repeatlast=1:shortest=0/)
})

test('FFmpeg renders literal punctuation and ASS-looking text without executing override tags', (t) => {
  if (!existsSync(ffmpeg)) return t.skip('Managed FFmpeg runtime unavailable')
  return (async () => {
    const root = await fixture()
    try {
      const value = '100%: Xin chào {\\pos(0,0)} \\N'
      await writeFile(join(root, 'text.ass'), overlayAssDocument(640, 360, 1, { ...text, value, x: 0.5, y: 0.5 }, 'Arial', (s, size) => s.length * size / 2))
      const bytes = run(['-f', 'lavfi', '-i', 'color=black:s=640x360:r=1:d=1', '-vf', 'ass=text.ass', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], root)
      let topPixels = 0; let centerPixels = 0
      for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
        const i = (y * 640 + x) * 3
        if (bytes[i] > 160) { if (y < 80) topPixels++; if (y >= 120 && y < 250) centerPixels++ }
      }
      assert.equal(topPixels, 0, 'User ASS override must not move text to the top-left')
      assert.ok(centerPixels > 50, 'Literal text is visible in requested area')
    } finally { await cleanup(root) }
  })()
})

test('full AutoShort burn keeps image and text on first and last frame, preserves duration/audio and cleans overlay scratch', async (t) => {
  if (!existsSync(ffmpeg)) return t.skip('Managed FFmpeg runtime unavailable')
  const root = await fixture()
  try {
    const video = join(root, 'source.mp4')
    const logo = join(root, 'ảnh logo.png')
    run(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=10:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video])
    run(['-f', 'lavfi', '-i', 'color=red:s=80x40,format=rgba', '-frames:v', '1', logo])
    const selected = await readAutoShortOverlayImage(logo)
    const overlays: AutoShortOverlays = { image: { ...image, ...selected.asset }, text: { ...text, value: 'Xin chào 100%: Việt Nam' } }
    const output = join(root, 'output.mp4')
    const result = await burnAutoShort({ video, mode: 'burn', fontId: 'auto' }, {
      overlays, ffmpegPath: ffmpeg, ffprobePath: ffprobe, finalOutputPath: output, itemWorkDir: root,
      expectedMedia: { durationSeconds: 2, frameRate: 10, requireAudio: true, durationToleranceFrames: 3 }, signal: new AbortController().signal
    }, () => {})
    assert.equal(result.ok, true)
    if (process.env.TEDIAPROS_OVERLAY_EVIDENCE === '1') {
      const evidence = join(process.cwd(), '.ai', 'tasks', '2026-09-12-autoshort-overlays')
      await mkdir(evidence, { recursive: true })
      await copyFile(output, join(evidence, 'overlay-smoke.mp4'))
      run(['-i', output, '-frames:v', '1', join(evidence, 'overlay-first-frame.png')])
    }
    const bytes = run(['-i', output, '-vf', "select='eq(n,0)+eq(n,19)'", '-fps_mode', 'vfr', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
    const frameSize = 320 * 180 * 3
    assert.equal(bytes.length, frameSize * 2)
    for (let n = 0; n < 2; n++) {
      const offset = n * frameSize
      const logoPixel = offset + (10 * 320 + 10) * 3
      assert.ok(bytes[logoPixel] > 180 && bytes[logoPixel + 1] < 70 && bytes[logoPixel + 2] < 70, 'Logo remains red at first/last frame')
      let white = 0
      for (let y = 75; y < 110; y++) for (let x = 20; x < 300; x++) {
        const pixel = offset + (y * 320 + x) * 3
        if (bytes[pixel] > 220 && bytes[pixel + 1] > 220 && bytes[pixel + 2] > 220) white++
      }
      assert.ok(white > 20, `Text remains visible at first/last frame ${n}: white pixels ${white}`)
    }
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('overlay-')), [])
  } finally { await cleanup(root) }
})

test('overlay scratch can be cleaned after preparation failure and cancellation never publishes', async (t) => {
  const root = await fixture()
  try {
    const missing = { ...image, path: join(root, 'missing.png') }
    await assert.rejects(prepareAutoShortOverlays({ image: missing }, { workDir: root, width: 320, height: 180, duration: 1, nextInputIndex: 1 }, []))
    const abort = new AbortController(); abort.abort()
    await assert.rejects(burnAutoShort({ video: join(root, 'source.mp4'), mode: 'burn' }, {
      overlays: { text }, ffmpegPath: ffmpeg, ffprobePath: ffprobe, finalOutputPath: join(root, 'cancelled.mp4'), itemWorkDir: root,
      expectedMedia: { durationSeconds: 1, requireAudio: false, durationToleranceFrames: 3 }, signal: abort.signal
    }, () => {}), /huỷ/)
    assert.deepEqual(await readdir(root), [])
  } finally { await cleanup(root) }
})

test('text-only rendering follows measured font width instead of shrinking ASS glyphs away from the right edge', async (t) => {
  if (!existsSync(ffmpeg)) return t.skip('Managed FFmpeg runtime unavailable')
  const root = await fixture()
  try {
    const prepared = await prepareAutoShortOverlays({ text: { ...text, value: 'Xin chào 100%: Việt Nam', x: 1 } }, {
      workDir: root, width: 320, height: 180, duration: 1, nextInputIndex: 1, fontId: 'noto-sans'
    }, [])
    const graph = taoFilterComplex({ w: 320, h: 180, giay: 1, hasAudio: false }, [], false, false, 'none', false, false, 100, null, false, undefined, prepared)
    const pixels = run(['-f', 'lavfi', '-i', 'color=black:s=320x180:r=1:d=1', ...graph, '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], root)
    const xs: number[] = []
    for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) if (pixels[(y * 320 + x) * 3] > 100) xs.push(x)
    assert.ok(Math.max(...xs) > 310, 'Text aligned right should actually reach the right edge')
    assert.ok(Math.max(...xs) - Math.min(...xs) > 195, 'Noto glyph width should match CSS em measurement (~209px), not ASS nominal size (~138px)')
  } finally { await cleanup(root) }
})

test('actual OCR mask + narration + portrait render preserves transparent image and text on padding through last frame', async (t) => {
  if (!existsSync(ffmpeg)) return t.skip('Managed FFmpeg runtime unavailable')
  const root = await fixture()
  try {
    const logo = join(root, 'transparent.png')
    run(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=20x20,format=rgba', '-frames:v', '1', logo])
    const selected = await readAutoShortOverlayImage(logo)
    const prepared = await prepareAutoShortOverlays({ image: { ...image, ...selected.asset, width: 0.1, opacity: 0.5 },
      text: { ...text, color: '#00ff00', x: 1, y: 0, size: 0.03 } }, {
      workDir: root, width: 1080, height: 1920, duration: 1, nextInputIndex: 3, fontId: 'noto-sans'
    }, [])
    const plan = planBurnInputs({ sourceVideo: 'source', narrationAudio: 'narration', timedMask: 'mask' })
    const graph = taoFilterComplexAutomatic({ w: 320, h: 180, giay: 1, hasAudio: false }, plan, false, 'none', true, 0, null, true, undefined, prepared)
    const output = join(root, 'portrait.mp4')
    run(['-f', 'lavfi', '-i', 'color=black:s=320x180:r=2:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-f', 'lavfi', '-i', 'color=black:s=320x180:r=2:d=1', '-i', prepared!.image!.path,
      ...graph, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output], root)
    const pixels = run(['-i', output, '-vf', 'crop=1080:120:0:0', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
    const frameSize = 1080 * 120 * 3
    assert.equal(pixels.length, frameSize * 2, 'Image input must not extend or shorten video')
    for (let n = 0; n < 2; n++) {
      const p = n * frameSize + (20 * 1080 + 20) * 3
      assert.ok(pixels[p] > 45 && pixels[p] < 80 && pixels[p + 1] < 10, 'PNG alpha and selected opacity multiply over black padding')
      let green = 0
      for (let i = n * frameSize; i < (n + 1) * frameSize; i += 3) if (pixels[i + 1] > 150 && pixels[i] < 70 && pixels[i + 2] < 70) green++
      assert.ok(green > 100, 'Green text remains on portrait padding in both frames')
    }
  } finally { await cleanup(root) }
})
