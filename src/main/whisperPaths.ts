import { join } from 'node:path'

/** Canonical CUDA directory for the current user-data profile. */
export function whisperCudaCandidateDirs(userData: string): string[] {
  return [join(userData, 'bin', 'whisper-cuda')]
}

/** Pick a CUDA directory only after the caller has performed a real probe. */
export function findWhisperCudaDir(
  candidates: string[],
  isUsable: (path: string) => boolean
): string | null {
  return candidates.find(isUsable) ?? null
}
