import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DEFAULT_THRESHOLD = 1.25
const DEFAULT_RESAMPLES = 10_000
const DEFAULT_SEED = 0x5eed2026

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requirePositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid-${name}`)
  return value
}

function normalizeOptions(options = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const resamples = options.resamples ?? DEFAULT_RESAMPLES
  const seed = options.seed ?? DEFAULT_SEED
  requirePositiveFinite(threshold, 'threshold')
  if (!Number.isSafeInteger(resamples) || resamples <= 0) throw new Error('invalid-resamples')
  if (!Number.isSafeInteger(seed)) throw new Error('invalid-seed')
  return { threshold, resamples, seed: seed >>> 0 }
}

/**
 * A failed or invalid-audio unit is deliberately retained in `total`. It cannot
 * look like a first-pass fit merely because a run did not produce a WAV.
 */
export function firstPassFit(units, threshold) {
  requirePositiveFinite(threshold, 'threshold')
  if (!Array.isArray(units)) throw new Error('invalid-units')
  if (units.length === 0) return { fit: 0, total: 0, rate: null }
  const fit = units.filter((unit) => isRecord(unit)
    && unit.status === 'measured'
    && Number.isFinite(unit.naturalSeconds) && unit.naturalSeconds > 0
    && Number.isFinite(unit.windowSeconds) && unit.windowSeconds > 0
    && unit.naturalSeconds <= unit.windowSeconds * threshold).length
  return { fit, total: units.length, rate: fit / units.length }
}

function requireVideoPair(value, seen) {
  if (!isRecord(value)) throw new Error('invalid-video-pair')
  const videoId = typeof value.videoId === 'string' ? value.videoId.trim() : ''
  if (!videoId) throw new Error('invalid-video-id')
  if (seen.has(videoId)) throw new Error('duplicate-video-id')
  if (!Array.isArray(value.baseline) || !Array.isArray(value.candidate)) throw new Error('invalid-video-arms')
  if (value.baseline.length === 0 || value.candidate.length === 0) throw new Error('empty-video-arm')
  seen.add(videoId)
  return { videoId, baseline: value.baseline, candidate: value.candidate }
}

function aggregate(pairs, arm, threshold) {
  let fit = 0
  let total = 0
  for (const pair of pairs) {
    const result = firstPassFit(pair[arm], threshold)
    fit += result.fit
    total += result.total
  }
  return { fit, total, rate: total === 0 ? null : fit / total }
}

function differenceFor(pairs, threshold) {
  const baseline = aggregate(pairs, 'baseline', threshold)
  const candidate = aggregate(pairs, 'candidate', threshold)
  return baseline.rate === null || candidate.rate === null ? null : candidate.rate - baseline.rate
}

function seededRandom(seed) {
  let state = seed || DEFAULT_SEED
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function quantile(sorted, probability) {
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

/**
 * Compare arms by resampling entire videos, never individual cues. This keeps
 * the paired video relationship and avoids treating correlated cues as extra
 * independent samples. It is pure: no provider, TTS, or file operation occurs.
 */
export function pairedFirstPassFitBootstrap(videos, options = {}) {
  if (!Array.isArray(videos)) throw new Error('invalid-videos')
  const { threshold, resamples, seed } = normalizeOptions(options)
  if (videos.length === 0) {
    return {
      threshold,
      videos: 0,
      baseline: { fit: 0, total: 0, rate: null },
      candidate: { fit: 0, total: 0, rate: null },
      difference: null,
      interval95: null,
      resamples: 0,
      seed,
      outcome: 'inconclusive'
    }
  }
  const seen = new Set()
  const pairs = videos.map((video) => requireVideoPair(video, seen))
  const baseline = aggregate(pairs, 'baseline', threshold)
  const candidate = aggregate(pairs, 'candidate', threshold)
  const difference = differenceFor(pairs, threshold)
  const random = seededRandom(seed)
  const samples = []
  for (let iteration = 0; iteration < resamples; iteration++) {
    const sampledVideos = Array.from({ length: pairs.length }, () => pairs[Math.floor(random() * pairs.length)])
    const sampledDifference = differenceFor(sampledVideos, threshold)
    if (sampledDifference !== null) samples.push(sampledDifference)
  }
  samples.sort((left, right) => left - right)
  return {
    threshold,
    videos: pairs.length,
    baseline,
    candidate,
    difference,
    interval95: samples.length === 0 ? null : [quantile(samples, 0.025), quantile(samples, 0.975)],
    resamples: samples.length,
    seed,
    outcome: difference === null ? 'inconclusive' : 'measured'
  }
}

export async function evaluateVietnameseDubbingManifest(inputPath, options = {}) {
  const absolutePath = resolve(inputPath)
  const raw = await readFile(absolutePath, 'utf8')
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    throw new Error('invalid-manifest-json')
  }
  if (!isRecord(manifest) || manifest.schemaVersion !== 1 || !Array.isArray(manifest.videos)) {
    throw new Error('invalid-manifest-schema')
  }
  return pairedFirstPassFitBootstrap(manifest.videos, options)
}

function parseCliArguments(args) {
  let inputPath
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    const value = args[index + 1]
    if (argument === '--input') {
      inputPath = value
      index++
    } else if (argument === '--threshold') {
      options.threshold = Number(value)
      index++
    } else if (argument === '--resamples') {
      options.resamples = Number(value)
      index++
    } else if (argument === '--seed') {
      options.seed = Number(value)
      index++
    } else {
      throw new Error(`unknown-argument:${argument}`)
    }
  }
  if (!inputPath) throw new Error('usage: node scripts/evaluate-vietnamese-dubbing.mjs --input <manifest.json> [--threshold 1.25] [--resamples 10000] [--seed 1592629286]')
  return { inputPath, options }
}

async function runCli() {
  try {
    const { inputPath, options } = parseCliArguments(process.argv.slice(2))
    const report = await evaluateVietnameseDubbingManifest(inputPath, options)
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`Vietnamese dubbing evaluation failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (/(?:^|[\\/])evaluate-vietnamese-dubbing\.mjs$/iu.test(process.argv[1] || '')) {
  void runCli()
}
