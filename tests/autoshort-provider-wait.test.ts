import assert from 'node:assert/strict'
import test from 'node:test'
import { providerWaitMessage, providerWaitNeedsAction } from '../src/shared/providerWaitPresentation'
import { runAutoShortQueue } from '../src/main/autoShortQueueRunner'

test('unknown outcome pauses instead of promising automatic progress, retaining pending videos', async () => {
  const wait = { operationId: 'op-unknown', stage: 'restoration-draft' as const, reason: 'outcome-unknown', nextEligibleAtUtc: null }
  let attempts = 0
  const results = await runAutoShortQueue({
    items: [{ id: 'first', filePath: 'first.mp4' }, { id: 'next', filePath: 'next.mp4' }],
    signal: new AbortController().signal, maxActiveItems: 1,
    pauseOnDeferred: providerWaitNeedsAction,
    processItem: async () => { attempts++; return { kind: 'deferred', wait } },
    waitForProvider: async () => { assert.fail('unknown outcome must not enter a timed wait') }
  })
  assert.equal(attempts, 1)
  assert.equal(results[0].status, 'waiting_provider')
  assert.match(providerWaitMessage(wait), /không tự chạy lại/)
  assert.doesNotMatch(providerWaitMessage(wait), /Sẽ tự tiếp tục/)
  assert.equal(providerWaitNeedsAction({ reason: 'provider-throttled', nextEligibleAtUtc: null }), true)
  const timed = { reason: 'provider-throttled', nextEligibleAtUtc: '2026-09-17T00:01:00Z' }
  assert.equal(providerWaitNeedsAction(timed), false)
  assert.match(providerWaitMessage(timed), /Sẽ tự tiếp tục/)
})
import {
  calculateProviderWaitRemainingMs,
  shouldWakeProviderWait,
  type ProviderWaitState
} from '../src/main/autoShortProviderWait'

test('cancelled batch cannot wake after cooldown', () => {
  const wait: ProviderWaitState = {
    operationId: 'op-1',
    stage: 'restore-translate',
    reason: 'provider-throttled',
    nextEligibleAtUtc: '2026-09-17T00:01:00.000Z'
  }
  assert.equal(shouldWakeProviderWait(wait, Date.parse('2026-09-17T00:02:00.000Z'), true), false)
})

test('null nextEligibleAtUtc cannot wake automatically', () => {
  const wait: ProviderWaitState = {
    operationId: 'op-2',
    stage: 'independent-review',
    reason: 'outcome-unknown',
    nextEligibleAtUtc: null
  }
  assert.equal(shouldWakeProviderWait(wait, Date.parse('2026-09-17T00:02:00.000Z'), false), false)
})

test('wake triggers when nowMs >= nextEligibleAtUtc and not cancelled', () => {
  const wait: ProviderWaitState = {
    operationId: 'op-3',
    stage: 'restore-translate',
    reason: 'provider-throttled',
    nextEligibleAtUtc: '2026-09-17T00:01:00.000Z'
  }
  assert.equal(shouldWakeProviderWait(wait, Date.parse('2026-09-17T00:00:59.000Z'), false), false)
  assert.equal(shouldWakeProviderWait(wait, Date.parse('2026-09-17T00:01:00.000Z'), false), true)
  assert.equal(shouldWakeProviderWait(wait, Date.parse('2026-09-17T00:01:01.000Z'), false), true)
})

test('calculateProviderWaitRemainingMs returns remaining milliseconds or 0 if elapsed', () => {
  const wait: ProviderWaitState = {
    operationId: 'op-4',
    stage: 'metadata',
    reason: 'throttled',
    nextEligibleAtUtc: '2026-09-17T00:01:00.000Z'
  }
  assert.equal(calculateProviderWaitRemainingMs(wait, Date.parse('2026-09-17T00:00:45.000Z')), 15000)
  assert.equal(calculateProviderWaitRemainingMs(wait, Date.parse('2026-09-17T00:01:10.000Z')), 0)
})
