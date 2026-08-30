import { access, readdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'

/** Find a named file below an extracted runtime archive. */
export async function findFile(root: string, names: string[]): Promise<string | null> {
  const wanted = new Set(names.map((name) => name.toLowerCase()))
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const candidate = join(root, entry.name)
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, names)
      if (nested) return nested
    } else if (wanted.has(entry.name.toLowerCase())) {
      return candidate
    }
  }
  return null
}

/** Move a fully verified directory into place and restore the previous one on failure. */
export async function replaceDirectoryAtomic(candidate: string, destination: string): Promise<void> {
  const backup = `${destination}.previous`
  await rm(backup, { recursive: true, force: true }).catch(() => {})
  if (await localFileExists(destination)) await rename(destination, backup)
  try {
    await rename(candidate, destination)
    await rm(backup, { recursive: true, force: true }).catch(() => {})
  } catch (error) {
    await rm(destination, { recursive: true, force: true }).catch(() => {})
    if (await localFileExists(backup)) await rename(backup, destination).catch(() => {})
    throw error
  }
}

export async function localFileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}
