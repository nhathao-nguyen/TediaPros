import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDubbingPlan } from '../src/main/dubbing/plan'
import { synthesizeDubbingPlan } from '../src/main/dubbing/synthesis'
import { applyDubbingTranslations } from '../src/main/dubbing/translation'
import { PreparationQueue } from '../src/main/dubbing/preparationQueue'

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

test('preparation queue bounds concurrency and consumes out-of-order completion in source order', async () => {
  const controller = new AbortController()
  let active = 0
  let maximum = 0
  const completed: number[] = []
  const queue = new PreparationQueue(5, 2, async (index) => {
    active++
    maximum = Math.max(maximum, active)
    await delay(index === 0 ? 20 : 2)
    active--
    completed.push(index)
    return index
  }, controller.signal)
  const consumed: number[] = []
  for (let index = 0; index < 5; index++) consumed.push(await queue.take(index))
  await queue.close()
  assert.equal(maximum, 2)
  assert.equal(completed[0], 1)
  assert.deepEqual(consumed, [0, 1, 2, 3, 4])
})

test('dubbing preparation concurrency overlaps two TTS requests without changing output order', async () => {
  const source = buildDubbingPlan({
    videoDuration: 30,
    paceMode: 'source-adaptive',
    cues: [
      { id: 'cue-0', start: 1, end: 3, text: 'Source zero.' },
      { id: 'cue-1', start: 6, end: 8, text: 'Source one.' },
      { id: 'cue-2', start: 11, end: 13, text: 'Source two.' },
      { id: 'cue-3', start: 16, end: 18, text: 'Source three.' }
    ]
  })
  const plan = applyDubbingTranslations(source, source.cues.map((cue, index) => ({ id: cue.id, text: `Spoken ${index}.` })))
  let active = 0
  let maximum = 0
  const completionOrder: string[] = []
  const result = await synthesizeDubbingPlan({
    plan,
    language: 'en',
    model: 'edge-tts',
    preparationConcurrency: 2,
    predictor: {
      profile: { samples: 5, weights: [1, 1], residualP90: 0.1 },
      addSample() {},
      estimate() { return { seconds: 1, uncertaintySeconds: 0.1 } }
    } as any,
    tts: {
      async synthesize(request) {
        active++
        maximum = Math.max(maximum, active)
        await delay(request.cueId === 'cue-0' ? 20 : 2)
        active--
        completionOrder.push(request.cueId)
        return { path: `${request.cueId}.wav`, voice: 'edge-voice' }
      }
    },
    audio: {
      async trim(path) { return { path, duration: 1 } },
      async applyTempo(path) { return { path, duration: 1 } }
    }
  })
  assert.equal(maximum, 2)
  assert.equal(completionOrder[0], 'cue-1')
  assert.deepEqual(result.plan.cues.map((cue) => cue.id), ['cue-0', 'cue-1', 'cue-2', 'cue-3'])
  assert.deepEqual(result.clips.map((clip) => clip.path), ['cue-0.wav', 'cue-1.wav', 'cue-2.wav', 'cue-3.wav'])
})

test('preparation queue stops starting work after a failed cue', async () => {
  const controller = new AbortController()
  const started: number[] = []
  const queue = new PreparationQueue(6, 2, async (index) => {
    started.push(index)
    if (index === 1) throw new Error('failed cue')
    await delay(10)
    return index
  }, controller.signal)
  assert.equal(await queue.take(0), 0)
  await assert.rejects(queue.take(1), /failed cue/u)
  await queue.close()
  assert.deepEqual(started, [0, 1])
})

test('preparation queue preserves all 500 unique units with bounded lookahead', async () => {
  const controller = new AbortController()
  let active = 0
  let maximum = 0
  let consumed = 0
  let furthestAhead = 0
  const queue = new PreparationQueue(500, 2, async (index) => {
    active++
    maximum = Math.max(maximum, active)
    furthestAhead = Math.max(furthestAhead, index - consumed)
    if (index % 11 === 0) await new Promise<void>((resolve) => setImmediate(resolve))
    active--
    return `unit-${index}`
  }, controller.signal)
  const output: string[] = []
  for (let index = 0; index < 500; index++) {
    output.push(await queue.take(index))
    consumed++
  }
  await queue.close()
  assert.equal(maximum, 2)
  // The observer increments after take() returns, one microtask behind the
  // queue's internal cursor, so a configured lookahead of four reports <= 4.
  assert.ok(furthestAhead <= 4, `lookahead advanced ${furthestAhead} positions`)
  assert.equal(new Set(output).size, 500)
  assert.equal(output[0], 'unit-0')
  assert.equal(output[499], 'unit-499')
})
