import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCutSeconds } from '../src/shared/autoShortCutEditor'

test('rejects empty, negative and ambiguous cut times', () => {
  for (const raw of ['', ' ', '-1', 'Infinity', 'NaN', '1e3', '1,2.3', '1.2.3']) {
    assert.equal(parseCutSeconds(raw).ok, false, raw)
  }
})

test('accepts zero and one decimal separator without losing precision', () => {
  assert.deepEqual(parseCutSeconds('0'), { ok: true, seconds: 0 })
  assert.deepEqual(parseCutSeconds(' 1.25 '), { ok: true, seconds: 1.25 })
  assert.deepEqual(parseCutSeconds(' 1,25 '), { ok: true, seconds: 1.25 })
  assert.deepEqual(parseCutSeconds('12.'), { ok: true, seconds: 12 })
})
