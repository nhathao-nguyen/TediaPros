import type { CutExecutionPlan, CutKeepSegment } from '../shared/autoShortCutPlan'

export function buildCutChunks(plan: CutExecutionPlan, maxSegments: number): CutKeepSegment[][] {
  if (!Number.isSafeInteger(maxSegments) || maxSegments < 1 || maxSegments > 64) throw new Error('CUT_RESOURCE_LIMIT')
  const chunks: CutKeepSegment[][] = []
  for (let index = 0; index < plan.keepSegments.length; index += maxSegments) {
    chunks.push(plan.keepSegments.slice(index, index + maxSegments))
  }
  return chunks
}

function volumeKey(value: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error('CUT_RESOURCE_LIMIT')
  return /^[A-Za-z]:$/u.test(normalized) ? normalized.toUpperCase() : normalized
}

function bytes(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error('CUT_RESOURCE_LIMIT')
  return Math.ceil(value)
}

export function cutVolumeReservations(input: {
  scratchVolume: string
  outputVolume: string
  cacheVolume: string
  bytesByVolume: { scratch: number; output: number; cache: number }
}): Array<{ volume: string; bytes: number }> {
  const ordered = [
    [input.scratchVolume, input.bytesByVolume.scratch],
    [input.outputVolume, input.bytesByVolume.output],
    [input.cacheVolume, input.bytesByVolume.cache]
  ] as const
  const reservations = new Map<string, number>()
  for (const [rawVolume, rawBytes] of ordered) {
    const volume = volumeKey(rawVolume)
    reservations.set(volume, (reservations.get(volume) || 0) + bytes(rawBytes))
  }
  return [...reservations].map(([volume, reservedBytes]) => ({ volume, bytes: reservedBytes }))
}
