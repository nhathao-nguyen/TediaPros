import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const out = resolve('.ai/tasks/2026-09-15-gateway-v2-review')
await mkdir(out, { recursive: true })
await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createGeminiGatewayTranslationAdapter } from './src/main/geminiGateway'
import { planTranslation } from './src/main/translation/planner'
import { parseTranslationResponse } from './src/main/translation/response'
const cp = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const output = resolve(process.argv[3])
mkdirSync(output, { recursive: true })
const input = { sourceLanguage: cp.detectedSourceLanguage || 'zh', targetLocale: 'vi-VN', mode: 'dubbing',
  cues: cp.sourceCues.map((c, i) => ({ id: c.id, sourceIndex: i, start: c.start, end: c.end, text: c.text, groupId: 'cue-' + i })),
  contextBefore: [], contextAfter: [], glossary: [] }
writeFileSync(join(output, 'source.json'), JSON.stringify(input, null, 2))
const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:4982/openai/v1', { auditPath: join(output, 'audit.json') })
const plan = planTranslation(input, adapter.capability)
assert.equal(plan.batches.length, 1)
const originalFetch = globalThis.fetch
let requests = 0
const envelopes = []
globalThis.fetch = async (url, init) => {
  assert.equal(String(url), 'http://127.0.0.1:4982/openai/v1/chat/completions')
  assert.ok(++requests <= 2, 'Replay allows only draft and review')
  const response = await originalFetch(url, init)
  const data = await response.clone().json()
  // Omit session/account metadata and headers from diagnostic evidence.
  const record = { status: response.status, id: data.id, model: data.model, choices: data.choices, gateway_metadata: data.gateway_metadata }
  envelopes.push(record)
  writeFileSync(join(output, 'envelopes.json'), JSON.stringify(envelopes, null, 2))
  console.log(JSON.stringify({ request: requests, status: response.status, metadata: data.gateway_metadata }))
  return response
}
;(async () => {
  try {
    const result = await adapter.requestOnce(plan.batches[0], AbortSignal.timeout(360000))
    const parsed = parseTranslationResponse(result.raw, 'json-items', input.cues.map(c => c.id), result.truncated)
    assert.equal(parsed.complete, true)
    writeFileSync(join(output, 'result.json'), JSON.stringify(parsed, null, 2))
    console.log(JSON.stringify({ success: true, cues: input.cues.length, requests, upstreamAttempts: envelopes.reduce((sum, e) => sum + e.gateway_metadata.upstream_attempts, 0) }))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
})()
` }, bundle: true, platform: 'node', format: 'cjs', outfile: joinPath(out, 'replay.cjs'), logLevel: 'silent',
  plugins: [{ name: 'mock-electron', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }))
    b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: "module.exports={app:{getPath:()=>require('node:os').tmpdir()}}", loader: 'js' }))
  } }]
})
function joinPath(dir, name) { return resolve(dir, name) }
