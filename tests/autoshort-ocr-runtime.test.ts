import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ChildProcess } from 'node:child_process'
import {
  assertContainedRegularFile,
  assertContainedParentDirectory
} from '../src/main/safeContainedPath'
import {
  ocrVideoWithVisualTimeline,
  type AutoShortOcrVideoOptions
} from '../src/main/ocr'
import { probeRuntimeAsset, probeRuntimeExecutable } from '../src/main/runtimeProbes'
import type { RuntimeAssetSpec } from '../src/main/runtimeManifest'
import type { CanonicalDisplayGeometry } from '../src/main/canonicalDisplayGeometry'
import type { PixelRegion } from '../src/shared/types'

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
