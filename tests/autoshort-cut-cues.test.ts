import assert from 'node:assert/strict'
import test from 'node:test'
import { findCutSeamCueIssues } from '../src/shared/autoShortCutCues'
import type { CutExecutionPlan } from '../src/shared/autoShortCutPlan'

const plan = {
  joins: [{ leftSegmentId: 'keep-0-50', rightSegmentId: 'keep-100-150', editedAt: { num: '2', den: '1' } }]
} as CutExecutionPlan

test('blocks recognition evidence that crosses a hard cut join', () => {
  const issues = findCutSeamCueIssues([
    { id: 'safe-left', start: 1, end: 2 },
    { id: 'unsafe', start: 1.8, end: 2.2 },
    { id: 'safe-right', start: 2, end: 3 }
  ], plan)
  assert.deepEqual(issues, [{ cueId: 'unsafe', joinIndex: 0, editedAtSeconds: 2, code: 'CUT_SEAM_REVIEW_REQUIRED' }])
})

test('does not invent a seam issue when cues stop exactly at the join', () => {
  assert.deepEqual(findCutSeamCueIssues([
    { id: 'left', start: 0, end: 2 }, { id: 'right', start: 2, end: 4 }
  ], plan), [])
})
