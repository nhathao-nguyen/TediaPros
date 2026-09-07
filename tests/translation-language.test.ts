import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assessTranslationLanguage,
  normalizeTranslationLocale,
  resolveTranslationReadiness,
  type StageCapability
} from '../src/main/translation/language'
import type { TranslationInput } from '../src/shared/translation'

test('normalizes BCP47 variants and keeps auto only when explicitly allowed', () => {
  assert.equal(normalizeTranslationLocale('zh-hans'), 'zh-Hans')
  assert.equal(normalizeTranslationLocale('pt-BR'), 'pt-BR')
  assert.equal(normalizeTranslationLocale('auto', true), 'auto')
  assert.throws(() => normalizeTranslationLocale('auto'))
  assert.throws(() => normalizeTranslationLocale('not a locale'))
})

test('same script is not proof of French translation', () => {
  const input: TranslationInput = {
    sourceLanguage: 'en', targetLocale: 'fr', mode: 'subtitle',
    cues: [{ id: 'a', sourceIndex: 0, start: 0, end: 2, groupId: 'g', text: 'This dog is friendly.' }],
    contextBefore: [], contextAfter: [], glossary: []
  }
  const result = assessTranslationLanguage(input, [{ id: 'a', text: 'This dog is friendly.' }])
  assert.notEqual(result.languageEvidence, 'matched')
  assert.ok(result.issues.every((issue) => issue.severity === 'warning'))
})

test('explicit source and target language equality does not create a false echo warning', () => {
  const input: TranslationInput = {
    sourceLanguage: 'en-US', targetLocale: 'en', mode: 'subtitle',
    cues: [{ id: 'a', sourceIndex: 0, start: 0, end: 2, groupId: 'g', text: 'This dog is friendly.' }],
    contextBefore: [], contextAfter: [], glossary: []
  }
  const result = assessTranslationLanguage(input, [{ id: 'a', text: 'This dog is friendly.' }])
  assert.equal(result.issues.length, 0)
  assert.equal(result.languageEvidence, 'unknown')
})

test('source script echo is reported as a warning with cue evidence', () => {
  const input: TranslationInput = {
    sourceLanguage: 'zh', targetLocale: 'en', mode: 'subtitle',
    cues: [{ id: 'a', sourceIndex: 0, start: 0, end: 2, groupId: 'g', text: '这是一只狗。' }],
    contextBefore: [], contextAfter: [], glossary: []
  }
  const result = assessTranslationLanguage(input, [{ id: 'a', text: '这是一只狗。' }])
  assert.equal(result.languageEvidence, 'suspect')
  assert.ok(result.issues.some((issue) => issue.code === 'language-suspect'))
})

test('required unsupported capability blocks while unknown only warns', () => {
  const stages: StageCapability[] = [
    { stage: 'translation', required: true, support: 'unknown', qualified: false, reason: 'no profile' },
    { stage: 'tts', required: false, support: 'unsupported', qualified: false, reason: 'disabled' },
    { stage: 'render', required: true, support: 'unsupported', qualified: false, reason: 'missing font' }
  ]
  const result = resolveTranslationReadiness(stages)
  assert.equal(result.canStart, false)
  assert.equal(result.blocking.length, 1)
  assert.equal(result.warnings.length, 1)
})
