import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRepairMessages,
  buildRephraseMessages,
  buildTranslationMessages,
  getLanguageSpeakingBudget,
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
  assert.equal(TRANSLATION_PROMPT_VERSION, 'translation-v5')
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

test('dubbing prompts expose the real speaking window including across a batch boundary', () => {
  const messages = buildTranslationMessages({ ...input, mode: 'dubbing',
    cues: [{ ...input.cues[0], end: 2, speakingDuration: 1.42 }],
    contextAfter: [{ ...input.cues[0], id: 'c2', start: 1.92, end: 3 }]
  }, 'json-items')
  assert.match(messages[1].content, /"speaking_duration_seconds":1.42/u)
  assert.match(messages[1].content, /"hard_max_natural_seconds":2.059/u)
  assert.match(messages[0].content, /shortest natural wording/u)
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

test('getLanguageSpeakingBudget calculates words or characters appropriately across language families', () => {
  const vi = getLanguageSpeakingBudget('vi', 2.0)
  assert.equal(vi.unit, 'words')
  assert.ok(vi.budget >= 8 && vi.budget <= 10)

  const zh = getLanguageSpeakingBudget('zh-CN', 2.0)
  assert.equal(zh.unit, 'characters')
  assert.ok(zh.budget >= 7 && zh.budget <= 10)

  const de = getLanguageSpeakingBudget('de', 2.0)
  assert.equal(de.unit, 'characters')
  assert.ok(de.budget >= 30)

  const en = getLanguageSpeakingBudget('en-US', 2.0)
  assert.equal(en.unit, 'words')
  assert.ok(en.budget >= 6 && en.budget <= 8)
})

test('dubbing prompt carries suggested speaking budget for the target language', () => {
  const messages = buildTranslationMessages({
    ...input,
    targetLocale: 'vi',
    mode: 'dubbing',
    cues: [{ ...input.cues[0], end: 2, speakingDuration: 2.0 }]
  }, 'json-items')
  assert.match(messages[1].content, /"suggested_max_words":\d+/u)
})
