import assert from 'node:assert/strict'
import test from 'node:test'
import { compileAutoShortCutPlan, mapSourceToEdited, normalizeAutoShortTemporalEdit } from '../src/shared/autoShortTemporalEdit'

test('normalizes overlapping and touching ripple-delete ranges', () => {
  const edit = normalizeAutoShortTemporalEdit({
    schemaVersion: 1, revision: 3, mode: 'ripple-delete',
    removedRanges: [
      { id: 'b', startUs: 20_000_000, endUs: 25_000_000 },
      { id: 'a', startUs: 0, endUs: 3_000_000 },
      { id: 'c', startUs: 24_000_000, endUs: 27_000_000 },
      { id: 'd', startUs: 27_000_000, endUs: 28_000_000 }
    ]
  })!
  assert.deepEqual(edit.removedRanges, [
    { id: 'a', startUs: 0, endUs: 3_000_000 },
    { id: 'b', startUs: 20_000_000, endUs: 28_000_000 }
  ])
})

test('builds source to edited map without mapping deleted time', () => {
  const edit = normalizeAutoShortTemporalEdit({ schemaVersion: 1, revision: 1, mode: 'ripple-delete', removedRanges: [
    { id: 'head', startUs: 0, endUs: 3_000_000 },
    { id: 'middle', startUs: 20_000_000, endUs: 25_000_000 }
  ] })
  const plan = compileAutoShortCutPlan(edit, 60_000_000)
  assert.equal(plan.editedDurationUs, 52_000_000)
  assert.equal(mapSourceToEdited(plan, 22_000_000), null)
  assert.equal(mapSourceToEdited(plan, 30_000_000), 22_000_000)
  assert.equal(mapSourceToEdited(plan, 60_000_000), 52_000_000)
})

test('rejects unsupported, unsafe and all-delete edits', () => {
  assert.throws(() => normalizeAutoShortTemporalEdit({ schemaVersion: 2, revision: 0, mode: 'ripple-delete', removedRanges: [] }))
  assert.throws(() => normalizeAutoShortTemporalEdit({ schemaVersion: 1, revision: 0, mode: 'ripple-delete', removedRanges: [{ id: 'x', startUs: 2, endUs: 1 }] }))
  assert.throws(() => compileAutoShortCutPlan({ schemaVersion: 1, revision: 0, mode: 'ripple-delete', removedRanges: [{ id: 'all', startUs: 0, endUs: 10 }] }, 10))
})
