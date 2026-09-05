import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import type {
  AutoShortConfig,
  AutoShortStartRequest,
  AutoShortQueueItemInput,
  AutoShortEvent,
  AlignedCue,
  OcrVisualTimeline,
  BurnResult
} from '../src/shared/types'
import {
  createAutoShortItemProcessor,
  type AutoShortItemCoordinatorDeps,
  type AutoShortItemContext
} from '../src/main/autoShortItemCoordinator'
import {
  mustRegenerateOcrSource,
  digestCanonicalSourceCues,
  sameOcrSourceCueEvidence,
  type OcrSourceCueEvidence
} from '../src/main/autoShortOcrCheckpoint'
import {
  createOcrBlurAuditMetadata,
  sanitizeAutoShortAuditError
} from '../src/main/autoShortAudit'
import type { CanonicalDisplayGeometry } from '../src/main/canonicalDisplayGeometry'
import type { Meta } from '../src/main/burn'
import type { TimedOcrBlurMask } from '../src/main/ocrMask'

const mockGeometry: CanonicalDisplayGeometry = {
  codedWidth: 1280,
  codedHeight: 720,
  rotation: 0,
  sampleAspectRatio: { numerator: 1, denominator: 1 },
  videoStart: 0,
  displayWidth: 1280,
  displayHeight: 720,
  fingerprint: 'f'.repeat(64)
}

const mockMeta: Meta = {
  w: 1280,
  h: 720,
  giay: 10,
  hasAudio: true,
  geometry: mockGeometry,
  videoDurationSeconds: 10,
  containerDurationSeconds: 10,
  frameRate: 25
}

function sampleTimeline(): OcrVisualTimeline {
  return {
    schemaVersion: 1,
    protocol: 'ocr-visual-cues/1',
    video: {
      width: 1280,
      height: 720,
      durationSeconds: 10,
      sampleFps: 8,
      frameCount: 80,
      geometryFingerprint: mockGeometry.fingerprint
    },
    profile: 'accurate',
    scanRegion: { x0: 0, y0: 500, x1: 1280, y1: 700 },
    segments: [
      {
        id: 'seg-1',
        startFrame: 8,
        endFrameExclusive: 24,
        start: 1.0,
        end: 3.0,
        text: 'Xin chào các bạn',
        confidence: 0.95,
        boxes: [
          {
            text: 'Xin chào các bạn',
            confidence: 0.95,
            x0: 100,
            y0: 550,
            x1: 400,
            y1: 620
          }
        ]
      }
    ]
  }
}

function baseConfig(overrides: Partial<AutoShortConfig> = {}): AutoShortConfig {
  return {
    subtitleMethod: 'ocr',
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
    outputDir: 'C:\\output',
    ...overrides
  }
}

test('Step 9.5 & 9.6: mustRegenerateOcrSource and evidence digest/comparison', () => {
  // 1. mustRegenerateOcrSource only true when automatic blur AND ocr/whisper-ocr method
  assert.equal(mustRegenerateOcrSource(baseConfig({ lamMo: true, blurMode: 'ocr-auto', subtitleMethod: 'ocr' })), true)
  assert.equal(mustRegenerateOcrSource(baseConfig({ lamMo: true, blurMode: 'ocr-auto', subtitleMethod: 'whisper-ocr' })), true)
  assert.equal(mustRegenerateOcrSource(baseConfig({ lamMo: true, blurMode: 'ocr-auto', subtitleMethod: 'whisper' })), false)
  assert.equal(mustRegenerateOcrSource(baseConfig({ lamMo: false, blurMode: 'ocr-auto', subtitleMethod: 'ocr' })), false)
  assert.equal(mustRegenerateOcrSource(baseConfig({ lamMo: true, blurMode: 'manual', subtitleMethod: 'ocr' })), false)

  // 2. digestCanonicalSourceCues is stable regardless of input order
  const cuesA: AlignedCue[] = [
    { id: 'c1', start: 1.0, end: 2.0, text: 'Hello', source: 'ocr', timingQuality: 'ocr' },
    { id: 'c2', start: 2.5, end: 4.0, text: 'World', source: 'ocr', timingQuality: 'ocr' }
  ]
  const cuesB: AlignedCue[] = [
    { id: 'c2', start: 2.5, end: 4.0, text: 'World', source: 'ocr', timingQuality: 'ocr' },
    { id: 'c1', start: 1.0, end: 2.0, text: 'Hello', source: 'ocr', timingQuality: 'ocr' }
  ]
  const digestA = digestCanonicalSourceCues(cuesA)
  const digestB = digestCanonicalSourceCues(cuesB)
  assert.equal(digestA, digestB)

  // Modifying text alters digest
  const cuesC: AlignedCue[] = [
    { id: 'c1', start: 1.0, end: 2.0, text: 'Hello altered', source: 'ocr', timingQuality: 'ocr' },
    { id: 'c2', start: 2.5, end: 4.0, text: 'World', source: 'ocr', timingQuality: 'ocr' }
  ]
  assert.notEqual(digestA, digestCanonicalSourceCues(cuesC))

  // 3. sameOcrSourceCueEvidence checks all fields
  const ev1: OcrSourceCueEvidence = {
    effectiveOcrProfile: 'accurate',
    engineVersion: '1.1.0',
    engineProtocol: 'ocr-local/1',
    cueDigest: digestA
  }
  assert.equal(sameOcrSourceCueEvidence(undefined, ev1), false)
  assert.equal(sameOcrSourceCueEvidence(ev1, { ...ev1 }), true)
  assert.equal(sameOcrSourceCueEvidence(ev1, { ...ev1, effectiveOcrProfile: 'fast' }), false)
  assert.equal(sameOcrSourceCueEvidence(ev1, { ...ev1, engineVersion: '1.2.0' }), false)
  assert.equal(sameOcrSourceCueEvidence(ev1, { ...ev1, cueDigest: 'different' }), false)
})

test('Step 9.7: Privacy & aggregate audit metadata', () => {
  // createOcrBlurAuditMetadata produces exactly the permitted aggregate fields
  const meta = createOcrBlurAuditMetadata({
    blurMode: 'ocr-auto',
    engineVersion: '1.1.0',
    scanProfile: 'accurate',
    visualSegmentCount: 5,
    boxSegmentCount: 12,
    maskedDurationSeconds: 8.5
  })
  const keys = Object.keys(meta).sort()
  assert.deepEqual(keys, [
    'blurMode',
    'ocrBoxSegmentCount',
    'ocrEngineVersion',
    'ocrMaskedDurationSeconds',
    'ocrSampleFps',
    'ocrScanProfile',
    'ocrVisualSegmentCount'
  ])

  // Non-automatic blur produces minimal keys
  const manualMeta = createOcrBlurAuditMetadata({ blurMode: 'manual' })
  assert.deepEqual(Object.keys(manualMeta).sort(), ['blurMode', 'ocrSampleFps'])

  // sanitizeAutoShortAuditError strips sensitive paths
  const err = new Error('Failed at C:\\secret\\path\\video.mp4 with dir D:/work/temp')
  const sanitized = sanitizeAutoShortAuditError(err, ['C:\\secret\\path\\video.mp4', 'D:/work/temp'])
  assert.ok(!sanitized.includes('C:\\secret\\path\\video.mp4'))
  assert.ok(!sanitized.includes('D:/work/temp'))
  assert.ok(sanitized.includes('[đường dẫn đã ẩn]'))
})

test('Step 9.2: RED OCR-only automatic reuse (single visual OCR call, same timeline to SRT & mask, burnAutoShort)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-pipe-ocr-only-'))
  try {
    const videoFile = join(root, 'input.mp4')
    await writeFile(videoFile, 'dummy-video-content')
    const outDir = join(root, 'out')
    await mkdir(outDir)

    let visualOcrCallCount = 0
    let timelinePassedToMask: OcrVisualTimeline | null = null
    let burnReqReceived: unknown = null
    let burnOptionsReceived: unknown = null

    const fakeTimeline = sampleTimeline()

    const deps: AutoShortItemCoordinatorDeps = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      probeMedia: async () => mockMeta,
      runVisualOcr: async () => {
        visualOcrCallCount++
        return {
          timeline: fakeTimeline,
          sourceSrtPath: 'source.engine.srt',
          sidecarPath: 'visual-cues.json',
          engineVersion: '1.1.0',
          engineProtocol: 'ocr-local/1',
          visualSegmentCount: 1,
          boxSegmentCount: 1
        }
      },
      writeTimedMask: async (timeline) => {
        timelinePassedToMask = timeline
        const maskFile = join(root, 'mask.mkv')
        await writeFile(maskFile, 'mask-bytes')
        return {
          maskPath: maskFile,
          durationSeconds: 10,
          frameCount: 80,
          width: 1280,
          height: 720
        } as TimedOcrBlurMask
      },
      burn: async (req, opts) => {
        burnReqReceived = req
        burnOptionsReceived = opts
        const outVideo = join(outDir, 'input-phude.mp4')
        await writeFile(outVideo, 'rendered-video')
        return { ok: true, output: outVideo }
      }
    }

    const processor = createAutoShortItemProcessor(deps)
    const context: AutoShortItemContext = {
      jobId: 'job-1',
      request: {
        items: [{ id: 'item-1', filePath: videoFile }],
        config: baseConfig({ outputDir: outDir })
      },
      item: { id: 'item-1', filePath: videoFile },
      index: 0,
      total: 1,
      signal: new AbortController().signal,
      emit: () => {},
      checkpointDir: join(root, 'checkpoint'),
      workDir: join(root, 'work'),
      artifactDir: join(root, 'audit'),
      separationProviderState: { mode: 'auto' }
    }

    const result = await processor(context)
    assert.equal(result.status, 'done')
    assert.equal(visualOcrCallCount, 1, 'Visual OCR must be called exactly once')
    assert.equal(timelinePassedToMask, fakeTimeline, 'Same timeline must be passed to writeTimedMask')

    // Burn options verification
    const req = burnReqReceived as Record<string, unknown>
    const opts = burnOptionsReceived as Record<string, unknown>
    assert.deepEqual(req.blurRegions, [], 'Automatic blur must send empty manual blurRegions to burn')
    assert.ok(opts.timedOcrBlurMask != null, 'burnAutoShort must receive timedOcrBlurMask')

    // Checkpoint contains evidence but NO timeline or mask paths
    const checkpointFile = join(context.checkpointDir, 'checkpoint.json')
    const cpStat = await stat(checkpointFile).catch(() => null)
    if (cpStat) {
      const cp = JSON.parse(await readFile(checkpointFile, 'utf8'))
      assert.equal(cp.version, 5)
      assert.ok(cp.ocrSourceEvidence != null)
      assert.equal(cp.timeline, undefined)
      assert.equal(cp.maskPath, undefined)
      assert.equal(cp.sidecarPath, undefined)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Step 9.3: Whisper+OCR concurrency and 4-row lock table', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-pipe-fused-'))
  try {
    const videoFile = join(root, 'video.mp4')
    await writeFile(videoFile, 'video-bytes')
    const outDir = join(root, 'out')
    await mkdir(outDir)

    const fakeTimeline = sampleTimeline()

    const makeContext = (suffix: string, configOverrides: Partial<AutoShortConfig> = {}) => ({
      jobId: `job-${suffix}`,
      request: {
        items: [{ id: `item-${suffix}`, filePath: videoFile }],
        config: baseConfig({ subtitleMethod: 'whisper-ocr', outputDir: outDir, ...configOverrides })
      },
      item: { id: `item-${suffix}`, filePath: videoFile },
      index: 0,
      total: 1,
      signal: new AbortController().signal,
      emit: () => {},
      checkpointDir: join(root, `cp-${suffix}`),
      workDir: join(root, `work-${suffix}`),
      artifactDir: join(root, `audit-${suffix}`),
      separationProviderState: { mode: 'auto' as const }
    })

    // Row 1: Whisper success + Visual OCR success -> fuse
    {
      let whisperStarted = false
      let ocrStarted = false
      const deps: AutoShortItemCoordinatorDeps = {
        resolveFfmpeg: async () => 'ffmpeg.exe',
        resolveFfprobe: async () => 'ffprobe.exe',
        probeMedia: async () => mockMeta,
        transcribeAudio: async () => {
          whisperStarted = true
          return {
            ok: true,
            outputs: [join(root, 'whisper.srt')],
            language: 'vi'
          }
        },
        runVisualOcr: async () => {
          ocrStarted = true
          return {
            timeline: fakeTimeline,
            sourceSrtPath: 'source.engine.srt',
            sidecarPath: 'visual-cues.json',
            engineVersion: '1.1.0',
            engineProtocol: 'ocr-local/1',
            visualSegmentCount: 1,
            boxSegmentCount: 1
          }
        },
        writeTimedMask: async () => ({
          maskPath: join(root, 'mask.mkv'),
          durationSeconds: 10,
          frameCount: 80,
          width: 1280,
          height: 720
        }),
        burn: async () => {
          const out = join(outDir, 'r1.mp4')
          await writeFile(out, 'out')
          return { ok: true, output: out }
        }
      }
      // write srt for whisper
      await writeFile(join(root, 'whisper.srt'), '1\n00:00:01,000 --> 00:00:03,000\nGiọng nói\n')

      const res = await createAutoShortItemProcessor(deps)(makeContext('r1'))
      assert.equal(res.status, 'done')
      assert.ok(whisperStarted && ocrStarted, 'Both Whisper and OCR must be invoked concurrently')
    }

    // Row 2: Whisper failure + Visual OCR success -> continue with OCR cues & sanitized warning
    {
      const deps: AutoShortItemCoordinatorDeps = {
        resolveFfmpeg: async () => 'ffmpeg.exe',
        resolveFfprobe: async () => 'ffprobe.exe',
        probeMedia: async () => mockMeta,
        transcribeAudio: async () => {
          return { ok: false, error: 'Whisper failed' }
        },
        runVisualOcr: async () => ({
          timeline: fakeTimeline,
          sourceSrtPath: 'source.engine.srt',
          sidecarPath: 'visual-cues.json',
          engineVersion: '1.1.0',
          engineProtocol: 'ocr-local/1',
          visualSegmentCount: 1,
          boxSegmentCount: 1
        }),
        writeTimedMask: async () => ({
          maskPath: join(root, 'mask.mkv'),
          durationSeconds: 10,
          frameCount: 80,
          width: 1280,
          height: 720
        }),
        burn: async () => {
          const out = join(outDir, 'r2.mp4')
          await writeFile(out, 'out')
          return { ok: true, output: out }
        }
      }
      const res = await createAutoShortItemProcessor(deps)(makeContext('r2'))
      assert.equal(res.status, 'done', 'Should succeed with OCR cues when Whisper fails')
    }

    // Row 3: Whisper success + Visual OCR failure -> FAIL item (no Whisper-only fallback in automatic blur)
    {
      const deps: AutoShortItemCoordinatorDeps = {
        resolveFfmpeg: async () => 'ffmpeg.exe',
        resolveFfprobe: async () => 'ffprobe.exe',
        probeMedia: async () => mockMeta,
        transcribeAudio: async () => ({
          ok: true,
          outputs: [join(root, 'whisper.srt')],
          language: 'vi'
        }),
        runVisualOcr: async () => {
          throw new Error('OCR process crashed')
        },
        writeTimedMask: async () => {
          throw new Error('Should not reach mask')
        },
        burn: async () => {
          throw new Error('Should not reach burn')
        }
      }
      const res = await createAutoShortItemProcessor(deps)(makeContext('r3'))
      assert.equal(res.status, 'error', 'Must fail item if visual OCR fails under automatic blur')
      assert.match(res.error || '', /OCR process crashed/iu)
    }

    // Row 4: Whisper failure + Visual OCR failure -> FAIL item
    {
      const deps: AutoShortItemCoordinatorDeps = {
        resolveFfmpeg: async () => 'ffmpeg.exe',
        resolveFfprobe: async () => 'ffprobe.exe',
        probeMedia: async () => mockMeta,
        transcribeAudio: async () => ({ ok: false, error: 'Whisper crash' }),
        runVisualOcr: async () => {
          throw new Error('OCR crash')
        },
        writeTimedMask: async () => {
          throw new Error('Should not reach mask')
        },
        burn: async () => {
          throw new Error('Should not reach burn')
        }
      }
      const res = await createAutoShortItemProcessor(deps)(makeContext('r4'))
      assert.equal(res.status, 'error', 'Must fail item when both fail')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Step 9.4: Whisper-only automatic (restore Whisper cues from checkpoint, run OCR once for mask only)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-pipe-whisper-only-'))
  try {
    const videoFile = join(root, 'video.mp4')
    await writeFile(videoFile, 'content')
    const outDir = join(root, 'out')
    await mkdir(outDir)
    const cpDir = join(root, 'cp')
    await mkdir(cpDir)

    // Pre-populate checkpoint with Whisper source cues
    const existingCues: AlignedCue[] = [
      { id: 'c1', start: 1, end: 3, text: 'Whisper cue from checkpoint', source: 'whisper', timingQuality: 'cue' }
    ]
    const inputStat = await stat(videoFile)
    const { buildAutoShortCheckpointFingerprint, AUTO_SHORT_CHECKPOINT_VERSION } = await import('../src/main/autoshort')
    const cfg = baseConfig({ subtitleMethod: 'whisper', outputDir: outDir })
    const fp = buildAutoShortCheckpointFingerprint(videoFile, inputStat, cfg)

    await writeFile(join(cpDir, 'checkpoint.json'), JSON.stringify({
      version: AUTO_SHORT_CHECKPOINT_VERSION,
      fingerprint: fp,
      sourceCues: existingCues,
      detectedSourceLanguage: 'vi'
    }))

    let transcribeCalled = false
    let visualOcrCallCount = 0
    let burnReceivedSrt: string = ''

    const deps: AutoShortItemCoordinatorDeps = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      probeMedia: async () => mockMeta,
      transcribeAudio: async () => {
        transcribeCalled = true
        return { ok: true, outputs: [] }
      },
      runVisualOcr: async () => {
        visualOcrCallCount++
        return {
          timeline: sampleTimeline(),
          sourceSrtPath: 'source.engine.srt',
          sidecarPath: 'visual-cues.json',
          engineVersion: '1.1.0',
          engineProtocol: 'ocr-local/1',
          visualSegmentCount: 1,
          boxSegmentCount: 1
        }
      },
      writeTimedMask: async () => ({
        maskPath: join(root, 'mask.mkv'),
        durationSeconds: 10,
        frameCount: 80,
        width: 1280,
        height: 720
      }),
      burn: async (req) => {
        burnReceivedSrt = await readFile(req.srt, 'utf8')
        const out = join(outDir, 'whisper-done.mp4')
        await writeFile(out, 'out')
        return { ok: true, output: out }
      }
    }

    const context: AutoShortItemContext = {
      jobId: 'job-w',
      request: { items: [{ id: 'item-w', filePath: videoFile }], config: cfg },
      item: { id: 'item-w', filePath: videoFile },
      index: 0,
      total: 1,
      signal: new AbortController().signal,
      emit: () => {},
      checkpointDir: cpDir,
      workDir: join(root, 'work'),
      artifactDir: join(root, 'audit'),
      separationProviderState: { mode: 'auto' }
    }

    const res = await createAutoShortItemProcessor(deps)(context)
    assert.equal(res.status, 'done')
    assert.equal(transcribeCalled, false, 'Whisper transcription should be skipped when checkpoint cues exist')
    assert.equal(visualOcrCallCount, 1, 'Visual OCR must be called once for mask generation')
    assert.ok(burnReceivedSrt.includes('Whisper cue from checkpoint'), 'SRT burned must contain original Whisper text')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Step 9.8: Parameterized failure matrix & cleanup verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-pipe-failures-'))
  try {
    const videoFile = join(root, 'source.mp4')
    await writeFile(videoFile, 'source')
    const outDir = join(root, 'out')
    await mkdir(outDir)

    // Test cases: [name, overrides to deps]
    const testCases: Array<{
      name: string
      depsFactory: (workDir: string) => Partial<AutoShortItemCoordinatorDeps>
      expectedErrorPattern: RegExp
    }> = [
      {
        name: 'empty OCR detection failure',
        depsFactory: () => ({
          runVisualOcr: async () => ({
            timeline: { ...sampleTimeline(), segments: [] },
            sourceSrtPath: 'srt',
            sidecarPath: 'sidecar',
            engineVersion: '1.1.0',
            engineProtocol: 'ocr-local/1',
            visualSegmentCount: 0,
            boxSegmentCount: 0
          })
        }),
        expectedErrorPattern: /OCR không phát hiện vùng chữ hợp lệ/u
      },
      {
        name: 'mask generation throws',
        depsFactory: () => ({
          runVisualOcr: async () => ({
            timeline: sampleTimeline(),
            sourceSrtPath: 'srt',
            sidecarPath: 'sidecar',
            engineVersion: '1.1.0',
            engineProtocol: 'ocr-local/1',
            visualSegmentCount: 1,
            boxSegmentCount: 1
          }),
          writeTimedMask: async () => {
            throw new Error('FFV1 encoder failed')
          }
        }),
        expectedErrorPattern: /FFV1 encoder failed/u
      },
      {
        name: 'burn fails',
        depsFactory: () => ({
          runVisualOcr: async () => ({
            timeline: sampleTimeline(),
            sourceSrtPath: 'srt',
            sidecarPath: 'sidecar',
            engineVersion: '1.1.0',
            engineProtocol: 'ocr-local/1',
            visualSegmentCount: 1,
            boxSegmentCount: 1
          }),
          writeTimedMask: async () => ({
            maskPath: 'mask.mkv',
            durationSeconds: 10,
            frameCount: 80,
            width: 1280,
            height: 720
          }),
          burn: async () => ({ ok: false, error: 'FFmpeg filter crashed' })
        }),
        expectedErrorPattern: /FFmpeg filter crashed|không đọc được video/u
      }
    ]

    for (const tc of testCases) {
      const workDir = join(root, `work-${tc.name.replace(/\s+/g, '-')}`)
      const cpDir = join(root, `cp-${tc.name.replace(/\s+/g, '-')}`)
      const auditDir = join(root, `audit-${tc.name.replace(/\s+/g, '-')}`)

      const fullDeps: AutoShortItemCoordinatorDeps = {
        resolveFfmpeg: async () => 'ffmpeg.exe',
        resolveFfprobe: async () => 'ffprobe.exe',
        probeMedia: async () => mockMeta,
        runVisualOcr: async () => ({
          timeline: sampleTimeline(),
          sourceSrtPath: 'srt',
          sidecarPath: 'sidecar',
          engineVersion: '1.1.0',
          engineProtocol: 'ocr-local/1',
          visualSegmentCount: 1,
          boxSegmentCount: 1
        }),
        writeTimedMask: async () => ({
          maskPath: 'mask.mkv',
          durationSeconds: 10,
          frameCount: 80,
          width: 1280,
          height: 720
        }),
        burn: async () => ({ ok: true, output: 'out.mp4' }),
        ...tc.depsFactory(workDir)
      }

      const context: AutoShortItemContext = {
        jobId: `job-${tc.name}`,
        request: { items: [{ id: 'item-f', filePath: videoFile }], config: baseConfig({ outputDir: outDir }) },
        item: { id: 'item-f', filePath: videoFile },
        index: 0,
        total: 1,
        signal: new AbortController().signal,
        emit: () => {},
        checkpointDir: cpDir,
        workDir,
        artifactDir: auditDir,
        separationProviderState: { mode: 'auto' }
      }

      const result = await createAutoShortItemProcessor(fullDeps)(context)
      assert.equal(result.status, 'error', `Case "${tc.name}" must return error status`)
      assert.match(result.error || '', tc.expectedErrorPattern, `Case "${tc.name}" error message pattern`)

      // Assert workDir was cleaned up
      const workStat = await stat(workDir).catch(() => null)
      assert.equal(workStat, null, `Work directory for "${tc.name}" must be deleted on failure`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
