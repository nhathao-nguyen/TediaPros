import { createHash } from 'node:crypto'

export interface DurationFeatures {
  graphemes: number
  words: number
  numerals: number
  abbreviations: number
  pauses: number
}

export interface DurationEstimate {
  seconds: number
  uncertaintySeconds: number
  confidence: number
}

export interface DurationProfile {
  version: 2
  samples: number
  weights: [number, number, number, number, number, number]
  residualP90: number
}

export interface DurationProfileKeyInput {
  endpoint?: string
  model?: string
  voice?: string
  language?: string
  options?: unknown
  referenceAudio?: unknown
}

interface DurationSample {
  features: DurationFeatures
  seconds: number
}

const FEATURE_COUNT = 6
const MIN_DURATION_SECONDS = 0.15
const DEFAULT_RESIDUAL_SECONDS = 0.75

function segmentGraphemes(text: string, locale?: string): string[] {
  if (!text) return []
  try {
    const Segmenter = Intl.Segmenter
    const segmenter = new Segmenter(locale || undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), (part) => part.segment)
  } catch {
    return Array.from(text)
  }
}

function segmentWords(text: string, locale?: string): string[] {
  if (!text) return []
  try {
    const Segmenter = Intl.Segmenter
    const segmenter = new Segmenter(locale || undefined, { granularity: 'word' })
    return Array.from(segmenter.segment(text))
      .filter((part) => part.isWordLike)
      .map((part) => part.segment)
  } catch {
    return text.split(/\s+/u).filter(Boolean)
  }
}

export function extractDurationFeatures(text: string, locale?: string): DurationFeatures {
  const value = text.trim()
  return {
    graphemes: segmentGraphemes(value.replace(/\s+/gu, ''), locale).length,
    words: segmentWords(value, locale).length,
    numerals: (value.match(/[\p{N}]/gu) || []).length,
    abbreviations: (value.match(/\b(?:[A-Za-zÀ-ỹ]\.){2,}|\b[A-Z]{2,}\b/gu) || []).length,
    pauses: (value.match(/[,;:!?。！？…—-]/gu) || []).length
  }
}

function featureVector(features: DurationFeatures): number[] {
  return [1, features.graphemes, features.words, features.numerals, features.abbreviations, features.pauses]
}

function solveLinearSystem(matrix: number[][], values: number[]): number[] {
  const size = values.length
  const augmented = matrix.map((row, rowIndex) => [...row, values[rowIndex]])
  for (let column = 0; column < size; column++) {
    let pivot = column
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row
    }
    if (Math.abs(augmented[pivot][column]) < 1e-9) continue
    if (pivot !== column) [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]]
    const divisor = augmented[column][column]
    for (let index = column; index <= size; index++) augmented[column][index] /= divisor
    for (let row = 0; row < size; row++) {
      if (row === column) continue
      const factor = augmented[row][column]
      if (Math.abs(factor) < 1e-12) continue
      for (let index = column; index <= size; index++) augmented[row][index] -= factor * augmented[column][index]
    }
  }
  return augmented.map((row) => Number.isFinite(row[size]) ? row[size] : 0)
}

function ridgeFit(
  samples: readonly DurationSample[],
  regularization = 0.25,
  priorWeights?: readonly number[],
  priorStrength = 0
): DurationProfile['weights'] {
  const normal = Array.from({ length: FEATURE_COUNT }, () => Array<number>(FEATURE_COUNT).fill(0))
  const rightHandSide = Array<number>(FEATURE_COUNT).fill(0)
  for (const sample of samples) {
    const vector = featureVector(sample.features)
    for (let row = 0; row < FEATURE_COUNT; row++) {
      rightHandSide[row] += vector[row] * sample.seconds
      for (let column = 0; column < FEATURE_COUNT; column++) normal[row][column] += vector[row] * vector[column]
    }
  }
  for (let index = 1; index < FEATURE_COUNT; index++) normal[index][index] += regularization
  if (priorWeights && priorWeights.length === FEATURE_COUNT && priorStrength > 0) {
    for (let index = 0; index < FEATURE_COUNT; index++) {
      normal[index][index] += priorStrength
      rightHandSide[index] += priorStrength * (priorWeights[index] || 0)
    }
  }
  const solved = solveLinearSystem(normal, rightHandSide)
  return solved.map((weight) => Math.max(0, Number.isFinite(weight) ? weight : 0)) as DurationProfile['weights']
}

function predictWithWeights(features: DurationFeatures, weights: readonly number[]): number {
  const predicted = featureVector(features).reduce((sum, value, index) => sum + value * (weights[index] || 0), 0)
  return Math.max(MIN_DURATION_SECONDS, Number.isFinite(predicted) ? predicted : MIN_DURATION_SECONDS)
}

function percentile90(values: readonly number[]): number {
  if (values.length === 0) return DEFAULT_RESIDUAL_SECONDS
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)] || 0
}

function stableValue(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`
}

export function durationProfileKey(input: DurationProfileKeyInput): string {
  return createHash('sha256').update(stableValue({
    version: 2,
    endpoint: input.endpoint?.trim() || '',
    model: input.model?.trim() || '',
    voice: input.voice?.trim() || '',
    language: input.language?.trim().toLowerCase() || '',
    options: input.options || {},
    referenceAudio: input.referenceAudio || null
  })).digest('hex')
}

export function selectBootstrapCues<T extends { id?: string; text: string }>(cues: readonly T[], max = 3): T[] {
  const limit = Math.max(0, Math.min(3, Math.floor(max)))
  if (limit === 0 || cues.length === 0) return []
  if (cues.length <= limit) return [...cues]
  const ranked = cues
    .map((cue, index) => ({ cue, index, length: extractDurationFeatures(cue.text).graphemes }))
    .sort((left, right) => left.length - right.length || left.index - right.index)
  const selectedIndexes = new Set<number>()
  for (let index = 0; index < limit; index++) {
    const rank = limit === 1 ? 0 : Math.round(index * (ranked.length - 1) / (limit - 1))
    selectedIndexes.add(ranked[rank].index)
  }
  return [...selectedIndexes].sort((left, right) => left - right).map((index) => cues[index])
}

export interface DurationPredictor {
  readonly profile: DurationProfile
  addSample(text: string, seconds: number, locale?: string): void
  estimate(text: string, options?: { locale?: string; sourceText?: string; sourceDuration?: number; speed?: number }): DurationEstimate
}

export function createDurationPredictor(initialProfile?: Partial<DurationProfile>): DurationPredictor {
  const samples: DurationSample[] = []
  const initialSampleCount = Math.max(0, Math.floor(initialProfile?.samples || 0))
  const profile: DurationProfile = {
    version: 2,
    samples: initialSampleCount,
    weights: initialProfile?.weights && initialProfile.weights.length === FEATURE_COUNT
      ? initialProfile.weights.map((weight) => Math.max(0, Number(weight) || 0)) as DurationProfile['weights']
      : [0.2, 0.045, 0.18, 0.02, 0.04, 0.12],
    residualP90: Math.max(0, initialProfile?.residualP90 || DEFAULT_RESIDUAL_SECONDS)
  }

  const refreshProfile = (): void => {
    if (samples.length === 0) return
    profile.samples = initialSampleCount + samples.length
    profile.weights = ridgeFit(samples, 0.25, initialProfile?.weights, initialSampleCount > 0 ? Math.min(12, initialSampleCount) : 0)
    const residuals = samples.map((sample) => Math.abs(sample.seconds - predictWithWeights(sample.features, profile.weights)))
    profile.residualP90 = Number(Math.max(0.08, percentile90(residuals)).toFixed(3))
  }

  return {
    profile,
    addSample(text, seconds, locale) {
      if (!(seconds > 0) || !Number.isFinite(seconds)) return
      samples.push({ features: extractDurationFeatures(text, locale), seconds })
      refreshProfile()
    },
    estimate(text, options = {}) {
      const speed = options.speed && options.speed > 0 ? options.speed : 1
      const seconds = predictWithWeights(extractDurationFeatures(text, options.locale), profile.weights) / speed
      const uncertainty = profile.samples >= 3
        ? profile.residualP90 / speed
        : Math.max(0.35, seconds * 0.3)
      return {
        seconds: Number(Math.max(MIN_DURATION_SECONDS, seconds).toFixed(3)),
        uncertaintySeconds: Number(uncertainty.toFixed(3)),
        confidence: Number(Math.min(0.98, profile.samples / 12).toFixed(3))
      }
    }
  }
}
