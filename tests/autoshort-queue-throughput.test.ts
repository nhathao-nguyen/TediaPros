import test from 'node:test'
import assert from 'node:assert/strict'
import type { AutoShortItemResult, AutoShortQueueItemInput } from '../src/shared/types'
import { runAutoShortQueue } from '../src/main/autoShortQueueRunner'

test('AutoShort Queue Runner: maxActiveItems=1 strictly serializes execution', async () => {
  const total = 3
  const items: AutoShortQueueItemInput[] = Array.from({ length: total }, (_, i) => ({
    id: `item-${i}`,
    filePath: `video-${i}.mp4`
  }))

  const started: number[] = []
  let activeCount = 0
  let peakActive = 0

  const terminalEvents: { result: AutoShortItemResult; index: number }[] = []

  const results = await runAutoShortQueue({
    items,
    signal: new AbortController().signal,
    maxActiveItems: 1,
    processItem: async (item, index) => {
      started.push(index)
      activeCount++
      peakActive = Math.max(peakActive, activeCount)
      await new Promise((r) => setTimeout(r, 20))
      activeCount--
      return {
        itemId: item.id,
        filePath: item.filePath,
        status: 'done'
      }
    },
    onTerminal: (result, index) => {
      terminalEvents.push({ result, index })
    }
  })

  assert.equal(peakActive, 1, 'maxActiveItems=1 must never exceed 1 active item')
  assert.deepEqual(started, [0, 1, 2], 'Items must start strictly sequentially')
  assert.equal(results.length, total)
  assert.equal(terminalEvents.length, total)
})

test('AutoShort Queue Runner: maxActiveItems=2 bounds concurrency and preserves order', async () => {
  const total = 5
  const items: AutoShortQueueItemInput[] = Array.from({ length: total }, (_, i) => ({
    id: `item-${i}`,
    filePath: `video-${i}.mp4`
  }))

  const delays = [80, 20, 70, 15, 30] // Item 1 finishes before Item 0
  let activeCount = 0
  let peakActive = 0
  const completionOrder: number[] = []

  const results = await runAutoShortQueue({
    items,
    signal: new AbortController().signal,
    maxActiveItems: 2,
    processItem: async (item, index) => {
      activeCount++
      peakActive = Math.max(peakActive, activeCount)
      await new Promise((r) => setTimeout(r, delays[index]))
      completionOrder.push(index)
      activeCount--
      return {
        itemId: item.id,
        filePath: item.filePath,
        status: 'done'
      }
    },
    onTerminal: () => {}
  })

  assert.equal(peakActive, 2, 'Peak concurrency must equal 2')
  assert.equal(completionOrder[0], 1, 'Item 1 (20ms) should complete before Item 0 (80ms)')
  assert.equal(results.length, total)
  // Even though finished out-of-order, results array preserves exact source order
  for (let i = 0; i < total; i++) {
    assert.equal(results[i].itemId, `item-${i}`)
    assert.equal(results[i].status, 'done')
  }
})

test('AutoShort Queue Runner: cancellation marks unstarted items as cancelled and stops admission', async () => {
  const total = 6
  const items: AutoShortQueueItemInput[] = Array.from({ length: total }, (_, i) => ({
    id: `item-${i}`,
    filePath: `video-${i}.mp4`
  }))

  const abortController = new AbortController()
  const started: number[] = []
  const terminals: number[] = []

  const results = await runAutoShortQueue({
    items,
    signal: abortController.signal,
    maxActiveItems: 2,
    processItem: async (item, index) => {
      started.push(index)
      if (index === 1) {
        abortController.abort()
      }
      await new Promise((r) => setTimeout(r, 30))
      return {
        itemId: item.id,
        filePath: item.filePath,
        status: 'done'
      }
    },
    onTerminal: (_, index) => {
      terminals.push(index)
    }
  })

  // Items 0 and 1 were admitted. Unstarted items must not run.
  assert.ok(started.length <= 2, `Expected at most 2 started items, got ${started.length}`)
  assert.equal(results[0].status, 'done')
  assert.equal(results[total - 1].status, 'cancelled')
  assert.equal(terminals.length, total, 'Every item must receive a terminal event')
})

test('AutoShort Queue Runner: single item error does not drop previous results or crash queue', async () => {
  const total = 4
  const items: AutoShortQueueItemInput[] = Array.from({ length: total }, (_, i) => ({
    id: `item-${i}`,
    filePath: `video-${i}.mp4`
  }))

  const results = await runAutoShortQueue({
    items,
    signal: new AbortController().signal,
    maxActiveItems: 2,
    processItem: async (item, index) => {
      if (index === 1) {
        throw new Error('Failure on item 1')
      }
      await new Promise((r) => setTimeout(r, 20))
      return {
        itemId: item.id,
        filePath: item.filePath,
        status: 'done'
      }
    },
    onTerminal: () => {}
  })

  assert.equal(results[0].status, 'done')
  assert.equal(results[1].status, 'error')
  assert.equal(results[1].error, 'Failure on item 1')
  assert.equal(results[2].status, 'done')
  assert.equal(results[3].status, 'done')
})

test('AutoShort Queue Runner: retries recoverable errors once after the first pass finishes', async () => {
  const items: AutoShortQueueItemInput[] = Array.from({ length: 3 }, (_, i) => ({
    id: `item-${i}`,
    filePath: `video-${i}.mp4`
  }))
  const starts: Array<[number, number]> = []
  const scheduled: number[] = []
  const terminals: number[] = []
  const results = await runAutoShortQueue({
    items,
    signal: new AbortController().signal,
    maxActiveItems: 1,
    processItem: async (item, index, _total, _reservation, attempt) => {
      starts.push([index, attempt])
      if (index === 0 && attempt === 1) return {
        itemId: item.id, filePath: item.filePath, status: 'error', error: 'duration',
        recovery: { kind: 'dubbing-duration', retryable: true, attempt }
      }
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    shouldRetry: (result) => result.recovery?.retryable === true,
    onRetryScheduled: (_result, index) => scheduled.push(index),
    onTerminal: (_result, index) => terminals.push(index)
  })
  assert.deepEqual(starts, [[0, 1], [1, 1], [2, 1], [0, 2]])
  assert.deepEqual(scheduled, [0])
  assert.deepEqual(terminals, [1, 2, 0])
  assert.equal(results[0].status, 'done')
})

test('AutoShort Queue Runner: cancellation during recovery finalizes every deferred item once', async () => {
  const controller = new AbortController()
  const items: AutoShortQueueItemInput[] = ['a', 'b'].map((id) => ({ id, filePath: `${id}.mp4` }))
  const terminals: string[] = []
  const recoveryStarts: string[] = []
  const results = await runAutoShortQueue({
    items, signal: controller.signal, maxActiveItems: 1,
    processItem: async (item, _index, _total, _reservation, attempt) => {
      if (attempt === 2) { recoveryStarts.push(item.id); controller.abort() }
      return attempt === 1
        ? { itemId: item.id, filePath: item.filePath, status: 'error', error: 'duration',
            recovery: { kind: 'dubbing-duration', retryable: true, attempt } }
        : { itemId: item.id, filePath: item.filePath, status: 'cancelled', error: 'cancelled' }
    },
    shouldRetry: (result) => result.recovery?.retryable === true,
    onTerminal: (result) => terminals.push(result.itemId)
  })
  assert.deepEqual(terminals.sort(), ['a', 'b'])
  assert.deepEqual(recoveryStarts, ['a'])
  assert.deepEqual(results.map((result) => result.status), ['cancelled', 'cancelled'])
})

test('AutoShort Queue Runner: a deferred recovery waits and resumes the same retry without a duplicate admission', async () => {
  const starts: Array<[string, 1 | 2]> = []
  let recoveryPolls = 0
  const results = await runAutoShortQueue({
    items: [
      { id: 'item-0', filePath: 'video-0.mp4' },
      { id: 'item-1', filePath: 'video-1.mp4' }
    ],
    signal: new AbortController().signal,
    maxActiveItems: 1,
    waitForProviderWait: async (wait) => {
      recoveryPolls++
      assert.equal(wait.operationId, 'op-recovery-0')
    },
    processItem: async (item, index, _total, _reservation, attempt = 1) => {
      starts.push([item.id, attempt])
      if (index === 0 && attempt === 1) {
        return {
          itemId: item.id,
          filePath: item.filePath,
          status: 'error',
          error: 'recoverable duration failure',
          recovery: { kind: 'dubbing-duration', retryable: true, attempt }
        }
      }
      if (index === 0 && attempt === 2 && recoveryPolls === 0) {
        return {
          kind: 'deferred',
          wait: {
            operationId: 'op-recovery-0',
            stage: 'restore-translate',
            reason: 'waiting-provider',
            nextEligibleAtUtc: null
          }
        }
      }
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    shouldRetry: (result) => result.recovery?.retryable === true,
    onTerminal: () => {}
  })

  assert.equal(recoveryPolls, 1)
  assert.deepEqual(starts, [['item-0', 1], ['item-1', 1], ['item-0', 2], ['item-0', 2]])
  assert.deepEqual(results.map((result) => result.status), ['done', 'done'])
})

test('AutoShort Queue Runner: circuit breaker trips after consecutive throttled errors and stops unstarted items', async () => {
  const items: AutoShortQueueItemInput[] = Array.from({ length: 5 }, (_, i) => ({
    id: `item-${i}`,
    filePath: `video-${i}.mp4`
  }))
  const started: number[] = []
  let trippedReason = ''
  let trippedCount = 0

  const results = await runAutoShortQueue({
    items,
    signal: new AbortController().signal,
    maxActiveItems: 1,
    circuitBreakerThreshold: 2,
    isThrottledError: (res) => res.error?.includes('405/429') ?? false,
    onCircuitTrip: (reason, count) => {
      trippedReason = reason
      trippedCount = count
    },
    processItem: async (item, index) => {
      started.push(index)
      if (index === 0 || index === 1) {
        return {
          itemId: item.id,
          filePath: item.filePath,
          status: 'error',
          error: 'Google Gemini Web tạm từ chối (HTTP 405/429 - chống bot)'
        }
      }
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    onTerminal: () => {}
  })

  assert.deepEqual(started, [0, 1], 'Only the first 2 items should have run before circuit tripped')
  assert.equal(trippedCount, 2, 'Tripped count should be 2')
  assert.match(trippedReason, /Circuit Breaker/u)
  assert.equal(results.length, 5)
  assert.equal(results[0].status, 'error')
  assert.equal(results[1].status, 'error')
  assert.equal(results[2].status, 'error')
  assert.match(results[2].error || '', /Circuit Breaker/u)
  assert.equal(results[3].status, 'error')
  assert.equal(results[4].status, 'error')
})

test('AutoShort Queue Runner: production default pauses and resumes the same deferred item before admitting the next item', async () => {
  const items: AutoShortQueueItemInput[] = [
    { id: 'item-0', filePath: 'video-0.mp4' },
    { id: 'item-1', filePath: 'video-1.mp4' },
    { id: 'item-2', filePath: 'video-2.mp4' }
  ]
  const terminals: string[] = []
  const deferreds: { id: string; stage: string }[] = []
  const started: string[] = []
  let firstAttempt = true
  let nowMs = Date.parse('2026-09-17T00:00:00.000Z')

  const results = await runAutoShortQueue({
    items,
    signal: new AbortController().signal,
    maxActiveItems: 1,
    circuitBreakerThreshold: 2,
    isThrottledError: (res) => res.error?.includes('throttled') ?? false,
    getNowMs: () => nowMs,
    waitForProviderWait: async (wait) => {
      assert.equal(wait.operationId, 'op-0')
      nowMs = Date.parse(wait.nextEligibleAtUtc!)
    },
    processItem: async (item, index) => {
      started.push(item.id)
      if (index === 0 && firstAttempt) {
        firstAttempt = false
        return {
          kind: 'deferred',
          wait: {
            operationId: 'op-0',
            stage: 'restore-translate',
            reason: 'Gemini Gateway rate limit (429)',
            nextEligibleAtUtc: '2026-09-17T00:10:00.000Z'
          }
        }
      }
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    onTerminal: (result) => {
      terminals.push(result.itemId)
    },
    onDeferred: (wait, _index, item) => {
      deferreds.push({ id: item.id, stage: wait.stage })
    }
  })

  assert.deepEqual(started, ['item-0', 'item-0', 'item-1', 'item-2'])
  assert.deepEqual(deferreds, [{ id: 'item-0', stage: 'restore-translate' }])
  assert.deepEqual(terminals, ['item-0', 'item-1', 'item-2'])
  assert.equal(results[0].status, 'done')
  assert.equal(results[1].status, 'done')
  assert.equal(results[2].status, 'done')
})

test('AutoShort Queue Runner: null provider deadline polls the same item and does not admit following items', async () => {
  const controller = new AbortController()
  const started: string[] = []
  let deferredCount = 0
  const results = await runAutoShortQueue({
    items: [
      { id: 'item-0', filePath: 'video-0.mp4' },
      { id: 'item-1', filePath: 'video-1.mp4' }
    ],
    signal: controller.signal,
    maxActiveItems: 1,
    waitForProviderWait: async (wait) => {
      assert.equal(wait.nextEligibleAtUtc, null)
      assert.deepEqual(started, ['item-0'])
    },
    processItem: async (item, index) => {
      started.push(item.id)
      if (index === 0 && deferredCount++ === 0) {
        return { kind: 'deferred', wait: {
          operationId: 'op-null', stage: 'restore-translate', reason: 'scheduler pending', nextEligibleAtUtc: null
        } }
      }
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    onTerminal: () => {}
  })
  assert.deepEqual(started, ['item-0', 'item-0', 'item-1'])
  assert.equal(results[0].status, 'done')
  assert.equal(results[1].status, 'done')
})

test('AutoShort Queue Runner: only an outcome-unknown hold pauses later admission', async () => {
  const predicate = (wait: { reason: string }) => wait.reason === 'outcome-unknown'
  const normalStarts: string[] = []
  let normalWaits = 0
  const normalResults = await runAutoShortQueue({
    items: [
      { id: 'item-0', filePath: 'video-0.mp4' },
      { id: 'item-1', filePath: 'video-1.mp4' }
    ],
    signal: new AbortController().signal,
    maxActiveItems: 1,
    pauseOnDeferred: predicate,
    waitForProviderWait: async () => {},
    processItem: async (item) => {
      normalStarts.push(item.id)
      if (item.id === 'item-0' && normalWaits++ === 0) {
        return {
          kind: 'deferred',
          wait: {
            operationId: 'op-normal',
            stage: 'restore-translate',
            reason: 'waiting-provider',
            nextEligibleAtUtc: null
          }
        }
      }
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    onTerminal: () => {}
  })
  assert.deepEqual(normalStarts, ['item-0', 'item-0', 'item-1'])
  assert.equal(normalResults[0].status, 'done')
  assert.equal(normalResults[1].status, 'done')

  const heldStarts: string[] = []
  const terminalIds: string[] = []
  const heldResults = await runAutoShortQueue({
    items: [
      { id: 'item-0', filePath: 'video-0.mp4' },
      { id: 'item-1', filePath: 'video-1.mp4' }
    ],
    signal: new AbortController().signal,
    maxActiveItems: 1,
    pauseOnDeferred: predicate,
    processItem: async (item) => {
      heldStarts.push(item.id)
      return {
        kind: 'deferred',
        wait: {
          operationId: 'op-unknown',
          stage: 'restore-translate',
          reason: 'outcome-unknown',
          nextEligibleAtUtc: null
        }
      }
    },
    onTerminal: (result) => { terminalIds.push(result.itemId) }
  })
  assert.deepEqual(heldStarts, ['item-0'])
  assert.deepEqual(terminalIds, [])
  assert.equal(heldResults[0].status, 'waiting_provider')
  assert.equal(heldResults[1], undefined)
})

test('AutoShort Queue Runner: cancellation during durable provider wait cancels the operation and never wakes it', async () => {
  const controller = new AbortController()
  let cancelCalls = 0
  const starts: string[] = []
  const results = await runAutoShortQueue({
    items: [
      { id: 'item-0', filePath: 'video-0.mp4' },
      { id: 'item-1', filePath: 'video-1.mp4' }
    ],
    signal: controller.signal,
    maxActiveItems: 1,
    waitForProviderWait: async () => { controller.abort(new Error('user-cancelled')) },
    processItem: async (item) => {
      starts.push(item.id)
      return { kind: 'deferred', cancelOperation: async () => { cancelCalls++ }, wait: {
        operationId: 'op-cancel-wait', stage: 'restore-translate', reason: 'provider-throttled', nextEligibleAtUtc: null
      } }
    },
    onTerminal: () => {}
  })
  assert.equal(cancelCalls, 1)
  assert.deepEqual(starts, ['item-0'])
  assert.equal(results[0].status, 'waiting_provider')
  assert.equal(results[1].status, 'cancelled')
})

test('AutoShort Queue Runner: two initially active provider waits keep later items behind both deferred retries', async () => {
  const items: AutoShortQueueItemInput[] = [
    { id: 'item-0', filePath: 'video-0.mp4' },
    { id: 'item-1', filePath: 'video-1.mp4' },
    { id: 'item-2', filePath: 'video-2.mp4' },
    { id: 'item-3', filePath: 'video-3.mp4' }
  ]
  const starts: string[] = []
  let releaseInitialGate!: () => void
  const initialGate = new Promise<void>((resolve) => { releaseInitialGate = resolve })
  let releaseSecondRetryGate!: () => void
  const secondRetryGate = new Promise<void>((resolve) => { releaseSecondRetryGate = resolve })
  let markSecondRetryStarted!: () => void
  const secondRetryStarted = new Promise<void>((resolve) => { markSecondRetryStarted = resolve })
  let initialArrivals = 0
  let retryOrder = 0

  const queue = runAutoShortQueue({
    items,
    signal: new AbortController().signal,
    maxActiveItems: 2,
    // Yield once so both initially admitted items have reached the provider
    // wait state before either worker is eligible to retry.
    waitForProviderWait: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    },
    processItem: async (item, index) => {
      starts.push(item.id)
      if (index < 2 && starts.filter((id) => id === item.id).length === 1) {
        initialArrivals++
        if (initialArrivals === 2) releaseInitialGate()
        await initialGate.promise
        return {
          kind: 'deferred',
          wait: {
            operationId: `op-${item.id}`,
            stage: 'restore-translate',
            reason: 'waiting-provider',
            nextEligibleAtUtc: '2026-09-17T00:10:00.000Z'
          }
        }
      }
      if (index < 2) {
        retryOrder++
        if (retryOrder === 2) {
          markSecondRetryStarted()
          await secondRetryGate.promise
        }
      }
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    onTerminal: () => {}
  })

  await secondRetryStarted.promise
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  assert.equal(starts.includes('item-2'), false, 'A new item must not start while any initially deferred operation is still unresolved.')
  assert.equal(starts.includes('item-3'), false, 'The global provider gate must remain closed until all deferred operations finish.')

  releaseSecondRetryGate()
  const results = await queue
  assert.deepEqual(results.map((result) => result.status), ['done', 'done', 'done', 'done'])
})
