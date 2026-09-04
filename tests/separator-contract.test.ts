import assert from 'node:assert/strict'
import test from 'node:test'
import { modelIdForSeparationPreset, separationPresetConfig } from '../src/shared/autoShortSeparation'
import { validateAutoShortStartRequest } from '../src/shared/autoShortContract'
import type { AutoShortStartRequest } from '../src/shared/types'

const validRequest = (): AutoShortStartRequest => ({
  items: [{ id: 'video-1', filePath: 'C:\\media\\one.mp4' }],
  config: {
    subtitleMethod: 'whisper',
    whisperModel: 'base',
    whisperDevice: 'cpu',
    blurRegions: [],
    lamMo: false,
    translateTarget: 'none',
    translateProvider: 'local',
    ttsEnabled: true,
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    outputDir: 'C:\\media\\out'
  }
})

test('Fast and Balanced share the compact model with fixed overlap', () => {
  assert.equal(modelIdForSeparationPreset('fast'), 'separator-fast-balanced-v1')
  assert.equal(modelIdForSeparationPreset('balanced'), 'separator-fast-balanced-v1')
  assert.deepEqual(separationPresetConfig('fast'), { modelId: 'separator-fast-balanced-v1', overlap: 0.10, batch: 1 })
  assert.deepEqual(separationPresetConfig('balanced'), { modelId: 'separator-fast-balanced-v1', overlap: 0.25, batch: 1 })
})

test('Quality uses only the HQ model', () => {
  assert.deepEqual(separationPresetConfig('quality'), { modelId: 'separator-quality-v1', overlap: 0.50, batch: 1 })
})

test('separate-vocals requires TTS and defaults a missing preset to balanced', () => {
  const request = validRequest()
  request.config.audioMode = 'separate-vocals'
  delete request.config.separationPreset
  const result = validateAutoShortStartRequest(request)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.config.separationPreset, 'balanced')
})

test('other audio modes normalize away a stale separation preset', () => {
  const request = validRequest()
  request.config.audioMode = 'replace'
  request.config.separationPreset = 'quality'
  const result = validateAutoShortStartRequest(request)
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.config.separationPreset, undefined)
})

test('separate-vocals rejects background music and disabled TTS', () => {
  const disabled = validRequest()
  disabled.config.audioMode = 'separate-vocals'
  disabled.config.separationPreset = 'balanced'
  disabled.config.ttsEnabled = false
  assert.equal(validateAutoShortStartRequest(disabled).ok, false)

  const music = validRequest()
  music.config.audioMode = 'separate-vocals'
  music.config.separationPreset = 'balanced'
  music.config.backgroundMusic = {
    folderPath: 'C:\\music',
    mode: 'single',
    volume: 15,
    assignments: { 'video-1': 'C:\\music\\track.wav' }
  }
  assert.equal(validateAutoShortStartRequest(music).ok, false)
})

test('separate-vocals rejects invalid separation preset', () => {
  const invalid = validRequest()
  invalid.config.audioMode = 'separate-vocals'
  // @ts-expect-error Testing invalid preset value
  invalid.config.separationPreset = 'ultra'
  assert.equal(validateAutoShortStartRequest(invalid).ok, false)
})
