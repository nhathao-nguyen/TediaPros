/**
 * Capacity evidence for the Gemini Gateway text route. The user has confirmed
 * a one-million-token context window. A gateway may advertise a larger exact
 * value, but a smaller value is a configuration mismatch rather than a reason
 * to silently fall back to the legacy small-batch path.
 */
export interface GatewayCapacity {
  contextTokens: number
  outputTokens: number
  limitKind: 'combined' | 'input-only'
  provenance: 'user-confirmed' | 'gateway-contract'
}

export interface GatewayCapacityAdvertisement {
  contextTokens?: number
  outputTokens?: number
  limitKind?: GatewayCapacity['limitKind']
}

export const USER_CONFIRMED_GATEWAY_CONTEXT_TOKENS = 1_000_000
export const DEFAULT_GATEWAY_OUTPUT_TOKENS = 16_384

export function resolveGatewayCapacity(server?: GatewayCapacityAdvertisement): GatewayCapacity {
  const contextTokens = server?.contextTokens ?? USER_CONFIRMED_GATEWAY_CONTEXT_TOKENS
  const outputTokens = server?.outputTokens ?? DEFAULT_GATEWAY_OUTPUT_TOKENS
  if (!Number.isSafeInteger(contextTokens) || contextTokens < USER_CONFIRMED_GATEWAY_CONTEXT_TOKENS) {
    throw new Error('gateway-context-contract-mismatch')
  }
  if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0) {
    throw new Error('gateway-output-contract-invalid')
  }
  if (server?.limitKind != null && server.limitKind !== 'combined' && server.limitKind !== 'input-only') {
    throw new Error('gateway-limit-kind-invalid')
  }
  return {
    contextTokens,
    outputTokens,
    limitKind: server?.limitKind ?? 'combined',
    provenance: server?.contextTokens == null ? 'user-confirmed' : 'gateway-contract'
  }
}
