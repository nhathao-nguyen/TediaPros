import assert from 'node:assert/strict'
import test from 'node:test'
import { EdgeTtsError, classifyEdgeFailure, parseRetryAfter, retryableEdgeFailure } from '../src/main/edgeTtsRecovery'
import { EdgeTtsScheduler } from '../src/main/edgeTtsScheduler'
import { classifyAutoShortTtsRecovery } from '../src/main/autoShortTtsRecovery'

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('Edge recovery classifies provider failures without retrying terminal requests', () => {
  assert.equal(classifyEdgeFailure(new Error('Unexpected server response: 429')).code, 'rate_limited')
  assert.equal(classifyEdgeFailure(new Error('HTTP 403 Forbidden')).code, 'access_denied')
  assert.equal(classifyEdgeFailure(new Error('HTTP 503 unavailable')).code, 'provider_5xx')
  assert.equal(classifyEdgeFailure(new Error('ECONNRESET')).code, 'transient_network')
  assert.equal(classifyEdgeFailure(new Error('ignored'), true).code, 'cancelled')
  assert.equal(retryableEdgeFailure(classifyEdgeFailure(new Error('HTTP 400 bad request'))), false)
  assert.equal(parseRetryAfter('2'), 2_000)
  assert.equal(parseRetryAfter(new Date(3_000).toUTCString(), 1_000), 2_000)
})

test('Edge scheduler admits at most two operations and drains queued work', async () => {
  const scheduler = new EdgeTtsScheduler({ concurrency: 2, spacingMs: 0 })
  let active = 0
  let maximum = 0
  const releases: Array<() => void> = []
  const operation = async (): Promise<number> => {
    active++
    maximum = Math.max(maximum, active)
    await new Promise<void>((resolve) => releases.push(resolve))
    active--
    return active
  }
  const requests = [scheduler.run(operation), scheduler.run(operation), scheduler.run(operation)]
  await tick()
  assert.equal(maximum, 2)
  assert.equal(scheduler.snapshot().queued, 1)
  releases.shift()?.()
  await tick()
  assert.equal(maximum, 2)
  while (releases.length) releases.shift()?.()
  await Promise.all(requests)
  assert.deepEqual(scheduler.snapshot(), {
    nextEligibleAt: 0, circuit: false, probeFailures: 0, active: 0, queued: 0, concurrency: 2
  })
})

test('Edge scheduler retries 429 through a single probe then restores service', async () => {
  const scheduler = new EdgeTtsScheduler({ concurrency: 2, spacingMs: 0, backoffMs: 0, cooldownMs: 5, random: () => 0 })
  const attempts: number[] = []
  const result = await scheduler.run(async (attempt) => {
    attempts.push(attempt.retryIndex)
    if (attempt.retryIndex === 0) throw new EdgeTtsError('rate_limited', 'HTTP 429', 429, 5)
    return 'ok'
  })
  assert.equal(result, 'ok')
  assert.deepEqual(attempts, [0, 1])
  assert.equal(scheduler.snapshot().circuit, false)
  assert.equal(scheduler.snapshot().concurrency, 1)
})

test('Edge scheduler cancels a queued waiter without starting its operation', async () => {
  const scheduler = new EdgeTtsScheduler({ concurrency: 1, spacingMs: 0 })
  let releaseFirst: () => void = () => undefined
  const first = scheduler.run(() => new Promise<string>((resolve) => { releaseFirst = () => resolve('first') }))
  const controller = new AbortController()
  let secondStarted = false
  const second = scheduler.run(async () => { secondStarted = true; return 'second' }, controller.signal)
  await tick()
  controller.abort()
  await assert.rejects(second, (error: EdgeTtsError) => error.code === 'cancelled')
  assert.equal(secondStarted, false)
  releaseFirst()
  assert.equal(await first, 'first')
})

test('Edge scheduler blocks access denial until an explicit resume', async () => {
  const scheduler = new EdgeTtsScheduler({ spacingMs: 0 })
  await assert.rejects(
    scheduler.run(async () => { throw new EdgeTtsError('access_denied', 'HTTP 403', 403) }),
    (error: EdgeTtsError) => error.code === 'access_denied'
  )
  assert.equal(scheduler.snapshot().blocked, 'access_denied')
  await assert.rejects(scheduler.run(async () => 'unreachable'), (error: EdgeTtsError) => error.code === 'circuit_open')
  scheduler.resume()
  assert.equal(await scheduler.run(async () => 'restored'), 'restored')
})

test('an exhausted transient request opens cooldown and remains item-recoverable once', async () => {
  const scheduler = new EdgeTtsScheduler({ spacingMs: 0, backoffMs: 0, cooldownMs: 5, random: () => 0 })
  const failure = new EdgeTtsError('transient_network', 'socket reset')
  await assert.rejects(scheduler.run(async () => { throw failure }), failure)
  assert.equal(scheduler.snapshot().circuit, true)
  assert.deepEqual(classifyAutoShortTtsRecovery(failure, failure.message, 1), {
    kind: 'provider-transient', retryable: true, attempt: 1
  })
  assert.deepEqual(classifyAutoShortTtsRecovery(failure, failure.message, 2), {
    kind: 'provider-transient', retryable: false, attempt: 2
  })
  assert.equal(await scheduler.run(async () => 'half-open success'), 'half-open success')
  assert.equal(scheduler.snapshot().circuit, false)
})
