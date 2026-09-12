import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createAutoShortItemProcessor, type AutoShortItemCoordinatorDeps } from '../src/main/autoShortItemCoordinator'
import { getAutoShortReadiness, installAutoShortDependencies, runAutoShortSttnPreview } from '../src/main/autoshort'
import { AutoShortArtifactCache } from '../src/main/autoShortArtifactCache'
import type { AutoShortConfig, OcrVisualTimeline } from '../src/shared/types'

const geometry = { codedWidth: 1280, codedHeight: 720, rotation: 0 as const, sampleAspectRatio: { numerator: 1, denominator: 1 }, videoStart: 0, displayWidth: 1280, displayHeight: 720, fingerprint: 'f'.repeat(64) }
const timeline: OcrVisualTimeline = {
  schemaVersion: 1, protocol: 'ocr-visual-cues/1', profile: 'accurate',
  video: { width: 1280, height: 720, durationSeconds: 10, sampleFps: 8, frameCount: 80, geometryFingerprint: geometry.fingerprint },
  scanRegion: { x0: 0, y0: 500, x1: 1280, y1: 720 },
  segments: [{ id: 'text', startFrame: 8, endFrameExclusive: 24, start: 1, end: 3, text: 'Original subtitle', confidence: .95, boxes: [{ text: 'Original subtitle', confidence: .95, x0: 100, y0: 550, x1: 400, y1: 620 }] }]
}
function config(outputDir: string): AutoShortConfig {
  return {
    subtitleMethod: 'ocr', whisperModel: 'base', whisperDevice: 'cpu',
    ocrRegion: { x0: 0, y0: .7, x1: 1, y1: 1 },
    blurRegions: [{ id: 'old', color: '#000000', x0: 0, y0: 0, x1: 1, y1: 1 }],
    lamMo: true, blurMode: 'sttn', ocrBlurProfile: 'fast', translateTarget: 'none',
    translateProvider: 'local', ttsEnabled: false, voiceOverMode: false,
    audioMode: 'mix', originalAudioVolume: 37, outputDir
  }
}

for (const outcome of ['success', 'removal failure', 'burn failure', 'cancel'] as const) {
  test(`STTN pipeline uses output volume and cleans temporary media after ${outcome}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'tedia-sttn-pipeline-'))
    try {
      const video = join(root, 'input.mp4')
      await writeFile(video, 'source')
      const events: string[] = []
      const outputDir = join(root, 'output')
      const itemOutputDir = join(outputDir, 'one')
      await mkdir(itemOutputDir, { recursive: true })
      await writeFile(join(itemOutputDir, 'existing.mp4'), 'keep existing output')
      const cfg = config(outputDir)
      const controller = new AbortController()
      let cleanedPath = ''
      const deps: AutoShortItemCoordinatorDeps = {
        resolveFfmpeg: async () => 'ffmpeg.exe', resolveFfprobe: async () => 'ffprobe.exe',
        probeMedia: async () => ({ w: 1280, h: 720, giay: 10, hasAudio: true, frameRate: 25, geometry }),
        runVisualOcr: async (options) => {
          events.push('ocr')
          assert.equal(options.input, video)
          assert.equal(options.profile, 'accurate')
          return { timeline, sourceSrtPath: '', sidecarPath: '', engineVersion: '1.1.0', engineProtocol: 'ocr-local/1', visualSegmentCount: 1, boxSegmentCount: 1 }
        },
        removeSubtitles: async (options) => {
          events.push('remove')
          assert.equal(options.videoPath, video)
          assert.equal(options.timeline, timeline)
          cleanedPath = options.outputPath
          assert.equal(dirname(dirname(cleanedPath)), itemOutputDir, 'Large STTN media must use the selected output volume, not system temp')
          await writeFile(cleanedPath, 'clean video with source audio')
          if (outcome === 'removal failure') throw new Error('STTN inference failed')
          if (outcome === 'cancel') controller.abort()
          return { outputPath: cleanedPath, provider: 'cpu', elapsedMs: 12 }
        },
        writeTimedMask: async () => { throw new Error('STTN must not create Gaussian mask') },
        burn: async (request, options) => {
          events.push('burn')
          assert.equal(request.video, cleanedPath)
          assert.equal(await readFile(cleanedPath, 'utf8'), 'clean video with source audio')
          if (outcome === 'burn failure') throw new Error('Burn failed')
          assert.equal(request.lamMo, false)
          assert.deepEqual(request.blurRegions, [])
          assert.equal(options.timedOcrBlurMask, null)
          assert.match(await readFile(request.srt!, 'utf8'), /Original subtitle/)
          assert.equal(request.amLuongGoc, 37)
          assert.equal(request.batAmThanh, false)
          assert.equal(options.expectedMedia.requireAudio, true)
          await writeFile(options.finalOutputPath, 'rendered')
          return { ok: true, output: options.finalOutputPath, title: 'Original title' }
        }
      }
      const result = await createAutoShortItemProcessor(deps)({
        jobId: 'test', request: { config: cfg, items: [{ id: 'one', filePath: video }] },
        item: { id: 'one', filePath: video }, index: 0, total: 1, signal: controller.signal,
        emit: () => {}, checkpointDir: join(root, 'checkpoint'), workDir: join(root, 'work'), artifactDir: join(root, 'artifacts'), itemOutputDir, separationProviderState: { mode: 'auto' }
      })
      assert.deepEqual(events, outcome === 'removal failure' || outcome === 'cancel' ? ['ocr', 'remove'] : ['ocr', 'remove', 'burn'])
      assert.equal(result.status, outcome === 'success' ? 'done' : outcome === 'cancel' ? 'cancelled' : 'error')
      if (outcome === 'success') assert.equal(result.title, 'Original title')
      if (outcome === 'success') {
        const summary = JSON.parse(await readFile(join(root, 'artifacts', 'diagnostics', 'summary.json'), 'utf8'))
        assert.equal(summary.stages.metadata?.status, 'succeeded')
        assert.equal(summary.stages.artifact_copy?.status, 'succeeded')
      }
      assert.ok(cleanedPath)
      assert.equal(dirname(dirname(cleanedPath)), itemOutputDir)
      if (outcome === 'removal failure') assert.match(result.error!, /STTN inference failed/)
      if (outcome === 'burn failure') assert.match(result.error!, /Burn failed/)
      await assert.rejects(readFile(cleanedPath), { code: 'ENOENT' })
      assert.equal((await readdir(itemOutputDir)).some(name => name.startsWith('.sttn-')), false)
      assert.equal(await readFile(join(itemOutputDir, 'existing.mp4'), 'utf8'), 'keep existing output')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
}

test('STTN cache reuses a validated clean video and releases its lease after render', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-sttn-cache-'))
  try {
    const video = join(root, 'input.mp4')
    await writeFile(video, 'same-source')
    const cache = new AutoShortArtifactCache({ rootDir: join(root, 'cache'), quotaBytes: 1024 * 1024 })
    let removals = 0
    const deps: AutoShortItemCoordinatorDeps = {
      resolveFfmpeg: async () => 'ffmpeg.exe', resolveFfprobe: async () => 'ffprobe.exe',
      probeMedia: async () => ({ w: 1280, h: 720, giay: 10, hasAudio: true, frameRate: 25, geometry }),
      runVisualOcr: async () => ({ timeline, sourceSrtPath: '', sidecarPath: '', engineVersion: '1.1.0', engineProtocol: 'ocr-local/1', visualSegmentCount: 1, boxSegmentCount: 1 }),
      removeSubtitles: async (options) => {
        removals++
        await writeFile(options.outputPath, 'cached-clean-video')
        return { outputPath: options.outputPath, provider: 'cpu', elapsedMs: 12 }
      },
      writeTimedMask: async () => { throw new Error('unexpected mask') },
      burn: async (request, options) => {
        assert.equal(await readFile(request.video, 'utf8'), 'cached-clean-video')
        await writeFile(options.finalOutputPath, `rendered-${removals}`)
        return { ok: true, output: options.finalOutputPath }
      }
    }
    const run = async (suffix: string) => {
      const itemOutputDir = join(root, `output-${suffix}`)
      await mkdir(itemOutputDir, { recursive: true })
      return createAutoShortItemProcessor(deps)({
        jobId: `job-${suffix}`, request: { config: config(root), items: [{ id: 'one', filePath: video }] },
        item: { id: 'one', filePath: video }, index: 0, total: 1, signal: new AbortController().signal,
        emit: () => {}, checkpointDir: join(root, `checkpoint-${suffix}`), workDir: join(root, `work-${suffix}`),
        artifactDir: join(root, `artifacts-${suffix}`), itemOutputDir, separationProviderState: { mode: 'auto' }, artifactCache: cache
      })
    }
    assert.equal((await run('first')).status, 'done')
    assert.equal((await run('second')).status, 'done')
    assert.equal(removals, 1)
    await writeFile(video, 'changed-source')
    assert.equal((await run('changed-source')).status, 'done')
    assert.equal(removals, 2, 'source digest change must invalidate STTN cache')
    assert.ok((await cache.prune(new AbortController().signal)).removedBytes >= 0, 'released cache lease remains prunable')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('STTN readiness needs visual OCR but does not probe Gaussian maskedmerge', async () => {
  let sttnProbes = 0
  const hooks = {
    resolveFfmpeg: async () => 'ffmpeg.exe',
    ocrEngineStatus: async () => ({ has: true, healthy: true, features: [] }),
    probeFfmpegOcrMaskCapability: async () => { throw new Error('Must not probe Gaussian') },
    getSttnReadiness: async () => { sttnProbes++; return [{ id: 'sttn-engine' as const, label: 'STTN', required: true, ready: true }] }
  }
  const readiness = await getAutoShortReadiness(config('C:\\output'), hooks as any)
  assert.equal(sttnProbes, 1)
  assert.equal(readiness.dependencies.find(d => d.id === 'ocr-engine')?.ready, false)
  assert.equal(readiness.dependencies.find(d => d.id === 'ffmpeg')?.ready, true)
  await getAutoShortReadiness({ ...config('C:\\output'), lamMo: false }, hooks as any)
  assert.equal(sttnProbes, 1)
})

test('STTN preview bounds source before OCR, uses accurate ROI, and produces playable MP4', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-sttn-preview-'))
  try {
    const videoPath = join(root, 'input.mp4')
    await writeFile(videoPath, 'source')
    const stages: string[] = []
    const result = await runAutoShortSttnPreview({ videoPath, config: config('') }, join(root, 'work'), new AbortController().signal, () => {}, {
      resolveFfmpeg: async () => 'ffmpeg.exe', resolveFfprobe: async () => 'ffprobe.exe',
      probeMedia: async () => ({ w: 1280, h: 720, giay: 5, hasAudio: true, frameRate: 25, geometry }),
      runMedia: async (_exe, args) => {
        const output = args.at(-1)!
        stages.push(output.endsWith('.mp4') ? 'encode' : 'clip')
        if (!output.endsWith('.mp4')) assert.equal(args[args.indexOf('-t') + 1], '5')
        await writeFile(output, 'media')
      },
      runVisualOcr: async options => {
        stages.push('ocr')
        assert.equal(options.input, join(root, 'work', 'source-preview.mkv'))
        assert.equal(options.profile, 'accurate')
        assert.deepEqual(options.scanRegion, { x0: 0, y0: 504, x1: 1280, y1: 720 })
        return { timeline, sourceSrtPath: '', sidecarPath: '', engineVersion: '1.1.0', engineProtocol: 'ocr-local/1', visualSegmentCount: 1, boxSegmentCount: 1 }
      },
      removeSubtitles: async options => {
        stages.push('remove')
        assert.equal(options.videoPath, join(root, 'work', 'source-preview.mkv'))
        assert.equal(options.previewSeconds, 5)
        assert.equal(options.timeline, timeline)
        await writeFile(options.outputPath, 'cleaned')
        return { outputPath: options.outputPath, provider: 'cpu', elapsedMs: 5 }
      }
    })
    assert.deepEqual(stages, ['clip', 'ocr', 'remove', 'encode'])
    assert.ok(result.outputPath.endsWith('.mp4'))
    assert.equal(await readFile(result.outputPath, 'utf8'), 'media')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('STTN preview rejects untrusted executable paths and overlong ranges before launching', async () => {
  for (const extra of [{ previewSeconds: 11 }, { ffmpegPath: 'C:\\evil.exe' }]) {
    await assert.rejects(() => runAutoShortSttnPreview({ videoPath: 'C:\\video.mp4', config: config(''), ...extra }, 'C:\\work', new AbortController().signal, () => {}))
  }
})

test('STTN preview cancellation after clipping does not launch OCR or removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-sttn-cancel-'))
  try {
    const videoPath = join(root, 'input.mp4')
    await writeFile(videoPath, 'source')
    const controller = new AbortController()
    let ocrCalls = 0
    await assert.rejects(() => runAutoShortSttnPreview({ videoPath, config: config('') }, join(root, 'work'), controller.signal, () => {}, {
      resolveFfmpeg: async () => 'ffmpeg.exe', resolveFfprobe: async () => 'ffprobe.exe',
      runMedia: async () => { controller.abort() },
      probeMedia: async () => ({ w: 1280, h: 720, giay: 5, hasAudio: false, geometry }),
      runVisualOcr: async () => { ocrCalls++; throw new Error('Unexpected OCR after cancel') }
    }))
    assert.equal(ocrCalls, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('STTN installs only its selected missing dependencies', async () => {
  let installed = false
  let installCount = 0
  const hooks = {
    readinessHooks: {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      ocrEngineStatus: async () => ({ has: true, healthy: true, features: ['visual-cues-v1'] }),
      getSttnReadiness: async () => [{ id: 'sttn-model' as const, label: 'STTN model', required: true, ready: installed }]
    },
    installSttnDependencies: async () => { installed = true; installCount++ }
  }
  assert.equal((await installAutoShortDependencies(config('C:\\output'), () => {}, undefined, hooks as any)).ready, true)
  assert.equal(installCount, 1)
  await installAutoShortDependencies({ ...config('C:\\output'), lamMo: false }, () => {}, undefined, hooks as any)
  assert.equal(installCount, 1)
})
