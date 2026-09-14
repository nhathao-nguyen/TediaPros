const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const metrics = require('./metrics.json')
const failures = metrics.items.filter(
  item => item.jobId === metrics.jobId && item.category === 'ocr-sttn-gap'
)
const cacheRoot = path.join(process.env.APPDATA, 'tedia-pros/autoshort-artifact-cache-v1/visual-ocr')
const outputRoot = path.resolve('tests/fixtures/ocr-stabilized-gap')
fs.mkdirSync(outputRoot, { recursive: true })
const cases = []

for (const entry of fs.readdirSync(cacheRoot)) {
  const artifactPath = path.join(cacheRoot, entry, 'artifact.bin')
  if (!fs.existsSync(artifactPath)) continue
  const bytes = fs.readFileSync(artifactPath)
  const artifact = JSON.parse(bytes.toString('utf8'))
  const timeline = artifact.timeline
  if (!timeline?.segments) continue
  const observed = failures.find(item => timeline.segments.some(
    segment => segment.id.startsWith('gap-') && item.error.includes(segment.id)
  ))
  if (!observed || cases.some(item => item.itemId === observed.itemId)) continue
  const gapIndex = timeline.segments.findIndex(
    segment => segment.id.startsWith('gap-') && observed.error.includes(segment.id)
  )
  assert.ok(gapIndex > 0 && gapIndex < timeline.segments.length - 1)
  const fixture = {
    sourceArtifactSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    expected: { ...timeline.video, scanRegion: timeline.scanRegion },
    timeline: { ...timeline, segments: timeline.segments.slice(gapIndex - 1, gapIndex + 2) }
  }
  const file = `case-${String(cases.length + 1).padStart(2, '0')}.json`
  fs.writeFileSync(path.join(outputRoot, file), JSON.stringify(fixture, null, 2))
  cases.push({ itemId: observed.itemId, file, gapId: timeline.segments[gapIndex].id })
}

assert.equal(cases.length, 13)
fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify({ schemaVersion: 1, cases }, null, 2))
console.log(JSON.stringify({ result: 'PASS', cases: cases.length, outputRoot }, null, 2))
