import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { planBalancedVideoExport, balancedVideoEncoderCandidates, randomizeVideoExportPlan } from '../src/main/videoExportPolicy'
import { appendVideoEffects, planVideoEffectInputs } from '../src/main/videoEffects'
import { probeBurnMedia, burnAutoShort, resetCachedWorkingEncoder } from '../src/main/burn'
import type { VideoEffect } from '../src/shared/videoEffects'

const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros/bin/ffmpeg.exe')
const ffprobe = join(dirname(ffmpeg), 'ffprobe.exe')
function run(args: string[]): Buffer {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { windowsHide: true, timeout: 20000, maxBuffer: 10 * 1024 * 1024 })
  assert.equal(r.status, 0, r.error?.message || r.stderr.toString()); return r.stdout
}

test('balanced export is stable, uses video-only source rate and allows re-encoding/upscale/detail headroom', () => {
  const source = { width: 1280, height: 720, frameRate: 30, videoBitrate: 1500000, videoCodec: 'h264' }
  const plan = planBalancedVideoExport(source)
  assert.deepEqual(plan, planBalancedVideoExport(source))
  assert.ok(plan.peakBitrate > source.videoBitrate, 'A compressed source is not a safe exact output target')
  assert.equal(plan.bufferBits, plan.peakBitrate * 2)
  const hevc = planBalancedVideoExport({ ...source, videoCodec: 'hevc' })
  assert.ok(hevc.peakBitrate > plan.peakBitrate, 'H.264 needs headroom over more efficient input codecs')
  const upscale = planBalancedVideoExport({ ...source, width: 1920, height: 1080, sourceWidth: 1280, sourceHeight: 720 })
  assert.ok(upscale.peakBitrate > plan.peakBitrate)
  const grain = planBalancedVideoExport({ ...source, effects: [{ kind: 'grain', intensity: 100 }] })
  assert.ok(grain.peakBitrate > plan.peakBitrate, 'New temporal detail requires bitrate headroom')
  assert.equal(grain.qualityNvenc, 23, 'Preserve the existing quality target for dense procedural detail')
  assert.equal(grain.qualityX264, 21)
  const vfr = planBalancedVideoExport({ ...source, frameRate: 120, averageFrameRate: 24 })
  assert.equal(vfr.frameRateForBudget, 24)
  assert.equal(vfr.gopFrames, 48)
  assert.equal(plan.encoderPreference, 'gpu')
  const staticPlan = planBalancedVideoExport({ ...source, videoBitrate: 80000 })
  assert.equal(staticPlan.encoderPreference, 'cpu', 'Very low-rate static-like sources can favor compression over hardware encode')
  assert.equal(balancedVideoEncoderCandidates(staticPlan, 'win32')[0].ten, 'libx264')
  assert.equal(planBalancedVideoExport({ ...source, videoBitrate: 80000, effects: [{ kind: 'grain', intensity: 35 }] }).encoderPreference, 'gpu')
  assert.equal(planBalancedVideoExport({ ...source, videoBitrate: 80000, frameRate: 60 }).encoderPreference, 'gpu')
  assert.equal(planBalancedVideoExport({ ...source, videoBitrate: 80000, effects: [{ kind: 'custom_overlay', intensity: 50, assetPath: 'unknown.mp4' }] }).encoderPreference, 'gpu', 'Unknown texture detail must not be classified from source bitrate alone')
  assert.equal(planBalancedVideoExport({ ...source, videoBitrate: 80000, effects: [{ kind: 'custom_overlay', intensity: 50, assetPath: 'texture.mp4',
    layers: [{ assetPath: 'texture.mp4', blendMode: 'screen' }, { assetPath: 'still.mp4', blendMode: 'multiply', isStatic: true }] }] }).encoderPreference, 'cpu')
  for (const value of [NaN, Infinity, -1, 0]) {
    const invalid = planBalancedVideoExport({ width: value, height: value, frameRate: value, videoBitrate: value })
    assert.ok(Number.isFinite(invalid.peakBitrate) && invalid.peakBitrate >= 400000 && invalid.peakBitrate <= 240000000)
  }
  assert.ok(Number.isFinite(planBalancedVideoExport({ ...source, effects: [{ kind: 'grain', intensity: NaN }] }).peakBitrate))
  for (const candidate of balancedVideoEncoderCandidates(plan, 'win32')) {
    assert.ok(!candidate.args.includes('-r') && !candidate.args.includes('-vsync'), 'Export budget must never change timing')
  }
})

test('codec policy distinguishes quality-target VBR/CRF from vendor fallbacks and has a usable CPU path', t => {
  const plan = planBalancedVideoExport({ width: 160, height: 90, averageFrameRate: 12 })
  const candidates = balancedVideoEncoderCandidates(plan, 'win32')
  const cpu = candidates.find(c => c.ten === 'libx264')!
  const nvenc = candidates.find(c => c.ten === 'h264_nvenc')!
  assert.equal(nvenc.args[nvenc.args.indexOf('-b:v') + 1], '0', 'CQ must not inherit a target average rate')
  assert.ok(nvenc.args.includes('-maxrate') && cpu.args.includes('-maxrate'))
  assert.deepEqual(candidates, balancedVideoEncoderCandidates(plan, 'win32'))
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const pixels = run(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=12:d=1', ...cpu.args, '-f', 'null', 'NUL'])
  assert.equal(pixels.length, 0, 'CPU fallback encodes without requiring GPU features')
})

test('per-export random CQ/GOP restores variation without changing bitrate, CPU quality, timing or texture policy', () => {
  const source = { width: 1280, height: 720, frameRate: 30, videoBitrate: 1500000, videoCodec: 'h264' }
  const base = planBalancedVideoExport(source), variants = new Set<string>()
  for (let quality = 0; quality < 3; quality++) for (let gop = 0; gop < 2; gop++) {
    const choices = [quality, gop]; let draws = 0
    const chosen = randomizeVideoExportPlan(base, maximum => {
      assert.equal(maximum, draws === 0 ? 3 : 2); return choices[draws++]
    })
    assert.equal(draws, 2, 'Choose one quality and GOP per export, not for every encoder retry')
    assert.ok([22, 23, 24].includes(chosen.qualityNvenc)); assert.ok([60, 120].includes(chosen.gopFrames))
    assert.deepEqual({ ...chosen, qualityNvenc: base.qualityNvenc, gopFrames: base.gopFrames, variation: undefined }, { ...base, variation: undefined })
    assert.equal(chosen.variation, 'cq-gop'); variants.add(`${chosen.qualityNvenc}/${chosen.gopFrames}`)
    const candidates = balancedVideoEncoderCandidates(chosen, 'win32')
    const value = (encoder: string, argument: string) => { const args = candidates.find(c => c.ten === encoder)!.args; return args[args.indexOf(argument) + 1] }
    assert.equal(value('h264_nvenc', '-cq'), String(chosen.qualityNvenc))
    assert.equal(value('h264_nvenc', '-g'), String(chosen.gopFrames))
    assert.equal(value('h264_amf', '-qp_p'), String(chosen.qualityNvenc))
    assert.equal(value('h264_qsv', '-global_quality'), String(chosen.qualityNvenc))
    assert.equal(value('libx264', '-g'), String(chosen.gopFrames))
    assert.equal(value('libx264', '-crf'), String(base.qualityX264))
    assert.deepEqual(candidates, balancedVideoEncoderCandidates(chosen, 'win32'), 'Fallbacks use the same job selection')
  }
  assert.equal(variants.size, 6)
  assert.deepEqual(base, planBalancedVideoExport(source), 'Planning stays deterministic and is not mutated by a render choice')
  const grain = planBalancedVideoExport({ ...source, effects: [{ kind: 'grain', intensity: 35 }] })
  for (const index of [0, 1]) {
    const chosen = randomizeVideoExportPlan(grain, () => index)
    assert.ok(chosen.qualityNvenc <= 23, 'Do not trade away procedural detail to create variation')
    assert.equal(chosen.peakBitrate, grain.peakBitrate)
  }
  for (const invalid of [-1, 3, .5, NaN]) assert.throws(() => randomizeVideoExportPlan(base, () => invalid), /ngẫu nhiên/)
})

test('all six NVENC quality/GOP choices and both CPU GOPs actually encode with correct frames, quality and GOP', async t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const root = await mkdtemp(join(tmpdir(), 'tedia-random-export-'))
  try {
    const reference = join(root, 'reference.mp4')
    run(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=5', '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv420p', reference])
    const metadata = await probeBurnMedia(reference, ffmpeg)
    const base = planBalancedVideoExport({ width: 160, height: 90, frameRate: 30, videoBitrate: metadata.videoBitrate, videoCodec: metadata.videoCodec })
    const gpu = spawnSync(ffmpeg, ['-v', 'error', '-i', reference, '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', 'NUL'], { windowsHide: true, timeout: 10000 })
    for (const encoder of ['libx264', ...(gpu.status === 0 ? ['h264_nvenc'] : [])]) {
      const qualities = encoder === 'libx264' ? [0] : [0, 1, 2]
      for (const quality of qualities) for (const gop of [0, 1]) {
        const choices = [quality, gop], chosen = randomizeVideoExportPlan(base, () => choices.shift()!)
        const args = balancedVideoEncoderCandidates(chosen, 'win32').find(c => c.ten === encoder)!.args
        const output = join(root, `${encoder}-${quality}-${gop}.mp4`)
        run(['-i', reference, ...args, output])
        const probe = spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=key_frame,pts_time:stream=nb_frames,width,height', '-of', 'json', output], { encoding: 'utf8', windowsHide: true })
        assert.equal(probe.status, 0); const media = JSON.parse(probe.stdout)
        assert.equal(Number(media.streams[0].nb_frames), 150); assert.equal(media.streams[0].width, 160); assert.equal(media.streams[0].height, 90)
        const keyframes = media.frames.filter(f => f.key_frame === 1).map(f => Math.round(Number(f.pts_time) * 30))
        assert.ok(keyframes.length >= 2); for (let i = 1; i < keyframes.length; i++) assert.ok(keyframes[i] - keyframes[i - 1] <= chosen.gopFrames)
        const comparison = spawnSync(ffmpeg, ['-hide_banner', '-i', output, '-i', reference, '-filter_complex', '[0:v][1:v]ssim', '-an', '-f', 'null', 'NUL'], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
        assert.equal(comparison.status, 0, comparison.stderr)
        const ssim = Number(comparison.stderr.match(/All:([\d.]+)/)?.[1]); assert.ok(ssim >= .98, `${encoder}/${chosen.qualityNvenc}/${chosen.gopFrames}: ${ssim}`)
        t.diagnostic(`${encoder}: ${encoder === 'libx264' ? 'CRF' + chosen.qualityX264 : 'CQ' + chosen.qualityNvenc}, GOP${chosen.gopFrames}, 150 frames, keyframes=${keyframes.join(',')}, SSIM=${ssim}`)
      }
    }
    if (gpu.status !== 0) t.diagnostic('Live NVENC unavailable; both CPU GOPs encoded, NVENC variants covered by argument contract')
  } finally { assert.ok(relative(tmpdir(), root).startsWith('tedia-random-export-')); await rm(root, { recursive: true, force: true }) }
})

test('shared asset planning decodes/scales once while preserving ordered RGB pixels, frame count and audio indexing', async t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const root = await mkdtemp(join(tmpdir(), 'tedia-balanced-export-'))
  try {
    const source = join(root, 'source.mp4'), a = join(root, 'a.mp4'), b = join(root, 'b.mp4')
    run(['-f', 'lavfi', '-i', 'color=0x3864A2:s=64x36:r=12:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source])
    run(['-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=12:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', a])
    run(['-f', 'lavfi', '-i', 'color=0x909090:s=64x36:r=24:d=0.5', '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b])
    const effects: VideoEffect[] = [{ kind: 'custom_overlay', assetPath: a, intensity: 50, blendMode: 'screen' },
      { kind: 'custom_overlay', assetPath: b, intensity: 75, layers: [{ assetPath: b, blendMode: 'screen', isStatic: true }, { assetPath: a, blendMode: 'multiply' }] }]
    const planned = planVideoEffectInputs(effects, 1)
    assert.equal(planned.inputArgs.filter(arg => arg === '-i').length, 2)
    assert.deepEqual(planned.mappings.map(m => m.videoInputIndex), [1, 2, 1])
    assert.deepEqual(planVideoEffectInputs(effects, 4).mappings.map(m => m.videoInputIndex), [4, 5, 4], 'Narration/mask/logo indexes remain reserved')
    const differingTiming = planVideoEffectInputs([{ ...effects[1], layers: [{ assetPath: b, blendMode: 'screen', isStatic: true }, { assetPath: b, blendMode: 'multiply' }] }], 1)
    assert.equal(differingTiming.inputArgs.filter(arg => arg === '-i').length, 2, 'Static and dynamic usages of one file have distinct timing')
    const optimized = ['[0:v]null[out]']
    appendVideoEffects(optimized, 64, 36, effects, planned.mappings)
    const original = ['[0:v]null[out]']
    appendVideoEffects(original, 64, 36, effects, [{ effectIndex: 0, videoInputIndex: 1, videoPath: a, blendMode: 'screen' },
      { effectIndex: 1, layerIndex: 0, videoInputIndex: 2, videoPath: b }, { effectIndex: 1, layerIndex: 1, videoInputIndex: 3, videoPath: a }])
    const output = ['-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']
    const cached = run(['-i', source, ...planned.inputArgs, '-filter_complex', optimized.join(';'), '-map', '[out]', ...output])
    const baseline = run(['-i', source, '-stream_loop', '-1', '-i', a, '-stream_loop', '-1', '-i', b, '-stream_loop', '-1', '-i', a,
      '-filter_complex', original.join(';'), '-map', '[out]', ...output])
    assert.equal(cached.length, 64 * 36 * 3 * 24)
    assert.deepEqual(cached, baseline, 'Shared decode/resize must not alter the ordered effect result')
    const metadata = await probeBurnMedia(source, ffmpeg)
    assert.equal(metadata.videoCodec, 'h264')
    assert.ok((metadata.videoBitrate || 0) > 0)
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=bit_rate', '-of', 'json', source], { encoding: 'utf8', windowsHide: true })
    assert.equal(metadata.videoBitrate, Number(JSON.parse(probe.stdout).streams[0].bit_rate))
  } finally {
    assert.ok(relative(tmpdir(), root).startsWith('tedia-balanced-export-'))
    await rm(root, { recursive: true, force: true })
  }
})

test('actual AutoShort exports preserve encoder telemetry and keep CPU preference separate from GPU success cache', async t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const gpu = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=160x90:r=24:d=0.1',
    '-c:v', 'h264_nvenc', '-f', 'null', 'NUL'], { windowsHide: true, timeout: 10000 })
  if (gpu.status !== 0) return t.skip('Live NVENC unavailable; CPU encode is covered separately')
  const root = await mkdtemp(join(tmpdir(), 'tedia-balanced-selection-'))
  resetCachedWorkingEncoder()
  try {
    const still = join(root, 'still.mp4'), motion = join(root, 'motion.mp4'), texture = join(root, 'texture.mp4')
    run(['-f', 'lavfi', '-i', 'color=black:s=16x16:r=24:d=1', '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', texture])
    const videoEffects: VideoEffect[] = [{ kind: 'custom_overlay', intensity: 50, assetPath: texture,
      layers: [{ assetPath: texture, blendMode: 'screen', isStatic: true }] }]
    run(['-f', 'lavfi', '-i', 'testsrc=s=720x1280:r=24:d=1', '-c:v', 'libx264', '-crf', '28', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-metadata', 'comment=SOURCE_METADATA_SENTINEL', still])
    run(['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=24:d=1', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-metadata', 'comment=SOURCE_METADATA_SENTINEL', motion])
    for (const [i, [source, expected]] of [[still, 'libx264'], [motion, 'h264_nvenc'], [still, 'libx264']].entries()) {
      const result = await burnAutoShort({ video: source, mode: 'burn' }, { ffmpegPath: ffmpeg, ffprobePath: ffprobe, videoEffects,
        finalOutputPath: join(root, `${i}.mp4`), itemWorkDir: root, signal: new AbortController().signal,
        expectedMedia: { durationSeconds: 1, frameRate: 24, requireAudio: false, durationToleranceFrames: 3 } }, () => {})
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(result.selectedEncoder, expected)
      assert.equal(result.encoderAttempts?.[0].codec, expected, 'A successful encoder in another preference must not override this choice')
      assert.equal(result.encoderAttempts?.[0].result, 'succeeded')
      const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', result.output!], { encoding: 'utf8', windowsHide: true })
      assert.equal(probe.status, 0)
      const media = JSON.parse(probe.stdout)
      assert.equal(media.format.tags?.comment, undefined, 'The new per-export choice must retain source metadata removal')
      assert.ok(!media.format.tags?.encoder && media.streams.every(stream => !stream.tags?.encoder), 'Container/stream encoder tags remain cleared')
    }
  } finally {
    resetCachedWorkingEncoder()
    assert.ok(relative(tmpdir(), root).startsWith('tedia-balanced-selection-'))
    await rm(root, { recursive: true, force: true })
  }
})
