import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSourceSpeechUnitPlan } from '../src/main/translation/speechUnitPlanner'
import { buildDubbingPlan, groupDubbingPlanForSourceAnchoredSpeech } from '../src/main/dubbing/plan'
import { applyDubbingTranslations } from '../src/main/dubbing/translation'

test('source speech units reserve the inter-group gap exactly once and retain their cue coverage', () => {
  const plan = buildSourceSpeechUnitPlan({
    sourceDigest: 'source-digest',
    videoDuration: 5,
    cues: [
      { id: 'a', sourceIndex: 0, start: 0, end: 1, groupId: 'old-a', text: 'Mở nắp' },
      { id: 'b', sourceIndex: 1, start: 1, end: 2, groupId: 'old-b', text: 'rồi khuấy đều.' },
      { id: 'c', sourceIndex: 2, start: 2, end: 3, groupId: 'old-c', text: 'Sau đó tắt bếp.' }
    ]
  })
  assert.deepEqual(plan.units.map((unit) => unit.memberCueIds), [['a', 'b'], ['c']])
  assert.equal(plan.units[0]?.budget.availableSeconds, 1.5)
  assert.ok(Math.abs((plan.units[0]?.budget.targetNaturalSeconds || 0) - 1.65) < 1e-9)
  assert.ok(Math.abs((plan.units[0]?.budget.hardMaxNaturalSeconds || 0) - 2.7) < 1e-9)
  assert.equal(plan.units[1]?.boundaryReason, 'end-of-source')
})

test('source speech planning refuses timeline or identity mutations before a prompt can use the plan', () => {
  assert.throws(() => buildSourceSpeechUnitPlan({
    sourceDigest: '',
    videoDuration: 2,
    cues: [{ id: 'a', sourceIndex: 0, start: 0, end: 1, groupId: 'g', text: 'Câu.' }]
  }), /invalid-speech-unit-source-digest/u)
  assert.throws(() => buildSourceSpeechUnitPlan({
    sourceDigest: 'x',
    videoDuration: 1,
    cues: [
      { id: 'a', sourceIndex: 0, start: 0, end: 1, groupId: 'g', text: 'Câu.' },
      { id: 'a', sourceIndex: 1, start: 1, end: 1, groupId: 'g', text: 'Trùng.' }
    ]
  }), /invalid-speech-unit-source/u)
})

test('Gateway source timing budget and TTS use the same frozen source partition despite target punctuation', () => {
  const cues = Array.from({ length: 6 }, (_, sourceIndex) => ({
    id: `cue-${sourceIndex + 1}`,
    sourceIndex,
    start: sourceIndex,
    end: sourceIndex + 1,
    groupId: 'source-run',
    text: '连续的原文片段'
  }))
  const speechPlan = buildSourceSpeechUnitPlan({ sourceDigest: 'source-digest', videoDuration: 6.5, cues })
  const translated = applyDubbingTranslations(
    buildDubbingPlan({ videoDuration: 6.5, cues }),
    cues.map((cue, index) => ({ id: cue.id, text: `Câu đích ${index + 1}.` }))
  )
  const ttsPlan = groupDubbingPlanForSourceAnchoredSpeech(translated, 'vi-VN')
  assert.deepEqual(
    ttsPlan.cues.map((cue) => cue.sourceCueIds),
    speechPlan.units.map((unit) => unit.memberCueIds)
  )
})
