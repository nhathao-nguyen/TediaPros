import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  durationProfileKey,
  extractDurationFeatures,
  type DurationProfileKeyInput
} from './durationPredictor'

export const VOICE_MEASUREMENT_VERSION = 1 as const
export const VOICE_MEASUREMENT_FEATURE_VERSION = 'spoken-unit-proxy-v1'
export const VOICE_MEASUREMENT_NORMALIZER_VERSION = 'nfc-nfkc-space-v1'
export const VOICE_MEASUREMENT_MAX_RECORDS = 512

export type VoiceMeasurementOrigin = 'voice-tab' | 'autoshort'
export type VoiceMeasurementDurationSource = 'probed-trimmed-audio' | 'provider-duration-header'
export type VoiceMeasurementStatus = 'cold' | 'advisory' | 'qualified' | 'stale'

export interface VoiceMeasurementRecord {
  version: 1
  sampleId: string
  profileKey: string
  textHash: string
  spokenUnitCount: number
  textFeatures: ReturnType<typeof extractDurationFeatures>
  locale: string
  durationNaturalMs: number
  durationSource: VoiceMeasurementDurationSource
  speed: number
  audioFingerprint: string
  origin: VoiceMeasurementOrigin
  cacheHit: boolean
  uncertaintyReasons: string[]
  measuredAtUtc: string
}

export interface VoiceMeasurementProfile {
  version: 1
  profileKey: string
  provider: string
  model: string
  voice: string
  locale: string
  metric: 'estimated-spoken-units-per-second'
  featureVersion: typeof VOICE_MEASUREMENT_FEATURE_VERSION
  normalizerVersion: typeof VOICE_MEASUREMENT_NORMALIZER_VERSION
  status: VoiceMeasurementStatus
  observationCount: number
  eligibleSampleCount: number
  uniqueTextSampleCount: number
  rateP10: number | null
  rateMedian: number | null
  rateP90: number | null
  uncertaintyReasons: string[]
  updatedAtUtc: string | null
  records: VoiceMeasurementRecord[]
}

export interface VoiceMeasurementInput {
  profileKey: string
  provider: string
  model: string
  voice: string
  locale: string
  text: string
  durationNaturalMs: number
  durationSource: VoiceMeasurementDurationSource
  speed?: number
  audioFingerprint?: string
  origin: VoiceMeasurementOrigin
  cacheHit?: boolean
  measuredAtUtc?: string
}

export interface VoicePromptHint {
  version: 1
  locale: string
  metric: 'estimated-spoken-units-per-second'
  normalizerVersion: typeof VOICE_MEASUREMENT_NORMALIZER_VERSION
  status: Exclude<VoiceMeasurementStatus, 'cold' | 'stale'>
  eligibleSamples: number
  median: number
  p10: number
  p90: number
  uncertaintyReasons: string[]
}

function normalizedLocale(locale: string): string {
  return locale.trim().replace(/_/gu, '-').toLowerCase()
}

function normalizedText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function languageOf(locale: string): string {
  return normalizedLocale(locale).split('-')[0] || ''
}

function spokenUnitCount(text: string, locale: string): number {
  const value = normalizedText(text)
  if (!value) return 0
  try {
    const segmenter = new Intl.Segmenter(locale || undefined, { granularity: 'word' })
    const segments = Array.from(segmenter.segment(value)).filter((part) => part.isWordLike)
    if (segments.length > 0) return segments.length
  } catch {
    // Fall through to a conservative Unicode-word approximation.
  }
  return (value.match(/[\p{L}\p{N}]+/gu) || []).length
}

function uncertaintyReasons(text: string, locale: string, durationSource: VoiceMeasurementDurationSource): string[] {
  const features = extractDurationFeatures(text, locale)
  const reasons: string[] = []
  if (features.numerals > 0) reasons.push('numbers')
  if (features.abbreviations > 0) reasons.push('abbreviations')
  if (!['en', 'vi', 'es', 'de', 'fr', 'pt', 'it', 'zh', 'ja', 'ko', 'ru', 'ar', 'hi'].includes(languageOf(locale))) {
    reasons.push('unknown-locale')
  }
  const scriptFamilies = [
    /\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Arabic}/u,
    /\p{Script=Devanagari}/u, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
  ].filter((pattern) => pattern.test(text)).length
  if (scriptFamilies > 1) reasons.push('mixed-script')
  if (durationSource !== 'probed-trimmed-audio') reasons.push('duration-header')
  return [...new Set(reasons)]
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return Number(sorted[index].toFixed(3))
}

function deriveSummary(profile: VoiceMeasurementProfile): void {
  const eligible = profile.records.filter((record) =>
    record.durationNaturalMs > 0 && Number.isFinite(record.durationNaturalMs) &&
    Math.abs(record.speed - 1) < 1e-6 && record.spokenUnitCount > 0
  )
  const rates = eligible
    .map((record) => record.spokenUnitCount / (record.durationNaturalMs / 1000))
    .filter((rate) => Number.isFinite(rate) && rate > 0 && rate < 1000)
  profile.observationCount = profile.records.length
  profile.eligibleSampleCount = rates.length
  profile.uniqueTextSampleCount = new Set(eligible.map((record) => record.textHash)).size
  profile.rateP10 = percentile(rates, 0.1)
  profile.rateMedian = percentile(rates, 0.5)
  profile.rateP90 = percentile(rates, 0.9)
  profile.uncertaintyReasons = [...new Set(profile.records.flatMap((record) => record.uncertaintyReasons))].slice(0, 16)
  if (rates.length === 0) profile.status = 'cold'
  else if (profile.status !== 'qualified') profile.status = 'advisory'
}

export function voiceMeasurementProfileKey(input: DurationProfileKeyInput): string {
  return durationProfileKey(input)
}

export function createVoiceMeasurementProfile(input: {
  profileKey: string
  provider: string
  model: string
  voice: string
  locale: string
}): VoiceMeasurementProfile {
  const now = new Date().toISOString()
  return {
    version: VOICE_MEASUREMENT_VERSION,
    profileKey: input.profileKey,
    provider: input.provider.trim(),
    model: input.model.trim(),
    voice: input.voice.trim(),
    locale: normalizedLocale(input.locale),
    metric: 'estimated-spoken-units-per-second',
    featureVersion: VOICE_MEASUREMENT_FEATURE_VERSION,
    normalizerVersion: VOICE_MEASUREMENT_NORMALIZER_VERSION,
    status: 'cold',
    observationCount: 0,
    eligibleSampleCount: 0,
    uniqueTextSampleCount: 0,
    rateP10: null,
    rateMedian: null,
    rateP90: null,
    uncertaintyReasons: [],
    updatedAtUtc: null,
    records: []
  }
}

function isValidRecord(value: unknown): value is VoiceMeasurementRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<VoiceMeasurementRecord>
  return record.version === 1 && typeof record.sampleId === 'string' && record.sampleId.length <= 80 &&
    typeof record.profileKey === 'string' && /^[a-f0-9]{64}$/u.test(record.profileKey) &&
    typeof record.textHash === 'string' && /^[a-f0-9]{64}$/u.test(record.textHash) &&
    typeof record.spokenUnitCount === 'number' && Number.isInteger(record.spokenUnitCount) && record.spokenUnitCount >= 0 && record.spokenUnitCount <= 100_000 &&
    typeof record.locale === 'string' && record.locale.length <= 64 &&
    typeof record.durationNaturalMs === 'number' && Number.isFinite(record.durationNaturalMs) && record.durationNaturalMs > 0 && record.durationNaturalMs <= 86_400_000 &&
    (record.durationSource === 'probed-trimmed-audio' || record.durationSource === 'provider-duration-header') &&
    typeof record.speed === 'number' && Number.isFinite(record.speed) && record.speed > 0 && record.speed <= 4 &&
    typeof record.audioFingerprint === 'string' && record.audioFingerprint.length <= 128 &&
    (record.origin === 'voice-tab' || record.origin === 'autoshort') && typeof record.cacheHit === 'boolean' &&
    Array.isArray(record.uncertaintyReasons) && record.uncertaintyReasons.every((item) => typeof item === 'string' && item.length <= 64) &&
    typeof record.measuredAtUtc === 'string'
}

export function isCompatibleVoiceMeasurementProfile(value: unknown): value is VoiceMeasurementProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const profile = value as Partial<VoiceMeasurementProfile>
  return profile.version === 1 && typeof profile.profileKey === 'string' && /^[a-f0-9]{64}$/u.test(profile.profileKey) &&
    typeof profile.provider === 'string' && typeof profile.model === 'string' && typeof profile.voice === 'string' &&
    typeof profile.locale === 'string' && profile.metric === 'estimated-spoken-units-per-second' &&
    profile.featureVersion === VOICE_MEASUREMENT_FEATURE_VERSION && profile.normalizerVersion === VOICE_MEASUREMENT_NORMALIZER_VERSION &&
    (profile.status === 'cold' || profile.status === 'advisory' || profile.status === 'qualified' || profile.status === 'stale') &&
    Array.isArray(profile.records) && profile.records.length <= VOICE_MEASUREMENT_MAX_RECORDS && profile.records.every(isValidRecord)
}

export function addVoiceMeasurement(
  profile: VoiceMeasurementProfile,
  input: VoiceMeasurementInput
): VoiceMeasurementProfile {
  if (profile.profileKey !== input.profileKey) throw new Error('Voice measurement không khớp profile key.')
  const durationNaturalMs = Number(input.durationNaturalMs)
  if (!(durationNaturalMs > 0) || !Number.isFinite(durationNaturalMs)) return profile
  const speed = Number.isFinite(input.speed) && (input.speed || 0) > 0 ? Number(input.speed) : 1
  const text = normalizedText(input.text)
  if (!text) return profile
  const textHash = createHash('sha256').update(text).digest('hex')
  const audioFingerprint = input.audioFingerprint?.trim() || `${textHash}:${durationNaturalMs.toFixed(1)}:${speed.toFixed(3)}`
  const duplicate = profile.records.some((record) => record.audioFingerprint === audioFingerprint ||
    (record.textHash === textHash && Math.abs(record.durationNaturalMs - durationNaturalMs) < 0.5 && Math.abs(record.speed - speed) < 1e-6))
  if (duplicate) return profile
  const record: VoiceMeasurementRecord = {
    version: 1,
    sampleId: randomUUID(),
    profileKey: input.profileKey,
    textHash,
    spokenUnitCount: spokenUnitCount(text, input.locale),
    textFeatures: extractDurationFeatures(text, input.locale),
    locale: normalizedLocale(input.locale),
    durationNaturalMs: Number(durationNaturalMs.toFixed(3)),
    durationSource: input.durationSource,
    speed,
    audioFingerprint,
    origin: input.origin,
    cacheHit: input.cacheHit === true,
    uncertaintyReasons: uncertaintyReasons(text, input.locale, input.durationSource),
    measuredAtUtc: input.measuredAtUtc || new Date().toISOString()
  }
  profile.records = [...profile.records, record].slice(-VOICE_MEASUREMENT_MAX_RECORDS)
  profile.updatedAtUtc = record.measuredAtUtc
  deriveSummary(profile)
  return profile
}

function profilePath(root: string, key: string): string {
  if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Voice measurement profile key không hợp lệ.')
  return join(root, `voice-measurement-v1-${key}.json`)
}

export async function loadVoiceMeasurementProfile(root: string, key: string): Promise<VoiceMeasurementProfile | undefined> {
  try {
    const parsed = JSON.parse(await readFile(profilePath(root, key), 'utf8')) as unknown
    if (!isCompatibleVoiceMeasurementProfile(parsed)) return undefined
    deriveSummary(parsed)
    return parsed
  } catch {
    return undefined
  }
}

export async function saveVoiceMeasurementProfile(root: string, profile: VoiceMeasurementProfile): Promise<void> {
  if (!isCompatibleVoiceMeasurementProfile(profile)) throw new Error('Voice measurement profile không hợp lệ.')
  await mkdir(root, { recursive: true })
  const path = profilePath(root, profile.profileKey)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(profile, null, 2), 'utf8')
  await rename(temporary, path)
}

export function voicePromptHintFromProfile(
  profile: VoiceMeasurementProfile | undefined,
  locale: string
): VoicePromptHint | undefined {
  if (!profile || profile.status === 'cold' || profile.status === 'stale') return undefined
  if (normalizedLocale(profile.locale) !== normalizedLocale(locale)) return undefined
  if (!(profile.rateMedian && profile.rateP10 && profile.rateP90) || profile.eligibleSampleCount < 1) return undefined
  return {
    version: 1,
    locale: normalizedLocale(locale),
    metric: profile.metric,
    normalizerVersion: profile.normalizerVersion,
    status: profile.status === 'qualified' ? 'qualified' : 'advisory',
    eligibleSamples: profile.eligibleSampleCount,
    median: profile.rateMedian,
    p10: profile.rateP10,
    p90: profile.rateP90,
    uncertaintyReasons: [...profile.uncertaintyReasons].slice(0, 12)
  }
}

/**
 * Return the bounded, UI-safe portion of a profile.  Raw text hashes,
 * fingerprints and records stay in Main and are never exposed over IPC.
 */
export function voiceMeasurementProfileSummary(profile: VoiceMeasurementProfile | undefined): {
  profileKey?: string
  provider?: string
  model?: string
  voice?: string
  locale?: string
  status: VoiceMeasurementStatus
  metric: VoiceMeasurementProfile['metric']
  eligibleSampleCount: number
  uniqueTextSampleCount: number
  rateP10: number | null
  rateMedian: number | null
  rateP90: number | null
  uncertaintyReasons: string[]
  updatedAtUtc: string | null
} {
  if (!profile) {
    return {
      status: 'cold',
      metric: 'estimated-spoken-units-per-second',
      eligibleSampleCount: 0,
      uniqueTextSampleCount: 0,
      rateP10: null,
      rateMedian: null,
      rateP90: null,
      uncertaintyReasons: [],
      updatedAtUtc: null
    }
  }
  return {
    profileKey: profile.profileKey,
    provider: profile.provider,
    model: profile.model,
    voice: profile.voice,
    locale: profile.locale,
    status: profile.status,
    metric: profile.metric,
    eligibleSampleCount: profile.eligibleSampleCount,
    uniqueTextSampleCount: profile.uniqueTextSampleCount,
    rateP10: profile.rateP10,
    rateMedian: profile.rateMedian,
    rateP90: profile.rateP90,
    uncertaintyReasons: [...profile.uncertaintyReasons].slice(0, 16),
    updatedAtUtc: profile.updatedAtUtc
  }
}
