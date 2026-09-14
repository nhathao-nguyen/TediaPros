import { createHash } from 'node:crypto'
import type { AutoShortConfig, AutoShortQueueItemInput } from '../shared/types'
import { normalizeFrameCutRanges, type AutoShortTemporalEditV2, type CutExecutionIdentity } from '../shared/autoShortCutContract'
import { normalizeAutoShortTemporalEdit } from '../shared/autoShortTemporalEdit'
import { canonicalJson } from './autoShortStageKeys'

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function contentConfig(config: AutoShortConfig): Omit<AutoShortConfig, 'executionPolicy'> {
  const { executionPolicy: _executionPolicy, ...content } = config
  return content
}

export function legacyNoCutDigests(config: AutoShortConfig): readonly string[] {
  return [digest(config), digest({ config, temporalEdit: undefined })]
}

export function itemCutConfigDigest(config: AutoShortConfig, temporalEdit: AutoShortQueueItemInput['temporalEdit']): string {
  // Scheduling knobs do not alter media bytes, cue identity, or cache keys.
  // Keeping them out lets a paused batch resume with a safer/faster scheduler.
  return digest({ config: contentConfig(config), temporalEdit })
}

export function matchesAutoShortItemConfigDigest(
  storedDigest: string,
  config: AutoShortConfig,
  temporalEdit: AutoShortQueueItemInput['temporalEdit']
): boolean {
  if (storedDigest === itemCutConfigDigest(config, temporalEdit)) return true
  // Backward compatibility for journals created before scheduling policy was
  // excluded from the digest.
  if (temporalEdit === undefined && legacyNoCutDigests(config).includes(storedDigest)) return true
  return storedDigest === digest({ config, temporalEdit })
}

export function semanticFrameEditDigest(edit: AutoShortTemporalEditV2): string {
  const ranges = normalizeFrameCutRanges(edit.removedRanges).map((range) => ({
    start: {
      presentationIndex: range.start.presentationIndex,
      ptsTicks: range.start.ptsTicks,
      timeBase: range.start.timeBase,
      eof: range.start.eof
    },
    end: {
      presentationIndex: range.end.presentationIndex,
      ptsTicks: range.end.ptsTicks,
      timeBase: range.end.timeBase,
      eof: range.end.eof
    }
  }))
  return digest({ schemaVersion: 2, mode: edit.mode, policyVersion: edit.policyVersion, ranges })
}

export function preparationIdentityKey(identity: CutExecutionIdentity): string {
  for (const value of [identity.sourceDigest, identity.editDigest, identity.runtimeDigest, identity.mediaPolicyDigest]) {
    if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('CUT_INVALID_IDENTITY')
  }
  if (!identity.executorRevision.trim() || identity.executorRevision.length > 128) throw new Error('CUT_INVALID_IDENTITY')
  return digest({ schemaVersion: 1, ...identity })
}

export function semanticTemporalSourceDigest(
  sourceDigest: string,
  temporalEdit: AutoShortQueueItemInput['temporalEdit']
): string {
  if (!/^[a-f0-9]{64}$/u.test(sourceDigest)) throw new Error('CUT_INVALID_IDENTITY')
  if (temporalEdit === undefined) return sourceDigest
  const editDigest = temporalEdit.schemaVersion === 2
    ? semanticFrameEditDigest(temporalEdit)
    : digest({
        schemaVersion: 1,
        mode: temporalEdit.mode,
        ranges: normalizeAutoShortTemporalEdit(temporalEdit)?.removedRanges.map(({ startUs, endUs }) => ({ startUs, endUs })) || []
      })
  return digest({ schemaVersion: 1, sourceDigest, editDigest })
}
