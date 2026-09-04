const PCM_BYTES_PER_SECOND = 44_100 * 2 * 2
const MIB = 1024 * 1024

/**
 * Calculates estimated free workspace bytes required for separation and composition.
 * Reserves space for: source PCM, vocal stem, instrumental stem, composed audio,
 * plus 25% safety margin and 256 MiB buffer.
 */
export function requiredSeparationWorkspaceBytes(durationSeconds: number): number {
  const fourPcmFiles = Math.ceil(durationSeconds * PCM_BYTES_PER_SECOND * 4)
  return Math.ceil(fourPcmFiles * 1.25) + 256 * MIB
}
