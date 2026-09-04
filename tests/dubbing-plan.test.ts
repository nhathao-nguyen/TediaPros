import test from 'node:test'
import assert from 'node:assert/strict'
import * as planModule from '../src/main/dubbing/plan'
import * as policyModule from '../src/main/autoShortPolicy'
import * as durationModule from '../src/main/dubbingDuration'
import * as cacheModule from '../src/main/dubbing/cache'
import * as translationModule from '../src/main/dubbing/translation'
import * as subtitleModule from '../src/main/dubbing/subtitles'
import * as synthesisModule from '../src/main/dubbing/synthesis'

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

test('synthesis performs at most one rephrase and updates both plan text and subtitle text', async () => {
  const synthesizeDubbingPlan = (synthesisModule as typeof synthesisModule & {
    synthesizeDubbingPlan?: (input: any) => Promise<any>
  }).synthesizeDubbingPlan!
  const buildDubbingPlan = (planModule as typeof planModule & { buildDubbingPlan?: PlanBuilder }).buildDubbingPlan!
  const plan = buildDubbingPlan({
    version: 1,
    videoDuration: 12,
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
      trim: async (path: string) => ({ path: `${path}.trim`, duration: path.startsWith('long') ? 2.5 : 0.9 }),
      applyTempo: async (path: string, _outputHint: string, targetDuration: number) => ({ path: `${path}.tempo`, duration: targetDuration })
    },
    rephrase: async () => ['short final']
  })
  assert.equal(ttsCalls, 2)
  assert.equal(result.metrics.rephraseCount, 1)
  assert.equal(result.plan.cues[0].finalSpokenText, 'short final')
  assert.equal(result.plan.cues[0].subtitles[0].text, 'short final')
})
