import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveDubbingWindow } from '../src/main/dubbing/plan'
import { makeSpeechBudget } from '../src/main/translation/speechBudget'

test('speech budget uses one already-derived group window and the policy tempo bounds', () => {
  const window = deriveDubbingWindow({ id: 'g', start: 0, end: 6, text: 'Một câu.' }, 6, 8)
  const budget = makeSpeechBudget('g', 1, window, 1.1, 1.8)
  assert.equal(budget.availableSeconds, 5.5)
  assert.ok(Math.abs(budget.targetNaturalSeconds - 6.05) < 1e-9)
  assert.ok(Math.abs(budget.hardMaxNaturalSeconds - 9.9) < 1e-9)
})

test('speech budget refuses invalid revisions and a tempo beyond the current hard policy', () => {
  const window = deriveDubbingWindow({ id: 'g', start: 0, end: 1, text: 'Một câu.' }, null, 2)
  assert.throws(() => makeSpeechBudget('g', 0, window, 1.1, 1.8), /invalid-speech-budget/u)
  assert.throws(() => makeSpeechBudget('g', 1, window, 1.1, 1.81), /invalid-speech-budget/u)
})
