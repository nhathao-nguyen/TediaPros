import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildStageKey, hashFileSha256 } from '../src/main/autoShortStageKeys'
import { buildAutoShortCheckpointFingerprint } from '../src/main/autoshort'
import type { AutoShortConfig } from '../src/shared/types'

test('stage keys canonicalize object order and keep stage namespaces independent', () => {
  const first = buildStageKey('translation', { b: 2, a: { z: true, y: 'x' } })
  const reordered = buildStageKey('translation', { a: { y: 'x', z: true }, b: 2 })
  assert.equal(first, reordered)
  assert.notEqual(first, buildStageKey('asr', { b: 2, a: { z: true, y: 'x' } }))
  assert.match(first, /^[a-f0-9]{64}$/u)
})

test('source content digest changes even when size and mtime stay the same', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-stage-key-'))
  const path = join(root, 'source.mp4')
  try {
    await writeFile(path, 'AAAA', 'utf8')
    const before = await hashFileSha256(path)
    const stamp = new Date('2026-01-01T00:00:00Z')
    await utimes(path, stamp, stamp)
    await writeFile(path, 'BBBB', 'utf8')
    await utimes(path, stamp, stamp)
    const after = await hashFileSha256(path)
    assert.notEqual(before, after)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('AutoShort checkpoint identity includes source content digest when supplied', () => {
  const config = {
    subtitleMethod: 'whisper',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    ocrRegion: { x0: 0, y0: 0.7, x1: 1, y1: 0.9 },
    blurRegions: [],
    lamMo: false,
    blurMode: 'manual',
    ocrBlurProfile: 'fast',
    translateTarget: 'none',
    translateProvider: 'local',
    ttsEnabled: false,
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    outputDir: 'C:\\out'
  } as AutoShortConfig
  const build = buildAutoShortCheckpointFingerprint as unknown as (...args: unknown[]) => string
  const common = ['C:\\input.mp4', { size: 4, mtimeMs: 100 }, config, undefined]
  assert.notEqual(build(...common, 'a'.repeat(64)), build(...common, 'b'.repeat(64)))
})
