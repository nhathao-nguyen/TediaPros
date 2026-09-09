import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTranslationIdentity } from '../src/main/translation/checkpoint'
import type { TranslationIdentity } from '../src/main/translation/checkpoint'
import type { TranslationInput } from '../src/shared/translation'
import { TRANSLATION_PROMPT_VERSION } from '../src/main/translation/prompts'

const identity: TranslationIdentity = {
  provider: 'fixture', modelIdentity: 'fixture@1', revisionKnown: true, profileId: 'fixture',
  promptVersion: 'translation-v4', parserVersion: 'translation-parser-v2', plannerVersion: 'translation-plan-v2', assessmentVersion: 'translation-assessment-v2', options: {}
}
const input: TranslationInput = {
  sourceLanguage: 'zh', targetLocale: 'en', mode: 'subtitle',
  cues: [{ id: 'a', sourceIndex: 0, start: 0, end: 2, groupId: 'g', text: '不要摸狗' }],
  contextBefore: [], contextAfter: [], glossary: []
}

test('corrected source text changes the reusable translation identity', () => {
  const corrected = { ...input, cues: [{ ...input.cues[0], text: '可以摸狗' }] }
  assert.notEqual(buildTranslationIdentity(input, identity), buildTranslationIdentity(corrected, identity))
})

test('synopsis changes invalidate reusable translations', () => {
  assert.notEqual(buildTranslationIdentity({ ...input, synopsis: 'Medical tutorial' }, identity),
    buildTranslationIdentity({ ...input, synopsis: 'Comedy dialogue' }, identity))
})

test('identity is stable across object property order and excludes secrets', () => {
  const a = buildTranslationIdentity(input, { ...identity, options: { temperature: 0.2, apiKey: 'secret-a' } })
  const b = buildTranslationIdentity(input, { ...identity, options: { apiKey: 'secret-b', temperature: 0.2 } })
  assert.equal(a, b)
})

test('current prompt cannot reuse translation identity from older prompt contracts', () => {
  assert.equal(TRANSLATION_PROMPT_VERSION, 'translation-v9')
  const after = buildTranslationIdentity(input, { ...identity, promptVersion: TRANSLATION_PROMPT_VERSION })
  for (const promptVersion of ['translation-v5', 'translation-v6', 'translation-v7', 'translation-v8']) {
    assert.notEqual(buildTranslationIdentity(input, { ...identity, promptVersion }), after)
  }
})

test('different dubbing speaking windows invalidate reuse', () => {
  const a = { ...input, mode: 'dubbing' as const,
    cues: [{ ...input.cues[0]!, speakingDuration: 1 }] }
  const b = { ...a, cues: [{ ...a.cues[0]!, speakingDuration: 2 }] }
  assert.notEqual(buildTranslationIdentity(a, identity), buildTranslationIdentity(b, identity))
  assert.equal(buildTranslationIdentity(a, identity), buildTranslationIdentity(structuredClone(a), identity))
})
