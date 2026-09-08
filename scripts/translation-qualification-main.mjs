#!/usr/bin/env node
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
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
    '  --matrix                  Add all directed pairs across the 16 UI locales (240 structural cases)',
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
    matrix: false,
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
    if (flag === '--matrix') {
      args.matrix = true
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

const UI_LOCALES = ['vi', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'ru', 'pt', 'ar', 'hi', 'th', 'id', 'ms']

/** Build structural directed-pair cases; semantic naturalness remains human review. */
export function expandDirectedLocaleMatrix(cases) {
  const result = []
  for (const sourceLocale of UI_LOCALES) {
    for (const targetLocale of UI_LOCALES) {
      if (sourceLocale === targetLocale) continue
      result.push({
        id: `matrix-${sourceLocale}-${targetLocale}`,
        sourceLocale,
        targetLocale,
        source: `Matrix source cue in ${sourceLocale}.`,
        reference: `Matrix target cue in ${targetLocale}.`,
        expected: 'valid',
        tags: ['directed-locale-pair', 'structural-only']
      })
    }
  }
  return [...cases, ...result]
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

async function loadOfflineHarness(scratch) {
  const entry = join(scratch, 'translation-qualification-harness.ts')
  const output = join(scratch, 'translation-qualification-harness.cjs')
  const source = `
    import { buildTranslationMessages } from ${JSON.stringify(resolve(SCRIPT_DIR, '../src/main/translation/prompts'))}
    import { translateWithAdapter } from ${JSON.stringify(resolve(SCRIPT_DIR, '../src/main/translation/orchestrator'))}

    export async function executeCase(entry, variant) {
      const format = variant === 'candidate' ? 'json-items' : 'id-lines'
      const input = {
        sourceLanguage: entry.sourceLocale,
        targetLocale: entry.targetLocale,
        mode: 'subtitle',
        cues: [{ id: 'c1', sourceIndex: 0, start: 0, end: 2, groupId: 'g1', text: entry.source }],
        contextBefore: [], contextAfter: [], glossary: []
      }
      let requests = 0
      let promptBytes = 0
      const adapter = {
        capability: {
          provider: 'fixture', modelIdentity: 'offline-fixture-' + variant,
          revisionKnown: true, format, contextTokens: 8192, outputTokens: 512
        },
        async requestOnce(batch) {
          requests += 1
          const messages = buildTranslationMessages(batch.input, format)
          promptBytes += new TextEncoder().encode(JSON.stringify(messages)).length
          if (entry.expected === 'needs-review') {
            return {
              raw: format === 'json-items'
                ? '{"items":[{"id":"c1","text":"First part"}]}\\ncontinuation was lost'
                : '[c1] First part\\ncontinuation was lost',
              truncated: false,
              modelIdentity: 'offline-fixture-' + variant
            }
          }
          return {
            raw: format === 'json-items'
              ? JSON.stringify({ items: [{ id: 'c1', text: entry.reference }] })
              : '[c1] ' + entry.reference,
            truncated: false,
            modelIdentity: 'offline-fixture-' + variant
          }
        }
      }
      const started = performance.now()
      const result = await translateWithAdapter(input, adapter, new AbortController().signal, { sleep: async () => {} })
      const elapsedMs = Math.max(0, Math.round(performance.now() - started))
      const expectedIds = new Set(input.cues.map((cue) => cue.id))
      const returnedIds = new Set(result.items.map((item) => item.id))
      const unexpectedCueCount = result.items.filter((item) => !expectedIds.has(item.id)).length
      const lostCueCount = [...expectedIds].filter((id) => !returnedIds.has(id)).length
      return {
        modelIdentity: result.modelIdentity,
        requests,
        recoveryRequests: Math.max(0, requests - 1),
        elapsedMs,
        lostCueCount,
        unexpectedCueCount,
        observedDisposition: result.assessment.disposition,
        issueCodes: result.assessment.issues.map((issue) => issue.code),
        promptBytes,
        wireFormat: format
      }
    }
  `
  await writeFile(entry, source, 'utf8')
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', target: 'node20', outfile: output })
  return await import(pathToFileURL(output).href + '?t=' + Date.now())
}

export async function buildOfflineQualificationReport(cases, options = {}, harness) {
  const variant = options.variant || 'candidate'
  const runs = options.runs || 1
  const records = []
  for (const entry of cases) {
    for (let run = 1; run <= runs; run += 1) {
      const measured = await harness.executeCase(entry, variant)
      records.push({
        schemaVersion: 2,
        caseId: entry.id,
        variant,
        run,
        modelIdentity: measured.modelIdentity,
        promptVersion: 'translation-v4',
        mode: 'offline',
        inputDigest: digestCase(entry),
        elapsedMs: measured.elapsedMs,
        requests: measured.requests,
        recoveryRequests: measured.recoveryRequests,
        lostCueCount: measured.lostCueCount,
        unexpectedCueCount: measured.unexpectedCueCount,
        expectedDisposition: entry.expected === 'valid' ? 'validated' : entry.expected === 'warning' ? 'with-warnings' : 'needs-review',
        observedDisposition: measured.observedDisposition,
        issueCodes: measured.issueCodes,
        promptBytes: measured.promptBytes,
        wireFormat: measured.wireFormat,
        semanticReview: 'pending',
        naturalness: null
      })
    }
  }
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: 'offline',
    variant,
    runs,
    caseCount: cases.length,
    providerCalls: records.reduce((sum, record) => sum + record.requests, 0),
    recoveryRequests: records.reduce((sum, record) => sum + record.recoveryRequests, 0),
    semanticReview: 'pending',
    records
  }
}

export async function runOfflineQualification(manifestPath, options = {}) {
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Qualification manifest must be a non-empty JSON array.')
  const baseCases = parsed.map(validateCase)
  const cases = options.matrix ? expandDirectedLocaleMatrix(baseCases) : baseCases
  const scratch = await mkdtemp(join(tmpdir(), 'tedia-translation-qualification-'))
  try {
    const harness = await loadOfflineHarness(scratch)
    return await buildOfflineQualificationReport(cases, options, harness)
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
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
  const report = await runOfflineQualification(args.manifest, { variant: args.variant, runs: args.runs, matrix: args.matrix })
  if (args.dryRun || !args.output) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: report.schemaVersion,
      mode: report.mode,
      variant: report.variant,
      runs: report.runs,
      caseCount: report.caseCount,
      providerCalls: report.providerCalls,
      recoveryRequests: report.recoveryRequests,
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
