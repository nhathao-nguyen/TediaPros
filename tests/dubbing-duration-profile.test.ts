import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as duration from '../src/main/dubbing/durationPredictor'
import { loadDurationProfile, saveDurationProfile } from '../src/main/dubbing/profileStore'

test('profile identity separates model revision, reference content and feature contracts', () => {
  const base = { voice: 'voice-a', model: 'alias', modelRevision: 'revision-a', referenceContentHash: 'sha-a', options: { speed: 1, style: 'neutral' } }
  for (const changed of [
    { modelRevision: 'revision-b' }, { referenceContentHash: 'sha-b' },
    { featureVersion: 'future-vector' }, { normalizerVersion: 'future-normalizer' },
    { options: { speed: 1.1, style: 'neutral' } }
  ]) assert.notEqual(duration.durationProfileKey(base), duration.durationProfileKey({ ...base, ...changed }))
  assert.equal(duration.durationProfileKey(base), duration.durationProfileKey({ ...base, options: { style: 'neutral', speed: 1 } }))
})

test('unchanged v2 feature meanings never substitute whitespace units for syllables', () => {
  const source = '  AWS 3,5 kg 2026  '
  assert.deepEqual(duration.extractDurationFeatures(source, 'vi'), {
    graphemes: 12, words: 4, numerals: 6, abbreviations: 1, pauses: 1
  })
  assert.equal(source, '  AWS 3,5 kg 2026  ')
})

test('fit residual cannot become calibrated confidence even with many repeated samples', () => {
  const predictor = duration.createDurationPredictor()
  for (let index = 0; index < 24; index++) predictor.addSample('Simple clear words', 2, 'en')
  const estimate = predictor.estimate('Simple clear words', { locale: 'en' })
  assert.equal(estimate.confidence, 0)
  assert.equal(estimate.calibration, 'uncalibrated')
  assert.ok(estimate.uncertaintySeconds >= 0.6)
})

test('numbers and abbreviations with equal whitespace units carry extra uncertainty', () => {
  const predictor = duration.createDurationPredictor()
  const plain = predictor.estimate('Take one small bag', { locale: 'en' })
  const ambiguous = predictor.estimate('Take 2026 AWS bags', { locale: 'en' })
  assert.ok(ambiguous.uncertaintySeconds > plain.uncertaintySeconds)
  assert.notEqual(ambiguous.seconds, plain.seconds)
  assert.ok(ambiguous.uncertaintyReasons?.includes('numeral-pronunciation'))
  assert.ok(ambiguous.uncertaintyReasons?.includes('abbreviation-pronunciation'))
})

test('unsupported locale and mixed script retain pronunciation uncertainty', () => {
  const predictor = duration.createDurationPredictor()
  const known = predictor.estimate('Simple clear words', { locale: 'en' })
  const unknown = predictor.estimate('Simple clear words', { locale: 'xx' })
  assert.ok(unknown.uncertaintySeconds > known.uncertaintySeconds)
  assert.ok(unknown.uncertaintyReasons?.includes('unknown-locale'))
  assert.ok(predictor.estimate('hello 世界', { locale: 'en' }).uncertaintyReasons?.includes('mixed-script'))
  assert.equal(predictor.estimate('こんにちは世界', { locale: 'ja' }).uncertaintyReasons?.includes('mixed-script'), false)
})

test('legacy or mismatched feature profiles cold start instead of reinterpreting weights', () => {
  const legacy = { version: 2 as const, samples: 500, weights: [100, 0, 0, 0, 0, 0] as duration.DurationProfile['weights'], residualP90: 0.01 }
  const predictor = duration.createDurationPredictor(legacy)
  assert.equal(predictor.profile.samples, 0)
  assert.ok(predictor.estimate('hello', { locale: 'en' }).seconds < 10)
  const current = duration.createDurationPredictor().profile
  assert.equal(duration.createDurationPredictor({ ...current, featureVersion: 'future' }).profile.samples, 0)
})

test('store rejects legacy profile metadata and round trips current feature contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'duration-profile-'))
  const key = duration.durationProfileKey({ voice: 'fixture', modelRevision: 'fixture-1' })
  try {
    const profile = duration.createDurationPredictor().profile
    await saveDurationProfile(root, key, profile)
    assert.deepEqual(await loadDurationProfile(root, key), profile)
    await writeFile(join(root, `duration-profile-v2-${key}.json`), JSON.stringify({ version: 2, samples: 8, weights: [1, 0, 0, 0, 0, 0], residualP90: 0.08 }))
    assert.equal(await loadDurationProfile(root, key), undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('held-out evaluation reports measured errors without training or qualifying the voice', () => {
  assert.equal(typeof duration.evaluateDurationPredictor, 'function')
  const predictor = duration.createDurationPredictor()
  const before = JSON.stringify(predictor.profile)
  const fixturePredictor = { ...predictor, estimate: () => ({ seconds: 2, uncertaintySeconds: 0.75, confidence: 0 }) }
  const result = duration.evaluateDurationPredictor(fixturePredictor, [
    { text: 'first held out cue', seconds: 3, locale: 'en' },
    { text: 'second held out cue', seconds: 1.5, locale: 'en' }
  ])
  assert.equal(result.samples, 2)
  assert.equal(result.meanAbsoluteErrorSeconds, 0.75)
  assert.equal(result.absoluteErrorP90Seconds, 1)
  assert.equal(result.intervalCoverage, 0.5)
  assert.equal(result.voiceQualified, false)
  assert.equal(JSON.stringify(predictor.profile), before)
  assert.equal(duration.evaluateDurationPredictor(predictor, []).meanAbsoluteErrorSeconds, null)
})
