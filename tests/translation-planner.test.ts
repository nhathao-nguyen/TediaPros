import assert from 'node:assert/strict'
import test from 'node:test'
import { joinGroupText } from '../src/main/semanticGrouping'
import { planTranslation, restoreOriginalCues, type TranslationCapability } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'
import { buildTranslationBatchMessages } from '../src/main/translation/prompts'
import { parseTranslationResponse } from '../src/main/translation/response'

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

test('planner splits a semantic group when the exact serialized prompt would exceed context', () => {
  const input: TranslationInput = {
    sourceLanguage: 'vi', targetLocale: 'en', mode: 'subtitle',
    cues: [
      { id: 'first', sourceIndex: 0, start: 0, end: 1, groupId: 'g', text: 'A short source sentence.' },
      { id: 'second', sourceIndex: 1, start: 1.1, end: 2.1, groupId: 'g', text: 'A second short source sentence.' }
    ],
    contextBefore: [], contextAfter: [], glossary: []
  }
  const plan = planTranslation(input, {
    ...capability,
    contextTokens: 1_400,
    outputTokens: 64,
    // Model a tokenizer where the shared message envelope costs 900 tokens
    // and each source cue adds 250. This makes each cue fit while the intact
    // semantic pair does not, independent of the literal fixture text size.
    countTokens: (text) => 900 + (text.match(/source_index/gu) || []).length * 250
  })
  assert.equal(plan.unsupported, false)
  assert.equal(plan.batches.length, 2)
  assert.deepEqual(plan.batches.map((batch) => batch.input.cues.map((cue) => cue.id)), [['first'], ['second']])
})

test('batch boundary pronoun receives two immutable source neighbors without requesting context IDs', () => {
  const input: TranslationInput = {
    sourceLanguage: 'zh', targetLocale: 'vi', mode: 'subtitle', glossary: [], contextBefore: [], contextAfter: [],
    cues: Array.from({ length: 28 }, (_, index) => ({
      id: `c${index}`, sourceIndex: index, start: index * 3, end: index * 3 + 1, groupId: `g${index}`,
      text: index === 23 ? '这是安全阀。' : index === 24 ? '它不能关闭。' : `第${index}句。`
    }))
  }
  const snapshot = JSON.stringify(input)
  const plan = planTranslation(input, { ...capability, contextTokens: 100_000 })
  assert.deepEqual(plan.batches[0].input.contextAfter.map((cue) => cue.id), ['c24', 'c25'])
  const second = plan.batches[1]
  assert.deepEqual(second.input.contextBefore.map((cue) => cue.id), ['c22', 'c23'])
  assert.equal(second.input.contextBefore[1].text, '这是安全阀。')
  assert.deepEqual(second.input.cues.map((cue) => cue.id), ['c24', 'c25', 'c26', 'c27'])
  const echoed = [...second.input.contextBefore, ...second.input.cues].map((cue) => ({ id: cue.id, text: 'Bản dịch' }))
  const parsed = parseTranslationResponse(JSON.stringify({ items: echoed }), 'json-items', second.input.cues.map((cue) => cue.id), false, second.input.contextBefore.map((cue) => cue.id))
  assert.deepEqual(parsed.items.map((cue) => cue.id), ['c24', 'c25', 'c26', 'c27'])
  second.input.contextBefore[1].text = 'changed in batch'
  assert.equal(JSON.stringify(input), snapshot)
})

test('split parts use neighboring source offsets as context and still restore one original output', () => {
  const sourceText = '安全阀不能关闭。'.repeat(100)
  const input: TranslationInput = {
    sourceLanguage: 'zh', targetLocale: 'vi', mode: 'subtitle', glossary: [], contextBefore: [], contextAfter: [],
    cues: [{ id: 'valve', sourceIndex: 0, start: 0, end: 60, groupId: 'g', text: sourceText }]
  }
  const plan = planTranslation(input, {
    ...capability, outputTokens: 64, contextTokens: 1_000,
    countTokens: (text) => 100 + (text.match(/source_index/gu) || []).length * 500
  })
  assert.ok(plan.batches.length >= 3)
  const middle = plan.batches[1]
  assert.equal(middle.input.contextBefore.at(-1)?.id, 'valve/part-1')
  assert.equal(middle.input.contextAfter[0]?.id, 'valve/part-3')
  const firstSpan = plan.mapping[0]
  assert.equal(middle.input.contextBefore.at(-1)?.text, sourceText.slice(firstSpan.startOffset, firstSpan.endOffset))
  const restored = restoreOriginalCues(input.cues, plan.mapping.map((span) => ({ id: span.unitId, text: 'Giữ van mở.' })), plan.mapping, 'vi')
  assert.deepEqual(restored.map((item) => item.id), ['valve'])
})

test('context is deduplicated, bounded and counted in the actual serialized token budget', () => {
  const cue = { id: 'current', sourceIndex: 4, start: 4, end: 5, groupId: 'g', text: '它不能关闭。' }
  const before = { ...cue, id: 'before', sourceIndex: 3, text: '安全阀。'.repeat(1000) }
  const input: TranslationInput = {
    sourceLanguage: 'zh', targetLocale: 'vi', mode: 'subtitle', cues: [cue], glossary: [],
    contextBefore: [before, before, cue], contextAfter: [before, { ...before, id: 'after' }]
  }
  const plan = planTranslation(input, { ...capability, contextTokens: 3_000, outputTokens: 64 })
  assert.equal(plan.unsupported, false)
  const batch = plan.batches[0]
  const contexts = [...batch.input.contextBefore, ...batch.input.contextAfter]
  assert.ok(contexts.length > 0)
  assert.equal(new Set(contexts.map((item) => item.id)).size, contexts.length)
  assert.ok(contexts.every((item) => item.id !== 'current' && [...item.text].length <= 512))
  assert.ok(Buffer.byteLength(JSON.stringify(buildTranslationBatchMessages(batch, capability.format))) + batch.maxOutputTokens <= 3_000)
})
