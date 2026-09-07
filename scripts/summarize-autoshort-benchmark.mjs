import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function usage() {
  return 'Usage: node scripts/summarize-autoshort-benchmark.mjs --input <jsonl> --output <json>'
}

function parseArgs(argv) {
  const values = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--input' || arg === '--output') {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error(usage())
      values[arg.slice(2)] = value
    } else {
      throw new Error(usage())
    }
  }
  if (!values.input || !values.output) throw new Error(usage())
  return values
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function validRecord(value) {
  return value && value.schemaVersion === 1 &&
    typeof value.caseId === 'string' && typeof value.variant === 'string' &&
    (value.mode === 'replay' || value.mode === 'live') && typeof value.runId === 'string' &&
    (!value.workload || ['fixed-output-replay', 'live-single', 'live-batch'].includes(value.workload)) &&
    finite(value.e2eMs) && value.stageActiveMs && typeof value.stageActiveMs === 'object' &&
    value.stageWaitMs && typeof value.stageWaitMs === 'object' && finite(value.peakScratchBytes) &&
    (value.peakRamBytes === null || finite(value.peakRamBytes)) &&
    (value.peakVramBytes === null || finite(value.peakVramBytes)) &&
    ['pass', 'fail', 'unverified'].includes(value.quality) &&
    (!value.cacheState || ['cold', 'warm', 'cache-hit', 'unknown'].includes(value.cacheState))
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index]
}

function sumStage(records, field) {
  const totals = {}
  for (const record of records) {
    for (const [stage, value] of Object.entries(record[field] || {})) {
      if (!finite(value)) continue
      totals[stage] = (totals[stage] || 0) + value
    }
  }
  return Object.fromEntries(Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const inputPath = resolve(args.input)
  const outputPath = resolve(args.output)
  const inputStat = await stat(inputPath)
  if (!inputStat.isFile() || inputStat.size <= 0) throw new Error('Benchmark input phải là file có dữ liệu.')
  const lines = (await readFile(inputPath, 'utf8')).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  const records = lines.map((line, index) => {
    let value
    try { value = JSON.parse(line) } catch { throw new Error(`Benchmark record ${index + 1} không phải JSON hợp lệ.`) }
    if (!validRecord(value)) throw new Error(`Benchmark record ${index + 1} không đúng schema v1.`)
    return value
  })
  if (!records.length) throw new Error('Benchmark input không có record.')
  const e2e = records.map((record) => record.e2eMs)
  const qualityCounts = { pass: 0, fail: 0, unverified: 0 }
  const modeCounts = { replay: 0, live: 0 }
  const workloadCounts = { 'fixed-output-replay': 0, 'live-single': 0, 'live-batch': 0 }
  const cacheStateCounts = { cold: 0, warm: 0, 'cache-hit': 0, unknown: 0 }
  let requestCount = 0
  let retryCount = 0
  let requestBytes = 0
  for (const record of records) {
    qualityCounts[record.quality] += 1
    modeCounts[record.mode] += 1
    const workload = record.workload || (record.mode === 'replay' ? 'fixed-output-replay' : 'live-single')
    workloadCounts[workload] += 1
    const cacheState = record.cacheState || 'unknown'
    cacheStateCounts[cacheState] += 1
    if (finite(record.requestCount)) requestCount += record.requestCount
    if (finite(record.retryCount)) retryCount += record.retryCount
    if (finite(record.requestBytes)) requestBytes += record.requestBytes
  }
  const summary = {
    schemaVersion: 1,
    count: records.length,
    qualityCounts,
    modeCounts,
    workloadCounts,
    cacheStateCounts,
    requestCount,
    retryCount,
    requestBytes,
    e2eMs: {
      min: Math.min(...e2e),
      p50: percentile(e2e, 0.5),
      p95: percentile(e2e, 0.95),
      max: Math.max(...e2e)
    },
    stageActiveMs: sumStage(records, 'stageActiveMs'),
    stageWaitMs: sumStage(records, 'stageWaitMs'),
    peakScratchBytes: Math.max(...records.map((record) => record.peakScratchBytes)),
    peakRamBytes: records.some((record) => record.peakRamBytes !== null)
      ? Math.max(...records.filter((record) => record.peakRamBytes !== null).map((record) => record.peakRamBytes))
      : null,
    peakVramBytes: records.some((record) => record.peakVramBytes !== null)
      ? Math.max(...records.filter((record) => record.peakVramBytes !== null).map((record) => record.peakVramBytes))
      : null
  }
  await mkdir(dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  await rename(temporary, outputPath)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
