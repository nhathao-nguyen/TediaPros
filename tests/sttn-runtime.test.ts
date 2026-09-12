import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { getSttnReadiness, installSttnModel, verifySttnModelFile } from '../src/main/inpainting/assets'
import { runSttnCommand, runSttnRemoval } from '../src/main/inpainting/runner'
import { deriveCanonicalDisplayGeometry } from '../src/main/canonicalDisplayGeometry'
import { stabilizeSingleSampleGaps, type OcrVisualTimeline } from '../src/shared/ocrVisualTimeline'
import { validateRuntimeDistributionManifest } from '../src/main/runtimeManifest'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed = false
  kill(): boolean { this.killed = true; return true }
}

test('STTN assets report two missing dependencies without making network requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sttn-missing-'))
  const previous = process.env.TEDIAPROS_TEST_USER_DATA
  process.env.TEDIAPROS_TEST_USER_DATA = root
  try {
    const deps = await getSttnReadiness()
    assert.deepEqual(deps.map(d => [d.id, d.ready]), [['sttn-engine', false], ['sttn-model', false]])
  } finally { process.env.TEDIAPROS_TEST_USER_DATA = previous; await rm(root, { recursive: true, force: true }) }
})

test('model installer rejects corrupt bytes and leaves existing file intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sttn-model-'))
  const target = join(root, 'sttn.pth')
  await writeFile(target, 'original')
  const spec = { bytes: 3, sha256: createHash('sha256').update('yes').digest('hex'), url: 'https://example.test/sttn.pth' }
  try {
    await assert.rejects(installSttnModel(() => {}, undefined, { targetPath: target, spec, fetch: async () => new Response('bad') }), /SHA-256/)
    assert.equal(await readFile(target, 'utf8'), 'original')
    assert.deepEqual(await readdir(root), ['sttn.pth'])
    await assert.rejects(verifySttnModelFile(target, spec), /size|kích thước/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('model installer promotes verified data and can reuse it offline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sttn-good-'))
  const target = join(root, 'sttn.pth')
  const spec = { bytes: 3, sha256: createHash('sha256').update('yes').digest('hex'), url: 'https://example.test/sttn.pth' }
  try {
    await installSttnModel(() => {}, undefined, { targetPath: target, spec, fetch: async () => new Response('yes') })
    assert.equal(await readFile(target, 'utf8'), 'yes')
    await installSttnModel(() => {}, undefined, { targetPath: target, spec, fetch: async () => { throw new Error('offline') } })
    assert.deepEqual(await readdir(root), ['sttn.pth'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('model cancellation drains download and cleans partial files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sttn-cancel-'))
  const controller = new AbortController()
  const spec = { bytes: 3, sha256: createHash('sha256').update('yes').digest('hex'), url: 'https://example.test/sttn.pth' }
  try {
    await assert.rejects(installSttnModel(progress => { if (progress.receivedBytes) controller.abort() }, controller.signal, { targetPath: join(root, 'sttn.pth'), spec, fetch: async () => new Response('yes') }), /abort/i)
    assert.deepEqual(await readdir(root), [])
    await assert.rejects(getSttnReadiness(controller.signal), /abort/i)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('worker cancellation kills the tree and waits for close', async () => {
  const child = new FakeChild()
  const controller = new AbortController()
  let settled = false
  const promise = runSttnCommand({ executablePath: process.execPath, args: ['--version'], expectedEvent: 'version', signal: controller.signal, spawnChild: (() => child) as unknown as typeof spawn }).finally(() => { settled = true })
  controller.abort()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(child.killed, true)
  assert.equal(settled, false)
  child.emit('close', 1)
  await assert.rejects(promise, /hủy|abort/i)
})

test('worker never treats done then nonzero exit as success or retries provider', async () => {
  const child = new FakeChild()
  let spawns = 0
  const promise = runSttnCommand({ executablePath: process.execPath, args: [], expectedEvent: 'done', spawnChild: (() => { spawns++; return child }) as unknown as typeof spawn })
  child.stdout.emit('data', Buffer.from('{"type":"done","outputPath":"out","provider":"cuda","elapsedMs":1}\n'))
  child.emit('close', 2)
  await assert.rejects(promise, /exit 2/)
  assert.equal(spawns, 1)
})

test('worker rejects oversized JSON and waits for close before rejecting', async () => {
  const child = new FakeChild()
  let settled = false
  const promise = runSttnCommand({ executablePath: process.execPath, args: [], expectedEvent: 'done', spawnChild: (() => child) as unknown as typeof spawn }).finally(() => { settled = true })
  child.stdout.emit('data', Buffer.from('x'.repeat(70 * 1024)))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(settled, false)
  assert.equal(child.killed, true)
  child.emit('close', 1)
  await assert.rejects(promise, /limit|giới hạn/i)
})

test('worker validates protocol and handles final JSON without newline', async () => {
  const child = new FakeChild()
  const promise = runSttnCommand({ executablePath: process.execPath, args: [], expectedEvent: 'version', spawnChild: (() => child) as unknown as typeof spawn })
  child.stdout.emit('data', Buffer.from('{"type":"version","protocol":"sttn-engine/1","engine":"sttn","version":"1.0.0"}'))
  child.emit('close', 0)
  assert.equal((await promise).version, '1.0.0')
})

test('distribution manifests accept optional STTN and old manifests without it', async () => {
  const { validateRuntimeReleaseManifest } = await import('../scripts/verify-runtime-release.mjs')
  const asset = { version: '1.0.0', platform: 'win32', arch: 'x64', asset: 'sttn.zip', sha256: 'a'.repeat(64), bytes: 1, entrypoint: 'sttn-engine.exe', files: ['sttn-engine.exe'], capabilities: ['cpu'], protocol: 'sttn-engine/1' }
  assert.equal(validateRuntimeDistributionManifest({ schemaVersion: 1, runtimeVersion: 'test', platform: 'win32', arch: 'x64', assets: { 'sttn-engine': asset } }).ok, true)
  assert.equal(validateRuntimeReleaseManifest({ schemaVersion: 1, runtimeVersion: 'test', platform: 'win32', arch: 'x64', assets: { 'sttn-engine': asset } }), null)
  assert.equal(validateRuntimeDistributionManifest({ schemaVersion: 1, runtimeVersion: 'test', platform: 'win32', arch: 'x64', assets: { 'ocr-engine': { ...asset, protocol: 'ocr-local/1' } } }).ok, true)
})

test('worker timeout and malformed protocol reject after process close', async () => {
  const child = new FakeChild()
  const promise = runSttnCommand({ executablePath: process.execPath, args: [], expectedEvent: 'version', timeoutMs: 5, spawnChild: (() => child) as unknown as typeof spawn })
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.equal(child.killed, true)
  child.emit('close', 1)
  await assert.rejects(promise, /timeout/)
  const wrong = new FakeChild()
  const wrongPromise = runSttnCommand({ executablePath: process.execPath, args: [], expectedEvent: 'version', spawnChild: (() => wrong) as unknown as typeof spawn })
  wrong.stdout.emit('data', Buffer.from('{"type":"version","protocol":"sttn-engine/2"}\n'))
  wrong.emit('close', 0)
  await assert.rejects(wrongPromise, /protocol/)
})

test('removal contains request/output, preserves source and cleans worker files on success and escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sttn-removal-'))
  const source = join(root, 'source.mkv')
  const output = join(root, 'result.mkv')
  await writeFile(source, 'source untouched')
  const geometry = deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 100, sampleAspectRatio: '1:1', rotation: 0, videoStart: 0 })
  const timeline: OcrVisualTimeline = { schemaVersion: 1, protocol: 'ocr-visual-cues/1', profile: 'accurate', video: { width: 100, height: 100, durationSeconds: 1, sampleFps: 8, frameCount: 8, geometryFingerprint: geometry.fingerprint }, scanRegion: { x0: 0, y0: 0, x1: 100, y1: 100 }, segments: [] }
  const input = { videoPath: source, outputPath: output, timeline, ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', signal: new AbortController().signal, previewSeconds: 1 }
  let escape = false
  const hooks = { resolveEngine: async () => 'engine', resolveModel: async () => 'model', command: async (request: Parameters<typeof runSttnCommand>[0]): Promise<Record<string, unknown>> => {
    if (request.expectedEvent === 'media') return { streams: [{ codec_type: 'video', width: 100, height: 100, duration: '1' }], format: { duration: '1' } }
    const job = JSON.parse(await readFile(request.args[2], 'utf8'))
    assert.equal(job.provider, 'auto')
    assert.equal(job.maxFrames, 12)
    assert.equal(job.previewSeconds, 1)
    assert.equal(JSON.parse(await readFile(job.timelinePath, 'utf8')).video.geometryFingerprint, geometry.fingerprint)
    await writeFile(job.outputPath, 'cleaned media')
    return { type: 'done', outputPath: escape ? source : job.outputPath, provider: 'cuda', elapsedMs: 123 }
  } }
  try {
    const result = await runSttnRemoval(input, hooks)
    assert.equal(result.outputPath, output)
    assert.equal(result.provider, 'cuda')
    assert.equal(await readFile(output, 'utf8'), 'cleaned media')
    assert.equal(await readFile(source, 'utf8'), 'source untouched')
    assert.deepEqual((await readdir(root)).sort(), ['result.mkv', 'source.mkv'])
    await assert.rejects(runSttnRemoval(input, hooks), /tồn tại/)
    escape = true
    await assert.rejects(runSttnRemoval({ ...input, outputPath: join(root, 'escape.mkv') }, hooks), /output/)
    assert.deepEqual((await readdir(root)).sort(), ['result.mkv', 'source.mkv'])
    await assert.rejects(runSttnRemoval({ ...input, outputPath: join(root, 'geometry.mkv'), timeline: { ...timeline, video: { ...timeline.video, width: 101 } } }, hooks), /width/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('removal accepts the canonical synthetic gap emitted by OCR stabilization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sttn-stabilized-gap-'))
  const source = join(root, 'source.mkv')
  const output = join(root, 'result.mkv')
  await writeFile(source, 'source untouched')
  const geometry = deriveCanonicalDisplayGeometry({ codedWidth: 100, codedHeight: 100, sampleAspectRatio: '1:1', rotation: 0, videoStart: 0 })
  const rawTimeline: OcrVisualTimeline = {
    schemaVersion: 1,
    protocol: 'ocr-visual-cues/1',
    profile: 'accurate',
    video: { width: 100, height: 100, durationSeconds: 1, sampleFps: 8, frameCount: 8, geometryFingerprint: geometry.fingerprint },
    scanRegion: { x0: 0, y0: 0, x1: 100, y1: 100 },
    segments: [
      {
        id: 'accurate-1', startFrame: 1, endFrameExclusive: 2,
        start: 0.125, end: 0.25, text: 'hello', confidence: 0.9,
        boxes: [{ text: 'hello', confidence: 0.9, x0: 10, y0: 10, x1: 40, y1: 30 }]
      },
      {
        id: 'accurate-3', startFrame: 3, endFrameExclusive: 4,
        start: 0.375, end: 0.5, text: 'Hello ', confidence: 0.85,
        boxes: [{ text: 'Hello ', confidence: 0.85, x0: 12, y0: 10, x1: 42, y1: 30 }]
      }
    ]
  }
  const timeline = stabilizeSingleSampleGaps(rawTimeline)
  assert.equal(timeline.segments[1].id, 'gap-2-accurate-1-accurate-3')

  const hooks = {
    resolveEngine: async () => 'engine',
    resolveModel: async () => 'model',
    command: async (request: Parameters<typeof runSttnCommand>[0]): Promise<Record<string, unknown>> => {
      if (request.expectedEvent === 'media') {
        return { streams: [{ codec_type: 'video', width: 100, height: 100, duration: '1' }], format: { duration: '1' } }
      }
      const job = JSON.parse(await readFile(request.args[2], 'utf8'))
      await writeFile(job.outputPath, 'cleaned media')
      return { type: 'done', outputPath: job.outputPath, provider: 'cuda', elapsedMs: 123 }
    }
  }

  try {
    const result = await runSttnRemoval({
      videoPath: source,
      outputPath: output,
      timeline,
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      signal: new AbortController().signal
    }, hooks)
    assert.equal(result.outputPath, output)
    assert.equal(await readFile(output, 'utf8'), 'cleaned media')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
