import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAutoShortBatchStore } from '../src/main/autoShortBatchStore'
import type { BatchSnapshot } from '../src/shared/autoShortBatchJournal'

function snapshot(revision = 0): BatchSnapshot {
  return {
    schemaVersion: 1,
    jobId: 'batch-1',
    revision,
    createdAtUtc: '2026-09-12T00:00:00.000Z',
    updatedAtUtc: '2026-09-12T00:00:00.000Z',
    items: [{
      itemId: 'item-1', inputPath: 'input.mp4', inputDigest: 'a'.repeat(64),
      configDigest: 'b'.repeat(64), ordinal: 0, attempt: 0, state: 'pending'
    }]
  }
}

test('batch store saves atomically, rejects stale writes, and falls back to a checksum-valid backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-batch-store-'))
  try {
    const store = createAutoShortBatchStore(root)
    await store.save(snapshot(0), null)
    assert.deepEqual(await store.load('batch-1'), snapshot(0))
    await store.save(snapshot(1), 0)
    await assert.rejects(store.save(snapshot(2), 0), /revision|phiên bản/iu)
    await writeFile(join(root, 'batch-1', 'snapshot.json'), '{"cut":', 'utf8')
    assert.deepEqual(await store.load('batch-1'), snapshot(0))
    assert.match(await readFile(join(root, 'batch-1', 'snapshot.backup.json'), 'utf8'), /checksum/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('batch store rejects unsafe job ids and a junction that escapes its root', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-batch-contained-'))
  const outside = await mkdtemp(join(tmpdir(), 'tedia-batch-outside-'))
  try {
    const store = createAutoShortBatchStore(root)
    await assert.rejects(store.load('../outside'), /job|ID|hợp lệ/iu)
    await mkdir(outside, { recursive: true })
    try {
      await symlink(outside, join(root, 'batch-link'), 'junction')
    } catch (error) {
      context.skip(`Junction unavailable: ${(error as Error).message}`)
      return
    }
    await assert.rejects(store.load('batch-link'), /symbolic|reparse|link/iu)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('batch journal preserves a validated exact-frame edit for restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-batch-v2-cut-'))
  try {
    const boundary = (presentationIndex: number, eof = false) => ({ presentationIndex, ptsTicks: String(presentationIndex), timeBase: { num: 1, den: 25 }, eof })
    const value: BatchSnapshot = {
      ...snapshot(0),
      items: [{
        ...snapshot(0).items[0],
        temporalEdit: {
          schemaVersion: 2, editId: 'edit-1', revision: 1, mode: 'ripple-delete', policyVersion: 'cut-v2',
          itemId: 'item-1', sourceDigest: 'a'.repeat(64), frameIndexRevision: 'index-v1',
          removedRanges: [{ id: 'remove-1', start: boundary(25), end: boundary(50) }], reviewResolutions: []
        }
      }]
    }
    const store = createAutoShortBatchStore(root)
    await store.save(value, null)
    assert.deepEqual(await store.load('batch-1'), value)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
