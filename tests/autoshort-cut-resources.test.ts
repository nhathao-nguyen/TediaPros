import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCutChunks, cutVolumeReservations } from '../src/main/autoShortCutPreparation'
import { reserveAutoShortVolumes, type AutoShortDiskBudget, type DiskReservation } from '../src/main/autoShortDiskBudget'
import type { CutExecutionPlan, CutKeepSegment } from '../src/shared/autoShortCutPlan'

const segment = (index: number): CutKeepSegment => ({
  segmentId: `keep-${index}-${index + 1}`,
  sourceStart: { presentationIndex: index, ptsTicks: String(index), timeBase: { num: 1, den: 25 }, eof: false },
  sourceEnd: { presentationIndex: index + 1, ptsTicks: String(index + 1), timeBase: { num: 1, den: 25 }, eof: index === 99 },
  editedStart: { num: String(index), den: '25' }, editedEnd: { num: String(index + 1), den: '25' }
})

const plan = { keepSegments: Array.from({ length: 100 }, (_, index) => segment(index)) } as CutExecutionPlan

test('chunks keep segments at the bounded process limit', () => {
  assert.deepEqual(buildCutChunks(plan, 64).map((chunk) => chunk.length), [64, 36])
  assert.throws(() => buildCutChunks(plan, 0), /CUT_RESOURCE_LIMIT/)
  assert.throws(() => buildCutChunks(plan, 65), /CUT_RESOURCE_LIMIT/)
})

test('unions byte reservations that share the same physical volume', () => {
  assert.deepEqual(cutVolumeReservations({
    scratchVolume: 'C:', outputVolume: 'D:', cacheVolume: 'c:',
    bytesByVolume: { scratch: 100, output: 200, cache: 50 }
  }), [{ volume: 'C:', bytes: 150 }, { volume: 'D:', bytes: 200 }])
})

test('releases earlier volume ownership when a later reservation fails', async () => {
  const calls: string[] = []
  const first: DiskReservation = {
    update: (bytes) => calls.push(`update:${bytes}`),
    release: () => calls.push('release:C:')
  }
  const budget: AutoShortDiskBudget = {
    reserve: async (volume) => {
      calls.push(`reserve:${volume}`)
      if (volume === 'D:') throw new Error('ENOSPC')
      return first
    }
  }
  await assert.rejects(() => reserveAutoShortVolumes(budget, [
    { volume: 'C:', bytes: 100 }, { volume: 'D:', bytes: 200 }
  ], new AbortController().signal), /ENOSPC/)
  assert.deepEqual(calls, ['reserve:C:', 'reserve:D:', 'release:C:'])
})

test('composite volume reservation updates and releases every owned volume once', async () => {
  const calls: string[] = []
  const budget: AutoShortDiskBudget = {
    reserve: async (volume, bytes) => ({
      update: (remaining) => calls.push(`update:${volume}:${remaining}`),
      release: () => calls.push(`release:${volume}:${bytes}`)
    })
  }
  const reservation = await reserveAutoShortVolumes(budget, [
    { volume: 'C:', bytes: 100 }, { volume: 'D:', bytes: 200 }
  ], new AbortController().signal)
  reservation.update(0)
  reservation.release()
  reservation.release()
  assert.deepEqual(calls, ['update:C::0', 'update:D::0', 'release:D::200', 'release:C::100'])
})
