import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { normalizeVideoEffects, type VideoEffect } from '../src/shared/videoEffects'
import { compileRgbTextureOverlay, compositeRgbTextures, blendRgbChannel } from '../src/shared/overlayCompositing'
import { appendVideoEffects, planVideoEffectInputs } from '../src/main/videoEffects'
import { readCapCutTextureLayout, synthesizeCapCutTextureLayers } from '../src/main/capcutTextureLayers'
import { getGeneratedEffectCacheDir, getSavedOverlayEffects, restoreVideoEffectChromaKeys, saveOverlayToVault, scanCapCutEffects } from '../src/main/capcutScanner'

const ffmpeg = process.env.TEDIAPROS_TEST_FFMPEG || join(process.env.APPDATA || '', 'tedia-pros/bin/ffmpeg.exe')
function run(args: string[], input?: Buffer): Buffer {
  const result = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { input, windowsHide: true, timeout: 20000, maxBuffer: 5 * 1024 * 1024 })
  assert.equal(result.status, 0, result.error?.message || result.stderr.toString())
  return result.stdout
}
const rgbaOutput = ['-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1']

test('layer contract rejects invalid filters, excessive passes and incompatible key/matte; old configs stay unchanged', () => {
  const effect: VideoEffect = { kind: 'custom_overlay', intensity: 75, assetPath: 'a.mp4', layers: [
    { assetPath: 'a.mp4', blendMode: 'screen' }, { assetPath: 'b.mp4', blendMode: 'multiply' }
  ] }
  assert.deepEqual(normalizeVideoEffects([effect])?.[0], effect)
  for (const layers of [[], Array(5).fill(effect.layers![0]), [{ assetPath: 'x\0', blendMode: 'screen' }], [{ assetPath: 'a.mp4', blendMode: 'screen;movie=secret' }]]) {
    assert.throws(() => normalizeVideoEffects([{ ...effect, layers }]))
  }
  assert.throws(() => normalizeVideoEffects([{ ...effect, mattePath: 'mask.mp4' }]))
  assert.throws(() => normalizeVideoEffects([{ ...effect, assetPath: 'different.mp4' }]))
  const old = { kind: 'custom_overlay', intensity: 20, assetPath: 'old.mp4', blendMode: 'screen' }
  assert.deepEqual(normalizeVideoEffects([old]), [old])
  assert.throws(() => normalizeVideoEffects([{ ...effect, layers: [{ ...effect.layers![0], isStatic: 'true' }] }]), /texture/)
  assert.equal(normalizeVideoEffects([{ ...effect, layers: [{ ...effect.layers![0], isStatic: true }] }])?.[0].layers?.[0].isStatic, true)
})

test('compiled preview layers match a full ordered stack mixed once with the original RGB', () => {
  const textures = [
    { pixels: new Uint8ClampedArray([12, 60, 120, 255, 0, 0, 0, 255, 255, 255, 255, 255]), blendMode: 'screen' as const },
    { pixels: new Uint8ClampedArray([220, 200, 160, 255, 255, 255, 255, 255, 128, 128, 128, 255]), blendMode: 'multiply' as const }
  ]
  for (const intensity of [0, 25, 75, 100]) for (const color of [0, 32, 128, 255]) {
    const source = new Uint8ClampedArray([color, 100, 200, 255, color, color, color, 255, color, color, color, 255])
    const expected = new Uint8ClampedArray(source)
    compositeRgbTextures(expected, textures, intensity)
    const multiply = new Uint8ClampedArray(source.length), screen = new Uint8ClampedArray(source.length)
    compileRgbTextureOverlay(textures, intensity, multiply, screen)
    for (let p = 0; p < source.length; p += 4) for (let c = 0; c < 3; c++) {
      const result = blendRgbChannel(blendRgbChannel(source[p + c], multiply[p + c], 'multiply'), screen[p + c], 'screen')
      assert.ok(Math.abs(result - expected[p + c]) <= 2, 'Preview must apply intensity to the group, not separately to each pass')
    }
  }
})

test('FFmpeg retains ordered layers, original color and whole-effect intensity; matte strength is applied', t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const source = ['-f', 'lavfi', '-i', 'color=0x3864A2:s=32x18:r=3:d=1']
  const a = ['-f', 'lavfi', '-i', 'color=0x202020:s=32x18:r=3:d=2']
  const b = ['-f', 'lavfi', '-i', 'color=0xD0D0D0:s=32x18:r=3:d=2']
  const pixels = (args: string[]) => new Uint8ClampedArray(run([...args, ...rgbaOutput]))
  const base = pixels(source), ta = pixels([...a, '-frames:v', '3']), tb = pixels([...b, '-frames:v', '3'])
  for (const intensity of [25, 100]) {
    const effect: VideoEffect = { kind: 'custom_overlay', assetPath: 'a.mp4', intensity, layers: [
      { assetPath: 'a.mp4', blendMode: 'screen' }, { assetPath: 'b.mp4', blendMode: 'multiply' }
    ] }
    const graph = ['[0:v]null[out]']
    appendVideoEffects(graph, 32, 18, [effect], [
      { effectIndex: 0, layerIndex: 0, videoInputIndex: 1, videoPath: 'a.mp4' },
      { effectIndex: 0, layerIndex: 1, videoInputIndex: 2, videoPath: 'b.mp4' }
    ])
    const actual = pixels([...source, ...a, ...b, '-filter_complex', graph.join(';'), '-map', '[out]'])
    const expected = new Uint8ClampedArray(base)
    compositeRgbTextures(expected, [{ pixels: ta, blendMode: 'screen' }, { pixels: tb, blendMode: 'multiply' }], intensity)
    assert.equal(actual.length, base.length)
    for (let p = 0; p < actual.length; p++) assert.ok(Math.abs(actual[p] - expected[p]) <= 3, `Layer mismatch at ${p}`)
    assert.throws(() => appendVideoEffects(['[0:v]null[out]'], 32, 18, [effect], []), /Thiếu/)
  }
  const matteResult = (intensity: number) => {
    const graph = ['[0:v]null[out]']
    appendVideoEffects(graph, 32, 18, [{ kind: 'custom_overlay', intensity, assetPath: 'a.mp4', mattePath: 'b.mp4', blendMode: 'alphamerge' }],
      [{ effectIndex: 0, videoInputIndex: 1, matteInputIndex: 2, videoPath: 'a.mp4' }])
    return pixels([...source, '-f', 'lavfi', '-i', 'color=white:s=32x18:r=3:d=2', '-f', 'lavfi', '-i', 'color=white:s=32x18:r=3:d=2',
      '-filter_complex', graph.join(';'), '-map', '[out]'])
  }
  assert.ok(matteResult(25)[0] < matteResult(100)[0] - 100, 'Matte must honor the intensity slider')
  const addGraph = ['[0:v]null[out]']
  appendVideoEffects(addGraph, 32, 18, [{ kind: 'custom_overlay', intensity: 25, assetPath: 'a.mp4', blendMode: 'add' }],
    [{ effectIndex: 0, videoInputIndex: 1, videoPath: 'a.mp4', blendMode: 'add' }])
  const added = pixels([...source, ...b, '-filter_complex', addGraph.join(';'), '-map', '[out]'])
  for (let p = 0; p < added.length; p += 4) for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(added[p + c] - Math.min(255, base[p + c] + tb[p + c] * .25)) <= 3, 'Add intensity must match CSS plus-lighter')
  }
})

async function fixture(root: string): Promise<string> {
  const packageRoot = join(root, 'CapCut/User Data/Cache/effect/123456/abc123')
  const feature = join(packageRoot, 'amazingfeature')
  for (const folder of ['xshader', 'material', 'seq', 'atlas', 'image']) await mkdir(join(feature, folder), { recursive: true })
  await writeFile(join(packageRoot, 'config.json'), JSON.stringify({ name: 'Nhiễu 2' }))
  await writeFile(join(feature, 'main.scene'), 'material/pass1.material seq/a0.seq material/pass2.material seq/b0.seq')
  for (const [i, mode] of ['Screen', 'Multiply'].entries()) {
    await writeFile(join(feature, `xshader/pass${i + 1}.frag`), `#define BLEND_MODE blend${mode}\nlm_inverse_premult sucaiAlign`)
    await writeFile(join(feature, `material/pass${i + 1}.material`), i === 0 ? 'share://input.texture' : 'rt/midTex.rt')
  }
  await writeFile(join(feature, 'seq/a0.seq'), 'atlas/a0.imageatlas atlas/a1.imageatlas')
  await writeFile(join(feature, 'seq/b0.seq'), 'atlas/b0.imageatlas')
  for (const [name, rgb, alpha] of [['a0', 20, 255], ['a1', 40, 255], ['b0', 200, 128]] as const) {
    await writeFile(join(feature, `atlas/${name}.imageatlas`), `image/${name}.png`)
    const data = Buffer.alloc(16 * 8 * 4)
    for (let p = 0; p < data.length; p += 4) { data[p] = data[p + 1] = data[p + 2] = rgb; data[p + 3] = alpha }
    run(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '16x8', '-i', 'pipe:0', '-frames:v', '1', join(feature, `image/${name}.png`)], data)
  }
  return packageRoot
}

test('metadata-driven textures preserve PNG alpha, exact frames, cache reuse, invalidation, vault and cancellation', async t => {
  if (!existsSync(ffmpeg)) return t.skip('FFmpeg unavailable')
  const root = await mkdtemp(join(tmpdir(), 'tedia-layer-fixture-'))
  const oldLocal = process.env.LOCALAPPDATA, oldProfile = process.env.TEDIAPROS_TEST_USER_DATA
  try {
    process.env.LOCALAPPDATA = root; process.env.TEDIAPROS_TEST_USER_DATA = join(root, 'profile')
    const packageRoot = await fixture(root), cache = getGeneratedEffectCacheDir()
    const layout = await readCapCutTextureLayout(packageRoot)
    assert.deepEqual(layout?.map(layer => [layer.blendMode, layer.frames.length]), [['screen', 2], ['multiply', 1]])
    const first = (await synthesizeCapCutTextureLayers(packageRoot, cache, ffmpeg))!
    assert.equal(first[0].isStatic, undefined)
    assert.equal(first[1].isStatic, true, 'A one-frame texture is safe to prepare outside the frame loop')
    const mtimes = await Promise.all(first.map(layer => stat(layer.assetPath).then(s => s.mtimeMs)))
    assert.deepEqual(await synthesizeCapCutTextureLayers(packageRoot, cache, 'missing-ffmpeg'), first, 'Warm cache must not launch a native helper')
    assert.deepEqual(await Promise.all(first.map(layer => stat(layer.assetPath).then(s => s.mtimeMs))), mtimes)
    const screen = run(['-i', first[0].assetPath, ...rgbaOutput])
    assert.equal(screen.length, 16 * 8 * 4 * 2, 'Each input sequence frame appears once')
    const multiply = run(['-i', first[1].assetPath, ...rgbaOutput])
    assert.ok(Math.abs(multiply[0] - 227) <= 2, 'Alpha 128 must flatten gray 200 over white, not be discarded')
    const mappings = planVideoEffectInputs([{ kind: 'custom_overlay', intensity: 75, assetPath: first[0].assetPath, layers: first }], 3).mappings
    assert.deepEqual(mappings.map(m => [m.layerIndex, m.videoInputIndex]), [[0, 3], [1, 4]])
    await writeFile(join(packageRoot, 'amazingfeature/image/a0.png'), await readFile(join(packageRoot, 'amazingfeature/image/a1.png')))
    const changed = (await synthesizeCapCutTextureLayers(packageRoot, cache, ffmpeg))!
    assert.notEqual(changed[0].assetPath, first[0].assetPath, 'Changed source pixels invalidate cached textures')
    assert.ok(!(await readdir(cache)).some(name => name.endsWith('.txt') || name.endsWith('.tmp')))
    const shaderPath = join(packageRoot, 'amazingfeature/xshader/pass2.frag')
    const shader = await readFile(shaderPath)
    await writeFile(shaderPath, '#define BLEND_MODE blendUnsupported\nlm_inverse_premult sucaiAlign')
    assert.equal(await readCapCutTextureLayout(packageRoot), undefined, 'Unsupported shaders must not be guessed')
    await writeFile(shaderPath, shader)
    const atlasPath = join(packageRoot, 'amazingfeature/atlas/b0.imageatlas')
    const atlas = await readFile(atlasPath)
    await writeFile(atlasPath, 'image/../../outside.png')
    assert.equal(await readCapCutTextureLayout(packageRoot), undefined, 'External atlas paths must not be followed')
    await writeFile(atlasPath, atlas)
    await writeFile(join(packageRoot, 'effect.mp4'), 'legacy video placeholder')
    const [scanned] = await scanCapCutEffects()
    assert.equal(scanned.layers?.length, 2)
    assert.notEqual(scanned.videoPath, join(packageRoot, 'effect.mp4'), 'Compatible shader metadata takes precedence over a raw MP4')
    const saved = await saveOverlayToVault(scanned)
    assert.equal(saved.layers?.length, 2)
    assert.equal(saved.layers?.[1].isStatic, true)
    const metadataPath = join(dirname(saved.videoPath), 'metadata.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
    delete metadata.layers
    await writeFile(metadataPath, JSON.stringify(metadata))
    const restored = (await restoreVideoEffectChromaKeys([{ kind: 'custom_overlay', intensity: 37, assetPath: saved.videoPath, sourceType: 'saved', blendMode: 'screen' }]))![0]
    assert.equal(restored.layers?.length, 2)
    assert.equal(restored.intensity, 37)
    assert.equal(JSON.parse(await readFile(metadataPath, 'utf8')).layers.length, 2, 'Migration must persist for offline reuse')
    const migrated = await readFile(metadataPath, 'utf8')
    const badMeta = JSON.parse(migrated)
    badMeta.layers[1].videoFile = '../outside.mp4'
    await writeFile(join(dirname(dirname(saved.videoPath)), 'outside.mp4'), 'outside item')
    await writeFile(metadataPath, JSON.stringify(badMeta))
    assert.equal((await getSavedOverlayEffects()).length, 0, 'A path escaping the vault item must reject the whole composition')
    await writeFile(metadataPath, migrated)
    await rm(join(root, 'CapCut'), { recursive: true, force: true })
    await rm(cache, { recursive: true, force: true })
    assert.equal((await getSavedOverlayEffects())[0].layers?.length, 2, 'Vault survives both source and converted-cache removal')
    const abort = new AbortController(); abort.abort()
    await assert.rejects(synthesizeCapCutTextureLayers(packageRoot, cache, ffmpeg, abort.signal), /huỷ/)
  } finally {
    if (oldLocal === undefined) delete process.env.LOCALAPPDATA; else process.env.LOCALAPPDATA = oldLocal
    if (oldProfile === undefined) delete process.env.TEDIAPROS_TEST_USER_DATA; else process.env.TEDIAPROS_TEST_USER_DATA = oldProfile
    assert.ok(relative(tmpdir(), root).startsWith('tedia-layer-fixture-'))
    await rm(root, { recursive: true, force: true })
  }
})
