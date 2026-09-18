import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addVoiceMeasurement,
  createVoiceMeasurementProfile,
  loadVoiceMeasurementProfile,
  saveVoiceMeasurementProfile,
  voiceMeasurementProfileSummary,
  voiceMeasurementProfileKey,
  voicePromptHintFromProfile
} from '../src/main/dubbing/voiceMeasurements'

function profile() {
  return createVoiceMeasurementProfile({
    profileKey: voiceMeasurementProfileKey({ endpoint: 'edge-tts', model: 'edge-tts', voice: 'vi-VN-HoaiMyNeural', language: 'vi-VN' }),
    provider: 'edge-tts',
    model: 'edge-tts',
    voice: 'vi-VN-HoaiMyNeural',
    locale: 'vi-VN'
  })
}

test('voice measurement profile derives an advisory spoken-unit rate with P10/median/P90', () => {
  const current = profile()
  addVoiceMeasurement(current, {
    profileKey: current.profileKey, provider: 'edge-tts', model: 'edge-tts', voice: current.voice,
    locale: 'vi-VN', text: 'Một câu nói thử nghiệm.', durationNaturalMs: 1_000,
    durationSource: 'probed-trimmed-audio', audioFingerprint: 'a'.repeat(64), origin: 'voice-tab'
  })
  addVoiceMeasurement(current, {
    profileKey: current.profileKey, provider: 'edge-tts', model: 'edge-tts', voice: current.voice,
    locale: 'vi-VN', text: 'Một câu khác dài hơn.', durationNaturalMs: 2_000,
    durationSource: 'probed-trimmed-audio', audioFingerprint: 'b'.repeat(64), origin: 'autoshort'
  })
  assert.equal(current.status, 'advisory')
  assert.equal(current.eligibleSampleCount, 2)
  assert.ok((current.rateP10 || 0) > 0)
  const hint = voicePromptHintFromProfile(current, 'vi-VN')
  assert.equal(hint?.metric, 'estimated-spoken-units-per-second')
  assert.equal(hint?.status, 'advisory')
  assert.equal(voicePromptHintFromProfile(current, 'en-US'), undefined)
  const summary = voiceMeasurementProfileSummary(current)
  assert.equal(summary.eligibleSampleCount, 2)
  assert.equal('records' in summary, false)
})

test('voice measurement deduplicates repeated audio/text and excludes non-1x samples from baseline', () => {
  const current = profile()
  const input = {
    profileKey: current.profileKey, provider: 'edge-tts', model: 'edge-tts', voice: current.voice,
    locale: 'vi-VN', text: 'Một câu có số 2.', durationNaturalMs: 1_000,
    durationSource: 'provider-duration-header' as const, audioFingerprint: 'same-audio', origin: 'voice-tab' as const
  }
  addVoiceMeasurement(current, input)
  addVoiceMeasurement(current, input)
  addVoiceMeasurement(current, { ...input, speed: 1.25, audioFingerprint: 'different-speed' })
  assert.equal(current.observationCount, 2)
  assert.equal(current.eligibleSampleCount, 1)
  assert.ok(current.uncertaintyReasons.includes('numbers'))
  assert.ok(current.uncertaintyReasons.includes('duration-header'))
})

test('voice measurement persistence is atomic and rejects a missing/corrupt profile without deleting siblings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-voice-measurements-'))
  try {
    const current = profile()
    addVoiceMeasurement(current, {
      profileKey: current.profileKey, provider: 'edge-tts', model: 'edge-tts', voice: current.voice,
      locale: 'vi-VN', text: 'Xin chào.', durationNaturalMs: 1_000,
      durationSource: 'probed-trimmed-audio', audioFingerprint: 'persisted', origin: 'voice-tab'
    })
    await saveVoiceMeasurementProfile(root, current)
    const restored = await loadVoiceMeasurementProfile(root, current.profileKey)
    assert.equal(restored?.eligibleSampleCount, 1)
    assert.match(await readFile(join(root, `voice-measurement-v1-${current.profileKey}.json`), 'utf8'), /"version": 1/u)
    await rm(join(root, `voice-measurement-v1-${current.profileKey}.json`), { force: true })
    assert.equal(await loadVoiceMeasurementProfile(root, current.profileKey), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
