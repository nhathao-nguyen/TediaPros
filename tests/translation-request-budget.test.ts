import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveGatewayCapacity } from '../src/main/translation/capabilitySnapshot'
import { checkRequestBudget, partitionOutputIds } from '../src/main/translation/requestBudget'

test('combined Gateway budget reserves review output separately from its input ledger', () => {
  const capacity = resolveGatewayCapacity()
  const base = {
    inputTokens: 983_616,
    outputReserve: 16_384,
    safetyReserve: 0,
    requestBytes: 100,
    requestByteLimit: 1_000_000
  }
  assert.equal(checkRequestBudget(capacity, base), 'fit')
  assert.equal(checkRequestBudget(capacity, { ...base, inputTokens: 983_617 }), 'input-limit')
  assert.equal(checkRequestBudget({ ...capacity, limitKind: 'input-only' }, {
    ...base,
    inputTokens: 1_000_000
  }), 'fit')
  assert.equal(checkRequestBudget(capacity, { ...base, outputReserve: 30_000 }), 'output-limit')
  assert.equal(checkRequestBudget(capacity, { ...base, requestBytes: 1_000_001 }), 'byte-limit')
})

test('output partition preserves source-group order and rejects ambiguous IDs', () => {
  assert.deepEqual(partitionOutputIds([
    { ids: ['a'], outputTokens: 10_000 },
    { ids: ['b'], outputTokens: 10_000 },
    { ids: ['c'], outputTokens: 10_000 }
  ], 16_384, 64), [['a'], ['b'], ['c']])
  assert.throws(() => partitionOutputIds([{ ids: ['a', 'a'], outputTokens: 1 }], 10, 0), /duplicate-or-empty-id/u)
  assert.throws(() => partitionOutputIds([{ ids: ['a'], outputTokens: 11 }], 10, 0), /needs-internal-output-partition/u)
})
