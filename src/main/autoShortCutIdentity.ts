import { createHash } from 'node:crypto'
import type { AutoShortConfig, AutoShortQueueItemInput } from '../shared/types'
import { canonicalJson } from './autoShortStageKeys'

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function legacyNoCutDigests(config: AutoShortConfig): readonly string[] {
  return [digest(config), digest({ config, temporalEdit: undefined })]
}

export function itemCutConfigDigest(config: AutoShortConfig, temporalEdit: AutoShortQueueItemInput['temporalEdit']): string {
  return digest({ config, temporalEdit })
}

export function matchesAutoShortItemConfigDigest(
  storedDigest: string,
  config: AutoShortConfig,
  temporalEdit: AutoShortQueueItemInput['temporalEdit']
): boolean {
  if (temporalEdit === undefined) return legacyNoCutDigests(config).includes(storedDigest)
  return storedDigest === itemCutConfigDigest(config, temporalEdit)
}
