import assert from 'node:assert/strict'
import test from 'node:test'
import { mapTranslationsStrict, parseTranslationResponse } from '../src/main/translation/response'
import type { SubtitleCue } from '../src/shared/types'

const cue = (id: string, text: string, index: number): SubtitleCue => ({
  id,
  start: index,
  end: index + 1,
  text,
  sourceIndex: index
})

test('cannot certify a response whose continuation would be discarded', () => {
  const result = parseTranslationResponse('[c1] First part\nsecond part', 'id-lines', ['c1'], false)
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((issue) => issue.code === 'unparsed-content'))
})

test('maps by identity even when provider changes order', () => {
  const source = [cue('a', 'source a', 0), cue('b', 'source b', 1)]
  const out = mapTranslationsStrict(source, [{ id: 'b', text: 'B' }, { id: 'a', text: 'A' }])
  assert.deepEqual(out.map((item) => [item.id, item.start, item.text]), [['a', 0, 'A'], ['b', 1, 'B']])
  assert.throws(() => mapTranslationsStrict(source, [{ id: 'a', text: 'A' }]))
})

test('valid JSON keeps escaped newlines and reports duplicate/unknown ids', () => {
  const result = parseTranslationResponse(
    JSON.stringify({ items: [{ id: 'a', t: 'first\nsecond' }, { id: 'a', t: 'duplicate' }, { id: 'x', t: 'unknown' }] }),
    'json-items',
    ['a', 'b'],
    false
  )
  assert.equal(result.items[0]?.text, 'first\nsecond')
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((issue) => issue.code === 'duplicate-id'))
  assert.ok(result.issues.some((issue) => issue.code === 'unknown-id'))
  assert.ok(result.issues.some((issue) => issue.code === 'missing-id'))
})

test('a truncated response is never complete even when all ids are present', () => {
  const result = parseTranslationResponse('[a] A', 'id-lines', ['a'], true)
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((issue) => issue.code === 'truncated-output'))
})

test('context ids are tolerated as non-output evidence but never mapped', () => {
  const result = parseTranslationResponse('[a] A\n[context-1] context', 'id-lines', ['a'], false, ['context-1'])
  assert.equal(result.complete, true)
  assert.deepEqual(result.items, [{ id: 'a', text: 'A' }])
  assert.equal(result.issues.find((issue) => issue.code === 'unknown-id')?.severity, 'warning')
})

test('embedded cue delimiters are rejected instead of becoming spoken text', () => {
  const result = parseTranslationResponse(
    '[cue-19-33420] This is the flower [cue-20-34200] also called Manjusaka',
    'id-lines',
    ['cue-19-33420', 'cue-20-34200'],
    false
  )
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((issue) => issue.code === 'unparsed-content'))
})

test('normalizes a gateway ID that dropped the cue prefix', () => {
  const result = parseTranslationResponse(
    '[32-49700] A shark fact\n[cue-33-51400] Another fact',
    'id-lines',
    ['cue-32-49700', 'cue-33-51400'],
    false
  )
  assert.equal(result.complete, true)
  assert.deepEqual(result.items, [
    { id: 'cue-32-49700', text: 'A shark fact' },
    { id: 'cue-33-51400', text: 'Another fact' }
  ])
})
