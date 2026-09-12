import assert from 'node:assert/strict'
import test from 'node:test'
import { compileFrameCutPlan, projectCutInterval, sampleAt } from '../src/shared/autoShortCutPlan'
import type { AutoShortTemporalEditV2, CutExecutionIdentity, CutFrameIndex, FrameBoundary } from '../src/shared/autoShortCutContract'

const boundary = (index: number): FrameBoundary => ({
  presentationIndex: index, ptsTicks: String(index), timeBase: { num: 1, den: 1 }, eof: index === 6
})
const source = { itemId: 'item-1', sourceDigest: 'a'.repeat(64), frameIndexRevision: 'index-v1' }
const identity: CutExecutionIdentity = {
  sourceDigest: source.sourceDigest, editDigest: 'b'.repeat(64), executorRevision: 'cut-executor-v2',
  runtimeDigest: 'c'.repeat(64), mediaPolicyDigest: 'd'.repeat(64)
}
const index: CutFrameIndex = {
  identity: source, frameCount: 6, videoEpoch: { num: '0', den: '1' }, sourceDuration: { num: '6', den: '1' },
  audio: { sampleRate: 48_000, channels: 2, startRelativeToVideo: { num: '1', den: '2' } },
  validatedBoundaries: Array.from({ length: 7 }, (_, frame) => boundary(frame))
}

const edit = (ranges: Array<[string, number, number]>): AutoShortTemporalEditV2 => ({
  ...source, schemaVersion: 2, editId: 'edit-1', revision: 1, mode: 'ripple-delete', policyVersion: 'cut-v2',
  removedRanges: ranges.map(([id, start, end]) => ({ id, start: boundary(start), end: boundary(end) })),
  reviewResolutions: []
})

test('rounds sample positions from absolute rational time', () => {
  assert.equal(sampleAt({ num: '1', den: '3' }, 48_000), 16_000n)
  assert.equal(sampleAt({ num: '-1', den: '2' }, 48_000), -24_000n)
})

test('compiles one linked frame/audio schedule with stable segment IDs', () => {
  const plan = compileFrameCutPlan({ edit: edit([['middle', 2, 4]]), index, identity })
  assert.deepEqual(plan.keepSegments.map((segment) => segment.segmentId), ['keep-0-2', 'keep-4-6'])
  assert.deepEqual(plan.keepSegments.map((segment) => [segment.editedStart, segment.editedEnd]), [
    [{ num: '0', den: '1' }, { num: '2', den: '1' }],
    [{ num: '2', den: '1' }, { num: '4', den: '1' }]
  ])
  assert.equal(plan.keepSegments.at(-1)?.outputSampleEnd, '192000')
  assert.deepEqual(plan.audio?.startRelativeToVideo, { num: '1', den: '2' })
  assert.equal(new Set(plan.keepSegments.map((segment) => segment.segmentId)).size, 2)
})

test('projects an interval across retained segments without covering a deleted gap', () => {
  const plan = compileFrameCutPlan({ edit: edit([['middle', 2, 4]]), index, identity })
  const fragments = projectCutInterval(plan, { num: '1', den: '1' }, { num: '5', den: '1' })
  assert.equal(fragments.length, 2)
  assert.deepEqual(fragments.map((part) => [part.sourceStart, part.sourceEnd]), [
    [{ num: '1', den: '1' }, { num: '2', den: '1' }],
    [{ num: '4', den: '1' }, { num: '5', den: '1' }]
  ])
})

test('rejects stale identities, unknown boundaries and all-delete plans', () => {
  assert.throws(() => compileFrameCutPlan({ edit: { ...edit([['middle', 2, 4]]), sourceDigest: 'e'.repeat(64) }, index, identity }), /CUT_SOURCE_CHANGED/)
  assert.throws(() => compileFrameCutPlan({ edit: edit([['unknown', 2, 7]]), index, identity }), /CUT_FRAME_INDEX_UNSUPPORTED/)
  assert.throws(() => compileFrameCutPlan({ edit: edit([['all', 0, 6]]), index, identity }), /CUT_INVALID_RANGE/)
})
