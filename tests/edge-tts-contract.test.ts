import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveEdgeVoice,
  resolveTtsProvider,
  validateEdgeProsody
} from '../src/shared/edgeTtsContract'

const voices = [
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My', gender: 'female' as const, language: 'vi', locale: 'vi-VN' },
  { id: 'en-US-JennyNeural', name: 'Jenny', gender: 'female' as const, language: 'en', locale: 'en-US', isDefault: true },
  { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'female' as const, language: 'en', locale: 'en-GB' },
  { id: 'es-ES-ElviraNeural', name: 'Elvira', gender: 'female' as const, language: 'es', locale: 'es-ES' }
]

test('legacy provider stays Local and a language resolves only to a compatible Edge voice', () => {
  assert.equal(resolveTtsProvider(undefined), 'local-tts')
  assert.equal(resolveEdgeVoice(voices, 'es').id, 'es-ES-ElviraNeural')
  assert.throws(() => resolveEdgeVoice(voices, 'es', 'clone:old-local-id'))
  assert.throws(() => resolveEdgeVoice([
    ...voices,
    { id: 'es-ES-Bad\"/><break time="9s"/>', name: 'Bad', gender: 'male', language: 'es', locale: 'es-ES' }
  ], 'es', 'es-ES-Bad\"/><break time="9s"/>'))
  assert.throws(() => resolveEdgeVoice(voices, 'xx'))
})

test('an exact Edge locale wins over a base-language default from another locale', () => {
  assert.equal(resolveEdgeVoice(voices, 'en-GB').id, 'en-GB-SoniaNeural')
  assert.equal(resolveEdgeVoice(voices, 'en').id, 'en-US-JennyNeural')
})

test('AutoShort keeps provider synthesis at 1x and Voice rejects unsafe prosody', () => {
  assert.deepEqual(validateEdgeProsody({}, 'autoshort'), { speed: 1 })
  assert.throws(() => validateEdgeProsody({ speed: 1.8 }, 'autoshort'))
  assert.throws(() => validateEdgeProsody({ speed: Number.NaN }, 'voice'))
  assert.throws(() => validateEdgeProsody({ pitch: '+101Hz' }, 'voice'))
})
