import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  resolveEdgeVoiceForPreflight,
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

test('AutoShort preflight accepts the explicit Edge voice while source language is still auto', () => {
  assert.equal(resolveEdgeVoiceForPreflight(voices, 'auto', 'es-ES-ElviraNeural').id, 'es-ES-ElviraNeural')
  assert.throws(() => resolveEdgeVoiceForPreflight(voices, 'auto'))
})

test('Voice exposes an Edge language selector before filtering its voice catalog', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'Voice.tsx'), 'utf8')
  assert.match(source, /Ngôn ngữ Edge-TTS/u)
  assert.match(source, /edgeLanguageOptions\.map/u)
})

test('AutoShort keeps provider synthesis at 1x and Voice rejects unsafe prosody', () => {
  assert.deepEqual(validateEdgeProsody({}, 'autoshort'), { speed: 1 })
  assert.throws(() => validateEdgeProsody({ speed: 1.8 }, 'autoshort'))
  assert.throws(() => validateEdgeProsody({ speed: Number.NaN }, 'voice'))
  assert.throws(() => validateEdgeProsody({ pitch: '+101Hz' }, 'voice'))
})
