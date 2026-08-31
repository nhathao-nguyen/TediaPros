import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DurationProfile } from './durationPredictor'

function isProfile(value: unknown): value is DurationProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<DurationProfile>
  const weights = profile.weights
  return profile.version === 2 &&
    typeof profile.samples === 'number' && Number.isInteger(profile.samples) && profile.samples >= 0 &&
    Array.isArray(weights) && weights.length === 6 && weights.every((weight) => typeof weight === 'number' && Number.isFinite(weight) && weight >= 0) &&
    typeof profile.residualP90 === 'number' && Number.isFinite(profile.residualP90) && profile.residualP90 >= 0
}

function profilePath(root: string, key: string): string {
  if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Duration profile key không hợp lệ.')
  return join(root, `duration-profile-v2-${key}.json`)
}

export async function loadDurationProfile(root: string, key: string): Promise<DurationProfile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(profilePath(root, key), 'utf8')) as unknown
    return isProfile(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export async function saveDurationProfile(root: string, key: string, profile: DurationProfile): Promise<void> {
  if (!isProfile(profile)) throw new Error('Duration profile không hợp lệ.')
  await mkdir(root, { recursive: true })
  await writeFile(profilePath(root, key), JSON.stringify(profile, null, 2), 'utf8')
}
