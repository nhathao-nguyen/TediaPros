import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertCutRunCapability,
  autoShortTemporalCutCapability,
  requestHasTemporalCut
} from '../src/main/autoShortCutCapability'

test('allows the existing no-cut workflow while Core cut execution is gated', () => {
  assert.equal(requestHasTemporalCut([{ id: 'plain', filePath: 'input.mp4' }]), false)
  assert.doesNotThrow(() => assertCutRunCapability(false, false))
  assert.deepEqual(autoShortTemporalCutCapability(false), {
    editing: true,
    execution: false,
    reason: 'CUT_CORE_NOT_VERIFIED'
  })
})

test('blocks a temporal cut before execution is verified', () => {
  const items = [{
    id: 'cut',
    filePath: 'input.mp4',
    temporalEdit: {
      schemaVersion: 1 as const,
      revision: 1,
      mode: 'ripple-delete' as const,
      removedRanges: [{ id: 'middle', startUs: 1_000_000, endUs: 2_000_000 }]
    }
  }]
  assert.equal(requestHasTemporalCut(items), true)
  assert.throws(() => assertCutRunCapability(true, false), (error: unknown) => {
    assert.equal((error as { code?: string }).code, 'CUT_CORE_NOT_VERIFIED')
    return true
  })
})

test('allows a temporal cut only after the explicit Core gate is enabled', () => {
  assert.doesNotThrow(() => assertCutRunCapability(true, true))
  assert.deepEqual(autoShortTemporalCutCapability(true), { editing: true, execution: true })
})
