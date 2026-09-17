import assert from 'node:assert/strict'
import test from 'node:test'
import {
  migrateBatchSnapshotToV2,
  recoverInterruptedBatch,
  resumeCandidateIds,
  validateBatchSnapshot,
  type BatchItemState,
  type BatchSnapshot
} from '../src/shared/autoShortBatchJournal'

function snapshot(): BatchSnapshot {
  const states: BatchItemState[] = ['succeeded', 'running', 'pending', 'failed', 'needs-review']
  return {
    schemaVersion: 1,
    jobId: 'batch-1',
    revision: 1,
    createdAtUtc: '2026-09-12T00:00:00.000Z',
    updatedAtUtc: '2026-09-12T00:00:00.000Z',
    items: states.map((state, ordinal) => ({
      itemId: `item-${ordinal}`,
      inputPath: `input-${ordinal}.mp4`,
      inputDigest: 'a'.repeat(64),
      configDigest: 'b'.repeat(64),
      ...(ordinal === 1 ? {
        temporalEdit: {
          schemaVersion: 1 as const,
          revision: 2,
          mode: 'ripple-delete' as const,
          removedRanges: [{ id: 'bad-take', startUs: 2_000_000, endUs: 3_500_000 }]
        }
      } : {}),
      ordinal,
      attempt: 1,
      state,
      ...(state === 'succeeded' ? {
        outputReceipt: { path: 'output-0.mp4', sha256: 'c'.repeat(64), bytes: 100, durationSeconds: 10 }
      } : {})
    }))
  }
}

test('restart changes running to interrupted and resumes only pending work without mutating source', () => {
  const source = snapshot()
  const recovered = recoverInterruptedBatch(source)
  assert.equal(recovered.items[1].state, 'interrupted')
  assert.deepEqual(resumeCandidateIds(recovered), ['item-1', 'item-2'])
  assert.equal(source.items[1].state, 'running')
  assert.equal(recovered.items[0].state, 'succeeded')
  assert.deepEqual(recovered.items[1].temporalEdit, source.items[1].temporalEdit)
})

test('journal validation rejects secret fields, duplicates, unsupported versions and false success receipts', () => {
  assert.deepEqual(validateBatchSnapshot(snapshot()), snapshot())
  assert.throws(() => validateBatchSnapshot({ ...snapshot(), apiKey: 'secret' }), /field|trường|schema/iu)
  assert.throws(() => validateBatchSnapshot({ ...snapshot(), schemaVersion: 3 }), /version|schema/iu)
  const duplicate = snapshot()
  duplicate.items[1].itemId = duplicate.items[0].itemId
  assert.throws(() => validateBatchSnapshot(duplicate), /trùng|duplicate/iu)
  const missingReceipt = snapshot()
  delete missingReceipt.items[0].outputReceipt
  assert.throws(() => validateBatchSnapshot(missingReceipt), /receipt|biên nhận/iu)
})

test('schema v2, waiting-provider validation, migration, and resume candidates', () => {
  const v1 = snapshot()
  const v2 = migrateBatchSnapshotToV2(v1)
  assert.equal(v2.schemaVersion, 2)
  assert.deepEqual(validateBatchSnapshot(v2), v2)

  // waiting-provider requires providerWait
  const waitingItem = {
    ...v2.items[2],
    state: 'waiting-provider' as const,
    providerWait: {
      operationId: 'op-123',
      stage: 'restore-translate' as const,
      reason: 'quota_exhausted: cooldown 60s',
      nextEligibleAtUtc: '2026-09-17T12:00:00.000Z'
    }
  }
  const snapshotWithWait: BatchSnapshot = {
    ...v2,
    items: [v2.items[0], v2.items[1], waitingItem, v2.items[3], v2.items[4]]
  }
  assert.deepEqual(validateBatchSnapshot(snapshotWithWait), snapshotWithWait)

  for (const stage of ['restoration-draft', 'restoration-review'] as const) {
    const restorationWait: BatchSnapshot = {
      ...snapshotWithWait,
      items: snapshotWithWait.items.map((item) => item.itemId === 'item-2'
        ? { ...item, providerWait: { ...waitingItem.providerWait, stage } }
        : item)
    }
    assert.equal(validateBatchSnapshot(restorationWait).items[2].providerWait?.stage, stage)
  }

  // candidates must include waiting-provider
  const candidates = resumeCandidateIds(snapshotWithWait)
  assert.deepEqual(candidates, ['item-2'])

  // recoverInterruptedBatch preserves waiting-provider and providerWait
  const recovered = recoverInterruptedBatch(snapshotWithWait)
  assert.equal(recovered.items[2].state, 'waiting-provider')
  assert.deepEqual(recovered.items[2].providerWait, waitingItem.providerWait)

  // missing providerWait on waiting-provider throws
  const badWait = {
    ...snapshotWithWait,
    items: snapshotWithWait.items.map((it) => it.itemId === 'item-2' ? { ...it, providerWait: undefined } : it)
  }
  assert.throws(() => validateBatchSnapshot(badWait), /waiting-provider.*providerWait/iu)
})

test('a 1000-item recovered queue preserves order and never resumes succeeded or failed items', () => {
  const large: BatchSnapshot = {
    ...snapshot(),
    jobId: 'batch-1000',
    items: Array.from({ length: 1000 }, (_, ordinal) => ({
      itemId: `item-${ordinal}`,
      inputPath: `input-${ordinal}.mp4`,
      inputDigest: 'a'.repeat(64),
      configDigest: 'b'.repeat(64),
      ordinal,
      attempt: ordinal < 502 ? 1 : 0,
      state: ordinal === 17 || ordinal === 31 || ordinal === 501
        ? 'failed' as const
        : ordinal < 502
          ? 'succeeded' as const
          : ordinal === 502
            ? 'running' as const
            : 'pending' as const,
      ...(ordinal < 502 && ordinal !== 17 && ordinal !== 31 && ordinal !== 501 ? {
        outputReceipt: { path: `output-${ordinal}.mp4`, sha256: 'c'.repeat(64), bytes: 100, durationSeconds: 10 }
      } : {})
    }))
  }
  const candidates = resumeCandidateIds(recoverInterruptedBatch(large))
  assert.equal(candidates.length, 498)
  assert.equal(candidates[0], 'item-502')
  assert.equal(candidates.at(-1), 'item-999')
  assert.equal(new Set(candidates).size, candidates.length)
})
