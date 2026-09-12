import assert from 'node:assert/strict'
import test from 'node:test'
import { preparationIdentityKey, semanticFrameEditDigest, semanticTemporalSourceDigest } from '../src/main/autoShortCutIdentity'
import type { AutoShortTemporalEditV2, CutExecutionIdentity } from '../src/shared/autoShortCutContract'

const boundary = (index: number) => ({ presentationIndex: index, ptsTicks: String(index), timeBase: { num: 1, den: 25 }, eof: index === 10 })
const makeEdit = (revision: number, id: string, end = 4): AutoShortTemporalEditV2 => ({
  schemaVersion: 2, editId: `edit-${revision}`, revision, mode: 'ripple-delete', policyVersion: 'cut-v2',
  itemId: 'item-1', sourceDigest: 'a'.repeat(64), frameIndexRevision: 'index-v1',
  removedRanges: [{ id, start: boundary(2), end: boundary(end) }], reviewResolutions: []
})

test('semantic edit identity ignores operation IDs and revision metadata', () => {
  assert.equal(semanticFrameEditDigest(makeEdit(1, 'first')), semanticFrameEditDigest(makeEdit(99, 'renamed')))
  assert.notEqual(semanticFrameEditDigest(makeEdit(1, 'first')), semanticFrameEditDigest(makeEdit(1, 'first', 5)))
})

test('preparation key changes for every output-affecting execution identity', () => {
  const identity: CutExecutionIdentity = {
    sourceDigest: 'a'.repeat(64), editDigest: 'b'.repeat(64), executorRevision: 'cut-executor-v2',
    runtimeDigest: 'c'.repeat(64), mediaPolicyDigest: 'd'.repeat(64)
  }
  assert.equal(preparationIdentityKey(identity), preparationIdentityKey({ ...identity }))
  for (const key of ['sourceDigest', 'editDigest', 'executorRevision', 'runtimeDigest', 'mediaPolicyDigest'] as const) {
    const replacement = key.endsWith('Digest') && key !== 'executorRevision' ? 'e'.repeat(64) : 'changed'
    assert.notEqual(preparationIdentityKey(identity), preparationIdentityKey({ ...identity, [key]: replacement }))
  }
})

test('downstream source identity is stable across mux bytes and edit metadata', () => {
  const sourceDigest = 'a'.repeat(64)
  const first = { schemaVersion: 1 as const, revision: 1, mode: 'ripple-delete' as const, removedRanges: [{ id: 'first', startUs: 1, endUs: 2 }] }
  const renamed = { ...first, revision: 99, removedRanges: [{ id: 'renamed', startUs: 1, endUs: 2 }] }
  assert.equal(semanticTemporalSourceDigest(sourceDigest, first), semanticTemporalSourceDigest(sourceDigest, renamed))
  assert.notEqual(semanticTemporalSourceDigest(sourceDigest, first), semanticTemporalSourceDigest(sourceDigest, { ...renamed, removedRanges: [{ id: 'renamed', startUs: 1, endUs: 3 }] }))
  assert.equal(semanticTemporalSourceDigest(sourceDigest, undefined), sourceDigest)
})
