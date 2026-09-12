import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const evidence = dirname(fileURLToPath(import.meta.url))
const root = resolve(evidence, '../../..')
const plans = [
  'docs/superpowers/plans/2026-09-12-autoshort-cut-repair.md',
  'docs/superpowers/plans/2026-09-12-autoshort-cut-repair-a-editor-recovery.md',
  'docs/superpowers/plans/2026-09-12-autoshort-cut-repair-b-media.md',
  'docs/superpowers/plans/2026-09-12-autoshort-cut-repair-c-pipeline.md'
]
const docs = [...plans,
  'docs/superpowers/specs/2026-09-12-autoshort-cut-repair-design.md',
  '.ai/tasks/TASK-20260912-autoshort-cut-repair-planning.md'
]
const failures = []
const contents = new Map(docs.map(file => [file, readFileSync(resolve(root, file), 'utf8')]))
let linkCount = 0
for (const [file, content] of contents) {
  if (/(?:^|\n)[^\n]*[ \t]+(?:\r?\n|$)/.test(content)) failures.push(`${file}: trailing whitespace`)
  if ((content.match(/^```/gm) || []).length % 2) failures.push(`${file}: unclosed code fence`)
  if (/\b(TODO|TBD)\b|เพิ่ม/.test(content)) failures.push(`${file}: placeholder or stray text`)
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/#.*$/, '')
    if (!target || /^https?:/.test(target)) continue
    const path = /^[A-Za-z]:[\/]/.test(target) ? target : resolve(root, dirname(file), target)
    linkCount++
    if (!existsSync(path)) failures.push(`${file}: missing link ${target}`)
  }
}
const combined = plans.map(file => contents.get(file)).join('\n')
const taskIds = [...combined.matchAll(/^## (?:\d+\. Task )?([PABCZ]\d{2}) —/gm)].map(m => m[1])
const expected = ['P00','A01','A02','A03','A04','A05','B01','B02','B03','B04','C01','C02','C03','C04','C05','Z01']
for (const id of expected) if (taskIds.filter(task => task === id).length !== 1) failures.push(`${id}: missing or duplicate task`)
const master = contents.get(plans[0])
for (let n = 1; n <= 12; n++) {
  const id = `F${String(n).padStart(2,'0')}`
  if (!master.includes(`| ${id} `)) failures.push(`${id}: missing finding coverage`)
}
for (let n = 1; n <= 18; n++) {
  const id = `R${String(n).padStart(2,'0')}`
  if (!master.includes(`| ${id} `)) failures.push(`${id}: missing Core coverage`)
}
for (const file of plans) {
  const text = contents.get(file)
  for (const heading of ['**Goal:**','**Architecture:**','**Tech Stack:**','**Spec:**','## Global Constraints']) {
    if (!text.includes(heading)) failures.push(`${file}: missing ${heading}`)
  }
}
const result = { status: failures.length ? 'FAIL' : 'PASS', documents: docs.length, checkedLinks: linkCount,
  tasks: taskIds.length, expectedTasks: expected.length, findingsMapped: 12, coreRequirementsMapped: 18,
  implementationCheckboxesChecked: (combined.match(/^- \[x\]/gm) || []).length, failures }
writeFileSync(resolve(evidence, 'document-validation.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (failures.length) process.exitCode = 1
