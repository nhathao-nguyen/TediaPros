#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url))
const DEFAULT_MANIFEST = resolve(SCRIPT_DIR, '../tests/fixtures/translation-multilingual/cases.json')

function usage() {
  return [
    'Usage: node scripts/translation-qualification-main.mjs [options]',
    '',
    '  --mode offline|live       Qualification mode (default: offline)',
    '  --manifest <absolute>     JSON case manifest',
    '  --output <absolute-dir>   Write translation-qualification-report.json',
    '  --variant baseline|candidate',
    '  --runs <1..10>            Repetitions per case (default: 1)',
    '  --dry-run                 Print bounded plan; never call a provider',
    '  --help'
  ].join('\n')
}

export function parseQualificationArgs(argv = process.argv.slice(2)) {
  const args = {
    mode: 'offline',
    manifest: DEFAULT_MANIFEST,
    output: null,
    variant: 'candidate',
    runs: 1,
    dryRun: false,
    explicitLive: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') return { ...args, help: true }
    if (flag === '--dry-run') {
      args.dryRun = true
      continue
    }
    if (flag === '--mode' || flag === '--manifest' || flag === '--output' || flag === '--variant' || flag === '--runs') {
      const value = argv[++i]
      if (!value) throw new Error(`${flag} requires a value.`)
      if (flag === '--mode') {
        args.mode = value
        args.explicitLive = value === 'live'
      } else if (flag === '--manifest') args.manifest = value
      else if (flag === '--output') args.output = value
      else if (flag === '--variant') args.variant = value
      else args.runs = Number(value)
      continue
    }
    throw new Error(`Unknown option: ${flag}`)
  }
  if (args.mode !== 'offline' && args.mode !== 'live') throw new Error('--mode must be offline or live.')
  if (!['baseline', 'candidate'].includes(args.variant)) throw new Error('--variant must be baseline or candidate.')
  if (!Number.isInteger(args.runs) || args.runs < 1 || args.runs > 10) throw new Error('--runs must be an integer from 1 to 10.')
  if (!isAbsolute(args.manifest)) throw new Error('--manifest must be an absolute path.')
  if (args.output !== null && !isAbsolute(args.output)) throw new Error('--output must be an absolute directory.')
  if (args.mode === 'live' && !args.explicitLive) throw new Error('Live qualification requires an explicit --mode live flag.')
  return args
}

function digestCase(entry) {
  return createHash('sha256').update(JSON.stringify({ id: entry.id, sourceLocale: entry.sourceLocale, targetLocale: entry.targetLocale, source: entry.source })).digest('hex')
}

function validateCase(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Case ${index + 1} must be an object.`)
  for (const key of ['id', 'sourceLocale', 'targetLocale', 'source', 'reference']) {
    if (typeof entry[key] !== 'string' || entry[key].trim() === '') throw new Error(`Case ${index + 1} has an invalid ${key}.`)
  }
  if (!['valid', 'warning', 'needs-review'].includes(entry.expected)) throw new Error(`Case ${entry.id} has an invalid expected disposition.`)
  if (!Array.isArray(entry.tags) || entry.tags.some((tag) => typeof tag !== 'string')) throw new Error(`Case ${entry.id} has invalid tags.`)
  return {
    id: entry.id.trim(),
    sourceLocale: entry.sourceLocale.trim(),
    targetLocale: entry.targetLocale.trim(),
    source: entry.source,
    reference: entry.reference,
    expected: entry.expected,
    tags: [...entry.tags]
  }
}

export function buildOfflineQualificationReport(cases, options = {}) {
  const variant = options.variant || 'candidate'
  const runs = options.runs || 1
  const records = []
  for (const entry of cases) {
    for (let run = 1; run <= runs; run += 1) {
      const parserNeedsReview = entry.expected === 'needs-review'
      records.push({
        schemaVersion: 1,
        caseId: entry.id,
        variant,
        run,
        modelIdentity: 'offline-fixture',
        promptVersion: 'translation-v4',
        mode: 'offline',
        inputDigest: digestCase(entry),
        elapsedMs: 0,
        requests: 0,
        recoveryRequests: 0,
        lostCueCount: parserNeedsReview ? 1 : 0,
        unexpectedCueCount: 0,
        semanticReview: 'pending',
        naturalness: null
      })
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'offline',
    variant,
    runs,
    caseCount: cases.length,
    providerCalls: 0,
    semanticReview: 'pending',
    records
  }
}

export async function runOfflineQualification(manifestPath, options = {}) {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Qualification manifest must be a non-empty JSON array.')
  const cases = parsed.map(validateCase)
  return buildOfflineQualificationReport(cases, options)
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseQualificationArgs(argv)
  if (args.help) {
    process.stdout.write(`${usage()}\n`)
    return 0
  }
  if (args.mode === 'live') {
    throw new Error('Live qualification adapter is intentionally not bundled. Supply an approved provider adapter and cost preflight before running live.')
  }
  const report = await runOfflineQualification(args.manifest, { variant: args.variant, runs: args.runs })
  if (args.dryRun || !args.output) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: report.schemaVersion,
      mode: report.mode,
      variant: report.variant,
      runs: report.runs,
      caseCount: report.caseCount,
      providerCalls: report.providerCalls,
      semanticReview: report.semanticReview,
      records: report.records.map(({ caseId, variant, run, inputDigest }) => ({ caseId, variant, run, inputDigest }))
    }, null, 2)}\n`)
    return 0
  }
  await mkdir(args.output, { recursive: true })
  const outputPath = join(args.output, 'translation-qualification-report.json')
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`Wrote offline qualification report: ${outputPath}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
