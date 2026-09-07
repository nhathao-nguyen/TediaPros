import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildBenchmarkV1,
  calculateCriticalPathMs,
  redactBenchmarkRecord,
  type BenchmarkStageInterval
} from '../scripts/autoshort-benchmark-main'

test('benchmark critical path measures overlapped stages once instead of summing active time', () => {
  const intervals: BenchmarkStageInterval[] = [
    { stage: 'asr', startMs: 0, endMs: 100 },
    { stage: 'visual_ocr', startMs: 20, endMs: 80 }
  ]
  assert.equal(calculateCriticalPathMs(intervals), 100)
})

test('benchmark record is schema bounded and redacts credentials/reference text', () => {
  const record = buildBenchmarkV1({
    caseId: 'case-1',
    variant: 'prefetch-on',
    mode: 'replay',
    sourceHash: 'A'.repeat(64),
    configHash: 'B'.repeat(64),
    runtimeHash: 'C'.repeat(64),
    cacheState: 'warm',
    requestedProvider: 'cuda',
    effectiveProvider: 'cpu',
    requestCount: 2,
    retryCount: 1,
    requestBytes: 256,
    runId: 'run-1',
    e2eMs: 100,
    stageActiveMs: { asr: 100 },
    stageWaitMs: { asr: 0 },
    peakRamBytes: null,
    peakVramBytes: null,
    peakScratchBytes: 32,
    quality: 'pass',
    metadata: {
      endpoint: 'http://user:password@127.0.0.1:8000',
      referenceTranscript: 'private words that must not be persisted'
    }
  })
  assert.equal(record.schemaVersion, 1)
  assert.equal(record.peakVramBytes, null)
  assert.equal(record.workload, 'fixed-output-replay')
  assert.equal(record.cacheState, 'warm')
  assert.equal(record.requestCount, 2)
  const safe = JSON.stringify(redactBenchmarkRecord(record))
  assert.doesNotMatch(safe, /password|private words|user:/iu)
  assert.match(safe, /localhost|internal-lan/iu)

  const unsafe = { ...record, endpointAlias: 'https://user:password@private.example/api' }
  assert.doesNotMatch(JSON.stringify(redactBenchmarkRecord(unsafe)), /password|user:/iu)
})

test('benchmark summarizer requires explicit files and writes a redacted aggregate atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-benchmark-summary-'))
  try {
    const input = join(root, 'runs.jsonl')
    const output = join(root, 'summary.json')
    await writeFile(input, [
      JSON.stringify(buildBenchmarkV1({
        caseId: 'a', variant: 'off', mode: 'replay', runId: '1', e2eMs: 100,
        stageActiveMs: { asr: 100 }, stageWaitMs: {}, peakRamBytes: null,
        peakVramBytes: null, peakScratchBytes: 10, quality: 'pass'
      })),
      JSON.stringify(buildBenchmarkV1({
        caseId: 'a', variant: 'on', mode: 'replay', runId: '2', e2eMs: 80,
        stageActiveMs: { asr: 60, visual_ocr: 40 }, stageWaitMs: {}, peakRamBytes: null,
        peakVramBytes: null, peakScratchBytes: 8, quality: 'unverified'
      }))
    ].join('\n'), 'utf8')
    const missing = spawnSync(process.execPath, ['scripts/summarize-autoshort-benchmark.mjs'], { encoding: 'utf8' })
    assert.notEqual(missing.status, 0)
    const completed = spawnSync(process.execPath, ['scripts/summarize-autoshort-benchmark.mjs', '--input', input, '--output', output], { encoding: 'utf8' })
    assert.equal(completed.status, 0, completed.stderr)
    const summary = JSON.parse(await readFile(output, 'utf8'))
    assert.equal(summary.schemaVersion, 1)
    assert.equal(summary.count, 2)
    assert.deepEqual(summary.qualityCounts, { pass: 1, fail: 0, unverified: 1 })
    assert.equal(summary.e2eMs.min, 80)
    assert.equal(summary.e2eMs.max, 100)
    assert.deepEqual(summary.workloadCounts, { 'fixed-output-replay': 2, 'live-single': 0, 'live-batch': 0 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
