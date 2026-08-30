import { join } from 'node:path'

/**
 * Return canonical runtime whisper-cuda directory first, followed by legacy profiles.
 */
export function whisperCudaCandidateDirs(userData: string, appData: string): string[] {
  const candidates: string[] = []
  const envDev = process.env.TEDIAPROS_RUNTIME_DIR?.trim()
  if (envDev) {
    candidates.push(join(envDev, 'whisper-cuda'))
    candidates.push(join(envDev, 'whisper-cpp'))
    candidates.push(envDev)
  }
  candidates.push(
    join(userData, 'bin', 'whisper-cuda'),
    join(userData, 'runtime', 'whisper-cuda'),
    join(userData, 'bin', 'whisper-cpp'),
    join(userData, 'runtime', 'whisper-cpp'),
    join(appData, 'tediapros', 'bin', 'whisper-cuda'),
    join(appData, 'tedia-pros', 'bin', 'whisper-cuda')
  )
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
