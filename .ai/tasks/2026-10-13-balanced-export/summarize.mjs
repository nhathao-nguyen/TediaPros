import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const evidence = dirname(fileURLToPath(import.meta.url))
const cases = []
for (const name of ['motion', 'static', 'grain']) {
  const [measurement] = JSON.parse(await readFile(join(evidence, `pipeline-${name}.json`), 'utf8'))
  assert.equal(measurement.production.frames, 96)
  assert.ok(measurement.production.hasAudio && measurement.production.fullyDecoded)
  const baseline = measurement.renders.find(r => r.version === 'old' && r.encoder === 'nvenc')
  const balanced = measurement.renders.find(r => r.version === 'balanced' && r.encoder === (measurement.plan.encoderPreference === 'cpu' ? 'cpu' : 'nvenc'))
  assert.ok(balanced.ssim >= baseline.ssim - .005)
  cases.push({ name, policyPreference: measurement.plan.encoderPreference, baseline, balanced,
    selectedPathSizeReductionPct: 100 * (1 - balanced.bytes / baseline.bytes),
    selectedPathTimeChangePct: 100 * (balanced.medianMs / baseline.medianMs - 1), production: measurement.production })
}
const tests = await readFile(join(evidence, 'tests.log'), 'utf8')
const sum = key => [...tests.matchAll(new RegExp(`ℹ ${key} (\\d+)`, 'g'))].reduce((n, m) => n + Number(m[1]), 0)
const verification = { tests: sum('tests'), pass: sum('pass'), fail: sum('fail'), skipped: sum('skipped') }
assert.equal(verification.fail, 0)
assert.ok(verification.pass > 0)
const summary = { environment: { gpu: 'GTX 1660 SUPER', driver: '616.92', cpu: 'i5-11400F', ffmpeg: '9.0.2' },
  samples: 'Generated 720x1280 / 24 FPS / 4 s sources, real Nhiễu 2 textures, median of three timed renders per variant',
  baseline: 'Previously randomized GPU policy fixed to CQ23/GOP60; before still-frame hoisting. CPU baseline faster CRF21.',
  reference: 'Same post-effect graph encoded with x264 CRF0; not the clean source',
  verification, cases }
await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ verification, cases: cases.map(({ name, selectedPathSizeReductionPct, selectedPathTimeChangePct }) =>
  ({ name, selectedPathSizeReductionPct, selectedPathTimeChangePct })) }, null, 2))
