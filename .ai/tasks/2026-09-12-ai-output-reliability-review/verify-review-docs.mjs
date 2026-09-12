import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const paths = [
  'docs/superpowers/specs/2026-09-12-ai-output-reliability-design.md',
  'docs/superpowers/plans/2026-09-12-ai-output-reliability.md',
  'docs/superpowers/specs/2026-09-12-ai-output-reliability-adversarial-cases.md',
  '.ai/tasks/2026-09-12-ai-output-reliability-review/review.md',
  '.ai/tasks/TASK-20260912-ai-output-reliability-review.md'
]
const texts = paths.map(path => readFileSync(resolve(root, path), 'utf8'))
let links = 0
for (let i = 0; i < texts.length; i++) {
  for (const [index, line] of texts[i].split(/\r?\n/u).entries()) {
    assert(!/[\t ]+$/u.test(line), `${paths[i]}:${index + 1}: trailing whitespace`)
  }
  for (const match of texts[i].matchAll(/\]\(([^)]+)\)/gu)) {
    const target = match[1]
    if (/^(https?:|#)/u.test(target)) continue
    assert(existsSync(resolve(dirname(resolve(root, paths[i])), target)), `Missing link: ${paths[i]} -> ${target}`)
    links++
  }
}
const criterionIds = [...texts[0].matchAll(/^- (AC\d{2}):/gmu)].map(match => match[1])
assert.equal(criterionIds.length, 20)
assert.equal(new Set(criterionIds).size, 20)
for (let i = 1; i <= 20; i++) assert(criterionIds.includes(`AC${String(i).padStart(2, '0')}`))
for (let i = 0; i <= 6; i++) assert(texts[1].includes(`## ${i + 3}. P${i}`), `Missing phase P${i}`)
const scenarios = [...texts[2].matchAll(/^\| (C\d{2}) \| (P[12]) \| (.+)$/gmu)]
assert.equal(scenarios.length, 60)
assert.equal(new Set(scenarios.map(match => match[1])).size, 60)
for (let i = 1; i <= 60; i++) assert(scenarios.some(match => match[1] === `C${String(i).padStart(2, '0')}`))
const covered = new Set()
for (const scenario of scenarios) {
  const ids = scenario[3].match(/AC\d{2}/gu) || []
  assert(ids.length > 0, `${scenario[1]} lacks acceptance criteria`)
  for (const id of ids) {
    assert(criterionIds.includes(id), `${scenario[1]} unknown criterion ${id}`)
    covered.add(id)
  }
}
assert.equal(covered.size, 20, 'Every criterion needs scenario coverage')
const findings = [...texts[3].matchAll(/^\| (R\d{2}) \| (P[12]) \|/gmu)]
assert.equal(findings.length, 14)
assert.equal(new Set(findings.map(match => match[1])).size, 14)
assert.equal(findings.filter(match => match[2] === 'P1').length, 10)
assert.equal(findings.filter(match => match[2] === 'P2').length, 4)
console.log(`PASS: ${paths.length} documents, ${links} local links, no trailing whitespace`)
console.log('PASS: AC01-AC20 all covered; C01-C60 unique; P0-P6 present; R01-R14 = 10 P1 + 4 P2')
console.log('Scope: document integrity/traceability only; does not execute or prove runtime scenarios')
