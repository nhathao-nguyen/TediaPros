import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const sections = [
  ['Core implementation: full module review', [
    'src/main/translation/capabilitySnapshot.ts', 'src/main/translation/requestBudget.ts',
    'src/main/translation/speechBudget.ts', 'src/main/translation/speechUnitPlanner.ts',
    'src/main/translation/viStyleProfile.ts', 'src/main/translation/semanticEvidence.ts',
    'src/main/translation/qualityDecision.ts', 'src/main/translation/planner.ts',
    'src/main/translation/orchestrator.ts', 'src/main/translation/checkpoint.ts',
    'src/main/dubbing/feedbackDecision.ts', 'src/main/dubbing/synthesis.ts',
    'src/main/geminiGateway.ts', 'src/main/geminiGatewayPrompts.ts', 'src/main/geminiGatewayDraftCheckpoint.ts',
    'src/shared/speechUnitPlan.ts', 'scripts/evaluate-vietnamese-dubbing.mjs'
  ]],
  ['Integration and supporting contracts: focused sections and call-site search', [
    'src/main/autoshort.ts', 'src/main/autoShortItemCoordinator.ts', 'src/main/autoShortContentQuality.ts',
    'src/main/dubbing/plan.ts', 'src/main/dubbing/translation.ts', 'src/main/dubbing/timeMap.ts',
    'src/main/translation/fileRunner.ts', 'src/main/translation/budget.ts', 'src/main/translation/response.ts',
    'src/main/sourceSpeechGrouping.ts', 'src/shared/translation.ts', 'scripts/run-local-runtime-tests.mjs'
  ]],
  ['Regression suites: executed; relevant assertions inspected (not every test body)', [
    'tests/translation-capability-snapshot.test.ts', 'tests/translation-request-budget.test.ts',
    'tests/speech-unit-plan.test.ts', 'tests/speech-unit-planner.test.ts', 'tests/speech-budget.test.ts',
    'tests/vietnamese-style-profile.test.ts', 'tests/translation-semantic-evidence.test.ts',
    'tests/dubbing-feedback-decision.test.ts', 'tests/vietnamese-evaluation.test.ts',
    'tests/gemini-gateway-long-context.test.ts', 'tests/gemini-gateway-prompts.test.ts',
    'tests/gemini-gateway-contract.test.ts', 'tests/gemini-gateway-draft-resume.test.ts',
    'tests/translation-planner.test.ts', 'tests/translation-orchestrator.test.ts',
    'tests/translation-rephrase.test.ts', 'tests/autoshort-content-quality.test.ts', 'tests/dubbing-plan.test.ts',
    'tests/translation-resume.test.ts', 'tests/translation-identity.test.ts', 'tests/autoshort-tts-pipeline.test.ts'
  ]],
  ['Guidance and design evidence: scope-relevant sections', [
    'AGENTS.md', 'src/main/AGENTS.md', 'src/main/dubbing/AGENTS.md', 'src/shared/AGENTS.md',
    '.ai/tasks/TASK_TEMPLATE.md', 'docs/architecture.md', 'docs/domain.md',
    'docs/adr/005-source-anchored-dubbing-tempo-policy.md',
    'docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-design.md',
    'docs/superpowers/specs/2026-09-15-vietnamese-duration-aware-translation-contracts.md',
    'docs/superpowers/plans/2026-09-15-vietnamese-duration-aware-translation.md',
    'docs/benchmarks/2026-09-15-vietnamese-duration-aware-translation-evaluation.md',
    '.ai/tasks/2026-09-15-vietnamese-duration-aware-translation-core/TASK.md'
  ]]
]
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const lines = [
  '# FILE_INVENTORY — Vietnamese translation/dubbing session review', '',
  `Snapshot UTC: ${new Date().toISOString()}. Base HEAD: \`${head}\`. This is a dirty working-tree review, not a commit diff audit.`, '',
  'Inventory covers the session translation/dubbing feature and its consumers. It does not claim a whole-repository audit. Review modes distinguish full reading, selected call paths, and test execution. SHA-256 pins the actual working files inspected; file presence is not proof of implementation completeness.', ''
]
for (const [label, paths] of sections) {
  lines.push(`## ${label}`, '', '| Path | Lines | SHA-256 |', '| --- | ---: | --- |')
  for (const path of paths) {
    const bytes = readFileSync(path)
    lines.push(`| \`${path}\` | ${bytes.toString('utf8').split(/\r?\n/u).length} | \`${createHash('sha256').update(bytes).digest('hex')}\` |`)
  }
  lines.push('')
}
lines.push('## Explicit exclusions', '',
  'Unrelated dirty font/thumbnail/OCR/renderer/Douyin/release work, runtime engines and binaries, real user media, installed Windows artifact, real Gateway/tokenizer/TTS services, external research claims, human listening and semantic ratings. No claim is made about correctness of these excluded areas.', '')
const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(join(here, 'FILE_INVENTORY.md'), lines.join('\n'), 'utf8')
console.log(JSON.stringify({ head, inventoriedFiles: sections.reduce((count, [, paths]) => count + paths.length, 0), output: join(here, 'FILE_INVENTORY.md') }))
