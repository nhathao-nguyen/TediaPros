import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

test('offline qualification is explicit, bounded and redacts case text', () => {
  const root = mkdtempSync(join(process.env.TEMP || process.cwd(), 'tedia-qualification-'))
  try {
    const manifest = join(process.cwd(), 'tests', 'fixtures', 'translation-multilingual', 'cases.json')
    const script = join(process.cwd(), 'scripts', 'translation-qualification-main.mjs')
    const result = spawnSync(process.execPath, [script, '--mode', 'offline', '--manifest', manifest, '--output', root, '--variant', 'candidate', '--runs', '2'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const reportPath = join(root, 'translation-qualification-report.json')
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      mode: string
      caseCount: number
      providerCalls: number
      records: Array<Record<string, unknown>>
    }
    assert.equal(report.mode, 'offline')
    assert.equal(report.caseCount, 4)
    assert.equal(report.providerCalls, 10)
    assert.equal(report.records.length, 8)
    assert.ok(report.records.every((record) => Number(record.requests) >= 1))
    assert.ok(report.records.every((record) => typeof record.observedDisposition === 'string'))
    assert.ok(report.records.every((record) => typeof record.inputDigest === 'string' && !('source' in record) && !('reference' in record)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('live qualification cannot be activated implicitly', () => {
  const script = join(process.cwd(), 'scripts', 'translation-qualification-main.mjs')
  const result = spawnSync(process.execPath, [script, '--mode', 'live'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}\n${result.stderr}`, /Live qualification adapter|explicit --mode live/iu)
})

test('offline qualification can execute the full 16-locale directed matrix', () => {
  const manifest = join(process.cwd(), 'tests', 'fixtures', 'translation-multilingual', 'cases.json')
  const script = join(process.cwd(), 'scripts', 'translation-qualification-main.mjs')
  const result = spawnSync(process.execPath, [script, '--mode', 'offline', '--manifest', manifest, '--matrix', '--dry-run'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout) as { caseCount: number; providerCalls: number; records: Array<Record<string, unknown>> }
  assert.equal(report.caseCount, 244)
  assert.equal(report.providerCalls, 245)
  assert.equal(report.records.length, 244)
  assert.ok(report.records.some((record) => record.caseId === 'matrix-zh-en'))
  assert.ok(report.records.every((record) => !('source' in record) && !('reference' in record)))
})
