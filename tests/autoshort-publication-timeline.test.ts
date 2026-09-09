import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type AutoShortDubbingUnit,
  validateAutoShortPublicationTimeline
} from '../src/main/autoShortPolicy'

function unit(end: number): AutoShortDubbingUnit {
  const duration = end - 9
  return {
    id: 'tail', timingPolicy: 'source-anchored-v2', sourceCueIds: ['tail'],
    sourceStart: 9, sourceEnd: 10, sourceText: 'Hello', translatedText: 'Hello',
    finalSpokenText: 'Hello', rephrased: false, naturalDuration: 1.2,
    finalDuration: duration, plannedStart: 9, plannedEnd: end, plannedDuration: duration,
    tempo: 1.2 / duration, hardEnd: 10, finalAudioPath: 'unchanged.wav',
    words: [], alignmentConfidence: 0, alignmentQuality: 'cue',
    subtitles: [{ id: 'tail', start: 9, end, text: 'Hello' }]
  }
}

for (const overshoot of [0.003, 0.01, 0.3]) {
  test(`blocks measured EOF overshoot ${overshoot} without changing evidence`, () => {
    const current = unit(10 + overshoot)
    const before = structuredClone(current)
    const result = validateAutoShortPublicationTimeline([current], 10)
    assert.equal(result.ok, false)
    assert.match(result.violations.join(' '), /EOF|thời lượng video/u)
    assert.deepEqual(current, before)
  })
}

test('metadata drift inside a longer video does not rewrite measured duration', () => {
  const current = unit(10)
  current.plannedEnd = 10.003
  const before = structuredClone(current)
  assert.equal(validateAutoShortPublicationTimeline([current], 11).ok, true)
  assert.deepEqual(current, before)
})

test('rejects missing measured duration and actual audio end beyond EOF', () => {
  const missing = unit(10)
  missing.finalDuration = 0
  assert.equal(validateAutoShortPublicationTimeline([missing], 10).ok, false)

  const actualOverflow = unit(9.5)
  actualOverflow.finalDuration = 1.1
  assert.equal(validateAutoShortPublicationTimeline([actualOverflow], 10).ok, false)
})

test('publication validation accepts deeply frozen evidence without mutation', () => {
  const frozen = unit(10)
  Object.freeze(frozen.subtitles[0])
  Object.freeze(frozen.subtitles)
  Object.freeze(frozen)
  assert.equal(validateAutoShortPublicationTimeline([frozen], 10).ok, true)
})
