import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { normalizeVideoEffects, type VideoEffect, type OverlayBlendMode } from '../src/shared/videoEffects'
import { readCapCutPackedAlpha } from '../src/main/capcutPackedAlpha'
import { appendVideoEffects } from '../src/main/videoEffects'
import { getSavedOverlayEffects, resolveOverlayComposition, restoreVideoEffectChromaKeys, saveOverlayToVault } from '../src/main/capcutScanner'
import { burnAutoShort } from '../src/main/burn'

const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros/bin/ffmpeg.exe')
const ffprobe = join(dirname(ffmpeg), 'ffprobe.exe')
function run(args: string[], input?: Buffer): Buffer {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { input, windowsHide: true, timeout: 20000, maxBuffer: 5 * 1024 * 1024 })
  assert.equal(r.status, 0, r.error?.message || r.stderr.toString()); return r.stdout
}
const rgba = ['-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']

test('packed-alpha contract is optional, rejects unknown layouts and conflicting pipelines', () => {
  const old = { kind: 'custom_overlay', intensity: 75, assetPath: 'overlay.mp4', blendMode: 'screen' }
  assert.deepEqual(normalizeVideoEffects([old]), [old])
  assert.equal(normalizeVideoEffects([{ ...old, packedAlpha: 'left' }])?.[0].packedAlpha, 'left')
  for (const packedAlpha of [true, 'right', 'left;movie=secret']) assert.throws(() => normalizeVideoEffects([{ ...old, packedAlpha }]), /alpha/)
  for (const conflict of [{ mattePath: 'mask.mp4' }, { chromaKey: { color: '#00ff00', similarity: .3, blend: .12 } },
    { layers: [{ assetPath: old.assetPath, blendMode: 'screen' }] }, { blendMode: 'chromakey' }]) {
    assert.throws(() => normalizeVideoEffects([{ ...old, packedAlpha: 'left', ...conflict }]), /Alpha/)
  }
})

function packedPixels(alpha: number): Buffer {
  const data = Buffer.alloc(64 * 18 * 4)
  for (let y = 0; y < 18; y++) for (let x = 0; x < 64; x++) {
    const p = (y * 64 + x) * 4
    data[p] = x < 32 ? alpha : 200
    data[p + 1] = x < 32 ? 64 : 160
    data[p + 2] = x < 32 ? 32 : 100
    data[p + 3] = 255
  }
  return data
}

async function fixture(root: string): Promise<{ packageRoot: string; video: string; luaPath: string }> {
  const packageRoot = join(root, 'CapCut/User Data/Cache/effect/123456/abc123'), feature = join(packageRoot, 'AmazingFeature')
  const luaPath = join(feature, 'lua/LumiFamily/LumiExportData.lua')
  const shaderDir = join(feature, 'effects/LumiAnimSeqLoadAndCrop/xshader/shaderLib/shaderGLES')
  await mkdir(dirname(luaPath), { recursive: true }); await mkdir(shaderDir, { recursive: true }); await mkdir(join(feature, 'resource/video'), { recursive: true })
  const video = join(feature, 'resource/video/overlay.mp4')
  run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '64x18', '-r', '12', '-i', 'pipe:0', '-c:v', 'libx264', '-crf', '0', '-pix_fmt', 'yuv420p', video], Buffer.concat(Array(12).fill(packedPixels(128))))
  await writeFile(join(feature, 'main.scene'), 'resource/video/overlay.mp4')
  await writeFile(luaPath, `local ae_attribute = {
    ['LumiAnimSeqLoadAndCrop_489-effect0'] = { ['specify_1_1'] = true, ['animSeqType_1_1'] = 0, ['enableVideoAlphaBlend_1_1'] = true, ['specify_9_16'] = false, ['enableVideoAlphaBlend_9_16'] = false, },
    ['LumiLayer_489-blend'] = { ['hasBlend'] = true, ['hasMatte'] = false, ['blendMode'] = 2, },
  }
  data.ae_attribute = ae_attribute`)
  await writeFile(join(shaderDir, 'crop.frag'), 'uniform int u_convertAlpha; alpha=texture2D(u_seqTexture,vec2(uv.x*0.5,uv.y)).x; rgb=texture2D(u_seqTexture,vec2((uv.x*0.5)+0.5,uv.y)).xyz;')
  return { packageRoot, video, luaPath }
}

test('Lumi metadata and shader bindings identify alpha-left/RGB-right, not filename or dimensions', async t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const root = await mkdtemp(join(tmpdir(), 'tedia-packed-metadata-'))
  try {
    const { packageRoot, video, luaPath } = await fixture(root)
    assert.deepEqual(await readCapCutPackedAlpha(packageRoot, video), { packedAlpha: 'left', blendMode: 'multiply' })
    assert.equal(await readCapCutPackedAlpha(packageRoot, join(root, 'unrelated.mp4')), undefined)
    const lua = await readFile(luaPath, 'utf8')
    for (const [index, blendMode] of [[0, 'alphamerge'], [1, 'add'], [12, 'screen']] as const) {
      await writeFile(luaPath, lua.replace("['blendMode'] = 2", `['blendMode'] = ${index}`))
      assert.equal((await readCapCutPackedAlpha(packageRoot))?.blendMode, blendMode)
    }
    for (const changed of [lua.replace("['enableVideoAlphaBlend_1_1'] = true", "['enableVideoAlphaBlend_1_1'] = false"),
      lua.replace("['blendMode'] = 2", "['blendMode'] = 4"),
      lua.replace("['specify_9_16'] = false", "['specify_9_16'] = true")]) {
      await writeFile(luaPath, changed); assert.equal(await readCapCutPackedAlpha(packageRoot), undefined)
    }
    await writeFile(luaPath, lua)
    await writeFile(join(packageRoot, 'AmazingFeature/main.scene'), 'resource/video/overlay.mp4 resource/video/other.mp4')
    assert.equal(await readCapCutPackedAlpha(packageRoot), undefined, 'Ambiguous resource bindings must not guess')
  } finally { assert.ok(relative(tmpdir(), root).startsWith('tedia-packed-metadata-')); await rm(root, { recursive: true, force: true }) }
})

test('actual inspected Overlay package has embedded alpha and native Multiply mode', async t => {
  const root = join(process.env.LOCALAPPDATA || '', 'CapCut/User Data/Cache/effect/7620270556557921589/6cb91fa515cd8b6854c46673ba32e0cc')
  if (!existsSync(root)) return t.skip('Real Overlay package unavailable')
  assert.deepEqual(await readCapCutPackedAlpha(root), { packedAlpha: 'left', blendMode: 'multiply' })
})

test('FFmpeg unpacking preserves all pixels across the frame, red-channel alpha, blend modes, intensity and EOF', async t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const root = await mkdtemp(join(tmpdir(), 'tedia-packed-pixels-'))
  try {
    const source = ['-f', 'lavfi', '-i', 'color=0x3864A2:s=32x18:r=3:d=1']
    const base = run([...source, ...rgba])
    for (const alpha of [0, 128, 255]) {
      const png = join(root, `${alpha}.png`)
      run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '64x18', '-i', 'pipe:0', '-frames:v', '1', png], packedPixels(alpha))
      for (const mode of ['alphamerge', 'multiply', 'screen', 'add'] as OverlayBlendMode[]) for (const intensity of [25, 100]) {
        const graph = ['[0:v]null[out]'], effect: VideoEffect = { kind: 'custom_overlay', assetPath: png, packedAlpha: 'left', blendMode: mode, intensity }
        appendVideoEffects(graph, 32, 18, [effect], [{ effectIndex: 0, videoInputIndex: 1, videoPath: png, blendMode: mode }])
        const pixels = run([...source, '-loop', '1', '-framerate', '3', '-i', png, '-filter_complex', graph.join(';'), '-map', '[out]', ...rgba])
        assert.equal(pixels.length, base.length, 'Primary frames/EOF control output')
        const s = alpha / 255 * intensity / 100
        for (let p = 0; p < pixels.length; p += 4) for (const [c, texture] of [200, 160, 100].entries()) {
          const a = base[p + c]
          const expected = mode === 'alphamerge' ? a * (1 - s) + texture * s : mode === 'multiply' ? a * (1 - s + s * texture / 255) :
            mode === 'screen' ? a + (255 - a) * texture / 255 * s : Math.min(255, a + texture * s)
          assert.ok(Math.abs(pixels[p + c] - expected) <= 3, `${mode}/${alpha}/${intensity} at ${p + c}: ${pixels[p + c]} != ${expected}`)
        }
      }
    }
    const portraitGraph = ['[0:v]null[out]'], portrait = ['-f', 'lavfi', '-i', 'color=0x3864A2:s=18x32:r=3:d=1']
    const portraitBase = run([...portrait, ...rgba]), png = join(root, '128.png')
    appendVideoEffects(portraitGraph, 18, 32, [{ kind: 'custom_overlay', assetPath: png, packedAlpha: 'left', blendMode: 'multiply', intensity: 75 }],
      [{ effectIndex: 0, videoInputIndex: 1, videoPath: png }])
    const portraitPixels = run([...portrait, '-loop', '1', '-framerate', '3', '-i', png, '-filter_complex', portraitGraph.join(';'), '-map', '[out]', ...rgba])
    assert.equal(portraitPixels.length, portraitBase.length)
    for (let p = 0; p < portraitPixels.length; p += 4) for (const [c, texture] of [200, 160, 100].entries()) {
      const s = 128 / 255 * .75, expected = portraitBase[p + c] * (1 - s + s * texture / 255)
      assert.ok(Math.abs(portraitPixels[p + c] - expected) <= 3, 'Unpack before portrait fill/crop, without a center seam')
    }
  } finally { assert.ok(relative(tmpdir(), root).startsWith('tedia-packed-pixels-')); await rm(root, { recursive: true, force: true }) }
})

test('legacy selection and vault migrate alpha metadata; actual export retains audio, frames and offline layout', async t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const root = await mkdtemp(join(tmpdir(), 'tedia-packed-vault-'))
  const oldLocal = process.env.LOCALAPPDATA, oldProfile = process.env.TEDIAPROS_TEST_USER_DATA
  try {
    process.env.LOCALAPPDATA = root; process.env.TEDIAPROS_TEST_USER_DATA = join(root, 'profile')
    const { packageRoot, video } = await fixture(root)
    const legacy: VideoEffect = { kind: 'custom_overlay', assetPath: video, blendMode: 'screen', intensity: 75, sourceType: 'capcut' }
    const [restored] = (await restoreVideoEffectChromaKeys([legacy]))!
    assert.equal(restored.packedAlpha, 'left'); assert.equal(restored.blendMode, 'multiply'); assert.equal(restored.intensity, 75)
    const saved = await saveOverlayToVault({ id: '123456_abc123', name: 'Overlay', folderPath: packageRoot, videoPath: video, blendMode: 'screen', isPro: false, aspectRatio: 'unknown' })
    assert.equal(saved.packedAlpha, 'left'); assert.equal(saved.blendMode, 'multiply')
    const metaPath = join(dirname(saved.videoPath), 'metadata.json'), meta = JSON.parse(await readFile(metaPath, 'utf8'))
    delete meta.packedAlpha; meta.blendMode = 'screen'; await writeFile(metaPath, JSON.stringify(meta))
    assert.deepEqual(await resolveOverlayComposition(saved.videoPath), { packedAlpha: 'left', blendMode: 'multiply' })
    assert.equal(JSON.parse(await readFile(metaPath, 'utf8')).packedAlpha, 'left')
    await rm(join(root, 'CapCut'), { recursive: true, force: true })
    assert.equal((await getSavedOverlayEffects())[0].packedAlpha, 'left', 'Vault must not depend on original cache after migration')
    const source = join(root, 'source.mp4'), output = join(root, 'result.mp4')
    run(['-f', 'lavfi', '-i', 'color=0x3864A2:s=160x90:r=12:d=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source])
    const res = await burnAutoShort({ video: source, mode: 'burn' }, { videoEffects: [{ ...legacy, assetPath: saved.videoPath, sourceType: 'saved' }],
      ffmpegPath: ffmpeg, ffprobePath: ffprobe, finalOutputPath: output, itemWorkDir: root, signal: new AbortController().signal,
      expectedMedia: { durationSeconds: 2, frameRate: 12, requireAudio: true, durationToleranceFrames: 3 } }, () => {})
    assert.equal(res.ok, true, JSON.stringify(res))
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', output], { windowsHide: true, encoding: 'utf8' })
    assert.equal(probe.status, 0); const streams = JSON.parse(probe.stdout).streams
    assert.equal(Number(streams.find(s => s.codec_type === 'video').nb_frames), 24)
    assert.ok(streams.some(s => s.codec_type === 'audio')); run(['-i', output, '-f', 'null', 'NUL'])
    assert.equal(existsSync(output + '.partial'), false)
  } finally {
    if (oldLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = oldLocal
    if (oldProfile === undefined) delete process.env.TEDIAPROS_TEST_USER_DATA; else process.env.TEDIAPROS_TEST_USER_DATA = oldProfile
    assert.ok(relative(tmpdir(), root).startsWith('tedia-packed-vault-')); await rm(root, { recursive: true, force: true })
  }
})
