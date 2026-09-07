import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRepairMessages,
  buildRephraseMessages,
  buildTranslationMessages,
  TRANSLATION_PARSER_VERSION,
  TRANSLATION_PROMPT_VERSION
} from '../src/main/translation/prompts'
import type { TranslationInput } from '../src/shared/translation'

const input: TranslationInput = {
  sourceLanguage: 'zh',
  targetLocale: 'en',
  mode: 'subtitle',
  cues: [{ id: 'c1', sourceIndex: 0, start: 0, end: 2, groupId: 'g1', text: '不要摸这只狗。' }],
  contextBefore: [],
  contextAfter: [],
  glossary: []
}

test('one target and one output grammar per request', () => {
  const messages = buildTranslationMessages(input, 'json-items')
  assert.match(messages[0].content, /target_locale=en/u)
  assert.match(messages[0].content, /task=translate/u)
  assert.doesNotMatch(messages.map((message) => message.content).join('\n'), /target_language=auto/u)
  assert.throws(() => buildTranslationMessages({ ...input, targetLocale: 'auto' }, 'json-items'))
  assert.equal(TRANSLATION_PROMPT_VERSION, 'translation-v4')
  assert.equal(TRANSLATION_PARSER_VERSION, 'translation-parser-v2')
})

test('subtitle prompts carry source as data and omit dubbing duration pressure', () => {
  const messages = buildTranslationMessages(input, 'id-lines')
  assert.match(messages[1].content, /不要摸这只狗/u)
  assert.match(messages[0].content, /format=id-lines/u)
  assert.doesNotMatch(messages.map((message) => message.content).join('\n'), /13 grapheme|13 ký tự/iu)
  assert.match(messages[1].content, /\[c1\]/u)
})

test('repair prompt contains only the IDs that need repair', () => {
  const messages = buildRepairMessages(input, 'json-items', [{
    code: 'missing-id', severity: 'error', cueIds: ['c1'], confidence: 'certain', message: 'missing'
  }], ['c1'])
  assert.match(messages[0].content, /task=repair/u)
  assert.match(messages[1].content, /expected_ids=c1/u)
  assert.match(messages[1].content, /不要摸这只狗/u)
})

test('rephrase is editing existing translation with source evidence', () => {
  const messages = buildRephraseMessages({ targetLocale: 'en', cues: [{
    id: 'c1', sourceText: '不要摸这只狗。', currentText: 'Do not touch this dog.', targetDuration: 2,
    contextBefore: [], contextAfter: []
  }] })
  assert.match(messages[0].content, /task=rephrase/u)
  assert.match(messages[1].content, /不要摸这只狗/u)
  assert.match(messages[1].content, /Do not touch this dog/u)
  assert.doesNotMatch(messages[0].content, /target_language=auto/u)
  assert.doesNotMatch(messages[0].content, /one translation per ID|đúng một.*cue/iu)
})
