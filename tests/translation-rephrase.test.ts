import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRephraseResponse } from '../src/main/translation/response'
import { buildRephraseMessages } from '../src/main/translation/prompts'

test('rephrase parser accepts at most three grounded candidates', () => {
  const result = parseRephraseResponse('[c1:1] Do not touch it.\n[c1:2] Please do not touch it.', 'c1')
  assert.equal(result.complete, true)
  assert.equal(result.items.length, 2)
  assert.deepEqual(result.items.map((item) => item.id), ['c1:1', 'c1:2'])
})

test('rephrase parser rejects continuation and free-form prose', () => {
  const result = parseRephraseResponse('[c1:1] First line\nsecond line', 'c1')
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((issue) => issue.code === 'unparsed-content'))
  assert.deepEqual(parseRephraseResponse('Here is a shorter option.', 'c1').items, [])
})

test('rephrase prompt carries source evidence and no translation cardinality contract', () => {
  const messages = buildRephraseMessages({ targetLocale: 'en', cues: [{
    id: 'c1', sourceText: '不要摸这只狗。', currentText: 'Do not touch this dog.', targetDuration: 2,
    contextBefore: [], contextAfter: []
  }] })
  assert.match(messages[0].content, /task=rephrase/u)
  assert.match(messages[1].content, /不要摸这只狗/u)
  assert.doesNotMatch(messages[0].content, /one translation per ID|đúng một.*cue/iu)
})
