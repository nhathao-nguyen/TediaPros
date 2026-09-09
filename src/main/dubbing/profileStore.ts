import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isCompatibleDurationProfile, type DurationProfile } from './durationPredictor'

function profilePath(root: string, key: string): string {
  if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Duration profile key không hợp lệ.')
  return join(root, `duration-profile-v2-${key}.json`)
}

export async function loadDurationProfile(root: string, key: string): Promise<DurationProfile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(profilePath(root, key), 'utf8')) as unknown
    return isCompatibleDurationProfile(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function saveDurationProfile(root: string, key: string, profile: DurationProfile): Promise<void> {
  if (!isCompatibleDurationProfile(profile)) throw new Error('Duration profile không hợp lệ.')
  await mkdir(root, { recursive: true })
  await writeFile(profilePath(root, key), JSON.stringify(profile, null, 2), 'utf8')
}
