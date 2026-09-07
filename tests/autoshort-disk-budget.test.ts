import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AutoShortDiskBudgetLedger,
  type DiskReservation
} from '../src/main/autoShortDiskBudget'
import { runAutoShortQueue } from '../src/main/autoShortQueueRunner'
import type { AutoShortQueueItemInput } from '../src/shared/types'

const signal = (): AbortSignal => new AbortController().signal

test('disk ledger admits one reservation and releases it idempotently', async () => {
  let freeBytes = 1_000
  const ledger = new AutoShortDiskBudgetLedger({
    safetyHeadroomBytes: 100,
    getFreeBytes: async () => freeBytes
  })

  const reservation = await ledger.reserve('F:', 400, signal())
  assert.equal(ledger.getReservedBytes('F:'), 400)
  reservation.update(250)
  assert.equal(ledger.getReservedBytes('F:'), 250)
  reservation.release()
  reservation.release()
  assert.equal(ledger.getReservedBytes('F:'), 0)
})

test('disk ledger queues a second item until the first releases space', async () => {
  let freeBytes = 1_000
  const ledger = new AutoShortDiskBudgetLedger({
    safetyHeadroomBytes: 100,
    getFreeBytes: async () => freeBytes
  })

  const first = await ledger.reserve('F:', 700, signal())
  let secondSettled = false
  const secondPromise = ledger.reserve('F:', 300, signal()).then((reservation) => {
    secondSettled = true
    return reservation
  })
  await Promise.resolve()
  assert.equal(secondSettled, false)
  first.release()
  const second = await secondPromise
  assert.equal(secondSettled, true)
  assert.equal(ledger.getReservedBytes('F:'), 300)
  second.release()
  freeBytes = 900
})

test('disk ledger rechecks queued items when a reservation reports fewer future bytes', async () => {
  const ledger = new AutoShortDiskBudgetLedger({
    safetyHeadroomBytes: 100,
    getFreeBytes: async () => 1_000
  })
  const first = await ledger.reserve('F:', 700, signal())
  const secondPromise = ledger.reserve('F:', 300, signal())
  first.update(500)
  const second = await secondPromise
  assert.equal(ledger.getReservedBytes('F:'), 800)
  first.release()
  second.release()
})

test('disk ledger cancels a queued reservation without consuming capacity', async () => {
  const ledger = new AutoShortDiskBudgetLedger({
    safetyHeadroomBytes: 100,
    getFreeBytes: async () => 1_000
  })
  const first = await ledger.reserve('F:', 700, signal())
  const controller = new AbortController()
  const pending = ledger.reserve('F:', 300, controller.signal)
  controller.abort()
  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as Error).name, 'AbortError')
    return true
  })
  assert.equal(ledger.getReservedBytes('F:'), 700)
  first.release()
})

test('disk ledger does not grant a reservation cancelled while its free-space probe is pending', async () => {
  let probeCalls = 0
  let releaseProbe!: () => void
  const probeReady = new Promise<void>((resolve) => { releaseProbe = resolve })
  let probeBlocked = false
  const ledger = new AutoShortDiskBudgetLedger({
    safetyHeadroomBytes: 100,
    getFreeBytes: async () => {
      probeCalls++
      if (probeCalls === 1) return 1_000
      probeBlocked = true
      await probeReady
      return 1_200
    }
  })

  const first = await ledger.reserve('F:', 700, signal())
  const controller = new AbortController()
  const pending = ledger.reserve('F:', 300, controller.signal)
  const waiter = ledger.reserve('F:', 100, signal())
  while (!probeBlocked) await new Promise((resolve) => setImmediate(resolve))

  controller.abort(new Error('cancelled while probing'))
  releaseProbe()
  await assert.rejects(pending, (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'ABORT_ERR')
    return true
  })
  const second = await Promise.race([
    waiter,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('waiter was lost after cancellation')), 100))
  ])
  second.release()
  assert.equal(ledger.getReservedBytes('F:'), 700)
  first.release()
})

test('disk ledger rejects an impossible reservation with ENOSPC', async () => {
  const ledger = new AutoShortDiskBudgetLedger({
    safetyHeadroomBytes: 100,
    getFreeBytes: async () => 500
  })
  await assert.rejects(
    ledger.reserve('F:', 450, signal()),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'ENOSPC')
      return true
    }
  )
})

test('queue admission keeps experimental two-item execution within the disk ledger', async () => {
  const ledger = new AutoShortDiskBudgetLedger({
    safetyHeadroomBytes: 100,
    getFreeBytes: async () => 1_000
  })
  const items: AutoShortQueueItemInput[] = [
    { id: 'item-0', filePath: 'video-0.mp4' },
    { id: 'item-1', filePath: 'video-1.mp4' }
  ]
  let active = 0
  let peak = 0
  const results = await runAutoShortQueue({
    items,
    signal: new AbortController().signal,
    maxActiveItems: 2,
    admitItem: (item, _index, _total, admissionSignal) => ledger.reserve('F:', 700, admissionSignal),
    processItem: async (item, _index, _total, reservation) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
      reservation?.update(0)
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    onTerminal: () => {}
  })
  assert.equal(peak, 1)
  assert.deepEqual(results.map((result) => result.status), ['done', 'done'])
  assert.equal(ledger.getReservedBytes('F:'), 0)
})

// Keep the public type exercised so future API changes fail at compile time.
const _reservationTypeCheck: DiskReservation | undefined = undefined
void _reservationTypeCheck
