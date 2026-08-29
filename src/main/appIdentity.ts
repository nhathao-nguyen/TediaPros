import { app } from 'electron'
import { access, copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'

const LEGACY_USER_DATA_DIRECTORY = 't-blao'
const MIGRATION_MARKER = '.tediapros-migration-v1'

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Copy only missing user data so a partially-created new profile is never overwritten. */
async function copyMissingTree(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  const entries = await readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const sourcePath = join(source, entry.name)
    const targetPath = join(target, entry.name)
    if (entry.isDirectory()) {
      await copyMissingTree(sourcePath, targetPath)
      continue
    }
    if (entry.isFile() && !(await exists(targetPath))) {
      await copyFile(sourcePath, targetPath)
    }
  }
}

/**
 * Preserve settings, encrypted keys, cookies, model caches and session data
 * when the package/app name changes the default Electron userData directory.
 * Failures are deliberately non-fatal: the branded app must still start.
 */
export async function migrateLegacyUserData(): Promise<void> {
  const current = normalize(app.getPath('userData'))
  const legacy = normalize(join(app.getPath('appData'), LEGACY_USER_DATA_DIRECTORY))
  if (current.toLowerCase() === legacy.toLowerCase()) return

  const marker = join(current, MIGRATION_MARKER)
  if (await exists(marker)) return
  if (!(await exists(legacy))) return

  try {
    await copyMissingTree(legacy, current)
    await writeFile(
      marker,
      JSON.stringify({ from: legacy, migratedAt: new Date().toISOString() }),
      { encoding: 'utf8', flag: 'wx' }
    )
  } catch {
    // Keep startup fail-safe; the old profile remains untouched for recovery.
  }
}
