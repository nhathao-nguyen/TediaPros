import test from 'node:test'
import assert from 'node:assert/strict'
import * as planModule from '../src/main/dubbing/plan'
import * as policyModule from '../src/main/autoShortPolicy'
import * as durationModule from '../src/main/dubbingDuration'
import * as cacheModule from '../src/main/dubbing/cache'
import * as translationModule from '../src/main/dubbing/translation'
import * as subtitleModule from '../src/main/dubbing/subtitles'
import * as synthesisModule from '../src/main/dubbing/synthesis'
import { planDubbingTimeMap, mapDubbingTime } from '../src/main/dubbing/timeMap'

test('local extension preserves unchanged segments and enforces 60 percent independently', () => {
  const map = planDubbingTimeMap(6, [
    { id: 'a', start: 0, sourceEnd: 1.5, naturalDuration: 3.4, availableDuration: 1.5 },
    { id: 'b', start: 2, sourceEnd: 3.5, naturalDuration: 1, availableDuration: 1.5 },
    { id: 'c', start: 4, sourceEnd: 5.5, naturalDuration: 4, availableDuration: 1.5 }
  ], 1.8)
  assert.ok(map.segments[0].outputEnd < 2.6)
  const unchanged = map.segments.find((segment) => segment.ownerCueId === 'b' && segment.mode === 'primary')!
  assert.ok(Math.abs(unchanged.outputEnd - unchanged.outputStart - 1.5) < 1e-9)
  assert.ok(map.segments.some((segment) => segment.sourceStart === 1.5 && segment.sourceEnd === 2 && !segment.ownerCueId))
  assert.ok(map.segments.filter((segment) => segment.ownerCueId === 'c')
    .reduce((sum, segment) => sum + segment.outputEnd - segment.outputStart, 0) <= 3.2)
  assert.equal(mapDubbingTime(map, 2), unchanged.outputStart)
  assert.equal(mapDubbingTime(map, 6), map.outputDuration)
  assert.throws(() => planDubbingTimeMap(2, [
    { id: 'too-long', start: 0, sourceEnd: 1.5, naturalDuration: 5, availableDuration: 1.5 }
  ], 1.8), /vượt giới hạn 60%/u)
})

test('visual extension slows at most 20 percent then replays source inside the owning cue interval', () => {
  const map = planDubbingTimeMap(4, [
    { id: 'a', start: 0, sourceEnd: 1, naturalDuration: 2.7, availableDuration: 1 },
    { id: 'b', start: 2, sourceEnd: 3.5, naturalDuration: 1, availableDuration: 1.5 }
  ], 1.8)
  const owned = map.segments.filter((segment) => segment.ownerCueId === 'a')
  assert.equal(owned.length, 2)
  assert.equal(owned[0].mode, 'primary')
  assert.ok(owned[0].outputEnd - owned[0].outputStart <= 1.2 + 1e-9)
  assert.equal(owned[1].mode, 'replay')
  assert.ok(owned[1].sourceStart >= 0 && owned[1].sourceEnd <= 1)
  assert.equal(mapDubbingTime(map, 2), map.segments.find((segment) => segment.ownerCueId === 'b')!.outputStart)
})

test('bounded extension keeps a feasible semantic group before introducing extra split gaps', async () => {
  const plan = planModule.groupDubbingPlanForSpeech(translationModule.applyDubbingTranslations(
    planModule.buildDubbingPlan({ videoDuration: 2, cues: [
      { id: 'p1', start: 0, end: 0.7, text: 'source fragment one' },
      { id: 'p2', start: 0.8, end: 1.5, text: 'source fragment two' }
    ] }), [{ id: 'p1', text: 'First complete sentence.' }, { id: 'p2', text: 'Second complete sentence.' }]
  ), 'en')
  assert.equal(plan.cues.length, 1)
  let splits = 0
  const result = await synthesisModule.synthesizeDubbingPlan({ plan, allowVideoExtension: true,
    language: 'en', model: 'fixture', onStructuralSplit: () => { splits++ },
    tts: { synthesize: async () => ({ path: 'group' }) },
    audio: { trim: async (path) => ({ path, duration: 3.4 }), applyTempo: async (path, _hint, duration) => ({ path, duration }) }
  })
  assert.equal(splits, 0)
  assert.deepEqual(result.plan.cues[0].sourceCueIds, ['p1', 'p2'])
  assert.ok(result.timeMap!.outputDuration <= 2.8)
})

test('measured rescue can extend video locally with original source ledger untouched', async () => {
  const original = planModule.buildDubbingPlan({ videoDuration: 4, paceMode: 'fixed', cues: [
    { id: 'a', start: 0, end: 1.5, text: 'Keep all the meaning.' },
    { id: 'b', start: 2, end: 3.5, text: 'Next sentence.' }
  ] })
  const result = await synthesisModule.synthesizeDubbingPlan({ plan: original,
    allowVideoExtension: true, language: 'en', model: 'fixture', fixedTempo: 1.8,
    tts: { synthesize: async (request) => ({ path: request.cueId }) },
    audio: { trim: async (path) => ({ path, duration: path === 'a' ? 3.4 : 1 }),
      applyTempo: async (path, _hint, target) => ({ path, duration: target }) }
  })
  assert.ok(result.timeMap)
  assert.ok(result.plan.videoDuration > 4 && result.plan.videoDuration <= 4.8)
  assert.equal(original.videoDuration, 4)
  assert.equal(original.cues[1].sourceStart, 2)
  assert.equal(result.plan.cues[1].sourceStart, mapDubbingTime(result.timeMap!, 2))
  assert.ok(result.plan.cues[0].voiceEnd! <= result.plan.cues[1].start - 0.5 + 0.005)
  assert.ok(result.metrics.maxTempo <= 1.8)
  assert.equal(result.plan.cues[0].finalSpokenText, original.cues[0].finalSpokenText)
  assert.equal(planModule.validateDubbingPlan(result.plan).ok, true)
})

test('tempo 1.460x from the reported DSP output is accepted under the new 1.8x ceiling', async () => {
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 2.221, paceMode: 'fixed', cues: [
      { id: 'cue-0-1490', start: 0, end: 1.721, text: 'Keep the full meaning.' }
    ] }), language: 'en', model: 'fixture', fixedTempo: 1.45,
    tts: { synthesize: async () => ({ path: 'natural.wav' }) },
    audio: { trim: async (path) => ({ path, duration: 2.496 }),
      applyTempo: async () => ({ path: 'measured.wav', duration: 1.710 }) }
  })
  assert.equal(result.plan.cues[0].tempo, 1.4596)
  assert.equal(result.plan.cues[0].actualDuration, 1.710)
  assert.equal(result.plan.cues[0].finalSpokenText, 'Keep the full meaning.')
})

test('audio requiring 1.8x fits without rephrase and fixed pace clamps at 1.8x', async () => {
  assert.equal(policyModule.AUTO_SHORT_TTS_HARD_MAX_TEMPO, 1.8)
  assert.equal(policyModule.selectFixedPace(2), 1.8)
  const result = await synthesisModule.synthesizeDubbingPlan({
    // The final 0.12s guard leaves exactly 1.5s for 2.7s of natural speech.
    plan: planModule.buildDubbingPlan({ videoDuration: 1.62, paceMode: 'fixed', cues: [
      { id: 'at-limit', start: 0, end: 1, text: 'Keep the full meaning.' }
    ] }), language: 'en', model: 'fixture', fixedTempo: 1,
    tts: { synthesize: async () => ({ path: 'natural.wav' }) },
    audio: { trim: async (path) => ({ path, duration: 2.7 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration }) },
    rephrase: async () => { throw new Error('No rephrase for audio within 1.8x') }
  })
  assert.equal(result.plan.cues[0].tempo, 1.8)
  assert.equal(result.plan.cues[0].actualDuration, 1.5)
})

test('rejects a looping overlong TTS clip for a short interjection', () => {
  const result = policyModule.validateVoiceAudioCompleteness('Oh my!', 8.76)
  assert.equal(result.ok, false)
  assert.match(result.error || '', /dài bất thường|lặp|sinh lỗi/u)
  assert.equal(policyModule.validateVoiceAudioCompleteness('Oh my!', 1.1).ok, true)
})

test('refreshes an overlong TTS cache entry before planning video extension', async () => {
  const requests: Array<{ cacheMode?: 'prefer' | 'bypass' }> = []
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 2.5, paceMode: 'fixed', cues: [
      { id: 'short-interjection', start: 0, end: 1.2, text: 'source' }
    ] }),
    language: 'en',
    model: 'fixture',
    fixedTempo: 1,
    tts: {
      synthesize: async (request) => {
        requests.push({ cacheMode: request.cacheMode })
        return request.cacheMode === 'bypass'
          ? { path: 'fresh.wav', fromCache: false }
          : { path: 'looping-cache.wav', fromCache: true }
      }
    },
    audio: {
      trim: async (path) => ({ path, duration: path === 'looping-cache.wav' ? 8.76 : 1.1 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration })
    }
  })
  assert.deepEqual(requests, [{ cacheMode: 'prefer' }, { cacheMode: 'bypass' }])
  assert.equal(result.plan.cues[0].naturalDuration, 1.1)
  assert.equal(result.timeMap, undefined)
})

test('second-pass duration recovery bypasses the previously measured TTS cache', async () => {
  const cacheModes: Array<'prefer' | 'bypass' | undefined> = []
  await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 3, cues: [
      { id: 'retry', start: 0, end: 2, text: 'Original source.' }
    ] }),
    recoveryAttempt: 2,
    language: 'en', model: 'fixture',
    tts: { synthesize: async (request) => { cacheModes.push(request.cacheMode); return { path: 'fresh' } } },
    audio: { trim: async (path) => ({ path, duration: 1 }), applyTempo: async (path, _hint, duration) => ({ path, duration }) }
  })
  assert.deepEqual(cacheModes, ['bypass'])
})

test('second-pass recovery can replace a semantically misaligned translation from source evidence', async () => {
  const original = planModule.buildDubbingPlan({ videoDuration: 2, cues: [
    { id: 'misaligned', start: 0, end: 1.8, text: '能走' }
  ] })
  const translated = translationModule.applyDubbingTranslations(original, [
    { id: 'misaligned', text: 'It crosses a 9-kilometer abyss.' }
  ])
  const spoken: string[] = []
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: translated,
    recoveryAttempt: 2,
    language: 'en', model: 'fixture',
    rephraseBatch: async () => new Map([['misaligned', ['It can walk.']]]),
    tts: { synthesize: async (request) => { spoken.push(request.text); return { path: request.text } } },
    audio: {
      trim: async (path) => ({ path, duration: path.includes('9-kilometer') ? 5 : 0.8 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration })
    }
  })
  assert.deepEqual(spoken, ['It crosses a 9-kilometer abyss.', 'It can walk.'])
  assert.equal(result.plan.cues[0].finalSpokenText, 'It can walk.')
})

test('tempo processing receives the authoritative duration measured by trim', async () => {
  let measuredDuration: number | undefined
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 1.62, paceMode: 'fixed', cues: [
      { id: 'measured-once', start: 0, end: 1, text: 'Keep the complete sentence.' }
    ] }),
    language: 'en',
    model: 'fixture',
    fixedTempo: 1,
    tts: { synthesize: async () => ({ path: 'natural.wav' }) },
    audio: {
      trim: async () => ({ path: 'trimmed.wav', duration: 2.7 }),
      applyTempo: async (...args: any[]) => {
        measuredDuration = args[4]
        return { path: 'fitted.wav', duration: args[2] }
      }
    }
  })
  assert.equal(measuredDuration, 2.7)
  assert.equal(result.plan.cues[0].actualDuration, 1.5)
})

test('speaking budgets reserve the next-cue gap once and use the EOF guard for the last cue', () => {
  const sources = [
    { id: 'a', start: 1.49, end: 2.9, text: 'First sentence.' },
    { id: 'b', start: 3.41, end: 4, text: 'Last sentence.' }
  ]
  const durations = translationModule.dubbingSpeakingDurations(sources, 5)
  // 3.41 - 0.50 - 1.49; 5.00 - 0.12 - 3.41. No second 0.50s reserve at EOF.
  assert.ok(Math.abs(durations[0] - 1.42) < 1e-9)
  assert.ok(Math.abs(durations[1] - 1.47) < 1e-9)
})

test('the last cue uses its EOF window without unnecessary rephrase or excessive tempo', async () => {
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 1.92, paceMode: 'fixed', cues: [
      { id: 'last', start: 0, end: 1.42, text: 'Check the crab before eating.' }
    ] }), language: 'en', model: 'fixture', fixedTempo: 1,
    tts: { synthesize: async () => ({ path: 'natural.wav' }) },
    audio: { trim: async (path) => ({ path, duration: 2.84 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration }) },
    rephrase: async () => { throw new Error('The measured audio already fits the EOF window') }
  })
  assert.equal(result.metrics.overflowCount, 0)
  assert.equal(result.metrics.rescueAttemptCount, 0)
  assert.equal(result.plan.cues[0].finalSpokenText, 'Check the crab before eating.')
  assert.equal(result.plan.cues[0].rephrased, false)
  assert.ok(Math.abs(result.plan.cues[0].voiceEnd! - 1.8) < 1e-9)
  assert.equal(result.plan.cues[0].tempo, 1.5778)
})

test('measured-first synthesis never rewrites a predictor outlier before TTS', async () => {
  const events: string[] = []
  const plan = planModule.buildDubbingPlan({ videoDuration: 5, cues: [
    { id: 'a', start: 0, end: 1, text: 'A long sentence with the original meaning.' },
    { id: 'b', start: 2, end: 3, text: 'Fine.' }
  ] })
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan, language: 'en', model: 'fixture',
    predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: (text: string) => ({ seconds: text.startsWith('A long') ? 4 : 0.8, uncertaintySeconds: 0, confidence: 1 }), addSample: () => {} },
    tts: { synthesize: async (r) => { events.push(r.text); return { path: r.cueId } } },
    audio: { trim: async (path: string) => ({ path, duration: 0.8 }), applyTempo: async (path: string, _hint: string, duration: number) => ({ path, duration }) }
  })
  assert.deepEqual(events, ['A long sentence with the original meaning.', 'Fine.'])
  assert.equal(result.plan.cues[0].subtitles[0].text, 'A long sentence with the original meaning.')
  assert.equal(result.plan.cues[0].rephrased, false)
  assert.equal(plan.cues[0].finalSpokenText, plan.cues[0].sourceText, 'do not mutate input/cache')
})

test('a fitting measured plan skips batch rephrase and reports zero rescue metrics', async () => {
  let batchCalls = 0
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 4, paceMode: 'fixed', cues: [
      { id: 'fit-a', start: 0, end: 2, text: 'A short line.' },
      { id: 'fit-b', start: 2.5, end: 3.5, text: 'Another line.' }
    ] }),
    language: 'en', model: 'fixture', fixedTempo: 1,
    tts: { synthesize: async (request) => ({ path: request.cueId }) },
    audio: {
      trim: async (path) => ({ path, duration: 0.6 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration })
    },
    rephraseBatch: async () => { batchCalls++; return new Map() }
  } as any)
  assert.equal(batchCalls, 0)
  assert.equal(result.metrics.overflowCount, 0)
  assert.equal(result.metrics.batchCount, 0)
  assert.equal(result.metrics.batchCueCount, 0)
  assert.equal(result.metrics.rescueAttemptCount, 0)
  assert.equal(result.metrics.rescueAcceptedCount, 0)
})

test('measured pass completes before one batch adapter and rescue audio begins', async () => {
  const cueIds = Array.from({ length: 10 }, (_, index) => `overflow-${index}`)
  const trace: string[] = []
  const candidateByCue = new Map(cueIds.map((cueId) => [cueId, `short-${cueId}`]))
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({
      // All ten cues have 1.5s, including the last cue before the 0.12s EOF guard.
      videoDuration: 19.62,
      paceMode: 'fixed',
      cues: cueIds.map((id, index) => ({ id, start: index * 2, end: index * 2 + 1, text: `Original ${id}.` }))
    }),
    language: 'en', model: 'fixture', fixedTempo: 1,
    predictor: {
      profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }),
      addSample: () => {}
    },
    tts: { synthesize: async (request) => {
      trace.push(`tts:${request.text}`)
      return { path: request.text }
    } },
    audio: {
      trim: async (path) => ({ path, duration: path.startsWith('short-') ? 0.7 : 3 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration })
    },
    rephraseBatch: async (requests: readonly { cueId: string }[]) => {
      trace.push(`batch:${requests.length}`)
      return new Map(requests.map((request) => [request.cueId, [candidateByCue.get(request.cueId)!]]))
    }
  } as any)

  const firstBatch = trace.findIndex((entry) => entry.startsWith('batch:'))
  assert.equal(firstBatch, cueIds.length)
  assert.deepEqual(trace.filter((entry) => entry.startsWith('batch:')), ['batch:10'])
  assert.ok(trace.slice(firstBatch + 1).every((entry) => entry.startsWith('tts:short-')))
  assert.equal(result.metrics.overflowCount, cueIds.length)
  assert.equal(result.metrics.batchCount, 2)
  assert.equal(result.metrics.batchCueCount, cueIds.length)
  assert.equal(result.metrics.rescueAcceptedCount, cueIds.length)
  assert.equal(result.plan.cues.every((cue) => cue.finalSpokenText.startsWith('short-')), true)
})

test('predecessor rescue preserves a grouped cue that fits with released lead', async () => {
  const original = planModule.buildDubbingPlan({
    // Preserve the group's 3.0s deadline so it needs the predecessor's released lead.
    videoDuration: 3.12,
    paceMode: 'fixed',
    cues: [
      { id: 'a', start: 0, end: 1.4, text: 'Opening sentence.' },
      { id: 'b1', start: 2, end: 2.3, text: 'source fragment one' },
      { id: 'b2', start: 2.4, end: 2.8, text: 'source fragment two' }
    ]
  })
  const plan = planModule.groupDubbingPlanForSpeech(
    translationModule.applyDubbingTranslations(original, [
      { id: 'a', text: 'Opening sentence.' },
      { id: 'b1', text: 'First translated part.' },
      { id: 'b2', text: 'Second translated part.' }
    ]),
    'en'
  )
  assert.deepEqual(plan.cues.map((cue) => cue.sourceCueIds), [['a'], ['b1', 'b2']])

  const splits: string[] = []
  const spoken: string[] = []
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan,
    language: 'en',
    model: 'fixture',
    fixedTempo: 1,
    localTempoDelta: 0.15,
    maxEarlyStartSeconds: 0.35,
    predictor: {
      profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }),
      addSample: () => {}
    },
    tts: {
      synthesize: async (request) => {
        spoken.push(request.text)
        return { path: request.text }
      }
    },
    audio: {
      trim: async (path) => ({
        path,
        duration: path === 'Opening sentence.'
          ? 3
          : path === 'Short opener.'
            ? 0.5
            : path.includes('First translated part. Second translated part.')
              ? 1.8 * (1.8 / 1.45) // Keep the same lead-in requirement under the new ceiling.
              : 0.7
      }),
      applyTempo: async (path, _hint, duration) => ({ path, duration })
    },
    rephraseBatch: async (requests) => new Map(requests.map((request) => [
      request.cueId,
      request.cueId === 'a' ? ['Short opener.'] : []
    ])),
    onStructuralSplit: (event) => splits.push(event.cueId)
  })

  assert.equal(planModule.validateDubbingPlan(result.plan).ok, true)
  assert.deepEqual(result.plan.cues.flatMap((cue) => cue.sourceCueIds), ['a', 'b1', 'b2'])
  assert.deepEqual(splits, [])
  const group = result.plan.cues.find((cue) => cue.sourceCueIds.includes('b2'))
  assert.ok(group)
  assert.deepEqual(group.sourceCueIds, ['b1', 'b2'])
  assert.ok(Math.abs(group.start - 1.7586206896551724) < 0.0001)
  assert.ok(Math.abs((group.voiceEnd || 0) - 3) < 0.0001)
  assert.ok(group.tempo <= 1.8)
  assert.equal(spoken.filter((text) => text === group.finalSpokenText).length, 1)
})

test('finalization reflows a fitting predecessor when a rescued cue needs the protected gap', async () => {
  const plan = planModule.buildDubbingPlan({
    videoDuration: 101,
    paceMode: 'fixed',
    cues: [
      { id: 'cue-59-96410', start: 96.41, end: 97.95, text: 'Previous line.' },
      { id: 'cue-60-98270', start: 98.27, end: 99.29, text: 'This is the red-spotted crab.' },
      { id: 'cue-61-99290', start: 99.29, end: 100, text: 'Next line.' }
    ]
  })
  plan.cues[1].translatedText = 'This is the red-spotted crab that everyone knows.'
  plan.cues[1].finalSpokenText = plan.cues[1].translatedText
  const spoken: string[] = []
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan,
    language: 'en',
    model: 'fixture',
    fixedTempo: 1,
    localTempoDelta: 0.15,
    maxEarlyStartSeconds: 0.35,
    predictor: {
      profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }),
      addSample: () => {}
    },
    tts: {
      synthesize: async (request) => {
        spoken.push(request.text)
        return { path: request.text }
      }
    },
    audio: {
      trim: async (path) => ({
        path,
        duration: path === 'Previous line.'
          ? 1.519
          : path === 'This is the red-spotted crab that everyone knows.' ? 2.048
            : path === 'This is the red-spotted crab.' ? 1.455 : 0.5
      }),
      applyTempo: async (path, _hint, duration) => {
        return { path: `${path}-tempo`, duration }
      }
    },
    rephrase: async () => ['This is the red-spotted crab.']
  })

  const previous = result.plan.cues[0]
  const rescued = result.plan.cues[1]
  assert.ok(previous.tempo > 1.35, 'the predecessor is sped up only as much as needed to release the gap')
  assert.ok(previous.tempo <= 1.8)
  assert.ok(rescued.tempo <= 1.8)
  assert.ok(rescued.start >= previous.voiceEnd! + 0.5 - 0.005)
  assert.ok(rescued.voiceEnd! <= rescued.hardEnd + 0.005)
  assert.equal(rescued.finalSpokenText, 'This is the red-spotted crab.')
  assert.deepEqual(spoken, ['Previous line.', 'This is the red-spotted crab that everyone knows.', 'Next line.', 'This is the red-spotted crab.'])
})

for (const [id, natural, available] of [['cue-0-1490', 2.8, 1.42], ['cue-0-2320', 2.727, 1.24]] as const) {
  test(`${id} rescues measured overflow once and rejects a still-too-long replacement`, async () => {
    for (const replacementFits of [true, false]) {
      let rephrases = 0
      let calls = 0
      const plan = planModule.buildDubbingPlan({ videoDuration: available + 0.12, cues: [
        { id, start: 0, end: available, text: 'Keep the full meaning.' }
      ] })
      const run = synthesisModule.synthesizeDubbingPlan({
        plan, language: 'en', model: 'fixture', localTempoDelta: 0.15,
        predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
          estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }), addSample: () => {} },
        tts: { synthesize: async () => { calls++; return { path: `audio-${calls}` } } },
        audio: { trim: async (path) => ({ path, duration: calls > 1 && replacementFits ? available : natural }),
          applyTempo: async (path, _hint, duration) => ({ path, duration }) },
        rephrase: async (request) => {
          rephrases++
          assert.ok(request.targetDuration <= available * 1.1 + 0.001)
          return ['Full meaning.']
        }
      })
      if (replacementFits) {
        const result = await run
        assert.ok(result.plan.cues[0].tempo <= 1.8)
        assert.equal(result.plan.cues[0].subtitles[0].text, 'Full meaning.')
      } else {
        await assert.rejects(run, /vượt trần 1\.80x/u)
      }
      assert.equal(rephrases, 1)
      assert.equal(calls, 2)
    }
  })
}

test('cancellation before measured synthesis never starts TTS', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancel fixture'))
  let calls = 0
  await assert.rejects(synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 2, cues: [{ id: 'a', start: 0, end: 1, text: 'A very long sentence that must be shortened before speaking.' }] }),
    language: 'en', model: 'fixture', signal: controller.signal,
    tts: { synthesize: async () => { calls++; return { path: 'unused' } } },
    audio: { trim: async (path) => ({ path, duration: 1 }), applyTempo: async (path, _hint, duration) => ({ path, duration }) }
  }), /Đã hủy tác vụ/u)
  assert.equal(calls, 0)
})

for (const [id, natural, firstRescue, available, fitted] of [
  ['cue-0-2320', 3.0, 2.4, 1.24, 1.7],
  ['cue-0-1490', 3.1, 2.8, 1.42, 1.95],
  ['cue-0-0', 3.2, 2.4, 1.26, 1.75]
] as const) {
  test(`${id} tries another distinct candidate when the first shorter audio still overflows`, async () => {
    const spoken: string[] = []
    const outcomes: string[] = []
    let llmCalls = 0
    const result = await synthesisModule.synthesizeDubbingPlan({
      plan: planModule.buildDubbingPlan({ videoDuration: available + 0.12, cues: [
        { id, start: 0, end: available, text: 'Carefully inspect the food before eating it.' }
      ] }), language: 'en', model: 'fixture',
      predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
        estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }), addSample: () => {} },
      rephrase: async (request) => {
        llmCalls++
        assert.equal((request as any).measuredDuration, natural)
        assert.ok(Math.abs((request as any).maxDuration - available * 1.8) < 0.001)
        return ['Inspect food before eating.', 'Check food before eating.', 'Check food before eating.']
      },
      tts: { synthesize: async (request) => { spoken.push(request.text); return { path: request.text } } },
      audio: { trim: async (path) => ({ path, duration: spoken.length === 1 ? natural : spoken.length === 2 ? firstRescue : fitted }),
        applyTempo: async (path, _hint, duration) => ({ path, duration }) },
      onRephrase: (event) => { if (event.phase === 'rescue') outcomes.push(event.outcome) }
    })
    assert.equal(llmCalls, 1)
    assert.equal(spoken.length, 3)
    assert.equal(result.plan.cues[0].finalSpokenText, 'Check food before eating.')
    assert.ok(result.plan.cues[0].tempo <= 1.8)
    assert.deepEqual(outcomes, ['improved-overflow', 'accepted'])
    assert.equal(result.metrics.rephraseCount, 1)
  })
}

test('measured audio inside the hard ceiling is not rephrased merely to lower local pace', async () => {
  const samples: number[] = []
  let calls = 0
  let rephraseCalls = 0
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 2.5, paceMode: 'fixed', cues: [
      { id: 'cue-0-1490', start: 0, end: 2, text: 'Check the crab before eating.' }
    ] }), language: 'en', model: 'fixture', fixedTempo: 1,
    predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }), addSample: (_text, seconds) => { samples.push(seconds) } },
    tts: { synthesize: async () => ({ path: ++calls === 1 ? 'original' : 'unexpected-rephrase' }) },
    audio: { trim: async (path) => ({ path, duration: path === 'original' ? 2.311 : 0.2 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration }) },
    rephrase: async () => {
      rephraseCalls++
      return ['Inspect the crab before eating.']
    }
  })
  assert.equal(calls, 1)
  assert.equal(rephraseCalls, 0)
  assert.equal(result.clips[0].path, 'original')
  assert.equal(result.plan.cues[0].finalSpokenText, 'Check the crab before eating.')
  assert.equal(result.plan.cues[0].naturalDuration, 2.311)
  assert.equal(result.plan.cues[0].rephrased, false)
  assert.deepEqual(samples, [2.311])
})

test('embedded candidate labels are rejected even when a rephrase adapter bypasses the parser', async () => {
  let calls = 0
  await assert.rejects(synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 1.54, paceMode: 'fixed', cues: [
      { id: 'cue-0-1490', start: 0, end: 1.42, text: 'Check the crab before eating.' }
    ] }), language: 'en', model: 'fixture', fixedTempo: 1,
    predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }), addSample: () => {} },
    tts: { synthesize: async () => { calls++; return { path: 'original' } } },
    audio: { trim: async (path) => ({ path, duration: 2.84 }), applyTempo: async (path, _hint, duration) => ({ path, duration }) },
    rephrase: async () => ['Check the crab. [cue-0-1490:2] Inspect it.']
  }), /cần nhịp 2\.000x, vượt trần 1\.80x/u)
  assert.equal(calls, 1)
})

test('a resumed plan with leaked labels is stopped before TTS or cache access', async () => {
  let calls = 0
  const plan = planModule.buildDubbingPlan({ videoDuration: 3, cues: [
    { id: 'cue-0-1490', start: 0, end: 2, text: 'Check the crab.' }
  ] })
  plan.cues[0].finalSpokenText = 'Check the crab. [cue-0-1490:2] Inspect it.'
  await assert.rejects(synthesisModule.synthesizeDubbingPlan({
    plan, language: 'en', model: 'fixture',
    tts: { synthesize: async () => { calls++; return { path: 'unused' } } },
    audio: { trim: async (path) => ({ path, duration: 1 }), applyTempo: async (path, _hint, duration) => ({ path, duration }) }
  }), /chứa nhãn rephrase.*trước TTS/u)
  assert.equal(calls, 0)
})

test('a worse rescue preserves the original overflow diagnostic and never applies excessive tempo', async () => {
  let calls = 0
  await assert.rejects(synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 1.54, cues: [
      { id: 'cue-0-1490', start: 0, end: 1.42, text: 'Check the crab before eating.' }
    ] }), language: 'en', model: 'fixture',
    predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }), addSample: () => {} },
    tts: { synthesize: async () => ({ path: ++calls === 1 ? 'original' : 'bad-rescue' }) },
    audio: { trim: async (path) => ({ path, duration: path === 'original' ? 2.84 : 14.86 }),
      applyTempo: async () => { throw new Error('DSP must not run beyond the hard ceiling') } },
    rephrase: async () => ['Inspect the crab before eating.']
  }), /cần nhịp 2\.000x, vượt trần 1\.80x/u)
  assert.equal(calls, 2)
})

test('rescue never synthesizes more than three distinct alternatives or recalibrates from worse clips', async () => {
  const spoken: string[] = []
  const samples: number[] = []
  let rephrases = 0
  await assert.rejects(synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 1.36, cues: [{ id: 'a', start: 0, end: 1.24, text: 'Original text.' }] }),
    language: 'en', model: 'fixture',
    predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
      estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }), addSample: (_text, seconds) => { samples.push(seconds) } },
    rephrase: async () => { rephrases++; return ['One choice.', 'One choice.', 'Two choices.', 'Three choices.', 'Fourth option.'] },
    tts: { synthesize: async (request) => { spoken.push(request.text); return { path: request.text } } },
    audio: { trim: async (path) => ({ path, duration: spoken.length === 1 ? 2.738 : 10 }), applyTempo: async () => { throw new Error('No DSP for overflowing audio') } }
  }), /cần nhịp 2\.208x, vượt trần 1\.80x/u)
  assert.deepEqual(spoken, ['Original text.', 'One choice.', 'Two choices.', 'Three choices.'])
  assert.equal(rephrases, 1)
  assert.deepEqual(samples, [2.738])
})

test('measured DSP output cannot silently exceed the hard tempo ceiling', async () => {
  await assert.rejects(synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 3, cues: [{ id: 'a', start: 0, end: 2, text: 'Full meaning.' }] }),
    language: 'en', model: 'fixture', fixedTempo: 1.1,
    predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 }, estimate: () => ({ seconds: 2, confidence: 1, uncertaintySeconds: 0 }), addSample: () => {} },
    tts: { synthesize: async () => ({ path: 'raw' }) },
    audio: { trim: async (path: string) => ({ path, duration: 2.6 }),
      applyTempo: async (path: string) => ({ path, duration: 1 }) }
  }), /tempo đo được.*vượt trần/u)
})

type PlanBuilder = (input: {
  version: number
  videoDuration: number
  paceMode: 'source-adaptive' | 'fixed'
  cues: Array<{ id: string; start: number; end: number; text: string }>
}) => {
  cues: Array<{ sourceStart: number; preferredEnd: number; hardEnd: number }>
}

test('builds source-anchored plan windows without cumulative start drift', () => {
  const buildDubbingPlan = (planModule as typeof planModule & { buildDubbingPlan?: PlanBuilder }).buildDubbingPlan
  assert.equal(typeof buildDubbingPlan, 'function', 'DubbingPlan builder must be implemented')

  const plan = buildDubbingPlan!({
    version: 1,
    videoDuration: 20,
    paceMode: 'source-adaptive',
    cues: [
      { id: 's1', start: 10, end: 12, text: 'one' },
      { id: 's2', start: 13, end: 15, text: 'two' },
      { id: 's3', start: 16, end: 18, text: 'three' }
    ]
  })

  assert.deepEqual(plan.cues.map((cue) => cue.sourceStart), [10, 13, 16])
  assert.deepEqual(plan.cues.map((cue) => cue.preferredEnd), [12, 15, 18])
  assert.deepEqual(plan.cues.map((cue) => cue.hardEnd), [12.5, 15.5, 19.88])
})

type TimingPlanBuilder = (input: {
  cues: Array<{ id: string; start: number; end: number; text: string }>
  naturalDurations: number[]
  videoDuration: number
  paceMode: 'source-adaptive' | 'fixed'
  globalTempo: number
}) => {
  cues: Array<{ cueId: string; start: number; voiceEnd: number; hardEnd: number; tempo: number }>
}

test('keeps every start anchored while allowing a cue to use its permitted gap', () => {
  const planDubbingAudioWindows = (policyModule as typeof policyModule & { planDubbingAudioWindows?: TimingPlanBuilder }).planDubbingAudioWindows
  assert.equal(typeof planDubbingAudioWindows, 'function', 'plan-driven timing policy must be implemented')

  const timing = planDubbingAudioWindows!({
    cues: [
      { id: 's1', start: 10, end: 12, text: 'one' },
      { id: 's2', start: 14, end: 15, text: 'two' },
      { id: 's3', start: 16, end: 18, text: 'three' }
    ],
    naturalDurations: [3.2, 0.8, 1.0],
    videoDuration: 20,
    paceMode: 'source-adaptive',
    globalTempo: 1
  })

  assert.deepEqual(timing.cues.map((cue) => cue.start), [10, 14, 16])
  assert.equal(timing.cues[0].hardEnd, 13.5)
  assert.ok(timing.cues[0].voiceEnd <= 13.5)
  assert.equal(timing.cues[1].start, 14)
})

test('rejects a cue that needs more than the permitted local pace adjustment', () => {
  const planDubbingAudioWindows = (policyModule as typeof policyModule & { planDubbingAudioWindows?: TimingPlanBuilder }).planDubbingAudioWindows
  assert.equal(typeof planDubbingAudioWindows, 'function', 'plan-driven timing policy must be implemented')
  assert.throws(
    () => planDubbingAudioWindows!({
      cues: [{ id: 'too-long', start: 10, end: 11, text: 'long' }],
      naturalDurations: [2.7],
      videoDuration: 12,
      paceMode: 'source-adaptive',
      globalTempo: 1
    }),
    /too-long/u
  )
})

test('fixed dubbing pace never exceeds the hard tempo ceiling', () => {
  const selectFixedPace = (policyModule as typeof policyModule & {
    selectFixedPace?: (speed: number) => number
  }).selectFixedPace
  assert.equal(typeof selectFixedPace, 'function')
  assert.equal(selectFixedPace!(2), 1.8)
})

test('validates source identity, hard-end, overlap, and final subtitle text', () => {
  const buildDubbingPlan = (planModule as typeof planModule & {
    buildDubbingPlan?: PlanBuilder
    validateDubbingPlan?: (plan: unknown) => { ok: boolean; violations: string[] }
  }).buildDubbingPlan
  const validateDubbingPlan = (planModule as typeof planModule & {
    validateDubbingPlan?: (plan: unknown) => { ok: boolean; violations: string[] }
  }).validateDubbingPlan
  assert.equal(typeof buildDubbingPlan, 'function')
  assert.equal(typeof validateDubbingPlan, 'function', 'DubbingPlan validation must be implemented')

  const plan = buildDubbingPlan!({
    version: 1,
    videoDuration: 20,
    paceMode: 'source-adaptive',
    cues: [
      { id: 's1', start: 10, end: 12, text: 'one' },
      { id: 's2', start: 13, end: 15, text: 'two' }
    ]
  }) as any
  plan.cues[0].voiceEnd = 13.6
  plan.cues[0].actualDuration = 3.6
  plan.cues[0].subtitles = [{ id: 's1-subtitle', sourceIndex: 1, start: 10, end: 13.6, text: 'wrong' }]
  plan.cues[1].start = 13.5

  const result = validateDubbingPlan!(plan)
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((message) => message.includes('s1')))
  assert.ok(result.violations.some((message) => message.includes('s2')))
})

test('fingerprints the complete effective TTS profile and remains order-stable', () => {
  const durationProfileKey = (durationModule as typeof durationModule & {
    durationProfileKey?: (input: unknown) => string
  }).durationProfileKey
  assert.equal(typeof durationProfileKey, 'function', 'duration profile fingerprint must be implemented')
  const base = {
    endpoint: 'http://127.0.0.1:8000',
    model: 'voice-model',
    voice: 'voice-a',
    language: 'vi',
    options: { temperature: 0.2, style: 'neutral' },
    referenceAudio: { path: 'reference.wav', size: 123, mtimeMs: 456 }
  }
  const reordered = {
    ...base,
    options: { style: 'neutral', temperature: 0.2 }
  }
  assert.equal(durationProfileKey!(base), durationProfileKey!(reordered))
  assert.notEqual(durationProfileKey!(base), durationProfileKey!({ ...base, voice: 'voice-b' }))
  assert.notEqual(durationProfileKey!(base), durationProfileKey!({ ...base, options: { temperature: 0.3, style: 'neutral' } }))
})

test('selects at most three real job cues with useful length diversity for bootstrap', () => {
  const selectBootstrapCues = (durationModule as typeof durationModule & {
    selectBootstrapCues?: (cues: Array<{ id: string; text: string }>, max?: number) => Array<{ id: string; text: string }>
  }).selectBootstrapCues
  assert.equal(typeof selectBootstrapCues, 'function', 'bootstrap cue selection must be implemented')
  const cues = [
    { id: 'a', text: 'short' },
    { id: 'b', text: 'medium phrase with useful context' },
    { id: 'c', text: 'a much longer sentence that gives the predictor a different real length' },
    { id: 'd', text: 'another sentence which should not create a synthetic sample' }
  ]
  const selected = selectBootstrapCues!(cues)
  assert.ok(selected.length <= 3)
  assert.ok(selected.every((cue) => cues.includes(cue)))
  assert.equal(new Set(selected.map((cue) => cue.id)).size, selected.length)
})

test('does not reuse TTS cache across effective voice configuration changes', () => {
  const buildTtsCacheKey = (cacheModule as typeof cacheModule & {
    buildTtsCacheKey?: (input: unknown) => string
  }).buildTtsCacheKey
  assert.equal(typeof buildTtsCacheKey, 'function', 'TTS cache key builder must be implemented')
  const base = {
    schemaVersion: 2,
    endpoint: 'http://127.0.0.1:8000',
    finalSpokenText: 'Nội dung cuối cùng',
    language: 'vi',
    model: 'model-a',
    voice: 'voice-a',
    serverSpeed: 1,
    options: { style: 'neutral', temperature: 0.2 },
    referenceAudio: { path: 'ref.wav', size: 10, mtimeMs: 20 },
    referenceTranscript: 'mẫu'
  }
  assert.equal(buildTtsCacheKey!(base), buildTtsCacheKey!({ ...base, options: { temperature: 0.2, style: 'neutral' } }))
  for (const change of [
    { model: 'model-b' },
    { voice: 'voice-b' },
    { language: 'en' },
    { options: { style: 'warm', temperature: 0.2 } },
    { referenceAudio: { path: 'ref.wav', size: 11, mtimeMs: 20 } },
    { finalSpokenText: 'Nội dung đã rephrase' }
  ]) {
    assert.notEqual(buildTtsCacheKey!(base), buildTtsCacheKey!({ ...base, ...change }))
  }
})

test('selects a language-compatible TTS capability when persisted model is stale', () => {
  const selectCompatible = (policyModule as typeof policyModule & {
    selectCompatibleAutoShortTtsModel?: (models: Array<any>, requestedId: string | undefined, language: string) => any
  }).selectCompatibleAutoShortTtsModel!
  assert.equal(typeof selectCompatible, 'function')
  const selected = selectCompatible([
    { id: 'tts-multilingual', available: true, languages: ['en', 'zh'] },
    { id: 'tts-vietnamese', available: true, languages: ['vi'] }
  ], 'tts-multilingual', 'vi')
  assert.equal(selected?.id, 'tts-vietnamese')
})

test('does not reject every rephrase when the predictor overestimates all candidates', () => {
  const chooseDubbingRephrase = (translationModule as typeof translationModule & {
    chooseDubbingRephrase?: (candidates: Array<{ text: string; predictedSeconds: number }>, targetDuration: number) => { text: string; predictedSeconds: number } | null
  }).chooseDubbingRephrase!
  assert.equal(typeof chooseDubbingRephrase, 'function')
  const selected = chooseDubbingRephrase([
    { text: 'Câu ngắn đã kiểm duyệt', predictedSeconds: 2.4 },
    { text: 'Câu dài hơn đã kiểm duyệt', predictedSeconds: 2.8 }
  ], 1.2)
  assert.equal(selected?.text, 'Câu ngắn đã kiểm duyệt')
})

test('updates predictor error from measured reusable clips with non-negative ridge weights', () => {
  const createDurationPredictor = (durationModule as typeof durationModule & {
    createDurationPredictor?: () => {
      profile: { samples: number; weights: readonly number[]; residualP90: number }
      addSample: (text: string, seconds: number, locale?: string) => void
      estimate: (text: string, options?: { locale?: string }) => { seconds: number; uncertaintySeconds: number }
    }
  }).createDurationPredictor
  assert.equal(typeof createDurationPredictor, 'function', 'duration predictor must be implemented')
  const predictor = createDurationPredictor!()
  predictor.addSample('Một câu ngắn.', 0.8, 'vi')
  predictor.addSample('Một câu dài hơn có số 2026 và nhiều dấu ngắt, rõ ràng.', 2.4, 'vi')
  predictor.addSample('Câu thứ ba có chữ viết tắt như U.S.A. và thời lượng khác.', 1.7, 'vi')
  assert.equal(predictor.profile.samples, 3)
  assert.ok(predictor.profile.weights.every((weight) => Number.isFinite(weight) && weight >= 0))
  assert.ok(Number.isFinite(predictor.profile.residualP90) && predictor.profile.residualP90 >= 0)
  const estimate = predictor.estimate('Một câu mới có độ dài vừa phải.', { locale: 'vi' })
  assert.ok(estimate.seconds > 0)
  assert.ok(estimate.uncertaintySeconds > 0)
})

test('translation request preserves source ids and applies final spoken text without moving anchors', () => {
  const buildDubbingTranslationRequest = (translationModule as typeof translationModule & {
    buildDubbingTranslationRequest?: (plan: unknown, contextRadius?: number) => { cues: Array<{ id: string; start: number }>; contextBefore: unknown[]; contextAfter: unknown[] }
  }).buildDubbingTranslationRequest
  const applyDubbingTranslations = (translationModule as typeof translationModule & {
    applyDubbingTranslations?: (plan: any, items: Array<{ id: string; text: string }>) => any
  }).applyDubbingTranslations
  assert.equal(typeof buildDubbingTranslationRequest, 'function', 'dubbing translation request must be implemented')
  assert.equal(typeof applyDubbingTranslations, 'function', 'dubbing translation application must be implemented')
  const buildDubbingPlan = (planModule as typeof planModule & { buildDubbingPlan?: PlanBuilder }).buildDubbingPlan!
  const plan = buildDubbingPlan({
    version: 1,
    videoDuration: 20,
    paceMode: 'source-adaptive',
    cues: [
      { id: 'source-a', start: 10, end: 12, text: 'First source' },
      { id: 'source-b', start: 14, end: 15, text: 'Second source' }
    ]
  })
  const request = buildDubbingTranslationRequest!(plan, 1)
  assert.deepEqual(request.cues.map((cue) => [cue.id, cue.start]), [['source-a', 10], ['source-b', 14]])
  assert.deepEqual(request.contextBefore, [])
  assert.deepEqual(request.cues[0].contextAfter, ['Second source'])
  assert.deepEqual(request.cues[1].contextBefore, ['First source'])
  const translated = applyDubbingTranslations!(plan, [
    { id: 'source-a', text: 'Bản dịch đầu' },
    { id: 'source-b', text: 'Bản dịch sau' }
  ])
  assert.deepEqual(translated.cues.map((cue: any) => cue.id), ['source-a', 'source-b'])
  assert.deepEqual(translated.cues.map((cue: any) => cue.start), [10, 14])
  assert.deepEqual(translated.cues.map((cue: any) => cue.finalSpokenText), ['Bản dịch đầu', 'Bản dịch sau'])
})

test('subtitle builder uses final spoken text and accepted audio window at cue quality', () => {
  const buildDubbingSubtitle = (subtitleModule as typeof subtitleModule & {
    buildDubbingSubtitle?: (input: unknown) => { id: string; start: number; end: number; text: string; timingQuality: string }
  }).buildDubbingSubtitle
  assert.equal(typeof buildDubbingSubtitle, 'function', 'dubbing subtitle builder must be implemented')
  const subtitle = buildDubbingSubtitle!({
    cueId: 'source-a',
    sourceIndex: 0,
    start: 10,
    end: 13.2,
    finalSpokenText: 'Lời nói cuối cùng'
  })
  assert.deepEqual(subtitle, {
    id: 'source-a-subtitle',
    sourceIndex: 0,
    start: 10,
    end: 13.2,
    text: 'Lời nói cuối cùng',
    timingQuality: 'cue'
  })
})

test('synthesis keeps source starts, measures final audio, and never asks Whisper for TTS subtitles', async () => {
  const synthesizeDubbingPlan = (synthesisModule as typeof synthesisModule & {
    synthesizeDubbingPlan?: (input: any) => Promise<any>
  }).synthesizeDubbingPlan
  assert.equal(typeof synthesizeDubbingPlan, 'function', 'dubbing synthesis pipeline must be implemented')
  const buildDubbingPlan = (planModule as typeof planModule & { buildDubbingPlan?: PlanBuilder }).buildDubbingPlan!
  const plan = buildDubbingPlan({
    version: 1,
    videoDuration: 20,
    paceMode: 'source-adaptive',
    cues: [
      { id: 's1', start: 10, end: 12, text: 'source one' },
      { id: 's2', start: 14, end: 15, text: 'source two' }
    ]
  })
  const durations: Record<string, number> = { s1: 3.2, s2: 0.8 }
  const calls: Array<{ id: string; text: string; speed: number }> = []
  let whisperCalls = 0
  const result = await synthesizeDubbingPlan!({
    plan,
    language: 'vi',
    model: 'model-a',
    voice: 'voice-a',
    tts: {
      synthesize: async (request: any) => {
        calls.push({ id: request.cueId, text: request.text, speed: request.speed })
        return { path: `${request.cueId}-${calls.length}.wav` }
      }
    },
    audio: {
      trim: async (path: string) => ({ path: `${path}.trim`, duration: path.startsWith('s1') ? durations.s1 : durations.s2 }),
      applyTempo: async (path: string, _outputHint: string, targetDuration: number) => ({ path: `${path}.tempo`, duration: targetDuration })
    },
    whisper: { transcribe: async () => { whisperCalls++ } }
  })
  assert.equal(whisperCalls, 0)
  assert.ok(calls.every((call) => call.speed === 1), 'TTS must synthesize at standard speed')
  assert.deepEqual(result.plan.cues.map((cue: any) => cue.sourceStart), [10, 14])
  assert.deepEqual(result.plan.cues.map((cue: any) => cue.subtitles[0].text), ['source one', 'source two'])
  assert.ok(result.plan.cues.every((cue: any) => cue.voiceEnd <= cue.hardEnd + 0.005))
})

test('measured short overflow borrows only verified leading silence before asking to rephrase', async () => {
  const synthesizeDubbingPlan = (synthesisModule as typeof synthesisModule & {
    synthesizeDubbingPlan?: (input: any) => Promise<any>
  }).synthesizeDubbingPlan!
  const plan = planModule.buildDubbingPlan({
    videoDuration: 6,
    paceMode: 'fixed',
    cues: [
      { id: 'cue-0-1490', start: 1.49, end: 3.41, text: 'Take a close look before eating this crab.' },
      { id: 'cue-1-3410', start: 3.41, end: 5.23, text: 'Can this crab be eaten?' }
    ]
  })
  let rephraseCalls = 0
  const result = await synthesizeDubbingPlan({
    plan,
    language: 'en',
    model: 'fixture',
    fixedTempo: 1,
    maxEarlyStartSeconds: 0.35,
    tts: { synthesize: async (request: any) => ({ path: `${request.cueId}.wav` }) },
    audio: {
      trim: async (path: string) => ({ path: `${path}.trim`, duration: path.startsWith('cue-0-1490') ? 2.253 * (1.8 / 1.45) : 0.8 }),
      applyTempo: async (path: string, _hint: string, targetDuration: number) => ({ path: `${path}.tempo`, duration: targetDuration })
    },
    rephrase: async () => {
      rephraseCalls++
      return ['must not be requested']
    }
  })

  const cue = result.plan.cues[0]
  assert.equal(rephraseCalls, 0)
  assert.equal(cue.sourceStart, 1.49)
  assert.ok(cue.start < cue.sourceStart)
  assert.ok(cue.sourceStart - cue.start <= 0.35)
  assert.equal(cue.tempo, 1.8)
  assert.ok(Math.abs(cue.voiceEnd - 2.91) < 0.01)
  assert.equal(planModule.validateDubbingPlan(result.plan).ok, true)
})

test('synthesis performs at most one rephrase and updates both plan text and subtitle text', async () => {
  const synthesizeDubbingPlan = (synthesisModule as typeof synthesisModule & {
    synthesizeDubbingPlan?: (input: any) => Promise<any>
  }).synthesizeDubbingPlan!
  const buildDubbingPlan = (planModule as typeof planModule & { buildDubbingPlan?: PlanBuilder }).buildDubbingPlan!
  const plan = buildDubbingPlan({
    version: 1,
    videoDuration: 11.62,
    paceMode: 'source-adaptive',
    cues: [{ id: 'long', start: 10, end: 11, text: 'long source' }]
  })
  let ttsCalls = 0
  const predictor = {
    profile: { version: 2 as const, samples: 0, weights: [0, 0, 0, 0, 0, 0] as [number, number, number, number, number, number], residualP90: 0.5 },
    addSample: () => {},
    estimate: (text: string) => ({ seconds: text === 'short final' ? 0.5 : 2.5, uncertaintySeconds: 0.5, confidence: 0.1 })
  }
  const result = await synthesizeDubbingPlan({
    plan,
    language: 'vi',
    model: 'model-a',
    voice: 'voice-a',
    predictor,
    tts: {
      synthesize: async (request: any) => {
        ttsCalls++
        return { path: `${request.text === 'short final' ? 'short' : 'long'}-${ttsCalls}.wav` }
      }
    },
    audio: {
      trim: async (path: string) => ({ path: `${path}.trim`, duration: path.startsWith('long') ? 3 : 0.9 }),
      applyTempo: async (path: string, _outputHint: string, targetDuration: number) => ({ path: `${path}.tempo`, duration: targetDuration })
    },
    rephrase: async () => ['short final']
  })
  assert.equal(ttsCalls, 2)
  assert.equal(result.metrics.rephraseCount, 1)
  assert.equal(result.plan.cues[0].finalSpokenText, 'short final')
  assert.equal(result.plan.cues[0].subtitles[0].text, 'short final')
})

test('long single cue rejects when fitting would exceed the hard tempo ceiling', async () => {
  const plan = planModule.buildDubbingPlan({ videoDuration: 4, paceMode: 'fixed', cues: [
    { id: 'long', start: 0, end: 1, text: 'Keep all the original words.' },
    { id: 'short', start: 2, end: 3, text: 'Next sentence.' }
  ] })
  let applyTempoCalls = 0
  await assert.rejects(synthesisModule.synthesizeDubbingPlan({
    plan, language: 'en', model: 'fixture', fixedTempo: 1,
    tts: { synthesize: async (request) => ({ path: `${request.cueId}.wav` }) },
    audio: {
      trim: async (path) => ({ path: `${path}.trim`, duration: path.startsWith('long') ? 5 : 0.8 }),
      applyTempo: async (path, _hint, target) => {
        applyTempoCalls++
        return { path: `${path}.tempo`, duration: target }
      }
    }
  }), /vượt giới hạn|vượt thời lượng|không cắt lời/u)
  assert.equal(applyTempoCalls, 0, 'an impossible single cue must fail before tempo processing')
})

test('measured tempo overshoot retries original audio once and rejects persistent overlap', async () => {
  const plan = planModule.buildDubbingPlan({ videoDuration: 2, paceMode: 'fixed', cues: [
    { id: 'long', start: 0, end: 1, text: 'All original words.' }
  ] })
  const paths: string[] = []
  await assert.rejects(synthesisModule.synthesizeDubbingPlan({
    plan, language: 'en', model: 'fixture',
    tts: { synthesize: async () => ({ path: 'original.wav' }) },
    audio: {
      trim: async () => ({ path: 'trimmed.wav', duration: 5 }),
      applyTempo: async (path) => { paths.push(path); return { path: 'bad.wav', duration: 3 } }
    }
  }), /vượt (?:trần|thời lượng)/u)
  assert.deepEqual(paths, [], 'an impossible single cue must be rejected before DSP')
})

test('DSP duration undershoot is corrected from the original WAV without exceeding measured tempo', async () => {
  let calls = 0
  const result = await synthesisModule.synthesizeDubbingPlan({
    plan: planModule.buildDubbingPlan({ videoDuration: 1.5, paceMode: 'fixed', cues: [
      { id: 'rounding', start: 0, end: 1, text: 'Full meaning.' }
    ] }), language: 'en', model: 'fixture', fixedTempo: 1.8,
    tts: { synthesize: async () => ({ path: 'original' }) },
    audio: { trim: async () => ({ path: 'trimmed', duration: 1.8 }),
      applyTempo: async (path, _hint, target) => {
        assert.equal(path, 'trimmed')
        calls++
        return { path: `fitted-${calls}`, duration: target - 0.01 }
      } }
  })
  assert.ok(calls > 1 && calls <= 4)
  assert.ok(result.plan.cues[0].tempo <= 1.8)
  assert.ok(result.plan.cues[0].voiceEnd! <= 1.005)
})
