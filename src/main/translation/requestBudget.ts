import type { GatewayCapacity } from './capabilitySnapshot'

export type GatewayRequestBudgetResult = 'fit' | 'invalid-count' | 'input-limit' | 'output-limit' | 'byte-limit'

export interface GatewayRequestBudgetInput {
  inputTokens: number
  outputReserve: number
  safetyReserve: number
  requestBytes: number
  requestByteLimit: number
}

/**
 * Pure validation of counts measured by an adapter. It intentionally does not
 * turn UTF-8 bytes into "exact" tokenizer output; callers retain that
 * provenance in their audit snapshot.
 */
export function checkRequestBudget(
  capacity: GatewayCapacity,
  input: GatewayRequestBudgetInput
): GatewayRequestBudgetResult {
  const values = Object.values(input)
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) return 'invalid-count'
  if (input.outputReserve <= 0 || input.requestByteLimit <= 0) return 'invalid-count'
  if (input.outputReserve > capacity.outputTokens) return 'output-limit'
  if (input.requestBytes > input.requestByteLimit) return 'byte-limit'
  const used = input.inputTokens + input.safetyReserve
    + (capacity.limitKind === 'combined' ? input.outputReserve : 0)
  return used <= capacity.contextTokens ? 'fit' : 'input-limit'
}

/**
 * Split only requested output IDs. The immutable source ledger is deliberately
 * not partitioned here: every resulting request can keep the same source
 * context when its input budget permits it.
 */
export function partitionOutputIds(
  groups: readonly { ids: readonly string[]; outputTokens: number }[],
  limit: number,
  envelopeReserve: number
): string[][] {
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(envelopeReserve)
    || limit <= envelopeReserve || envelopeReserve < 0) {
    throw new Error('invalid-output-budget')
  }
  const batches: string[][] = []
  const seen = new Set<string>()
  let pending: string[] = []
  let used = envelopeReserve
  for (const group of groups) {
    if (!group.ids.length || !Number.isSafeInteger(group.outputTokens) || group.outputTokens <= 0) {
      throw new Error('invalid-output-group')
    }
    for (const rawId of group.ids) {
      const id = rawId.trim()
      if (!id || seen.has(id)) throw new Error('duplicate-or-empty-id')
      seen.add(id)
    }
    if (group.outputTokens + envelopeReserve > limit) throw new Error('needs-internal-output-partition')
    if (pending.length > 0 && used + group.outputTokens > limit) {
      batches.push(pending)
      pending = []
      used = envelopeReserve
    }
    pending.push(...group.ids)
    used += group.outputTokens
  }
  if (pending.length > 0) batches.push(pending)
  return batches
}
