import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { canonicalJson } from '../src/main/autoShortStageKeys'
import { legacyNoCutDigests, matchesAutoShortItemConfigDigest } from '../src/main/autoShortCutIdentity'
import { buildAutoShortCheckpointFingerprintCandidates } from '../src/main/autoshort'
import type { AutoShortConfig, AutoShortQueueItemInput } from '../src/shared/types'

const config = {
  subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu',
  ocrRegion: { x0: 0, y0: 0.7, x1: 1, y1: 0.9 }, blurRegions: [], lamMo: false,
  blurMode: 'manual', ocrBlurProfile: 'fast', translateTarget: 'none', translateProvider: 'local',
  ttsEnabled: false, voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 20,
  outputDir: 'C:\\out'
} as AutoShortConfig

const hash = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex')

test('accepts exactly the two known no-cut batch digest formulas', () => {
  const expected = [hash(config), hash({ config, temporalEdit: undefined })]
  assert.deepEqual(legacyNoCutDigests(config), expected)
  for (const digest of expected) assert.equal(matchesAutoShortItemConfigDigest(digest, config, undefined), true)
  assert.equal(matchesAutoShortItemConfigDigest('0'.repeat(64), config, undefined), false)
  assert.equal(matchesAutoShortItemConfigDigest(expected[0], { ...config, outputDir: 'C:\\changed' }, undefined), false)
})

test('does not widen digest compatibility for cut jobs', () => {
  const item: AutoShortQueueItemInput = {
    id: 'item-1', filePath: 'C:\\source.mp4',
    temporalEdit: { schemaVersion: 1, revision: 1, mode: 'ripple-delete', removedRanges: [{ id: 'r', startUs: 1, endUs: 2 }] }
  }
  assert.equal(matchesAutoShortItemConfigDigest(hash(config), config, item.temporalEdit), false)
  assert.equal(matchesAutoShortItemConfigDigest(hash({ config, temporalEdit: item.temporalEdit }), config, item.temporalEdit), true)
})

test('keeps both known checkpoint fingerprints only for no-cut sources', () => {
  const noCut = buildAutoShortCheckpointFingerprintCandidates('C:\\source.mp4', { size: 10, mtimeMs: 20 }, config, undefined, 'a'.repeat(64), undefined)
  assert.equal(noCut.length, 2)
  assert.equal(new Set(noCut).size, 2)
  const cut = buildAutoShortCheckpointFingerprintCandidates('C:\\source.mp4', { size: 10, mtimeMs: 20 }, config, undefined, 'a'.repeat(64), {
    schemaVersion: 1, revision: 1, mode: 'ripple-delete', removedRanges: [{ id: 'r', startUs: 1, endUs: 2 }]
  })
  assert.equal(cut.length, 1)
})
