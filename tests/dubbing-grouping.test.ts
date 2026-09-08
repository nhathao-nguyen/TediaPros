import assert from 'node:assert/strict'
import test from 'node:test'
import * as plans from '../src/main/dubbing/plan'
import { applyDubbingTranslations, dubbingSpeakingDurations } from '../src/main/dubbing/translation'
import { synthesizeDubbingPlan } from '../src/main/dubbing/synthesis'
import { parseSrt } from '../src/shared/subtitles'

const cases = [
  { id: 'cue-2-6060', start: 6.06, split: 6.7, end: 8.18, next: 9.92,
    source: ['这是豆鸡', '天天打架运动', '鸡肉纤维又粗又紧'],
    text: ['This is a bean chicken', 'Fighting daily, lots of exercise', 'Chicken fibers are coarse and tight'], audio: 4.1 },
  { id: 'cue-2-5530', start: 5.53, split: 6.41, end: 8.63, next: 10.15,
    source: ['這是紫地蟹', '主要以山上的靈芝草為食', '固稱靈芝蟹'],
    text: ["It's a purple land crab.", 'It mainly eats mountain lingzhi grass.', "Hence it's called lingzhi crab."], audio: 4.8 }
]

function group(plan: plans.DubbingPlan): plans.DubbingPlan {
  const fn = (plans as any).groupDubbingPlanForSpeech
  assert.equal(typeof fn, 'function')
  return fn(plan, 'en')
}

for (const sample of cases) test(`${sample.id} keeps all fragments in one physical speech window`, async () => {
  const sources = sample.source.map((text, i) => ({ id: i ? `${sample.id}-part${i}` : sample.id,
    start: [sample.start, sample.split, sample.end][i], end: [sample.split, sample.end, sample.next][i], text }))
  const original = applyDubbingTranslations(plans.buildDubbingPlan({ videoDuration: sample.next + 0.5, cues: sources }), sources.map((cue, i) => ({ id: cue.id, text: sample.text[i] })))
  assert.ok(dubbingSpeakingDurations(sources, original.videoDuration)[0] < 0.4)
  const before = JSON.stringify(original)
  const merged = group(original)
  assert.equal(JSON.stringify(original), before)
  assert.equal(merged.cues.length, 1)
  assert.deepEqual(merged.cues[0].sourceCueIds, sources.map((cue) => cue.id))
  assert.deepEqual((merged as any).sourceCues, sources)
  assert.equal(merged.cues[0].sourceStart, sample.start)
  assert.equal(merged.cues[0].sourceEnd, sample.next)
  assert.equal(merged.cues[0].finalSpokenText, sample.text.join(' '))
  const spoken: string[] = []
  const result = await synthesizeDubbingPlan({ plan: merged, language: 'en', model: 'fixture',
    tts: { synthesize: async (request) => { spoken.push(request.text); return { path: 'pcm' } } },
    audio: { trim: async () => ({ path: 'pcm', duration: sample.audio }), applyTempo: async (path, _hint, duration) => ({ path, duration }) }
  })
  assert.deepEqual(spoken, [sample.text.join(' ')])
  assert.ok(result.plan.cues[0].tempo <= 1.45)
  assert.equal(plans.validateDubbingPlan(result.plan).ok, true)
  assert.equal(result.subtitles.map((cue) => cue.text).join(' '), sample.text.join(' '))
  assert.ok(result.subtitles.length > 1, 'group captions should remain readable')
  assert.equal(result.subtitles[0].start, sample.start)
  assert.equal(result.subtitles.at(-1)!.end, result.plan.cues[0].voiceEnd)
  assert.ok(result.subtitles.every((cue, i) => i === 0 || cue.start === result.subtitles[i - 1].end))
})

test('grouping preserves question, speaker, sentence and pause boundaries plus a 0.5s inter-unit gap', async () => {
  const rows = [
    ['引言', 'Intro', 0, 1], ['能吃吗', 'Edible?', 1, 3],
    ['这是某种蟹', 'This is a crab', 3.3, 4], ['生活在山中', 'Lives in hills', 4, 5.5],
    ['还有别的吗？', 'Anything else?', 5.5, 7],
    ['[SPEAKER_00] 第一部分', 'Part one', 7, 8], ['[SPEAKER_01] 第二部分', 'Part two', 8, 9],
    ['完整句子。', 'A sentence.', 9.7, 11], ['另一句', 'Another', 11, 12]
  ] as const
  const sources = rows.map(([text, _target, start, end], i) => ({ id: `s${i}`, start, end, text }))
  const plan = group(applyDubbingTranslations(plans.buildDubbingPlan({ videoDuration: 13, cues: sources }), rows.map((row, i) => ({ id: `s${i}`, text: row[1] }))))
  assert.deepEqual(plan.cues.map((cue) => cue.sourceCueIds), [['s0'], ['s1'], ['s2', 's3'], ['s4'], ['s5'], ['s6'], ['s7'], ['s8']])
  assert.deepEqual(plan.cues.flatMap((cue) => cue.sourceCueIds), sources.map((cue) => cue.id))
  const synthesized = await synthesizeDubbingPlan({ plan, language: 'en', model: 'fixture',
    tts: { synthesize: async () => ({ path: 'pcm' }) },
    audio: { trim: async () => ({ path: 'pcm', duration: 0.4 }), applyTempo: async (path, _hint, duration) => ({ path, duration }) }
  })
  for (let i = 1; i < synthesized.plan.cues.length; i++) assert.ok(synthesized.plan.cues[i].start - synthesized.plan.cues[i - 1].voiceEnd! >= 0.5 - 0.005)
  assert.equal(synthesized.plan.cues[3].subtitles[0].sourceIndex, 4)
})

test('grouped speech is measured before any duration-prediction rewrite', async () => {
  const source = Array.from({ length: 18 }, (_, i) => [
    { id: `s${i}a`, start: i * 4, end: i * 4 + 0.5, text: '这是第一部分' },
    { id: `s${i}b`, start: i * 4 + 0.5, end: i * 4 + 2.5, text: '这是第二部分。' }
  ]).flat()
  const plan = group(plans.buildDubbingPlan({ videoDuration: 73, cues: source }))
  const spoken: string[] = []
  await synthesizeDubbingPlan({ plan, language: 'zh', model: 'fixture',
    predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 }, estimate: () => ({ seconds: 9, uncertaintySeconds: 0, confidence: 1 }), addSample: () => {} },
    rephrase: async () => { throw new Error('A fitting measured clip must not trigger rephrase.') },
    tts: { synthesize: async (request) => { spoken.push(request.text); return { path: 'pcm' } } },
    audio: { trim: async () => ({ path: 'pcm', duration: 2 }), applyTempo: async (path, _hint, duration) => ({ path, duration }) }
  })
  assert.deepEqual(spoken, plan.cues.map((cue) => cue.finalSpokenText))
})

test('group validation rejects dropped, duplicated, reordered or retimed source identities', () => {
  const original = plans.buildDubbingPlan({ videoDuration: 5, cues: [
    { id: 'a', start: 0, end: 0.7, text: '第一部分' }, { id: 'b', start: 0.7, end: 2, text: '第二部分' }, { id: 'c', start: 2, end: 4, text: '第三部分' }
  ] })
  const plan = group(original)
  assert.equal(plans.validateDubbingPlan(plan).ok, true)
  for (const mutate of [
    (p: plans.DubbingPlan) => { p.cues[0].sourceCueIds.pop() },
    (p: plans.DubbingPlan) => { p.cues[0].sourceCueIds[1] = 'a' },
    (p: plans.DubbingPlan) => { p.cues[0].sourceCueIds.reverse() },
    (p: plans.DubbingPlan) => { p.cues[0].sourceStart += 0.2 },
    (p: plans.DubbingPlan) => { p.cues[0].sourceEnd -= 0.2 },
    (p: plans.DubbingPlan) => { p.cues[0].sourceText = 'Lost words' }
  ]) { const bad = structuredClone(plan); mutate(bad); assert.equal(plans.validateDubbingPlan(bad).ok, false) }
})

test('speech groups remain bounded and a still-impossible complete sentence is rejected', async () => {
  const source = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, start: i, end: i + 1, text: '片段' }))
  const plan = group(plans.buildDubbingPlan({ videoDuration: 11, cues: source }))
  assert.ok(plan.cues.every((cue) => cue.sourceCueIds.length <= 6 && cue.sourceEnd - cue.sourceStart <= 15))
  assert.deepEqual(plan.cues.flatMap((cue) => cue.sourceCueIds), source.map((cue) => cue.id))
  const impossible = group(plans.buildDubbingPlan({ videoDuration: 1.5, cues: [{ id: 'sentence', start: 0, end: 1, text: 'Complete meaning.' }] }))
  await assert.rejects(synthesizeDubbingPlan({ plan: impossible, language: 'en', model: 'fixture',
    tts: { synthesize: async () => ({ path: 'pcm' }) },
    audio: { trim: async () => ({ path: 'pcm', duration: 3 }), applyTempo: async () => { throw new Error('must not force fit') } }
  }), /vượt trần/u)
})

test('a short final warning stays with its explanation before the next question', () => {
  const source = [
    { id: 'a', start: 33.13, end: 34.37, text: '这是某种蟹' },
    { id: 'b', start: 34.37, end: 35.91, text: '可能有寄生虫' },
    { id: 'c', start: 35.91, end: 37.23, text: '主要用来展示' },
    { id: 'warning', start: 37.23, end: 38.09, text: '不能吃' },
    { id: 'question', start: 38.09, end: 39.71, text: '这种蟹能吃吗？' }
  ]
  const plan = group(plans.buildDubbingPlan({ videoDuration: 41, cues: source }))
  assert.deepEqual(plan.cues.map((cue) => cue.sourceCueIds), [['a', 'b', 'c', 'warning'], ['question']])
})

test('bounded partitions avoid leaving a tiny seventh fragment isolated at the end', () => {
  const source = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, start: i * 1.2, end: (i + 1) * 1.2, text: '片段' }))
  source[6].end = source[6].start + 0.6
  const plan = group(plans.buildDubbingPlan({ videoDuration: source[6].end + 0.5, cues: source }))
  assert.equal(plan.cues.length, 2)
  assert.ok(plan.cues.every((cue) => cue.sourceCueIds.length > 1 && cue.sourceCueIds.length <= 6))
  assert.deepEqual(plan.cues.flatMap((cue) => cue.sourceCueIds), source.map((cue) => cue.id))
})

test('a 600ms pause is a boundary regardless of binary floating-point rounding', () => {
  for (const [end, start, count] of [[1.1, 1.7, 2], [10.6, 11.2, 2], [1, 1.6, 2], [1.1, 1.699, 1]]) {
    const plan = group(plans.buildDubbingPlan({ videoDuration: start + 4, cues: [
      { id: 'a', start: end - 1, end, text: '第一部分' },
      { id: 'b', start, end: start + 2, text: '第二部分' }
    ] }))
    assert.equal(plan.cues.length, count, `pause ${end} -> ${start}`)
  }
})

test('group captions retain original SRT index after invalid entries are skipped and timing is sorted', async () => {
  const parsed = parseSrt('1\n00:00:00,000 --> 00:00:00,000\nInvalid\n\n2\n00:00:02,000 --> 00:00:03,000\n第二部分\n\n3\n00:00:01,000 --> 00:00:02,000\n第一部分\n')
  assert.deepEqual(parsed.cues.map(cue => cue.sourceIndex), [2, 1])
  const source = parsed.cues.map(cue => ({ ...cue, id: cue.id! }))
  const plan = group(plans.buildDubbingPlan({ videoDuration: 4, cues: source }))
  const result = await synthesizeDubbingPlan({ plan, language: 'zh', model: 'fixture',
    tts: { synthesize: async () => ({ path: 'pcm' }) },
    audio: { trim: async () => ({ path: 'pcm', duration: 1 }), applyTempo: async (path, _hint, duration) => ({ path, duration }) }
  })
  assert.deepEqual(result.plan.cues[0].sourceCueIds, source.map(cue => cue.id))
  assert.ok(result.subtitles.every(cue => cue.sourceIndex === 2))
})

test('Arabic question marks separate a question from both neighboring utterances', () => {
  const original = plans.buildDubbingPlan({ videoDuration: 6, cues: [
    { id: 'intro', start: 0, end: 1.5, text: 'مقدمة' },
    { id: 'question', start: 1.5, end: 3, text: 'هل هذا صالح للأكل؟' },
    { id: 'answer', start: 3, end: 5, text: 'هذا صالح للأكل' }
  ] })
  assert.deepEqual(plans.groupDubbingPlanForSpeech(original, 'ar').cues.map(cue => cue.sourceCueIds), [['intro'], ['question'], ['answer']])
})
