import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAutoShortTemporalEditV2 } from '../src/shared/autoShortCutContract'
import { compileAutoShortCutPlan, type AutoShortTemporalEdit } from '../src/shared/autoShortTemporalEdit'

const boundary = (presentationIndex: number, eof = false) => ({
  presentationIndex,
  ptsTicks: String(presentationIndex * 1001),
  timeBase: { num: 1, den: 30_000 },
  eof
})

const valid = () => ({
  schemaVersion: 2 as const,
  editId: 'edit-1',
  revision: 3,
  mode: 'ripple-delete' as const,
  policyVersion: 'cut-v2' as const,
  itemId: 'item-1',
  sourceDigest: 'a'.repeat(64),
  frameIndexRevision: 'frame-index-v1',
  removedRanges: [{ id: 'r-1', start: boundary(1), end: boundary(3) }],
  reviewResolutions: []
})

test('validates a frame-boundary edit without trusting unknown fields', () => {
  assert.deepEqual(validateAutoShortTemporalEditV2(valid()), valid())
  assert.throws(() => validateAutoShortTemporalEditV2({ ...valid(), surprise: true }), /field không hợp lệ/)
  assert.throws(() => validateAutoShortTemporalEditV2({ ...valid(), schemaVersion: 9 }), /Phiên bản/)
  assert.throws(() => validateAutoShortTemporalEditV2({ ...valid(), mode: 'hold' }), /chế độ/)
  assert.throws(() => validateAutoShortTemporalEditV2(null), /không hợp lệ/)
})

test('rejects duplicate raw IDs, reversed bounds and oversized serialized edits', () => {
  const duplicate = { ...valid(), removedRanges: [valid().removedRanges[0], { ...valid().removedRanges[0] }] }
  assert.throws(() => validateAutoShortTemporalEditV2(duplicate), /ID khoảng cắt bị trùng/)
  assert.throws(() => validateAutoShortTemporalEditV2({ ...valid(), removedRanges: [{ id: 'bad', start: boundary(4), end: boundary(2) }] }), /điểm cuối/)
  assert.throws(() => validateAutoShortTemporalEditV2({ ...valid(), removedRanges: [{ id: 'huge', start: { ...boundary(1), ptsTicks: '9'.repeat(2_100_000) }, end: boundary(2) }] }), /2 MiB/)
})

test('legacy timestamp keep segment IDs stay unique', () => {
  const edit: AutoShortTemporalEdit = {
    schemaVersion: 1,
    revision: 1,
    mode: 'ripple-delete',
    removedRanges: [
      { id: 'head', startUs: 0, endUs: 1_000_000 },
      { id: 'middle', startUs: 2_000_000, endUs: 3_000_000 }
    ]
  }
  const plan = compileAutoShortCutPlan(edit, 4_000_000)
  assert.equal(new Set(plan.keepSegments.map((segment) => segment.id)).size, plan.keepSegments.length)
})
