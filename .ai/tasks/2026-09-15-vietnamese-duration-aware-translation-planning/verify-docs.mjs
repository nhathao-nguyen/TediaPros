// Documentation-only checks. Does not modify files or call providers/TTS.
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const paths = [
  'docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-design.md',
  'docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-contracts.md',
  'docs/superpowers/plans/2026-09-15-vietnamese-duration-aware-translation.md',
  'docs/benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md'
]
const docs = new Map()
let localLinks = 0, syntaxCheckedBlocks = 0
for (const path of paths) {
  const absolute = resolve(root, path)
  const body = await readFile(absolute, 'utf8')
  docs.set(path, body)
  assert.ok(!body.includes('\uFFFD'), `Encoding replacement in ${path}`)
  assert.ok(!/\b(?:TBD|TODO)\b/.test(body), `Unfinished marker in ${path}`)
  assert.equal((body.match(/^```/gm) || []).length % 2, 0, `Unbalanced fences in ${path}`)
  for (const match of body.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '')
    if (/^(?:https?:|#)/.test(target)) continue
    const filePart = decodeURIComponent(target.split('#')[0]).replace(/:\d+$/, '')
    const destination = resolve(dirname(absolute), filePart)
    const inRoot = relative(root, destination)
    assert.ok(!inRoot.startsWith('..'), `Link leaves workspace: ${target}`)
    assert.ok((await stat(destination)).isFile(), `Link missing: ${target}`)
    localLinks++
  }
  for (const match of body.matchAll(/^```(ts|js)\r?\n([\s\S]*?)^```/gm)) {
    await transform(match[2], { loader: match[1], target: 'es2022', sourcefile: `${path}:snippet-${syntaxCheckedBlocks + 1}` })
    syntaxCheckedBlocks++
  }
}
const spec = docs.get(paths[0])
const contracts = docs.get(paths[1])
const plan = docs.get(paths[2])
const evaluation = docs.get(paths[3])
for (let i = 1; i <= 15; i++) {
  const requirement = `R${String(i).padStart(2, '0')}`
  assert.ok(spec.includes(requirement), `Missing ${requirement} in spec`)
  assert.ok(evaluation.includes(requirement), `Missing ${requirement} traceability`)
}
for (let i = 0; i <= 13; i++) {
  const task = `T${String(i).padStart(2, '0')}`
  assert.ok(plan.includes(`### ${task} —`), `Missing task ${task}`)
  assert.ok(contracts.includes(task), `Missing contract/gate ${task}`)
}
assert.ok(spec.includes('**không dùng Gemini tạo giọng**'))
assert.ok(spec.includes('**Gemini Gateway hỗ trợ đầy đủ context 1M'))
assert.ok(plan.includes('1_000_000'))
assert.ok(plan.includes('superpowers:executing-plans'))
assert.ok(evaluation.includes('PROPOSED PROTOCOL'))
assert.ok(evaluation.includes('CTX04') && evaluation.includes('CTX05') && evaluation.includes('TTS01'))
const registry = await readFile(resolve(root, 'scripts/run-local-runtime-tests.mjs'), 'utf8')
const baselineSuites = ['translation-prompts.test', 'dubbing-grouping.test', 'dubbing-duration-profile.test',
  'autoshort-content-quality.test', 'gemini-gateway-prompts.test', 'dubbing-plan.test', 'gemini-gateway-contract.test',
  'gemini-gateway-draft-resume.test', 'translation-orchestrator.test', 'translation-rephrase.test',
  'translation-planner.test', 'autoshort-tts-pipeline.test', 'autoshort-tts-cache.test']
assert.ok(baselineSuites.every(suite => registry.includes(`'${suite}'`)), 'Baseline test name absent from runner')
console.log(JSON.stringify({ status: 'PASS', documentationFiles: paths.length, localLinks, syntaxCheckedBlocks,
  requirementsCovered: 15, tasksCovered: 14, existingSuiteNamesChecked: baselineSuites.length,
  providerCalls: 0, ttsCalls: 0,
  limits: 'Checks documentation links, coverage and snippet syntax only; not production implementation, TypeScript integration, benchmark or live qualification.' }, null, 2))
