import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { synthesizeDubbingPlan } from '../src/main/dubbing/synthesis'
import { buildDubbingPlan } from '../src/main/dubbing/plan'
import { applyDubbingTranslations } from '../src/main/dubbing/translation'
import { generateVoiceClone, isRetryableVoiceCloneGenerationError } from '../src/main/tts'

test('voice clone refreshes only the explicit Chatterbox generation failure once', async () => {
  assert.equal(isRetryableVoiceCloneGenerationError('chatterbox_generation_failed: Chatterbox generation failed'), true)
  assert.equal(isRetryableVoiceCloneGenerationError('HTTP 403 Forbidden'), false)

  let requests = 0
  const wav = Buffer.from('RIFF0000WAVEfmt ')
  const server = createServer((request, response) => {
    request.resume()
    requests++
    if (requests === 1) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'chatterbox_generation_failed', message: 'Chatterbox generation failed' } }))
      return
    }
    response.writeHead(200, { 'content-type': 'audio/wav' })
    response.end(wav)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const scratch = await mkdtemp(join(tmpdir(), 'tedia-chatterbox-recovery-'))
  const outputPath = join(scratch, 'voice.wav')
  try {
    const result = await generateVoiceClone({
      serverUrl: `http://127.0.0.1:${address.port}`,
      text: 'A complete sentence.',
      language: 'en',
      model: 'tts-multilingual',
      referenceAudioPath: 'reference.wav',
      referenceAudioBuffer: Buffer.from('reference-audio')
    }, undefined, outputPath)
    assert.equal(result.ok, true)
    assert.equal(requests, 2)
    assert.deepEqual(result.requestSpans?.map(span => [span.status, span.retryIndex, span.retryReason]), [
      [500, 0, 'chatterbox_generation_failed'],
      [200, 1, 'chatterbox_generation_failed']
    ])
    assert.ok(result.requestSpans?.every(span =>
      typeof span.queuedAtUtc === 'string' &&
      typeof span.startedAtUtc === 'string' &&
      typeof span.firstResponseAtUtc === 'string' &&
      typeof span.endedAtUtc === 'string' &&
      (span.durationMs || 0) >= 0
    ))
    assert.deepEqual(await readFile(outputPath), wav)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TTS request pipelining (prefetchTts: true) overlaps next cue synthesis with current cue DSP while keeping server in-flight <= 1', async () => {
  const sourcePlan = buildDubbingPlan({
    videoDuration: 30,
    paceMode: 'source-adaptive',
    cues: [
      { id: 'cue-0', start: 1, end: 3, text: 'Source zero' },
      { id: 'cue-1', start: 5, end: 7, text: 'Source one' },
      { id: 'cue-2', start: 9, end: 11, text: 'Source two' },
      { id: 'cue-3', start: 13, end: 15, text: 'Source three' }
    ]
  })

  const translatedPlan = applyDubbingTranslations(sourcePlan, [
    { id: 'cue-0', text: 'Spoken zero' },
    { id: 'cue-1', text: 'Spoken one' },
    { id: 'cue-2', text: 'Spoken two' },
    { id: 'cue-3', text: 'Spoken three' }
  ])

  let activeServerRequests = 0
  let maxServerInFlight = 0
  let overlapObserved = false
  let activeAudioDsp = false

  const fakeTts = {
    async synthesize(request: any) {
      activeServerRequests++
      maxServerInFlight = Math.max(maxServerInFlight, activeServerRequests)
      const interval = setInterval(() => {
        if (activeAudioDsp) overlapObserved = true
      }, 2)
      // Simulate network latency (25ms)
      await new Promise((r) => setTimeout(r, 25))
      clearInterval(interval)
      if (activeAudioDsp) overlapObserved = true
      activeServerRequests--
      return { path: `/tmp/fake-${request.cueId}.wav`, voice: 'test-voice' }
    }
  }

  const fakeAudio = {
    async trim(path: string) {
      return { path, duration: 2.5 }
    },
    async applyTempo(path: string) {
      activeAudioDsp = true
      // Simulate local CPU DSP processing (30ms)
      await new Promise((r) => setTimeout(r, 30))
      activeAudioDsp = false
      return { path, duration: 1.8 }
    }
  }

  const result = await synthesizeDubbingPlan({
    plan: translatedPlan,
    language: 'vi',
    model: 'model-a',
    prefetchTts: true,
    predictor: {
      profile: { samples: 5, weights: [1, 1], residualP90: 0.1 },
      addSample() {},
      estimate() { return { seconds: 1.5, uncertaintySeconds: 0.1 } }
    } as any,
    tts: fakeTts as any,
    audio: fakeAudio as any
  })

  assert.equal(result.plan.cues.length, 4)
  assert.equal(result.clips.length, 4)
  assert.equal(maxServerInFlight, 1, `Server in-flight peak was ${maxServerInFlight}, expected <= 1`)
  assert.equal(overlapObserved, true, 'Next cue synthesis should overlap with current cue DSP when prefetchTts is true')
  assert.ok(result.metrics.prefetchStarted >= 1)
  assert.ok(result.metrics.prefetchUsed >= 1)
  assert.equal(result.metrics.prefetchDiscarded, 0)
})

test('TTS request pipelining (prefetchTts: false by default) strictly serializes synthesis and DSP', async () => {
  const sourcePlan = buildDubbingPlan({
    videoDuration: 30,
    paceMode: 'source-adaptive',
    cues: [
      { id: 'cue-0', start: 1, end: 3, text: 'Source zero' },
      { id: 'cue-1', start: 5, end: 7, text: 'Source one' }
    ]
  })

  const translatedPlan = applyDubbingTranslations(sourcePlan, [
    { id: 'cue-0', text: 'Spoken zero' },
    { id: 'cue-1', text: 'Spoken one' }
  ])

  let activeServerRequests = 0
  let maxServerInFlight = 0
  let overlapObserved = false
  let activeAudioDsp = false

  const fakeTts = {
    async synthesize(request: any) {
      activeServerRequests++
      maxServerInFlight = Math.max(maxServerInFlight, activeServerRequests)
      if (activeAudioDsp) overlapObserved = true
      await new Promise((r) => setTimeout(r, 15))
      if (activeAudioDsp) overlapObserved = true
      activeServerRequests--
      return { path: `/tmp/fake-${request.cueId}.wav`, voice: 'test-voice' }
    }
  }

  const fakeAudio = {
    async trim(path: string) { return { path, duration: 2.0 } },
    async applyTempo(path: string) {
      activeAudioDsp = true
      await new Promise((r) => setTimeout(r, 20))
      activeAudioDsp = false
      return { path, duration: 1.5 }
    }
  }

  const result = await synthesizeDubbingPlan({
    plan: translatedPlan,
    language: 'vi',
    model: 'model-a',
    // prefetchTts omitted -> defaults to false
    predictor: {
      profile: { samples: 5, weights: [1, 1], residualP90: 0.1 },
      addSample() {},
      estimate() { return { seconds: 1.5, uncertaintySeconds: 0.1 } }
    } as any,
    tts: fakeTts as any,
    audio: fakeAudio as any
  })

  assert.equal(result.plan.cues.length, 2)
  assert.equal(overlapObserved, false, 'Default conservative policy must not overlap synthesis with DSP')
})

test('TTS prefetch regression: DSP failure aborts in-flight next cue request and drains before synthesizeDubbingPlan rejects', async () => {
  const plan = buildDubbingPlan({
    videoDuration: 10,
    paceMode: 'fixed',
    cues: [
      { id: 'cue-0', start: 0, end: 1, text: 'First sentence.' },
      { id: 'cue-1', start: 3, end: 4, text: 'Second sentence.' }
    ]
  })

  let tts1Active = false
  let tts1Signal: AbortSignal | undefined
  let tts1Calls = 0
  let releaseTts1: () => void = () => {}
  const tts1Gate = new Promise<void>((r) => { releaseTts1 = r })

  let planRejected = false

  const promise = synthesizeDubbingPlan({
    plan,
    language: 'en',
    model: 'mock',
    fixedTempo: 1.3,
    prefetchTts: true,
    predictor: {
      profile: { samples: 5, residualP90: 0.1 },
      estimate: () => ({ seconds: 1.0, uncertaintySeconds: 0.1 }),
      addSample() {}
    } as any,
    tts: {
      synthesize: async (req, signal) => {
        if (req.cueId === 'cue-1') {
          tts1Calls++
          tts1Active = true
          tts1Signal = signal
          await tts1Gate
          tts1Active = false
        }
        return { path: `${req.cueId}.wav` }
      }
    },
    audio: {
      trim: async (path) => ({ path, duration: 1.5 }),
      applyTempo: async () => {
        // Current cue DSP fails while next cue TTS is in-flight
        throw new Error('DSP fixture failure')
      }
    }
  }).catch((err) => {
    planRejected = true
    return err
  })

  // Wait enough time for DSP to fail and trigger abort
  await new Promise((r) => setTimeout(r, 30))

  // synthesizeDubbingPlan must NOT have rejected yet because tts1 has not settled (drain barrier)
  assert.equal(planRejected, false, 'synthesizeDubbingPlan must not reject before next cue request settles')
  assert.equal(tts1Active, true, 'Next cue TTS request should still be active waiting for gate')
  assert.equal(tts1Signal?.aborted, true, 'Next cue TTS signal must have been aborted when DSP failed')

  // Now release gate
  releaseTts1()
  const error = await promise

  assert.equal(planRejected, true)
  assert.equal(error?.message, 'DSP fixture failure')
  assert.equal(tts1Active, false, 'Next cue TTS must be settled when function returns')
  assert.equal(tts1Calls, 1, 'Next cue TTS must have been called exactly once (no orphan retry)')
})

test('TTS prefetch regression: prefetch HTTP 403 passes through original error without redundant second retry', async () => {
  const plan = buildDubbingPlan({
    videoDuration: 10,
    paceMode: 'fixed',
    cues: [
      { id: 'cue-0', start: 0, end: 1, text: 'First.' },
      { id: 'cue-1', start: 3, end: 4, text: 'Second.' }
    ]
  })

  let tts1Calls = 0

  await assert.rejects(
    async () => {
      await synthesizeDubbingPlan({
        plan,
        language: 'en',
        model: 'mock',
        fixedTempo: 1,
        prefetchTts: true,
        predictor: {
          profile: { samples: 5, residualP90: 0.1 },
          estimate: () => ({ seconds: 2, uncertaintySeconds: 0.1 }),
          addSample() {}
        } as any,
        tts: {
          synthesize: async (req) => {
            if (req.cueId === 'cue-1') {
              tts1Calls++
              throw new Error('HTTP 403 Forbidden: invalid token')
            }
            return { path: `${req.cueId}.wav` }
          }
        },
        audio: {
          trim: async (path) => ({ path, duration: 2 }),
          applyTempo: async (path) => ({ path, duration: 1.5 })
        }
      })
    },
    (err: Error) => {
      assert.ok(err.message.includes('HTTP 403 Forbidden'))
      return true
    }
  )

  assert.equal(tts1Calls, 1, 'Prefetch failure must not trigger a redundant second call for the same cue')
})

test('TTS prefetch determinism: output plan, clip order, timing match exactly between prefetch=true and prefetch=false', async () => {
  const makePlan = () => buildDubbingPlan({
    videoDuration: 20,
    paceMode: 'fixed',
    cues: [
      { id: 'c0', start: 0, end: 2, text: 'Alpha' },
      { id: 'c1', start: 4, end: 6, text: 'Beta' },
      { id: 'c2', start: 8, end: 10, text: 'Gamma' }
    ]
  })

  const fakeTts = {
    async synthesize(req: any) {
      return { path: `fake-${req.cueId}.wav` }
    }
  }
  const fakeAudio = {
    async trim(path: string) { return { path, duration: 2.2 } },
    async applyTempo(path: string, _hint: string, targetDuration: number) {
      return { path, duration: targetDuration }
    }
  }
  const makePredictor = () => ({
    profile: { samples: 5, residualP90: 0.1 },
    estimate: () => ({ seconds: 2.0, uncertaintySeconds: 0.1 }),
    addSample() {}
  } as any)

  const resPrefetchOff = await synthesizeDubbingPlan({
    plan: makePlan(),
    language: 'vi',
    model: 'm',
    fixedTempo: 1,
    prefetchTts: false,
    predictor: makePredictor(),
    tts: fakeTts as any,
    audio: fakeAudio as any
  })

  const resPrefetchOn = await synthesizeDubbingPlan({
    plan: makePlan(),
    language: 'vi',
    model: 'm',
    fixedTempo: 1,
    prefetchTts: true,
    predictor: makePredictor(),
    tts: fakeTts as any,
    audio: fakeAudio as any
  })

  assert.equal(resPrefetchOn.clips.length, resPrefetchOff.clips.length)
  for (let i = 0; i < resPrefetchOff.clips.length; i++) {
    assert.equal(resPrefetchOn.clips[i].start, resPrefetchOff.clips[i].start)
    assert.equal(resPrefetchOn.clips[i].path, resPrefetchOff.clips[i].path)
    assert.equal(resPrefetchOn.plan.cues[i].actualDuration, resPrefetchOff.plan.cues[i].actualDuration)
    assert.equal(resPrefetchOn.plan.cues[i].tempo, resPrefetchOff.plan.cues[i].tempo)
  }
})
