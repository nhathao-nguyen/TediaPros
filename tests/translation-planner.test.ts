import assert from 'node:assert/strict'
import test from 'node:test'
import { joinGroupText } from '../src/main/semanticGrouping'
import { planTranslation, restoreOriginalCues, type TranslationCapability } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'

const capability: TranslationCapability = {
  provider: 'local', modelIdentity: 'fixture@1', revisionKnown: true, format: 'json-items',
  contextTokens: 4096, outputTokens: 512, countTokens: (text) => Buffer.byteLength(text, 'utf8')
}

test('Korean context keeps word spacing while CJK remains compact', () => {
  assert.equal(joinGroupText([{ text: '나는' }, { text: '학생입니다' }], 'ko'), '나는 학생입니다')
  assert.equal(joinGroupText([{ text: '你' }, { text: '好' }], 'zh'), '你好')
})

test('all source spans survive internal long-cue planning and restore', () => {
  const sourceText = 'Một câu dài. '.repeat(200)
  const input: TranslationInput = {
    sourceLanguage: 'vi', targetLocale: 'en', mode: 'subtitle',
    cues: [{ id: 'a', sourceIndex: 0, start: 0, end: 30, groupId: 'g', text: sourceText }],
    contextBefore: [], contextAfter: [], glossary: []
  }
  const plan = planTranslation(input, capability)
  const spans = plan.mapping.filter((mapping) => mapping.originalId === 'a').sort((a, b) => a.partIndex - b.partIndex)
  assert.ok(spans.length > 1)
  assert.equal(spans.map((mapping) => sourceText.slice(mapping.startOffset, mapping.endOffset)).join(''), sourceText)
  assert.equal(new Set(plan.batches.flatMap((batch) => batch.input.cues.map((cue) => cue.id))).size, spans.length)
  const restored = restoreOriginalCues(input.cues.map((cue) => ({ ...cue })), spans.map((mapping) => ({ id: mapping.unitId, text: `T${mapping.partIndex}` })), spans, 'en')
  assert.equal(restored[0]?.id, 'a')
  assert.match(restored[0]?.text || '', /^T1/iu)
})

test('planner preserves a short cue ID and source timing', () => {
  const input: TranslationInput = {
    sourceLanguage: 'zh', targetLocale: 'en', mode: 'dubbing',
    cues: [{ id: 'c1', sourceIndex: 3, start: 4, end: 5, groupId: 'g', text: '你好' }],
    contextBefore: [], contextAfter: [], glossary: []
  }
  const plan = planTranslation(input, { ...capability, outputTokens: 2048 })
  assert.deepEqual(plan.batches[0]?.input.cues.map((cue) => [cue.id, cue.start, cue.end]), [['c1', 4, 5]])
})
