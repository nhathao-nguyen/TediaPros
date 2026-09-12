import assert from 'node:assert/strict'
import test from 'node:test'
import { pageFrameBoundaries, parseFfprobeFrameIndex, resolveFrameBoundary, upgradeLegacyTemporalEdit } from '../src/main/autoShortFrameIndex'
import type { CutFrameIndex } from '../src/shared/autoShortCutContract'
import type { FrameBoundary } from '../src/shared/autoShortCutContract'

const cfr = (den: number, lastIndex = 3): FrameBoundary[] => Array.from({ length: lastIndex + 1 }, (_, index) => ({
  presentationIndex: index,
  ptsTicks: String(index),
  timeBase: { num: 1, den },
  eof: index === lastIndex
}))

test('resolves user time to the first presentation boundary at or after it', () => {
  assert.equal(resolveFrameBoundary(cfr(25, 27), { num: '1001', den: '1000' }, { num: '0', den: '1' }).presentationIndex, 26)
  const oneSecond = [0, 25, 26, 27].map((index, presentationIndex) => ({
    presentationIndex, ptsTicks: String(index), timeBase: { num: 1, den: 25 }, eof: presentationIndex === 3
  }))
  assert.equal(resolveFrameBoundary(oneSecond, { num: '1001', den: '1000' }, { num: '0', den: '1' }).ptsTicks, '26')
  assert.equal(resolveFrameBoundary(oneSecond, { num: '2', den: '25' }, { num: '1', den: '1' }).eof, true)
})

test('uses rational comparison for fractional rates and rejects ambiguous indexes', () => {
  const fractional = [0, 1, 2].map((index) => ({
    presentationIndex: index, ptsTicks: String(index), timeBase: { num: 1001, den: 30_000 }, eof: index === 2
  }))
  assert.equal(resolveFrameBoundary(fractional, { num: '34', den: '1000' }, { num: '0', den: '1' }).presentationIndex, 2)
  const duplicate = [...fractional, { ...fractional[1], presentationIndex: 2 }]
  assert.throws(() => resolveFrameBoundary(duplicate, { num: '1', den: '100' }, { num: '0', den: '1' }), /CUT_FRAME_INDEX_UNSUPPORTED/)
})

test('rejects a request beyond EOF instead of silently clamping it', () => {
  assert.throws(() => resolveFrameBoundary(cfr(25), { num: '1', den: '1' }, { num: '0', den: '1' }), /CUT_INVALID_RANGE/)
})

test('parses VFR presentation ticks, EOF and audio epoch without average FPS', () => {
  const index = parseFfprobeFrameIndex({
    itemId: 'item-1', sourceDigest: 'a'.repeat(64),
    videoStream: { time_base: '1/1000', start_pts: 100, duration_ts: 130 },
    audioStream: { time_base: '1/48000', start_pts: 28_800, sample_rate: '48000', channels: 2 },
    frames: [
      { best_effort_timestamp: 100, pkt_duration: 40 },
      { best_effort_timestamp: 140, pkt_duration: 50 },
      { best_effort_timestamp: 190, pkt_duration: 40 }
    ]
  })
  assert.deepEqual(index.validatedBoundaries.map((entry) => entry.ptsTicks), ['100', '140', '190', '230'])
  assert.deepEqual(index.videoEpoch, { num: '1', den: '10' })
  assert.deepEqual(index.sourceDuration, { num: '13', den: '100' })
  assert.deepEqual(index.audio?.startRelativeToVideo, { num: '1', den: '2' })
})

test('keeps frame index pages bounded and requires an explicit valid limit', () => {
  const boundaries = Array.from({ length: 301 }, (_, index) => ({
    presentationIndex: index, ptsTicks: String(index), timeBase: { num: 1, den: 25 }, eof: index === 300
  }))
  assert.throws(() => pageFrameBoundaries(boundaries, undefined, 257), /CUT_RESOURCE_LIMIT/)
  const first = pageFrameBoundaries(boundaries, undefined, 256)
  assert.equal(first.boundaries.length, 256)
  assert.equal(first.nextCursor, '256')
  const second = pageFrameBoundaries(boundaries, first.nextCursor, 256)
  assert.equal(second.boundaries.length, 45)
  assert.equal(second.nextCursor, undefined)
})

test('upgrades legacy timestamps to actual boundaries and rejects a zero-frame cut', () => {
  const boundaries = Array.from({ length: 28 }, (_, index) => ({
    presentationIndex: index, ptsTicks: String(index), timeBase: { num: 1, den: 25 }, eof: index === 27
  }))
  const index: CutFrameIndex = {
    identity: { itemId: 'item-1', sourceDigest: 'a'.repeat(64), frameIndexRevision: 'index-v1' },
    frameCount: 27, videoEpoch: { num: '0', den: '1' }, sourceDuration: { num: '27', den: '25' }, validatedBoundaries: boundaries
  }
  assert.throws(() => upgradeLegacyTemporalEdit({
    schemaVersion: 1, revision: 1, mode: 'ripple-delete',
    removedRanges: [{ id: 'micro', startUs: 1_001_000, endUs: 1_019_000 }]
  }, index), /CUT_INVALID_RANGE/)
  const upgraded = upgradeLegacyTemporalEdit({
    schemaVersion: 1, revision: 1, mode: 'ripple-delete',
    removedRanges: [{ id: 'valid', startUs: 1_001_000, endUs: 1_050_000 }]
  }, index)
  assert.deepEqual(upgraded.removedRanges.map((range) => [range.start.presentationIndex, range.end.presentationIndex]), [[26, 27]])
})
