const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')

const moduleContext = { exports: {} }
const compiled = esbuild.transformSync(
  fs.readFileSync('src/shared/ocrVisualTimeline.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }
).code
require('node:vm').runInNewContext(compiled, {
  module: moduleContext,
  exports: moduleContext.exports
})
const source = moduleContext.exports
const metrics = require('./metrics.json')
const observedFailures = metrics.items.filter(
  item => item.jobId === metrics.jobId && item.category === 'ocr-sttn-gap'
)
const cacheRoot = path.join(
  process.env.APPDATA,
  'tedia-pros/autoshort-artifact-cache-v1/visual-ocr'
)
const results = []

for (const entry of fs.readdirSync(cacheRoot)) {
  const artifactPath = path.join(cacheRoot, entry, 'artifact.bin')
  if (!fs.existsSync(artifactPath)) continue
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const timeline = artifact.timeline
  if (!timeline?.segments) continue
  const observed = observedFailures.find(item => timeline.segments.some(
    segment => segment.id.startsWith('gap-') && item.error.includes(segment.id)
  ))
  if (!observed) continue

  const expected = { ...timeline.video, scanRegion: timeline.scanRegion }
  const validated = source.validateStabilizedOcrVisualTimeline(timeline, expected)
  assert.equal(JSON.stringify(validated), JSON.stringify(timeline))
  results.push({
    itemId: observed.itemId,
    artifactPath,
    syntheticGapCount: timeline.segments.filter(segment => segment.id.startsWith('gap-')).length
  })
}

assert.equal(
  new Set(results.map(result => result.itemId)).size,
  13,
  'Every observed OCR/STTN gap failure must cross the repaired boundary'
)

const report = {
  result: 'PASS: all observed stabilized OCR artifacts cross the repaired STTN boundary',
  cases: results.length,
  results
}
fs.writeFileSync(path.join(__dirname, 'gap-fix-verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ result: report.result, cases: report.cases }, null, 2))
