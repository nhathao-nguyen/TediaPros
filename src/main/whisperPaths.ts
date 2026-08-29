import { join } from 'node:path'

/**
 * Return the current profile first, followed by the pre-branding profile used
 * by older TediaPros builds. New installs must always target the current path.
 */
export function whisperCudaCandidateDirs(userData: string, appData: string): string[] {
  const candidates = [
    join(userData, 'bin', 'whisper-cuda'),
    join(appData, 'tediapros', 'bin', 'whisper-cuda')
  ]
  const seen = new Set<string>()
  return candidates.filter((path) => {
    const key = path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Pick the first CUDA directory that the caller has proved usable. */
export function findWhisperCudaDir(
  candidates: string[],
  isUsable: (path: string) => boolean
): string | null {
  return candidates.find(isUsable) ?? null
}
