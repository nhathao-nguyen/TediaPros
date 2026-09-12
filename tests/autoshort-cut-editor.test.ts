import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseCutRunIntent, parseCutSeconds, reduceCutHistory } from '../src/shared/autoShortCutEditor'
import { normalizeFrameCutRanges, type CutHistory, type FrameBoundary, type FrameCutRange } from '../src/shared/autoShortCutContract'

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

const boundary = (presentationIndex: number): FrameBoundary => ({
  presentationIndex,
  ptsTicks: String(presentationIndex),
  timeBase: { num: 1, den: 1 },
  eof: presentationIndex === 6
})

const range = (id: string, start: number, end: number): FrameCutRange => ({ id, start: boundary(start), end: boundary(end) })

test('keeps raw edit operations in history while normalizing execution ranges', () => {
  const empty = { operations: [], reviewResolutions: [] }
  const first = range('one', 1, 3)
  const second = range('two', 2, 4)
  let history: CutHistory = { past: [], present: empty, future: [] }
  history = reduceCutHistory(history, { type: 'replace', content: { operations: [first], reviewResolutions: [] } })
  history = reduceCutHistory(history, { type: 'replace', content: { operations: [first, second], reviewResolutions: [] } })
  assert.deepEqual(normalizeFrameCutRanges(history.present.operations).map((item) => [item.start.presentationIndex, item.end.presentationIndex]), [[1, 4]])
  const undone = reduceCutHistory(history, { type: 'undo' })
  assert.deepEqual(undone.present.operations, [first])
  assert.deepEqual(history.present.operations, [first, second])
  assert.deepEqual(reduceCutHistory(undone, { type: 'redo' }).present.operations, [first, second])
})

test('caps transaction history without mutating inputs', () => {
  const empty = { operations: [], reviewResolutions: [] }
  let history: CutHistory = { past: [], present: empty, future: [] }
  for (let index = 0; index < 205; index += 1) {
    history = reduceCutHistory(history, { type: 'replace', content: { operations: [range(`r-${index}`, index, index + 1)], reviewResolutions: [] } })
  }
  assert.equal(history.past.length, 200)
  assert.deepEqual(empty, { operations: [], reviewResolutions: [] })
})

test('chooses a safe run intent for draft and resumed edits', () => {
  assert.equal(chooseCutRunIntent({ hasDraft: true, snapshotChanged: false, hasResume: true }), 'resolve-draft')
  assert.equal(chooseCutRunIntent({ hasDraft: false, snapshotChanged: true, hasResume: true }), 'new-run')
  assert.equal(chooseCutRunIntent({ hasDraft: false, snapshotChanged: false, hasResume: true }), 'resume')
  assert.equal(chooseCutRunIntent({ hasDraft: false, snapshotChanged: false, hasResume: false }), 'start')
})
