import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AutoShortResourceManager } from '../src/main/autoShortResourceManager'
import { createAutoShortItemProcessor, type AutoShortItemContext } from '../src/main/autoShortItemCoordinator'
import { runAutoShortSttnPreview } from '../src/main/autoshort'

test('AutoShortResourceManager enforces resource capacities sequentially', async () => {
  const manager = new AutoShortResourceManager({ 'local-gpu-heavy': 1 })
  assert.equal(manager.getCapacity('local-gpu-heavy'), 1)
  assert.equal(manager.getAllocated('local-gpu-heavy'), 0)

  const lease1 = await manager.acquire(['local-gpu-heavy'])
  assert.equal(manager.getAllocated('local-gpu-heavy'), 1)

  let lease2Acquired = false
  const p2 = manager.acquire(['local-gpu-heavy']).then((lease) => {
    lease2Acquired = true
    return lease
  })

  // Short delay: lease2 should still be waiting
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(lease2Acquired, false, 'Lease 2 should not be acquired while lease 1 is held')

  lease1.release()
  const lease2 = await p2
  assert.equal(lease2Acquired, true, 'Lease 2 should be acquired after lease 1 is released')
  assert.equal(manager.getAllocated('local-gpu-heavy'), 1)

  lease2.release()
  assert.equal(manager.getAllocated('local-gpu-heavy'), 0)
})

test('AutoShortResourceManager claims resource sets atomically without deadlock', async () => {
  const manager = new AutoShortResourceManager({
    'local-gpu-heavy': 1,
    'server-inference': 1
  })

  let task1Finished = false
  let task2Finished = false

  // Task 1 needs GPU and Server
  const p1 = manager.withLease(['local-gpu-heavy', 'server-inference'], undefined, async () => {
    await new Promise((r) => setTimeout(r, 30))
    task1Finished = true
  })

  // Task 2 needs Server and GPU in reverse order
  const p2 = manager.withLease(['server-inference', 'local-gpu-heavy'], undefined, async () => {
    await new Promise((r) => setTimeout(r, 20))
    task2Finished = true
  })

  await Promise.all([p1, p2])
  assert.equal(task1Finished, true)
  assert.equal(task2Finished, true)
  assert.equal(manager.getAllocated('local-gpu-heavy'), 0)
  assert.equal(manager.getAllocated('server-inference'), 0)
})

test('AutoShortResourceManager supports cancellation while queued', async () => {
  const manager = new AutoShortResourceManager({ 'local-gpu-heavy': 1 })
  const lease1 = await manager.acquire(['local-gpu-heavy'])

  const controller = new AbortController()
  const p2 = manager.acquire(['local-gpu-heavy'], controller.signal)

  // Abort while waiting in queue
  controller.abort(new Error('User cancelled'))

  await assert.rejects(async () => {
    await p2
  }, /User cancelled/)

  assert.equal(manager.getAllocated('local-gpu-heavy'), 1)
  lease1.release()
  assert.equal(manager.getAllocated('local-gpu-heavy'), 0)
})

test('Double release does not corrupt allocation count', async () => {
  const manager = new AutoShortResourceManager({ 'local-cpu-heavy': 1 })
  const lease = await manager.acquire(['local-cpu-heavy'])
  assert.equal(manager.getAllocated('local-cpu-heavy'), 1)

  lease.release()
  assert.equal(manager.getAllocated('local-cpu-heavy'), 0)

  // Double release
  lease.release()
  assert.equal(manager.getAllocated('local-cpu-heavy'), 0)
})

test('AutoShortResourceManager sanitizes invalid, NaN, and negative capacities', () => {
  const manager = new AutoShortResourceManager({
    'local-gpu-heavy': NaN as any,
    'local-cpu-heavy': -10 as any,
    'server-inference': 'invalid' as any,
    'local-audio-dsp': 0 as any
  })
  assert.equal(manager.getCapacity('local-gpu-heavy'), 1)
  assert.equal(manager.getCapacity('local-cpu-heavy'), 1)
  assert.equal(manager.getCapacity('server-inference'), 1)
  assert.equal(manager.getCapacity('local-audio-dsp'), 1)
})

test('AutoShortResourceManager strict FIFO queue prevents multi-claim starvation', async () => {
  const manager = new AutoShortResourceManager({
    'local-gpu-heavy': 1,
    'local-cpu-heavy': 1
  })

  // Lease 1 holds GPU
  const lease1 = await manager.acquire(['local-gpu-heavy'])

  const order: string[] = []

  // Task A needs [GPU, CPU] - enters queue first, blocked because GPU held
  const taskA = manager.withLease(['local-gpu-heavy', 'local-cpu-heavy'], undefined, async () => {
    order.push('A')
  })

  // Task B needs only [CPU] - enters queue second. CPU is currently free, but Task A is head.
  // Under strict FIFO, Task B must NOT jump ahead of Task A.
  const taskB = manager.withLease(['local-cpu-heavy'], undefined, async () => {
    order.push('B')
  })

  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(order, [], 'Neither task should have executed while lease1 is held')

  // Release GPU
  lease1.release()

  await Promise.all([taskA, taskB])
  assert.deepEqual(order, ['A', 'B'], 'Task A must be serviced before Task B')
})

test('Concurrent production item processors + preview enforce lane peaks <= 1', async () => {
  const root = join(tmpdir(), `tediapros-rm-test-${Date.now()}`)
  await mkdir(root, { recursive: true })

  const manager = new AutoShortResourceManager({
    'local-gpu-heavy': 1,
    'local-cpu-heavy': 1,
    'local-audio-dsp': 1,
    'server-inference': 1
  })

  let peakGpu = 0
  let peakCpu = 0

  const track = () => {
    peakGpu = Math.max(peakGpu, manager.getAllocated('local-gpu-heavy'))
    peakCpu = Math.max(peakCpu, manager.getAllocated('local-cpu-heavy'))
  }

  const mockTimeline = {
    segments: [{ start: 0, end: 5, text: 'test', confidence: 0.9, box: { x0: 0, y0: 0, x1: 100, y1: 100 } }],
    fps: 8,
    durationSeconds: 5
  }

  const processor = createAutoShortItemProcessor({
    resolveFfmpeg: async () => 'mock-ffmpeg',
    resolveFfprobe: async () => 'mock-ffprobe',
    probeMedia: async () => ({ w: 1280, h: 720, giay: 5, hasAudio: false }),
    runVisualOcr: async () => {
      track()
      await new Promise((r) => setTimeout(r, 25))
      track()
      return {
        timeline: mockTimeline as any,
        engineVersion: '1.1.0',
        visualSegmentCount: 1,
        boxSegmentCount: 1
      }
    },
    writeTimedMask: async () => ({ outputPath: 'mask.mkv', durationSeconds: 5 }),
    burn: async () => {
      track()
      await new Promise((r) => setTimeout(r, 25))
      track()
      const outPath = join(root, `out-${Math.random().toString(36).slice(2)}.mp4`)
      await writeFile(outPath, 'fake-mp4')
      return { ok: true, output: outPath }
    }
  })

  const baseConfig: AutoShortConfig = {
    subtitleMethod: 'ocr',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    ocrRegion: { x0: 0, y0: 0.7, x1: 1, y1: 0.9 },
    blurRegions: [],
    lamMo: true,
    blurMode: 'ocr-auto',
    sttnMode: 'sttn-auto',
    ocrBlurProfile: 'accurate',
    translateTarget: 'none',
    translateProvider: 'local',
    ttsEnabled: false,
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    outputDir: join(root, 'out')
  }

  const makeContext = async (id: string): Promise<AutoShortItemContext> => {
    const video = join(root, `${id}.mp4`)
    await writeFile(video, 'mock')
    return {
      jobId: `job-${id}`,
      request: {
        items: [{ id, filePath: video }],
        config: { ...baseConfig, outputDir: join(root, `out-${id}`) }
      },
      item: { id, filePath: video },
      index: 0,
      total: 1,
      signal: new AbortController().signal,
      emit() {},
      checkpointDir: join(root, `chk-${id}`),
      workDir: join(root, `work-${id}`),
      artifactDir: join(root, `audit-${id}`),
      resourceManager: manager
    }
  }

  const [ctx1, ctx2] = await Promise.all([makeContext('item-1'), makeContext('item-2')])

  // Also simulate preview running concurrently
  const previewWorkDir = join(root, 'preview-work')
  const previewVideo = join(root, 'preview.mp4')
  await writeFile(previewVideo, 'mock')

  const previewPromise = runAutoShortSttnPreview(
    {
      videoPath: previewVideo,
      previewSeconds: 3,
      config: { ...baseConfig, blurMode: 'sttn' }
    },
    previewWorkDir,
    new AbortController().signal,
    () => {},
    {
      resolveFfmpeg: async () => 'mock-ffmpeg',
      resolveFfprobe: async () => 'mock-ffprobe',
      probeMedia: async () => ({ w: 1280, h: 720, giay: 3, hasAudio: false } as any),
      runMedia: async (_ff, args) => {
        const out = args[args.length - 1]
        await writeFile(out, 'preview-output')
      },
      runVisualOcr: async () => {
        track()
        await new Promise((r) => setTimeout(r, 20))
        track()
        return {
          timeline: mockTimeline as any,
          engineVersion: '1.1.0',
          visualSegmentCount: 1,
          boxSegmentCount: 1
        }
      },
      removeSubtitles: async () => {
        track()
        await new Promise((r) => setTimeout(r, 20))
        track()
        const cleanedPath = join(previewWorkDir, 'cleaned.mkv')
        await writeFile(cleanedPath, 'fake-cleaned')
        return { outputPath: cleanedPath, provider: 'cuda', elapsedMs: 20 }
      },
      resourceManager: manager
    }
  )

  const [res1, res2, previewRes] = await Promise.all([
    processor(ctx1),
    processor(ctx2),
    previewPromise
  ])

  assert.equal(res1.status, 'done')
  assert.equal(res2.status, 'done')
  assert.equal(previewRes.provider, 'cuda')

  // Peak concurrent usage for each lane must be <= 1
  assert.equal(peakGpu <= 1, true, `Peak GPU allocation must be <= 1, got ${peakGpu}`)
  assert.equal(peakCpu <= 1, true, `Peak CPU allocation must be <= 1, got ${peakCpu}`)
  assert.equal(manager.getAllocated('local-gpu-heavy'), 0)
  assert.equal(manager.getAllocated('local-cpu-heavy'), 0)
})
