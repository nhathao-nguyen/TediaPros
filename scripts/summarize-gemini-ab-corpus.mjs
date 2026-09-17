import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DEFAULT_RESAMPLES = 10_000
const DEFAULT_SEED = 0x5eed2026

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0
}

function armFit(arm, thresholdKey) {
  const fit = arm?.estimatedFit?.[thresholdKey]
  const total = arm?.estimatedFit?.cueCount ?? arm?.cueCount ?? 0
  return { fit: Number.isFinite(fit) ? Math.max(0, fit) : 0, total: Number.isFinite(total) ? Math.max(0, total) : 0 }
}

function armMeasuredFit(arm, thresholdKey) {
  const cueCount = Number.isFinite(arm?.cueCount) ? Math.max(0, arm.cueCount) : 0
  const translatedCueCount = Number.isFinite(arm?.translatedCueCount) ? Math.max(0, arm.translatedCueCount) : 0
  if (cueCount === 0 || translatedCueCount !== cueCount) return { fit: 0, total: 0 }
  return armFit(arm, thresholdKey)
}

function addCounts(target, value) {
  target.fit += value.fit
  target.total += value.total
}

function seededRandom(seed) {
  let state = seed >>> 0 || DEFAULT_SEED
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
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function pairedBootstrap(pairs, key, resamples, seed) {
  const usable = pairs.filter((pair) => pair.baseline[key].total > 0 && pair.candidate[key].total > 0)
  if (usable.length === 0) return { videos: 0, difference: null, interval95: null, resamples: 0, seed }
  const rate = (value) => value.total > 0 ? value.fit / value.total : null
  const aggregate = (items, arm) => items.reduce((sum, pair) => {
    sum.fit += pair[arm][key].fit
    sum.total += pair[arm][key].total
    return sum
  }, { fit: 0, total: 0 })
  const baseline = aggregate(usable, 'baseline')
  const candidate = aggregate(usable, 'candidate')
  const difference = rate(candidate) - rate(baseline)
  const random = seededRandom(seed)
  const samples = []
  for (let index = 0; index < resamples; index++) {
    const sampled = Array.from({ length: usable.length }, () => usable[Math.floor(random() * usable.length)])
    const sampledBaseline = aggregate(sampled, 'baseline')
    const sampledCandidate = aggregate(sampled, 'candidate')
    samples.push(rate(sampledCandidate) - rate(sampledBaseline))
  }
  samples.sort((left, right) => left - right)
  return {
    videos: usable.length,
    baseline: { ...baseline, rate: rate(baseline) },
    candidate: { ...candidate, rate: rate(candidate) },
    difference,
    interval95: [quantile(samples, 0.025), quantile(samples, 0.975)],
    resamples: samples.length,
    seed
  }
}

async function main() {
  const inputPath = resolve(arg('--input') || '.ai/tasks/2026-09-16-voice-aware-live-validation/full-64/ab/ab-report.json')
  const outputPath = resolve(arg('--output') || '.ai/tasks/2026-09-16-voice-aware-live-validation/full-64/ab/ab-summary.json')
  const resamples = Number(arg('--resamples') || DEFAULT_RESAMPLES)
  const seed = Number(arg('--seed') || DEFAULT_SEED) >>> 0
  if (!Number.isSafeInteger(resamples) || resamples <= 0) throw new Error('invalid-resamples')
  const report = JSON.parse(await readFile(inputPath, 'utf8'))
  const videos = Array.isArray(report.videos) ? report.videos : []
  const expected = Number.isSafeInteger(report.sourceVideoCount) ? report.sourceVideoCount : videos.length
  const byIndex = new Map(videos.map((video) => [video.index, video]))
  const thresholds = [
    ['fitAt1_10', 'fitAt1_10'],
    ['fitAt1_25', 'fitAt1_25'],
    ['fitAt1_80', 'fitAt1_80']
  ]
  const aggregate = Object.fromEntries(thresholds.map(([key]) => [key, { baseline: { fit: 0, total: 0 }, candidate: { fit: 0, total: 0 } }]))
  const issueCodeCounts = { baseline: {}, candidate: {} }
  const statusCounts = { baseline: {}, candidate: {} }
  const pairs = []
  const rows = []
  for (let index = 0; index < expected; index++) {
    const video = byIndex.get(index)
    const arms = video?.arms || {}
    const row = { index, sourcePath: video?.sourcePath || null, baseline: {}, candidate: {} }
    for (const [armName, armKey] of [['baseline', 'a-baseline'], ['candidate', 'b-voice-hint']]) {
      const arm = arms[armKey]
      const status = arm?.status || 'missing'
      statusCounts[armName][status] = (statusCounts[armName][status] || 0) + 1
      for (const code of arm?.issueCodes || []) issueCodeCounts[armName][code] = (issueCodeCounts[armName][code] || 0) + 1
      row[armName] = {
        status,
        disposition: arm?.disposition || null,
        cueCount: arm?.cueCount || 0,
        translatedCueCount: arm?.translatedCueCount || 0,
        issueCodes: arm?.issueCodes || [],
        estimatedFit: Object.fromEntries(thresholds.map(([key]) => [key, armFit(arm, key)])),
        measuredFit: Object.fromEntries(thresholds.map(([key]) => [key, armMeasuredFit(arm, key)])),
        fitEligibility: arm ? {
          completeTranslation: Number.isFinite(arm.cueCount) && Number.isFinite(arm.translatedCueCount) && arm.cueCount > 0 && arm.translatedCueCount === arm.cueCount
        } : { completeTranslation: false },
        semanticReview: arm?.semanticReview || 'missing'
      }
      for (const [key] of thresholds) addCounts(aggregate[key][armName], armMeasuredFit(arm, key))
    }
    rows.push(row)
    if (video?.arms?.['a-baseline'] && video?.arms?.['b-voice-hint']) {
      pairs.push({
        baseline: Object.fromEntries(thresholds.map(([key]) => [key, armMeasuredFit(video.arms['a-baseline'], key)])),
        candidate: Object.fromEntries(thresholds.map(([key]) => [key, armMeasuredFit(video.arms['b-voice-hint'], key)]))
      })
    }
  }
  const rates = (counts) => ({ ...counts, rate: counts.total > 0 ? counts.fit / counts.total : null })
  const paired = Object.fromEntries(thresholds.map(([key]) => [key, pairedBootstrap(pairs, key, resamples, seed)]))
  const doneVideos = rows.filter((row) => row.baseline.status === 'done' && row.candidate.status === 'done').length
  const measuredArmCounts = {
    baseline: rows.filter((row) => row.baseline.fitEligibility?.completeTranslation).length,
    candidate: rows.filter((row) => row.candidate.fitEligibility?.completeTranslation).length
  }
  const summary = {
    schemaVersion: 1,
    kind: 'tediapros-gemini-ab-corpus-summary',
    sourceReport: inputPath,
    generatedAtUtc: new Date().toISOString(),
    sourceVideoCount: expected,
    recordedVideoCount: videos.length,
    missingVideoCount: Math.max(0, expected - videos.length),
    doneVideoCount: doneVideos,
    measuredArmCounts,
    statusCounts,
    issueCodeCounts,
    aggregate: Object.fromEntries(thresholds.map(([key]) => [key, { baseline: rates(aggregate[key].baseline), candidate: rates(aggregate[key].candidate) }])),
    pairedBootstrap: paired,
    evidence: {
      timing: 'proxy-estimate-from-live-edge-tts-profile; not measured translated WAV',
      semantic: 'provider assessment only; human semantic review remains pending',
      voiceProfile: report.voiceHint || null,
      outputContract: report.arms || null,
      outcome: doneVideos === expected && expected > 0 ? 'measured-with-human-review-pending' : 'incomplete-or-inconclusive'
    },
    videos: rows
  }
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  process.stdout.write(JSON.stringify({ outputPath, sourceVideoCount: expected, recordedVideoCount: videos.length, doneVideoCount: doneVideos, missingVideoCount: summary.missingVideoCount }))
}

void main().catch((error) => {
  process.stderr.write(`A/B summary failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
