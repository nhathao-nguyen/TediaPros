import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { test } from 'node:test'
import type { ChildProcess } from 'node:child_process'
import {
  assertContainedRegularFile,
  assertContainedParentDirectory
} from '../src/main/safeContainedPath'
import {
  ocrVideoWithVisualTimeline,
  negotiateOcrVisualTransport,
  validateOcrSrtOutput,
  type AutoShortOcrVideoOptions
} from '../src/main/ocr'
import { probeRuntimeAsset, probeRuntimeExecutable } from '../src/main/runtimeProbes'
import type { RuntimeAssetSpec } from '../src/main/runtimeManifest'
import type { CanonicalDisplayGeometry } from '../src/main/canonicalDisplayGeometry'
import type { AutoShortDependencyConfig, PixelRegion } from '../src/shared/types'
import {
  getAutoShortReadiness,
  installAutoShortDependencies,
  type AutoShortReadinessHooks,
  type AutoShortInstallHooks
} from '../src/main/autoshort'
import {
  probeFfmpegOcrMaskCapability,
  clearFfmpegOcrMaskProbeCache,
  getFfmpegOcrMaskProbeCacheSize,
  type FfmpegInstallOptions
} from '../src/main/ffmpegOcrMaskProbe'

test('OCR transport negotiation defaults to stream-full only for a qualified binary and keeps ROI opt-in', () => {
  const qualified = {
    healthy: true,
    version: '1.2.0',
    protocol: 'ocr-local/1',
    features: ['visual-stream-full-v1', 'visual-stream-roi-v1']
  }
  assert.equal(negotiateOcrVisualTransport(undefined, qualified).effective, 'stream-full')
  assert.equal(negotiateOcrVisualTransport('stream-roi', qualified).effective, 'stream-roi')
  assert.equal(negotiateOcrVisualTransport('legacy-disk', qualified).effective, 'legacy-disk')

  const legacy = { healthy: true, version: '1.1.0', protocol: 'ocr-local/1', features: ['visual-cues-v1'] }
  const fallback = negotiateOcrVisualTransport('stream-roi', legacy)
  assert.equal(fallback.effective, 'legacy-disk')
  assert.match(fallback.reason || '', /visual-stream-roi-v1/u)
})

test('standalone OCR output validation rejects missing, empty, and count-mismatched SRT', () => {
  assert.throws(() => validateOcrSrtOutput('', 1), /SRT có cue hợp lệ/u)
  assert.throws(() => validateOcrSrtOutput('not an srt', 1), /SRT có cue hợp lệ/u)
  const valid = '1\n00:00:00,000 --> 00:00:01,000\nHello\n'
  assert.throws(() => validateOcrSrtOutput(valid, 0), /SRT có cue hợp lệ/u)
  assert.equal(validateOcrSrtOutput(valid, 1).length, 1)
})

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid = 99999
  killed = false

  kill(): boolean {
    this.killed = true
    this.emit('close', 0)
    return true
  }
}

const mockGeometry: CanonicalDisplayGeometry = {
  codedWidth: 576,
  codedHeight: 768,
  rotation: 0,
  sampleAspectRatio: { numerator: 1, denominator: 1 },
  videoStart: 0,
  displayWidth: 576,
  displayHeight: 768,
  fingerprint: 'a'.repeat(64)
}

const mockScanRegion: PixelRegion = {
  x0: 50,
  y0: 100,
  x1: 500,
  y1: 600
}

test('assertContainedRegularFile validates regular file inside root and rejects escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-path-safety-'))
  try {
    const validFile = join(root, 'valid.txt')
    await writeFile(validFile, 'hello')

    // Valid file succeeds
    const resolved = await assertContainedRegularFile(validFile, root, 'Test file')
    assert.ok(resolved.length > 0)

    // Relative candidate rejected
    await assert.rejects(
      async () => assertContainedRegularFile('relative.txt', root, 'Test'),
      /tuyệt đối/u
    )

    // Directory rejected
    const subDir = join(root, 'subdir')
    await mkdir(subDir)
    await assert.rejects(
      async () => assertContainedRegularFile(subDir, root, 'Test'),
      /regular file/u
    )

    // Missing file rejected
    await assert.rejects(
      async () => assertContainedRegularFile(join(root, 'missing.txt'), root, 'Test'),
      /không tồn tại/u
    )

    // Escaping file rejected
    const outside = await mkdtemp(join(tmpdir(), 'tedia-outside-'))
    const outsideFile = join(outside, 'outside.txt')
    await writeFile(outsideFile, 'secret')
    await assert.rejects(
      async () => assertContainedRegularFile(outsideFile, root, 'Test'),
      /ngoài thư mục gốc/u
    )
    await rm(outside, { recursive: true, force: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('probeRuntimeAsset calculates verified features and checks manifest capabilities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-probe-'))
  try {
    // Create a mock script that behaves like ocr-engine
    const scriptPath = join(root, 'mock-engine.js')
    await writeFile(
      scriptPath,
      `
      const args = process.argv.slice(2);
      if (args.includes('--version')) {
        console.log(JSON.stringify({
          type: 'version',
          protocol: 'ocr-local/1',
          engine: 'rapidocr',
          version: '1.1.0',
          features: ['directml-fallback', 'probe', 'rapidocr', 'visual-cues-v1']
        }));
        process.exit(0);
      }
      if (args.includes('--probe')) {
        console.log(JSON.stringify({
          type: 'probe',
          protocol: 'ocr-local/1',
          ready: true,
          engine: 'rapidocr',
          version: '1.1.0',
          features: ['visual-cues-v1', 'rapidocr', 'probe', 'directml-fallback']
        }));
        process.exit(0);
      }
      process.exit(1);
    `
    )

    const isWin = process.platform === 'win32'
    const entrypointName = isWin ? 'mock-engine.cmd' : 'mock-engine.js'
    if (isWin) {
      await writeFile(join(root, 'mock-engine.cmd'), `@echo off\r\nnode "%~dp0mock-engine.js" %*\r\n`)
    } else {
      await import('node:fs/promises').then((fs) => fs.chmod(scriptPath, 0o755))
    }

    const spec: RuntimeAssetSpec = {
      version: '1.1.0',
      platform: isWin ? 'win32' : 'linux',
      arch: 'x64',
      asset: 'ocr-engine.zip',
      sha256: '0'.repeat(64),
      bytes: 1000,
      entrypoint: entrypointName,
      capabilities: ['visual-cues-v1'],
      files: [entrypointName, 'mock-engine.js']
    }

    const res = await probeRuntimeAsset('ocr-engine', root, spec)
    assert.equal(res.healthy, true)
    assert.deepEqual(res.features, ['directml-fallback', 'probe', 'rapidocr', 'visual-cues-v1'])

    // When manifest requires capability absent from probe
    const strictSpec: RuntimeAssetSpec = {
      ...spec,
      capabilities: ['visual-cues-v1', 'unsupported-future-capability']
    }
    const strictRes = await probeRuntimeAsset('ocr-engine', root, strictSpec)
    assert.equal(strictRes.healthy, false)
    assert.match(strictRes.message || '', /thiếu capabilities/iu)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ocrVideoWithVisualTimeline executes successfully and validates sidecar authority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-run-'))
  const outputDir = join(root, 'job-out')
  await mkdir(outputDir, { recursive: true })

  try {
    const validTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: {
        width: mockGeometry.displayWidth,
        height: mockGeometry.displayHeight,
        durationSeconds: 1.0,
        sampleFps: 8,
        frameCount: 8,
        geometryFingerprint: mockGeometry.fingerprint
      },
      profile: 'fast',
      scanRegion: mockScanRegion,
      segments: [
        {
          id: 'fast-0-4',
          startFrame: 0,
          endFrameExclusive: 4,
          start: 0.0,
          end: 0.5,
          text: 'Sidecar Authoritative Text',
          confidence: 0.9,
          boxes: [
            {
              x0: 60,
              y0: 120,
              x1: 200,
              y1: 180,
              text: 'Sidecar Authoritative Text',
              confidence: 0.9
            }
          ]
        }
      ]
    }

    const mockSpawn = (_command: string, args: string[]) => {
      const cp = new MockChildProcess()
      const outIdx = args.indexOf('--output')
      const engineSrt = args[outIdx + 1]
      const sidecarIdx = args.indexOf('--visual-cues-output')
      const sidecar = args[sidecarIdx + 1]

      process.nextTick(async () => {
        // Write conflicting engine SRT
        await writeFile(engineSrt, '1\n00:00:00,000 --> 00:00:01,000\nConflicting Wrong Text\n')
        // Write valid sidecar JSON
        await writeFile(sidecar, JSON.stringify(validTimeline))

        cp.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'progress', percent: 50 }) + '\n'))
        cp.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'done',
          output: engineSrt,
          visual_cues: sidecar,
          version: '1.1.0',
          count: 1
        }) + '\n'))
        cp.emit('close', 0)
      })
      return cp as unknown as ChildProcess
    }

    const options: AutoShortOcrVideoOptions = {
      input: 'dummy.mp4',
      outputDir,
      scanRegion: mockScanRegion,
      profile: 'fast',
      geometry: mockGeometry,
      videoDurationSeconds: 1.0,
      sampleFps: 8,
      signal: new AbortController().signal,
      spawnChild: mockSpawn as unknown as typeof import('node:child_process').spawn,
      engineExecutable: 'mock-engine.exe',
      ffmpegExecutable: 'mock-ffmpeg.exe'
    }

    const result = await ocrVideoWithVisualTimeline(options)

    // Assert sidecar authority
    assert.equal(result.timeline.segments[0].text, 'Sidecar Authoritative Text')
    assert.equal(result.visualSegmentCount, 1)
    assert.equal(result.boxSegmentCount, 1)
    assert.equal(result.engineVersion, '1.1.0')
    assert.equal(result.engineProtocol, 'ocr-local/1')

    // Assert authoritative SRT contains sidecar text, not conflicting engine text
    const srtContent = await import('node:fs/promises').then((fs) => fs.readFile(result.sourceSrtPath, 'utf8'))
    assert.match(srtContent, /Sidecar Authoritative Text/u)
    assert.doesNotMatch(srtContent, /Conflicting Wrong Text/u)

    // Assert engine SRT was removed
    const engineSrtPath = join(join(outputDir, Object.keys(validTimeline).length > 0 ? '' : ''), 'source.engine.srt')
    const engineExists = await import('node:fs/promises').then((fs) => fs.access(engineSrtPath).then(() => true).catch(() => false))
    assert.equal(engineExists, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ocrVideoWithVisualTimeline rejects mismatched done paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-bad-paths-'))
  try {
    const mockSpawn = () => {
      const cp = new MockChildProcess()
      process.nextTick(() => {
        cp.stdout.emit('data', Buffer.from(JSON.stringify({
          type: 'done',
          output: '/different/path/output.srt',
          visual_cues: '/different/path/sidecar.json'
        }) + '\n'))
        cp.emit('close', 0)
      })
      return cp as unknown as ChildProcess
    }

    const options: AutoShortOcrVideoOptions = {
      input: 'dummy.mp4',
      outputDir: root,
      scanRegion: mockScanRegion,
      profile: 'fast',
      geometry: mockGeometry,
      videoDurationSeconds: 1.0,
      sampleFps: 8,
      signal: new AbortController().signal,
      spawnChild: mockSpawn as unknown as typeof import('node:child_process').spawn,
      engineExecutable: 'mock-engine.exe',
      ffmpegExecutable: 'mock-ffmpeg.exe'
    }

    await assert.rejects(
      async () => ocrVideoWithVisualTimeline(options),
      /không khớp/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ocrVideoWithVisualTimeline rejects child process failure with sanitized message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-fail-'))
  try {
    const mockSpawn = () => {
      const cp = new MockChildProcess()
      process.nextTick(() => {
        cp.stderr.emit('data', Buffer.from('Error: segmentation fault in native backend\n'))
        cp.emit('close', 1)
      })
      return cp as unknown as ChildProcess
    }

    const options: AutoShortOcrVideoOptions = {
      input: 'dummy.mp4',
      outputDir: root,
      scanRegion: mockScanRegion,
      profile: 'fast',
      geometry: mockGeometry,
      videoDurationSeconds: 1.0,
      sampleFps: 8,
      signal: new AbortController().signal,
      spawnChild: mockSpawn as unknown as typeof import('node:child_process').spawn,
      engineExecutable: 'mock-engine.exe',
      ffmpegExecutable: 'mock-ffmpeg.exe'
    }

    await assert.rejects(
      async () => ocrVideoWithVisualTimeline(options),
      /thất bại/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ocrVideoWithVisualTimeline rejects pre-aborted and mid-run cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-abort-'))
  try {
    const preAborted = new AbortController()
    preAborted.abort()

    const options: AutoShortOcrVideoOptions = {
      input: 'dummy.mp4',
      outputDir: root,
      scanRegion: mockScanRegion,
      profile: 'fast',
      geometry: mockGeometry,
      videoDurationSeconds: 1.0,
      sampleFps: 8,
      signal: preAborted.signal,
      engineExecutable: 'mock-engine.exe',
      ffmpegExecutable: 'mock-ffmpeg.exe'
    }

    await assert.rejects(
      async () => ocrVideoWithVisualTimeline(options),
      /huỷ/u
    )

    // Mid-run cancellation
    const midAc = new AbortController()
    const mockSpawn = () => {
      const cp = new MockChildProcess()
      process.nextTick(() => {
        midAc.abort()
      })
      return cp as unknown as ChildProcess
    }

    await assert.rejects(
      async () => ocrVideoWithVisualTimeline({
        ...options,
        signal: midAc.signal,
        spawnChild: mockSpawn as unknown as typeof import('node:child_process').spawn
      }),
      /huỷ/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ocrVideoWithVisualTimeline enforces phase-aware watchdog timeouts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-timeout-'))
  try {
    // 1. Model load timeout test
    const mockHangingSpawn = () => {
      const cp = new MockChildProcess()
      // Never emits anything
      return cp as unknown as ChildProcess
    }

    const options: AutoShortOcrVideoOptions = {
      input: 'dummy.mp4',
      outputDir: root,
      scanRegion: mockScanRegion,
      profile: 'fast',
      geometry: mockGeometry,
      videoDurationSeconds: 1.0,
      sampleFps: 8,
      signal: new AbortController().signal,
      modelLoadTimeoutMs: 50,
      progressTimeoutMs: 50,
      spawnChild: mockHangingSpawn as unknown as typeof import('node:child_process').spawn,
      engineExecutable: 'mock-engine.exe',
      ffmpegExecutable: 'mock-ffmpeg.exe'
    }

    await assert.rejects(
      async () => ocrVideoWithVisualTimeline(options),
      /quá thời gian khởi động mô hình/u
    )

    // 2. Progress timeout test (progress starts, then stalls)
    const mockStallingSpawn = () => {
      const cp = new MockChildProcess()
      process.nextTick(() => {
        cp.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'progress', percent: 10 }) + '\n'))
      })
      return cp as unknown as ChildProcess
    }

    await assert.rejects(
      async () => ocrVideoWithVisualTimeline({
        ...options,
        spawnChild: mockStallingSpawn as unknown as typeof import('node:child_process').spawn
      }),
      /không có tiến độ mới/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ocrVideoWithVisualTimeline rejects sidecar with empty segments or geometry mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-ocr-geom-'))
  try {
    const mockSpawnWithSidecar = (sidecarContent: unknown) => {
      return (_cmd: string, args: string[]) => {
        const cp = new MockChildProcess()
        const outIdx = args.indexOf('--output')
        const engineSrt = args[outIdx + 1]
        const sidecarIdx = args.indexOf('--visual-cues-output')
        const sidecar = args[sidecarIdx + 1]
        process.nextTick(async () => {
          await writeFile(engineSrt, '1\n00:00:00,000 --> 00:00:01,000\nText\n')
          await writeFile(sidecar, JSON.stringify(sidecarContent))
          cp.stdout.emit('data', Buffer.from(JSON.stringify({
            type: 'done',
            output: engineSrt,
            visual_cues: sidecar,
            version: '1.1.0'
          }) + '\n'))
          cp.emit('close', 0)
        })
        return cp as unknown as ChildProcess
      }
    }

    const options: AutoShortOcrVideoOptions = {
      input: 'dummy.mp4',
      outputDir: root,
      scanRegion: mockScanRegion,
      profile: 'fast',
      geometry: mockGeometry,
      videoDurationSeconds: 1.0,
      sampleFps: 8,
      signal: new AbortController().signal,
      engineExecutable: 'mock-engine.exe',
      ffmpegExecutable: 'mock-ffmpeg.exe'
    }

    // 1. Empty segments
    const emptyTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: {
        width: mockGeometry.displayWidth,
        height: mockGeometry.displayHeight,
        durationSeconds: 1.0,
        sampleFps: 8,
        frameCount: 8,
        geometryFingerprint: mockGeometry.fingerprint
      },
      profile: 'fast',
      scanRegion: mockScanRegion,
      segments: []
    }
    await assert.rejects(
      async () => ocrVideoWithVisualTimeline({
        ...options,
        spawnChild: mockSpawnWithSidecar(emptyTimeline) as unknown as typeof import('node:child_process').spawn
      }),
      /không chứa segment/u
    )

    // 2. Geometry mismatch (wrong width)
    const mismatchTimeline = {
      ...emptyTimeline,
      video: {
        ...emptyTimeline.video,
        width: 9999
      },
      segments: [
        {
          id: 'fast-0-4',
          startFrame: 0,
          endFrameExclusive: 4,
          start: 0,
          end: 0.5,
          text: 'Text',
          confidence: 0.9,
          boxes: [{ x0: 60, y0: 120, x1: 200, y1: 180, text: 'Text', confidence: 0.9 }]
        }
      ]
    }
    await assert.rejects(
      async () => ocrVideoWithVisualTimeline({
        ...options,
        spawnChild: mockSpawnWithSidecar(mismatchTimeline) as unknown as typeof import('node:child_process').spawn
      }),
      /không khớp/u
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('getAutoShortReadiness evaluates readiness matrix for automatic and manual OCR blur', async () => {
  // Row 1: ocr-auto + accurate + lamMo: true + mask probe ok + ocr ok => ready: true
  const baseHooks: AutoShortReadinessHooks = {
    resolveFfmpeg: async () => 'C:\\mock\\ffmpeg.exe',
    ocrEngineStatus: async () => ({
      has: true,
      healthy: true,
      needsUpdate: false,
      version: '1.1.0',
      protocol: 'ocr-local/1',
      engine: 'rapidocr',
      features: ['visual-cues-v1', 'rapidocr']
    }),
    probeFfmpegOcrMaskCapability: async () => ({
      healthy: true,
      features: ['ocr-mask-v1'],
      probeSchemaVersion: 1
    }),
    whisperEngineStatus: async () => ({
      has: true,
      healthy: true,
      needsUpdate: false,
      version: '1.0.0',
      protocol: 'whisper-engine/1',
      engine: 'faster-whisper',
      features: ['probe']
    }),
    whisperModelStatus: async () => ({
      model: 'base',
      installed: true,
      complete: true
    })
  }

  const row1Config: AutoShortDependencyConfig = {
    subtitleMethod: 'ocr',
    blurMode: 'ocr-auto',
    ocrScanProfile: 'accurate',
    lamMo: true
  }
  const res1 = await getAutoShortReadiness(row1Config, baseHooks)
  assert.equal(res1.ready, true)
  assert.equal(res1.dependencies.find((d) => d.id === 'ffmpeg')?.ready, true)
  assert.equal(res1.dependencies.find((d) => d.id === 'ocr-engine')?.ready, true)

  // Row 2: ocr-auto + accurate + lamMo: true + mask probe failing + ocr ok => ready: false (ffmpeg missing mask capability)
  const row2Hooks: AutoShortReadinessHooks = {
    ...baseHooks,
    probeFfmpegOcrMaskCapability: async () => ({
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: 'Probe failed'
    })
  }
  const res2 = await getAutoShortReadiness(row1Config, row2Hooks)
  assert.equal(res2.ready, false)
  const ffDep2 = res2.dependencies.find((d) => d.id === 'ffmpeg')
  assert.equal(ffDep2?.ready, false)
  assert.equal(ffDep2?.message, 'FFmpeg hiện tại chưa qua kiểm tra mặt nạ OCR.')

  // Row 3: ocr-auto + accurate + lamMo: true + mask probe ok + ocr missing visual-cues-v1 => ready: false (ocr needs update)
  const row3Hooks: AutoShortReadinessHooks = {
    ...baseHooks,
    ocrEngineStatus: async () => ({
      has: true,
      healthy: true,
      needsUpdate: false,
      version: '1.0.0',
      protocol: 'ocr-local/1',
      engine: 'rapidocr',
      features: ['rapidocr']
    })
  }
  const res3 = await getAutoShortReadiness(row1Config, row3Hooks)
  assert.equal(res3.ready, false)
  const ocrDep3 = res3.dependencies.find((d) => d.id === 'ocr-engine')
  assert.equal(ocrDep3?.ready, false)
  assert.equal(ocrDep3?.message, 'OCR engine cần cập nhật để tạo vùng làm mờ theo chữ.')

  // Row 4: ocr-auto + fast + lamMo: false + mask probe failing + ocr missing visual-cues-v1 => ready: true (blur disabled)
  const row4Config: AutoShortDependencyConfig = {
    subtitleMethod: 'ocr',
    blurMode: 'ocr-auto',
    ocrScanProfile: 'fast',
    lamMo: false
  }
  const res4 = await getAutoShortReadiness(row4Config, {
    ...row2Hooks,
    ...row3Hooks
  })
  assert.equal(res4.ready, true)
  assert.equal(res4.dependencies.find((d) => d.id === 'ffmpeg')?.ready, true)
  assert.equal(res4.dependencies.find((d) => d.id === 'ocr-engine')?.ready, true)

  // Row 5: manual + accurate + lamMo: true + mask probe failing + ocr missing visual-cues-v1 => ready: true (manual blur only needs standard ffmpeg)
  const row5Config: AutoShortDependencyConfig = {
    subtitleMethod: 'ocr',
    blurMode: 'manual',
    ocrScanProfile: 'accurate',
    lamMo: true
  }
  const res5 = await getAutoShortReadiness(row5Config, {
    ...row2Hooks,
    ...row3Hooks
  })
  assert.equal(res5.ready, true)
  assert.equal(res5.dependencies.find((d) => d.id === 'ffmpeg')?.ready, true)
  assert.equal(res5.dependencies.find((d) => d.id === 'ocr-engine')?.ready, true)

  // Row 6: whisper + blurMode: ocr-auto + lamMo: false + mask probe failing + ocr absent => ready: true
  const row6Config: AutoShortDependencyConfig = {
    subtitleMethod: 'whisper',
    blurMode: 'ocr-auto',
    ocrScanProfile: 'accurate',
    lamMo: false
  }
  const row6Hooks: AutoShortReadinessHooks = {
    ...baseHooks,
    ocrEngineStatus: async () => ({
      has: false,
      healthy: false,
      needsUpdate: false,
      version: null,
      protocol: null,
      engine: 'rapidocr',
      features: []
    }),
    probeFfmpegOcrMaskCapability: async () => ({
      healthy: false,
      features: [],
      probeSchemaVersion: 1
    })
  }
  const res6 = await getAutoShortReadiness(row6Config, row6Hooks)
  assert.equal(res6.ready, true)
  assert.equal(res6.dependencies.some((d) => d.id === 'ocr-engine'), false)
  assert.equal(res6.dependencies.find((d) => d.id === 'ffmpeg')?.ready, true)
})

test('installAutoShortDependencies triggers capability-aware installs and reprobes', async () => {
  let ffmpegInstallCalled = false
  let ffmpegInstallOptions: FfmpegInstallOptions | undefined
  let ocrInstallCalled = false

  let ffmpegMaskOk = false
  let ocrVisualOk = false

  const readinessHooks: AutoShortReadinessHooks = {
    resolveFfmpeg: async () => 'C:\\mock\\ffmpeg.exe',
    ocrEngineStatus: async () => ({
      has: true,
      healthy: true,
      needsUpdate: false,
      version: '1.1.0',
      protocol: 'ocr-local/1',
      engine: 'rapidocr',
      features: ocrVisualOk ? ['visual-cues-v1'] : []
    }),
    probeFfmpegOcrMaskCapability: async () => ({
      healthy: ffmpegMaskOk,
      features: ffmpegMaskOk ? ['ocr-mask-v1'] : [],
      probeSchemaVersion: 1
    })
  }

  const installHooks: AutoShortInstallHooks = {
    readinessHooks,
    installFfmpeg: async (_onProgress, options) => {
      ffmpegInstallCalled = true
      ffmpegInstallOptions = options
      ffmpegMaskOk = true
    },
    installOcrEngine: async () => {
      ocrInstallCalled = true
      ocrVisualOk = true
    }
  }

  const config: AutoShortDependencyConfig = {
    subtitleMethod: 'ocr',
    blurMode: 'ocr-auto',
    ocrScanProfile: 'accurate',
    lamMo: true
  }

  const progressEvents: Array<{ id: string; phase: string }> = []
  const result = await installAutoShortDependencies(
    config,
    (p) => progressEvents.push({ id: p.id, phase: p.phase }),
    undefined,
    installHooks
  )

  assert.equal(result.ready, true)
  assert.equal(ffmpegInstallCalled, true)
  assert.deepEqual(ffmpegInstallOptions, { forceCapabilityReinstall: 'ocr-mask-v1' })
  assert.equal(ocrInstallCalled, true)

  // When post-install check remains false for automatic blur, throws explicit error
  let failFfmpegMaskOk = false
  const failingInstallHooks: AutoShortInstallHooks = {
    readinessHooks: {
      ...readinessHooks,
      probeFfmpegOcrMaskCapability: async () => ({
        healthy: failFfmpegMaskOk,
        features: failFfmpegMaskOk ? ['ocr-mask-v1'] : [],
        probeSchemaVersion: 1
      })
    },
    installFfmpeg: async () => {
      failFfmpegMaskOk = false
    },
    installOcrEngine: async () => {}
  }

  await assert.rejects(
    async () => installAutoShortDependencies(config, () => {}, undefined, failingInstallHooks),
    /Sau khi cài đặt FFmpeg\/OCR engine, môi trường vẫn chưa hỗ trợ tính năng làm mờ chữ tự động/u
  )
})

test('probeFfmpegOcrMaskCapability rejects invalid paths, missing sibling ffprobe, and avoids caching failures', async () => {
  clearFfmpegOcrMaskProbeCache()

  // 1. Relative path rejected
  const relResult = await probeFfmpegOcrMaskCapability('relative/ffmpeg.exe')
  assert.equal(relResult.healthy, false)
  assert.match(relResult.message || '', /đường dẫn tuyệt đối/u)

  // 2. Non-existent file rejected
  const root = await mkdtemp(join(tmpdir(), 'tedia-probe-test-'))
  try {
    const missingFfmpeg = join(root, 'ffmpeg.exe')
    const missResult = await probeFfmpegOcrMaskCapability(missingFfmpeg)
    assert.equal(missResult.healthy, false)
    assert.match(missResult.message || '', /Không tìm thấy FFmpeg/u)

    // 3. Ffmpeg exists but ffprobe is missing in same dir
    await writeFile(missingFfmpeg, 'dummy ffmpeg binary')
    const noProbeResult = await probeFfmpegOcrMaskCapability(missingFfmpeg)
    assert.equal(noProbeResult.healthy, false)
    assert.match(noProbeResult.message || '', /Không tìm thấy FFprobe cùng thư mục/u)

    // 4. Failed probe does not store cache
    assert.equal(getFfmpegOcrMaskProbeCacheSize(), 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('probeFfmpegOcrMaskCapability verifies real ffmpeg and validates caching', async () => {
  const possiblePaths = [
    join(process.env.APPDATA || '', 'tedia-pros', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    join(process.env.LOCALAPPDATA || '', 'tedia-pros', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  ]
  let realFfmpeg: string | null = null
  for (const p of possiblePaths) {
    if (await import('node:fs/promises').then((fs) => fs.access(p).then(() => true).catch(() => false))) {
      realFfmpeg = p
      break
    }
  }

  if (!realFfmpeg) return

  clearFfmpegOcrMaskProbeCache()
  assert.equal(getFfmpegOcrMaskProbeCacheSize(), 0)

  const result1 = await probeFfmpegOcrMaskCapability(realFfmpeg)
  assert.equal(result1.healthy, true)
  assert.deepEqual(result1.features, ['ocr-mask-v1'])
  assert.equal(getFfmpegOcrMaskProbeCacheSize(), 1)

  // Second probe should hit cache immediately
  const t0 = Date.now()
  const result2 = await probeFfmpegOcrMaskCapability(realFfmpeg)
  const duration = Date.now() - t0
  assert.equal(result2.healthy, true)
  assert.deepEqual(result2, result1)
  assert.ok(duration < 100, `Cached probe should return almost instantly (${duration}ms)`)
})
