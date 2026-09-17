import test from 'node:test'
import assert from 'node:assert/strict'
import { nextFeedbackAction } from '../src/main/dubbing/feedbackDecision'
import { hashFeedbackCandidate } from '../src/main/dubbing/synthesis'

test('feedback decision skips tried candidates and cancellation wins', () => {
  const candidates = [
    { hash: 'tried', text: 'already attempted', quality: 'eligible' as const },
    { hash: 'review', text: 'not eligible', quality: 'review' as const },
    { hash: 'next', text: 'fresh candidate', quality: 'eligible' as const }
  ]

  assert.deepEqual(nextFeedbackAction(candidates, new Set(['tried']), false), {
    type: 'synthesize', candidate: candidates[2]
  })
  assert.deepEqual(nextFeedbackAction(candidates, new Set(['tried', 'next']), false), {
    type: 'stop', reason: 'no-progress'
  })
  assert.deepEqual(nextFeedbackAction(candidates, new Set(), true), { type: 'stop', reason: 'cancelled' })
})

test('feedback candidate hash is stable for reordered options and sensitive to speech identity', () => {
  const base = {
    sourceCueIds: ['source-1', 'source-2'],
    text: 'A shorter candidate.',
    model: 'model-a',
    voice: 'voice-a',
    options: { rate: 1, style: { emphasis: 'soft', pitch: 0 } }
  }
  const hash = hashFeedbackCandidate(base)
  assert.equal(hash, hashFeedbackCandidate({ ...base, options: { style: { pitch: 0, emphasis: 'soft' }, rate: 1 } }))
  assert.notEqual(hash, hashFeedbackCandidate({ ...base, sourceCueIds: ['source-1', 'source-3'] }))
  assert.notEqual(hash, hashFeedbackCandidate({ ...base, text: 'Another candidate.' }))
  assert.notEqual(hash, hashFeedbackCandidate({ ...base, model: 'model-b' }))
  assert.notEqual(hash, hashFeedbackCandidate({ ...base, voice: 'voice-b' }))
})
