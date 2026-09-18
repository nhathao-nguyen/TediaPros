import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const suites = [
  'translation-capability-snapshot.test', 'translation-request-budget.test',
  'speech-unit-plan.test', 'speech-unit-planner.test', 'speech-budget.test',
  'vietnamese-style-profile.test', 'translation-semantic-evidence.test',
  'dubbing-feedback-decision.test', 'vietnamese-evaluation.test',
  'gemini-gateway-long-context.test', 'gemini-gateway-prompts.test',
  'gemini-gateway-contract.test', 'gemini-gateway-draft-resume.test',
  'translation-planner.test', 'translation-orchestrator.test',
  'translation-rephrase.test', 'autoshort-content-quality.test', 'dubbing-plan.test',
  'translation-resume.test', 'translation-identity.test', 'autoshort-tts-pipeline.test'
]
const command = ['scripts/run-local-runtime-tests.mjs', ...suites]
const result = spawnSync(process.execPath, command, { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 })
const output = `${result.stdout || ''}${result.stderr || ''}`
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'regression-results.txt'), `node ${command.join(' ')}\n${output}\nExit: ${result.status}\n`, 'utf8')
console.log(output.split(/\r?\n/u).slice(-35).join('\n'))
const totals = [...output.matchAll(/(?:ℹ|#) (tests|pass|fail|skipped) (\d+)/gu)].reduce((sum, match) => {
  sum[match[1]] = (sum[match[1]] || 0) + Number(match[2])
  return sum
}, {})
console.log(JSON.stringify({ suiteCount: suites.length, totals, exitCode: result.status }))
if (result.error) console.error(result.error)
process.exitCode = result.status ?? 1
