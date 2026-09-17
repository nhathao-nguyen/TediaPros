import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveGatewayCapacity } from '../src/main/translation/capabilitySnapshot'

test('Gateway keeps the user-confirmed 1M context floor until its contract advertises an exact higher value', () => {
  const fallback = resolveGatewayCapacity()
  assert.deepEqual(fallback, {
    contextTokens: 1_000_000,
    outputTokens: 16_384,
    limitKind: 'combined',
    provenance: 'user-confirmed'
  })

  assert.deepEqual(resolveGatewayCapacity({
    contextTokens: 1_048_576,
    outputTokens: 32_768,
    limitKind: 'input-only'
  }), {
    contextTokens: 1_048_576,
    outputTokens: 32_768,
    limitKind: 'input-only',
    provenance: 'gateway-contract'
  })
})

test('Gateway rejects a contradictory or malformed advertised capacity rather than silently falling back', () => {
  assert.throws(() => resolveGatewayCapacity({ contextTokens: 32_768 }), /gateway-context-contract-mismatch/u)
  assert.throws(() => resolveGatewayCapacity({ outputTokens: 0 }), /gateway-output-contract-invalid/u)
  assert.throws(() => resolveGatewayCapacity({ limitKind: 'neither' as never }), /gateway-limit-kind-invalid/u)
})
