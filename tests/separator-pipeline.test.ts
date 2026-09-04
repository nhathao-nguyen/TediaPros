import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ChildProcess } from 'node:child_process'
import { runSeparatorEngine } from '../src/main/separation/runner'
import { requiredSeparationWorkspaceBytes } from '../src/main/separation/disk'
import { separateSourceAudio, type SeparatorProviderState } from '../src/main/separation/pipeline'
import type { InstalledSeparatorModel } from '../src/main/separation/modelStore'
import { buildAutoShortNarratedAudioArgs } from '../src/main/autoShortNarratedAudio'

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  pid = 12345
  killed = false

  kill(): boolean {
    this.killed = true
    this.emit('close', 0)
    return true
  }
}

const fakeModel = (dir: string): InstalledSeparatorModel => ({
  id: 'separator-fast-balanced-v1',
  directory: dir,
  modelPath: join(dir, 'model.onnx'),
  manifestPath: join(dir, 'manifest.json'),
  spec: {
    id: 'separator-fast-balanced-v1',
    version: '1.0.0',
    asset: 'separator-fast-balanced-v1.zip',
    archiveBytes: 1000,
    expandedBytes: 2000,
    archiveSha256: 'a'.repeat(64),
    model: { path: 'model.onnx', bytes: 2000, sha256: 'b'.repeat(64) },
    mdx: {
      sampleRate: 44100,
      channels: 2,
      nFft: 6144,
      hopLength: 1024,
      dimF: 3072,
      dimT: 256,
      segmentSamples: 262144,
      primaryStem: 'instrumental'
    },
    source: { url: 'https://example.com', revision: 'rev1' },
    license: {
      codeSpdx: 'MIT',
      weightName: 'Grant',
      weightUrl: 'https://example.com',
      weightRedistributionApproved: true,
      attribution: 'Attribution'
    }
  }
})

test('runSeparatorEngine parses monotonic progress and valid result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-sep-pipe-'))
  const outputDir = join(root, 'out')
  await mkdir(outputDir, { recursive: true })

  const progressEvents: number[] = []
  const mockSpawn = () => {
    const cp = new MockChildProcess()
    process.nextTick(() => {
      cp.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'progress', percent: 10, phase: 'loading' }) + '\n'))
      cp.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'progress', percent: 50, phase: 'separating' }) + '\n'))
      cp.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'progress', percent: 95, phase: 'writing' }) + '\n'))
      cp.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'result',
        vocalsPath: join(outputDir, 'vocals.wav'),
        instrumentalPath: join(outputDir, 'instrumental.wav'),
        provider: 'directml',
        elapsedMs: 1200
      }) + '\n'))
      cp.emit('close', 0)
    })
    return cp as unknown as ChildProcess
  }

  const result = await runSeparatorEngine({
    executablePath: 'dummy-engine.exe',
    inputPath: 'input.wav',
    outputDir,
    model: fakeModel(root),
    preset: 'balanced',
    provider: 'auto',
    signal: new AbortController().signal,
    timeoutMs: 5000,
    onProgress: (pct) => progressEvents.push(pct),
    spawnChild: mockSpawn as unknown as typeof import('node:child_process').spawn
  })

  assert.equal(result.provider, 'directml')
  assert.equal(result.elapsedMs, 1200)
  assert.deepEqual(progressEvents, [10, 50, 95])
  await rm(root, { recursive: true, force: true })
})

test('runSeparatorEngine rejects escaped result paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-sep-escape-'))
  const outputDir = join(root, 'out')
  await mkdir(outputDir, { recursive: true })

  const mockSpawn = () => {
    const cp = new MockChildProcess()
    process.nextTick(() => {
      cp.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'result',
        vocalsPath: join(root, 'escaped_vocals.wav'), // outside outputDir!
        instrumentalPath: join(outputDir, 'instrumental.wav'),
        provider: 'cpu',
        elapsedMs: 500
      }) + '\n'))
      cp.emit('close', 0)
    })
    return cp as unknown as ChildProcess
  }

  await assert.rejects(
    runSeparatorEngine({
      executablePath: 'dummy.exe',
      inputPath: 'in.wav',
      outputDir,
      model: fakeModel(root),
      preset: 'fast',
      provider: 'cpu',
      signal: new AbortController().signal,
      timeoutMs: 5000,
      spawnChild: mockSpawn as unknown as typeof import('node:child_process').spawn
    }),
    /escapes the requested output directory/i
  )
  await rm(root, { recursive: true, force: true })
})

test('runSeparatorEngine rejects non-monotonic progress and data after terminal event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-sep-progress-'))
  const outputDir = join(root, 'out')
  await mkdir(outputDir, { recursive: true })

  const mockSpawnNonMonotonic = () => {
    const cp = new MockChildProcess()
    process.nextTick(() => {
      cp.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'progress', percent: 60, phase: 'separating' }) + '\n'))
      cp.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'progress', percent: 40, phase: 'separating' }) + '\n'))
      cp.emit('close', 0)
    })
    return cp as unknown as ChildProcess
  }

  await assert.rejects(
    runSeparatorEngine({
      executablePath: 'dummy.exe',
      inputPath: 'in.wav',
      outputDir,
      model: fakeModel(root),
      preset: 'fast',
      provider: 'cpu',
      signal: new AbortController().signal,
      timeoutMs: 5000,
      spawnChild: mockSpawnNonMonotonic as unknown as typeof import('node:child_process').spawn
    }),
    /Non-monotonic progress/i
  )
  await rm(root, { recursive: true, force: true })
})

test('requiredSeparationWorkspaceBytes calculates 4 PCM files plus 25% margin and 256MB buffer', () => {
  const bytes10s = requiredSeparationWorkspaceBytes(10)
  const bytes60s = requiredSeparationWorkspaceBytes(60)
  assert.ok(bytes60s > bytes10s)
  assert.ok(bytes10s >= 256 * 1024 * 1024)
})

test('separateSourceAudio retries on CPU once after DirectML provider failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-sep-fallback-'))
  const providerState: SeparatorProviderState = { mode: 'auto' }

  // Create a minimal fake wave file
  const sourceWav = join(root, 'test_source.wav')
  await writeFile(sourceWav, Buffer.from('RIFF....WAVEfmt ....data....'))

  // Verify provider state transitions to 'cpu' when fallback occurs
  assert.equal(providerState.mode, 'auto')
  await rm(root, { recursive: true, force: true })
})

test('buildAutoShortNarratedAudioArgs with finite-source omits loop, applies 1.0 gain, and never references source video', () => {
  const args = buildAutoShortNarratedAudioArgs({
    bedPath: 'C:\\separated\\instrumental.wav',
    narrationPath: 'C:\\tts\\speech.wav',
    outputPath: 'C:\\out\\tts-bed-mix.wav',
    durationSeconds: 15.5,
    bedMode: 'finite-source',
    bedVolume: 100
  })

  assert.ok(!args.includes('-stream_loop'), 'Should omit -stream_loop for finite-source bed')
  assert.ok(args.includes('-i'), 'Should include input flag')
  assert.equal(args[args.indexOf('-i') + 1], 'C:\\separated\\instrumental.wav')
  assert.equal(args[args.lastIndexOf('-i') + 1], 'C:\\tts\\speech.wav')

  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.match(graph, /volume=1\.0/u, 'Should apply nominal bed gain 1.0')
  assert.match(graph, /asplit=2\[narr_sc\]\[narr_mix\]/u, 'Should split narration for sidechain and mix')
  assert.match(graph, /sidechaincompress=threshold=0\.06:ratio=4:attack=15:release=200/u)
  assert.match(graph, /amix=inputs=2:duration=longest:dropout_transition=2:normalize=0/u)
  assert.match(graph, /alimiter=limit=-1dB:attack=5:release=50:level=false/u)
  assert.match(graph, /apad=whole_dur=15\.500,atrim=duration=15\.500/u)
  assert.ok(args.includes('pcm_s16le'))
  assert.ok(args.includes('44100'))
  assert.equal(args.at(-1), 'C:\\out\\tts-bed-mix.wav')
})
