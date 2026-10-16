import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { alphaEvidence, alphaProfile, applyGeminiAlpha } from '../src/main/inpainting/geminiAlphaMath'
import { runGeminiAlpha } from '../src/main/inpainting/geminiAlpha'
import { runAutoShortSttnPreview } from '../src/main/autoshort'
import { parseCanonicalMediaMetadata } from '../src/main/canonicalDisplayGeometry'
import { parseAutoShortDependencyConfig } from '../src/shared/autoShortDependencyContract'
import { autoShortNeedsOcr, isAlphaRemoval, isSttnRemoval, normalizeAutoShortBlurMode } from '../src/shared/autoShortOcrBlur'

const region = { x0: 562, y0: 1125, x1: 658, y1: 1208 }
const profile = alphaProfile(720, 1280, region)
function markedFrame(opacity = 1): Buffer {
  const frame = Buffer.alloc(720 * 1280 * 3, 30)
  for (let y = 0; y < 90; y++) for (let x = 0; x < 90; x++) {
    const a = profile.alpha[y * 90 + x] * opacity
    const value = Math.round(30 * (1 - a) + 255 * a)
    const offset = ((1115 + y) * 720 + 555 + x) * 3
    frame.fill(value, offset, offset + 3)
  }
  return frame
}

test('alpha inverse recovers synthetic background without changing any pixel outside the logo', () => {
  const frame = markedFrame()
  applyGeminiAlpha(frame, 720, false)
  assert.ok(frame.every(v => Math.abs(v - 30) <= 1))
  const clean = markedFrame()
  applyGeminiAlpha(clean, 720, true)
  assert.ok(clean.every(v => Math.abs(v - 30) <= 1))
  assert.throws(() => alphaProfile(720, 1280, { ...region, x0: NaN }), /hợp lệ/)
  assert.throws(() => alphaProfile(1080, 1920, region), /720/)
  assert.throws(() => alphaProfile(720, 1280, { x0: 0, y0: 0, x1: 100, y1: 100 }), /Vùng/)
})

test('alpha evidence distinguishes absent and changed opacity logos; IPC keeps alpha independent of OCR/STTN', () => {
  const gray = profile.alpha.map(a => Math.round(30 + 225 * a))
  const good = alphaEvidence(gray)
  assert.ok(good.score > .99)
  assert.ok(Math.abs(good.opacityRatio - 1) < .01)
  assert.equal(alphaEvidence(new Uint8Array(8100).fill(30)).score, 0)
  assert.ok(alphaEvidence(profile.alpha.map(a => Math.round(30 + 225 * a * .5))).opacityRatio < .6)
  const config = parseAutoShortDependencyConfig({ subtitleMethod: 'none', whisperModel: 'base', lamMo: true, blurMode: 'gemini-alpha' })
  assert.equal(normalizeAutoShortBlurMode(config.blurMode), 'gemini-alpha')
  assert.equal(isAlphaRemoval(config), true)
  assert.equal(isSttnRemoval(config), false)
  assert.equal(autoShortNeedsOcr(config), false)
})

const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG
const ffprobe = process.env.TEDIAPROS_TEST_FFPROBE || (ffmpeg?.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'))
const native = { skip: !ffmpeg || !ffprobe ? 'Set TEDIAPROS_TEST_FFMPEG and TEDIAPROS_TEST_FFPROBE for native media checks' : false }

function command(exe: string, args: string[], input?: Buffer): Buffer {
  const result = spawnSync(exe, args, { input, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
  assert.equal(result.status, 0, result.stderr?.toString())
  return result.stdout
}

test('native alpha preserves frames, raw RGB outside the logo and audio; rejects no-logo and cancels without publishing', native, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-alpha-'))
  try {
    const source = join(root, 'source.mkv'), output = join(root, 'cleaned.mkv')
    const fixture = Buffer.concat(Array.from({ length: 8 }, () => markedFrame()))
    command(ffmpeg!, ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '720x1280', '-framerate', '4', '-i', 'pipe:0', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-map', '0:v', '-map', '1:a', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', '-frames:v', '8', source], fixture)
    const input = { videoPath: source, outputPath: output, ffmpegPath: ffmpeg!, ffprobePath: ffprobe!, region, signal: new AbortController().signal }
    const result = await runGeminiAlpha(input)
    assert.equal(result.frames, 8)
    const decoded = command(ffmpeg!, ['-v', 'error', '-i', output, '-map', '0:v:0', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
    assert.ok(decoded.every(v => Math.abs(v - 30) <= 1))
    const audioHash = (path: string) => command(ffmpeg!, ['-v', 'error', '-i', path, '-map', '0:a:0', '-c:a', 'copy', '-f', 'hash', '-']).toString()
    assert.equal(audioHash(output), audioHash(source))
    const preview = await runAutoShortSttnPreview({ videoPath: source, previewSeconds: 2, config: {
      subtitleMethod: 'none', whisperModel: 'base', whisperDevice: 'cpu', lamMo: true,
      blurMode: 'gemini-alpha', ocrBlurProfile: 'accurate', blurRegions: [],
      ocrRegion: { x0: region.x0 / 720, y0: region.y0 / 1280, x1: region.x1 / 720, y1: region.y1 / 1280 },
      translateTarget: 'none', translateProvider: 'local', ttsEnabled: false,
      voiceOverMode: false, audioMode: 'replace', outputDir: root
    } }, join(root, 'preview'), new AbortController().signal, () => {}, {
      resolveFfmpeg: async () => ffmpeg!, resolveFfprobe: async () => ffprobe!,
      probeMedia: async path => parseCanonicalMediaMetadata(JSON.parse(command(ffprobe!, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]).toString())),
      runVisualOcr: async () => { throw new Error('Alpha preview must not invoke OCR') },
      removeSubtitles: async () => { throw new Error('Alpha preview must not invoke STTN') }
    })
    const previewStream = JSON.parse(command(ffprobe!, ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', preview.outputPath]).toString()).streams.find((s: { codec_type: string }) => s.codec_type === 'video')
    assert.equal(Number(previewStream.nb_read_frames), 8)
    assert.equal(Number(previewStream.duration), 2)
    assert.deepEqual(await readdir(join(root, 'preview')), ['preview.mp4'])
    const original = await readFile(output)
    await assert.rejects(runGeminiAlpha(input), /ghi đè/)
    assert.deepEqual(await readFile(output), original)
    const wrong = join(root, 'no-logo.mkv')
    command(ffmpeg!, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=720x1280:r=4:d=2', '-c:v', 'ffv1', wrong])
    await assert.rejects(runGeminiAlpha({ ...input, videoPath: wrong, outputPath: join(root, 'rejected.mkv') }), /chưa khớp/)
    const weak = join(root, 'weak-logo.mkv')
    command(ffmpeg!, ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '720x1280', '-framerate', '4', '-i', 'pipe:0', '-c:v', 'ffv1', weak], Buffer.concat(Array.from({ length: 8 }, () => markedFrame(.5))))
    await assert.rejects(runGeminiAlpha({ ...input, videoPath: weak, outputPath: join(root, 'weak-rejected.mkv') }), /chưa khớp/)
    const fast = join(root, 'fast.mkv')
    command(ffmpeg!, ['-v', 'error', '-i', source, '-vf', 'fps=24', '-c:v', 'ffv1', '-c:a', 'copy', fast])
    const controller = new AbortController()
    await assert.rejects(runGeminiAlpha({ ...input, videoPath: fast, outputPath: join(root, 'cancelled.mkv'), signal: controller.signal, onProgress: percent => { if (percent > 0) controller.abort() } }), /hủy|abort/i)
    assert.deepEqual((await readdir(root)).sort(), ['cleaned.mkv', 'fast.mkv', 'no-logo.mkv', 'preview', 'source.mkv', 'weak-logo.mkv'])
  } finally { await rm(root, { recursive: true, force: true }) }
})
