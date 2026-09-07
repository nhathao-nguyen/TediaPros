import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAutoShortItemScope } from '../src/main/autoShortItemScope'
import { createAutoShortItemProcessor, type AutoShortItemContext } from '../src/main/autoShortItemCoordinator'
import { AutoShortResourceManager } from '../src/main/autoShortResourceManager'
import type { AutoShortConfig } from '../src/shared/types'

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms))

test('AutoShortItemScope: basic success execution', async () => {
  const scope = createAutoShortItemScope()
  const outcome = await scope.start(async (signal) => {
    assert.equal(signal.aborted, false)
    return 42
  })
  assert.equal(outcome.ok, true)
  if (outcome.ok) {
    assert.equal(outcome.value, 42)
  }
  await scope.drain()
  scope.dispose()
})

test('AutoShortItemScope: failure records firstError, aborts sibling branches, returns BranchOutcome without unhandled rejection', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (err: unknown) => unhandled.push(err)
  process.on('unhandledRejection', onUnhandled)

  try {
    const scope = createAutoShortItemScope()
    let siblingAborted = false

    // Sibling action that waits for abort
    const siblingPromise = scope.start(async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          siblingAborted = true
          resolve()
        })
      })
      return 'sibling-done'
    })

    // Failing action
    const failingPromise = scope.start(async () => {
      await tick(10)
      throw new Error('primary failure')
    })

    const failingOutcome = await failingPromise
    assert.equal(failingOutcome.ok, false)
    if (!failingOutcome.ok) {
      assert.equal((failingOutcome.error as Error).message, 'primary failure')
    }

    assert.equal((scope.firstError as Error)?.message, 'primary failure')
    assert.equal(scope.signal.aborted, true)

    const siblingOutcome = await siblingPromise
    assert.equal(siblingAborted, true)
    assert.equal(siblingOutcome.ok, true) // resolved gracefully upon abort event

    await scope.drain()
    scope.dispose()
    assert.equal(unhandled.length, 0, 'No unhandledRejection events should be fired')
  } finally {
    process.removeListener('unhandledRejection', onUnhandled)
  }
})

test('AutoShortItemScope: drain waits for all registered promises to settle before completing', async () => {
  const scope = createAutoShortItemScope()
  let settled = false

  scope.start(async () => {
    await tick(50)
    settled = true
    return 'done'
  })

  assert.equal(settled, false)
  await scope.drain()
  assert.equal(settled, true, 'drain must wait for started action to finish')
  scope.dispose()
})

test('AutoShortItemScope: item scopes are isolated; failure in scope A does not abort scope B', async () => {
  const parentController = new AbortController()
  const scopeA = createAutoShortItemScope(parentController.signal)
  const scopeB = createAutoShortItemScope(parentController.signal)

  await scopeA.start(async () => {
    throw new Error('Item A failed')
  })

  assert.equal(scopeA.signal.aborted, true)
  assert.equal(scopeB.signal.aborted, false, 'Scope B must remain active when Scope A fails')

  const outcomeB = await scopeB.start(async () => 'Item B success')
  assert.equal(outcomeB.ok, true)
  if (outcomeB.ok) assert.equal(outcomeB.value, 'Item B success')

  await scopeA.drain()
  await scopeB.drain()
  scopeA.dispose()
  scopeB.dispose()
})

test('AutoShortItemScope: parent abort cancels all child scopes', async () => {
  const parentController = new AbortController()
  const scopeA = createAutoShortItemScope(parentController.signal)
  const scopeB = createAutoShortItemScope(parentController.signal)

  parentController.abort(new Error('User cancelled job'))

  assert.equal(scopeA.signal.aborted, true)
  assert.equal(scopeB.signal.aborted, true)

  scopeA.dispose()
  scopeB.dispose()
})

test('Coordinator Scope Integration: ASR error while OCR is running aborts OCR and drains before workDir cleanup', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (err: unknown) => unhandled.push(err)
  process.on('unhandledRejection', onUnhandled)

  const root = join(tmpdir(), `tediapros-itemscope-test-${Date.now()}`)
  await mkdir(root, { recursive: true })
  const video = join(root, 'input.mp4')
  await writeFile(video, 'mock input')

  let releaseOcr: () => void = () => {}
  const ocrGate = new Promise<void>((r) => { releaseOcr = r })
  let ocrSignal: AbortSignal | undefined
  let ocrRunning = false

  const config: AutoShortConfig = {
    subtitleMethod: 'whisper',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    ocrRegion: { x0: 0, y0: 0.7, x1: 1, y1: 0.9 },
    blurRegions: [],
    lamMo: true,
    blurMode: 'ocr-auto',
    ocrBlurProfile: 'accurate',
    translateTarget: 'none',
    translateProvider: 'local',
    ttsEnabled: false,
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    outputDir: join(root, 'output')
  }

  const processor = createAutoShortItemProcessor({
    resolveFfmpeg: async () => 'mock-ffmpeg',
    resolveFfprobe: async () => 'mock-ffprobe',
    probeMedia: async () => ({ w: 1280, h: 720, giay: 10, hasAudio: true }),
    runVisualOcr: async (options) => {
      ocrSignal = options.signal
      ocrRunning = true
      await ocrGate
      ocrRunning = false
      throw new Error('late OCR failure')
    },
    transcribeAudio: async () => {
      await tick(20)
      return { ok: false, error: 'ASR fixture failure', outputs: [] }
    },
    writeTimedMask: async () => { throw new Error('must not reach mask') },
    burn: async () => { throw new Error('must not render') }
  })

  const context: AutoShortItemContext = {
    jobId: 'scope-test-job',
    request: { items: [{ id: 'item-1', filePath: video }], config },
    item: { id: 'item-1', filePath: video },
    index: 0,
    total: 1,
    signal: new AbortController().signal,
    emit() {},
    checkpointDir: join(root, 'checkpoint'),
    workDir: join(root, 'work'),
    artifactDir: join(root, 'audit'),
    policy: {
      maxActiveItems: 1,
      overlapIndependentStages: true,
      prefetchTts: false,
      ocrTransport: 'legacy-disk'
    },
    resourceManager: new AutoShortResourceManager({ 'local-cpu-heavy': 2, 'local-gpu-heavy': 2 })
  }

  let processorDone = false
  const processorPromise = processor(context).then((res) => {
    processorDone = true
    return res
  })

  // Wait enough time for ASR to fail
  await tick(60)

  // Assertions while OCR gate is still open:
  assert.equal(processorDone, false, 'Processor must NOT settle before OCR gate is released (must wait for scope.drain)')
  assert.equal(ocrRunning, true, 'OCR is still running')
  assert.equal(ocrSignal?.aborted, true, 'OCR signal must have received abort signal when ASR failed')
  const workDirBeforeRelease = await stat(context.workDir).catch(() => null)
  assert.ok(workDirBeforeRelease, 'workDir must still exist while OCR is running')

  // Now release OCR
  releaseOcr()
  const itemResult = await processorPromise

  assert.equal(itemResult.status, 'error')
  assert.ok(itemResult.error?.includes('ASR fixture failure'))
  assert.equal(ocrRunning, false, 'OCR must be completely stopped when item returns')

  const workDirAfterRelease = await stat(context.workDir).catch(() => null)
  assert.equal(workDirAfterRelease, null, 'workDir must be cleaned up only after scope drain')

  await tick(20)
  assert.equal(unhandled.length, 0, 'No unhandled rejections from late OCR failure')
  process.removeListener('unhandledRejection', onUnhandled)
})

test('Coordinator Scope Integration: OCR failure while ASR is pending preserves original OCR error and aborts sibling', async () => {
  const root = join(tmpdir(), `tediapros-itemscope-test2-${Date.now()}`)
  await mkdir(root, { recursive: true })
  const video = join(root, 'input.mp4')
  await writeFile(video, 'mock input')

  let asrSignal: AbortSignal | undefined

  const config: AutoShortConfig = {
    subtitleMethod: 'whisper',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    ocrRegion: { x0: 0, y0: 0.7, x1: 1, y1: 0.9 },
    blurRegions: [],
    lamMo: true,
    blurMode: 'ocr-auto',
    ocrBlurProfile: 'accurate',
    translateTarget: 'none',
    translateProvider: 'local',
    ttsEnabled: false,
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    outputDir: join(root, 'output')
  }

  const processor = createAutoShortItemProcessor({
    resolveFfmpeg: async () => 'mock-ffmpeg',
    resolveFfprobe: async () => 'mock-ffprobe',
    probeMedia: async () => ({ w: 1280, h: 720, giay: 10, hasAudio: true }),
    runVisualOcr: async () => {
      await tick(10)
      throw new Error('OCR hardware failure')
    },
    transcribeAudio: async (_jobId, _opt, _prog, signal) => {
      asrSignal = signal
      await new Promise<void>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('Đã hủy tác vụ')))
      })
      return { ok: true, outputs: ['sub.srt'] }
    },
    writeTimedMask: async () => { throw new Error('must not reach') },
    burn: async () => { throw new Error('must not reach') }
  })

  const context: AutoShortItemContext = {
    jobId: 'scope-test-job-2',
    request: { items: [{ id: 'item-2', filePath: video }], config },
    item: { id: 'item-2', filePath: video },
    index: 0,
    total: 1,
    signal: new AbortController().signal,
    emit() {},
    checkpointDir: join(root, 'checkpoint'),
    workDir: join(root, 'work'),
    artifactDir: join(root, 'audit'),
    policy: {
      maxActiveItems: 1,
      overlapIndependentStages: true,
      prefetchTts: false,
      ocrTransport: 'legacy-disk'
    },
    resourceManager: new AutoShortResourceManager({ 'local-cpu-heavy': 2, 'local-gpu-heavy': 2 })
  }

  const itemResult = await processor(context)
  assert.equal(itemResult.status, 'error')
  assert.equal(asrSignal?.aborted, true, 'ASR should be aborted by sibling OCR failure')
  assert.ok(
    itemResult.error?.includes('OCR hardware failure'),
    `Expected OCR hardware failure preserved, got: ${itemResult.error}`
  )
})
