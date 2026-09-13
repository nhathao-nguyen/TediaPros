import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTtsAudioHeader, normalizeTtsAudioOutputPath, planTtsAudioSave, ttsAudioFormat } from '../src/shared/ttsAudioFormat'

test('the generated MIME owns the saved extension', () => {
  assert.deepEqual(ttsAudioFormat('audio/mpeg'), { mime: 'audio/mpeg', extension: 'mp3' })
  assert.deepEqual(ttsAudioFormat(), { mime: 'audio/wav', extension: 'wav' })
  assert.throws(() => ttsAudioFormat('text/html'))
})

test('the selected save path is normalized to the generated MIME extension', () => {
  assert.equal(normalizeTtsAudioOutputPath('C:\\out\\voice.wav', 'audio/mpeg'), 'C:\\out\\voice.mp3')
  assert.equal(normalizeTtsAudioOutputPath('C:\\out\\voice', 'audio/wav'), 'C:\\out\\voice.wav')
})

test('a normalized alternate save path must not overwrite an unconfirmed file', () => {
  assert.deepEqual(planTtsAudioSave('C:\\out\\voice.wav', 'audio/mpeg'), {
    path: 'C:\\out\\voice.mp3',
    exclusive: true
  })
  assert.deepEqual(planTtsAudioSave('C:\\out\\voice.mp3', 'audio/mpeg'), {
    path: 'C:\\out\\voice.mp3',
    exclusive: false
  })
})

test('a matching extension keeps the exact path spelling confirmed by the save dialog', () => {
  assert.deepEqual(planTtsAudioSave('C:\\out\\voice.MP3', 'audio/mpeg'), {
    path: 'C:\\out\\voice.MP3',
    exclusive: false
  })
})

test('saving rejects bytes that do not match the declared audio format', () => {
  assert.doesNotThrow(() => assertTtsAudioHeader(new Uint8Array([0x49, 0x44, 0x33, 0x04]), 'audio/mpeg'))
  assert.doesNotThrow(() => assertTtsAudioHeader(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]), 'audio/wav'))
  assert.throws(() => assertTtsAudioHeader(new Uint8Array([0x3c, 0x68, 0x74, 0x6d]), 'audio/mpeg'))
})
