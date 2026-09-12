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
