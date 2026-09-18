import assert from 'node:assert/strict'
import test from 'node:test'
import {
  firstPassFit,
  pairedFirstPassFitBootstrap
} from '../scripts/evaluate-vietnamese-dubbing.mjs'

test('first-pass fit keeps failed audio in the denominator', () => {
  assert.deepEqual(firstPassFit([
    { status: 'measured', naturalSeconds: 4.4, windowSeconds: 4 },
    { status: 'failed', naturalSeconds: null, windowSeconds: 4 }
  ], 1.25), { fit: 1, total: 2, rate: 0.5 })
  assert.throws(() => firstPassFit([], 0), /invalid-threshold/u)
})

test('paired bootstrap resamples complete videos deterministically without dropping failed units', () => {
  const videos = [
    {
      videoId: 'video-a',
      baseline: [
        { status: 'measured', naturalSeconds: 2, windowSeconds: 1 },
        { status: 'failed', naturalSeconds: null, windowSeconds: 1 }
      ],
      candidate: [
        { status: 'measured', naturalSeconds: 1, windowSeconds: 1 },
        { status: 'measured', naturalSeconds: 1, windowSeconds: 1 }
      ]
    },
    {
      videoId: 'video-b',
      baseline: [{ status: 'measured', naturalSeconds: 1, windowSeconds: 1 }],
      candidate: [{ status: 'measured', naturalSeconds: 1, windowSeconds: 1 }]
    }
  ]
  const first = pairedFirstPassFitBootstrap(videos, { threshold: 1.25, resamples: 200, seed: 42 })
  const second = pairedFirstPassFitBootstrap(videos, { threshold: 1.25, resamples: 200, seed: 42 })

  assert.deepEqual(first, second)
  assert.deepEqual(first.baseline, { fit: 1, total: 3, rate: 1 / 3 })
  assert.deepEqual(first.candidate, { fit: 3, total: 3, rate: 1 })
  assert.ok(Math.abs(first.difference - 2 / 3) < 1e-12)
  assert.equal(first.videos, 2)
  assert.equal(first.resamples, 200)
  assert.ok(first.interval95)
  assert.ok(first.interval95[0] <= first.difference && first.interval95[1] >= first.difference)
  assert.throws(() => pairedFirstPassFitBootstrap([...videos, { ...videos[0], videoId: 'video-a' }], { resamples: 10 }), /duplicate-video-id/u)
})
