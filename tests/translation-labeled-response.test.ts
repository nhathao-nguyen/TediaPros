import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCueLinesV1Response } from '../src/main/translation/response'

const expected = ['cue-1', 'cue-2']

test('cue-lines-v1 accepts exact IDs and canonical text', () => {
  const result = parseCueLinesV1Response('\uFEFF[cue-1] Xin mở nắp.\r\n[cue-2] Sau đó khuấy đều.\r\n', expected, false)
  assert.equal(result.complete, true)
  assert.deepEqual(result.items, [
    { id: 'cue-1', text: 'Xin mở nắp.' },
    { id: 'cue-2', text: 'Sau đó khuấy đều.' }
  ])
  assert.deepEqual(result.issues, [])
})

test('cue-lines-v1 does not strip cue prefixes or infer positional IDs', () => {
  const alias = parseCueLinesV1Response('[1] Dòng một.\n[1] Dòng hai.', expected, false)
  assert.equal(alias.complete, false)
  assert.ok(alias.issues.some((item) => item.code === 'unknown-id'))

  const prefix = parseCueLinesV1Response('[1-1] Dòng một.\n[cue-2] Dòng hai.', expected, false)
  assert.equal(prefix.complete, false)
  assert.ok(prefix.issues.some((item) => item.code === 'unknown-id'))
})

test('cue-lines-v1 rejects duplicates, missing IDs, prose and Markdown fences', () => {
  const duplicate = parseCueLinesV1Response('[cue-1] Một.\n[cue-1] Hai.', expected, false)
  assert.equal(duplicate.complete, false)
  assert.ok(duplicate.issues.some((item) => item.code === 'duplicate-id'))
  assert.ok(duplicate.issues.some((item) => item.code === 'missing-id'))

  const prose = parseCueLinesV1Response('Here is the translation:\n[cue-1] Một.\n[cue-2] Hai.', expected, false)
  assert.equal(prose.complete, false)
  assert.ok(prose.issues.some((item) => item.code === 'unparsed-content'))

  const fenced = parseCueLinesV1Response('```text\n[cue-1] Một.\n[cue-2] Hai.\n```', expected, false)
  assert.equal(fenced.complete, false)
  assert.ok(fenced.issues.some((item) => item.code === 'unparsed-content'))
})

test('cue-lines-v1 treats truncated output as incomplete even when parsed lines are present', () => {
  const result = parseCueLinesV1Response('[cue-1] Một.\n[cue-2] Hai.', expected, true)
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((item) => item.code === 'truncated-output'))
})

test('cue-lines-v1 rejects a context cue instead of silently filtering it', () => {
  const result = parseCueLinesV1Response('[cue-before] Context.\n[cue-1] Một.\n[cue-2] Hai.', expected, false)
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((item) => item.code === 'unknown-id' && item.cueIds.includes('cue-before')))
})
