import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const taskDir = resolve('.ai/tasks/2026-09-15-gateway-v2-hardening')
await mkdir(taskDir, { recursive: true })

await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createGeminiGatewayTranslationAdapter } from './src/main/geminiGateway'
import { planTranslation } from './src/main/translation/planner'
import { parseTranslationResponse } from './src/main/translation/response'

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function requireExactPro(label: unknown): void {
  const value = String(label || '')
  assert.match(value, /(^|[^0-9])3\\.1\\s+pro([^0-9]|$)/iu, 'observed model must be Gemini 3.1 Pro')
  assert.doesNotMatch(value, /image/iu, 'image route is never a text-translation route')
}

function safeMetadata(value: unknown): JsonRecord {
  const data = asRecord(value)
  const keys = [
    'gateway_contract_version', 'requested_model', 'resolved_model', 'observed_model',
    'observed_model_id', 'model_verification', 'route_fingerprint', 'completion_state',
    'completion_evidence', 'normalization', 'logical_request_id', 'upstream_attempts',
    'upstream_retry_reasons'
  ]
  return Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]]))
}

function assertStrictSuccess(metadata: JsonRecord): void {
  assert.equal(metadata.gateway_contract_version, 2, 'gateway must return contract v2')
  assert.equal(metadata.requested_model, 'gemini-advanced', 'unexpected requested alias')
  assert.equal(metadata.model_verification, 'matched', 'gateway did not prove observed model')
  assert.equal(metadata.completion_state, 'complete', 'gateway did not prove completion')
  assert.ok(typeof metadata.completion_evidence === 'string' && metadata.completion_evidence.length > 0, 'missing completion evidence')
  assert.ok(typeof metadata.route_fingerprint === 'string' && /^[a-f0-9]{64}$/iu.test(metadata.route_fingerprint), 'invalid route fingerprint')
  assert.ok(Number.isInteger(metadata.upstream_attempts) && Number(metadata.upstream_attempts) >= 1 && Number(metadata.upstream_attempts) <= 3, 'upstream attempt count must stay within one gateway stage cap')
  requireExactPro(metadata.observed_model)
}

const sourcePath = resolve(process.argv[2] || '')
const output = resolve(process.argv[3] || '')
const baseUrl = (process.argv[4] || 'http://127.0.0.1:4982/openai/v1').replace(/\\/+$/u, '')
const parsedBaseUrl = new URL(baseUrl)
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(parsedBaseUrl.hostname), 'live harness permits a loopback gateway only')
assert.ok(sourcePath && existsSync(sourcePath), 'source fixture must exist')
if (existsSync(output)) {
  assert.equal(readdirSync(output).length, 0, 'output directory must be new and empty; do not overwrite earlier live evidence')
}
mkdirSync(output, { recursive: true })

const loaded = JSON.parse(readFileSync(sourcePath, 'utf8')) as JsonRecord
const input = Array.isArray(loaded.cues)
  ? loaded
  : Array.isArray(loaded.sourceCues)
    ? {
        sourceLanguage: typeof loaded.detectedSourceLanguage === 'string' ? loaded.detectedSourceLanguage : 'zh',
        targetLocale: 'vi-VN',
        mode: 'dubbing',
        cues: loaded.sourceCues.map((cue: unknown, sourceIndex: number) => {
          const value = asRecord(cue)
          return {
            id: String(value.id || ''),
            sourceIndex,
            start: Number(value.start),
            end: Number(value.end),
            groupId: typeof value.groupId === 'string' ? value.groupId : 'checkpoint-' + sourceIndex,
            text: String(value.text || '')
          }
        }),
        contextBefore: [],
        contextAfter: [],
        glossary: []
      }
    : (() => { throw new Error('input must be a canonical fixture or an AutoShort checkpoint with sourceCues') })()
assert.ok(Array.isArray(input.cues) && input.cues.length > 0, 'fixture must contain canonical cues')
const expectedIds = input.cues.map((cue: { id?: unknown }) => String(cue.id || ''))
assert.ok(expectedIds.every(Boolean) && new Set(expectedIds).size === expectedIds.length, 'fixture cue IDs must be exact and unique')
writeFileSync(join(output, 'source.json'), JSON.stringify(input, null, 2))

const adapter = createGeminiGatewayTranslationAdapter(baseUrl, {
  auditPath: join(output, 'audit.json'),
  draftDir: join(output, 'draft')
})
const plan = planTranslation(input, adapter.capability)
assert.equal(plan.batches.length, 1, 'fixture must run as exactly one two-stage batch')

const originalFetch = globalThis.fetch
const envelopes: JsonRecord[] = []
const capabilityChecks: JsonRecord[] = []
let clientGenerationRequests = 0

function save(name: string, value: unknown): void {
  writeFileSync(join(output, name), JSON.stringify(value, null, 2))
}

globalThis.fetch = async (url, init) => {
  const target = new URL(String(url))
  const isGeneration = target.pathname.endsWith('/chat/completions') && String(init?.method || 'GET').toUpperCase() === 'POST'
  const isCapabilities = target.pathname.endsWith('/gateway/capabilities') && String(init?.method || 'GET').toUpperCase() === 'GET'
  if (isGeneration) {
    assert.ok(clientGenerationRequests < 2, 'safety stop: a video may send only draft plus independent review')
    clientGenerationRequests++
  }
  const response = await originalFetch(url, init)
  let body: JsonRecord = {}
  try { body = asRecord(await response.clone().json()) } catch {}
  if (isCapabilities) {
    capabilityChecks.push({
      status: response.status,
      gateway_contract_version: body.gateway_contract_version,
      provider_ready: body.provider_ready,
      provider_error: body.provider_error,
      models: body.models,
      gateway_model_routes: body.gateway_model_routes
    })
    save('capabilities.json', capabilityChecks)
  }
  if (isGeneration) {
    const choice = Array.isArray(body.choices) ? asRecord(body.choices[0]) : {}
    const message = asRecord(choice.message)
    const content = typeof message.content === 'string' ? message.content : ''
    envelopes.push({
      status: response.status,
      id: body.id,
      model: body.model,
      finish_reason: choice.finish_reason,
      response_content_bytes: Buffer.byteLength(content, 'utf8'),
      gateway_metadata: safeMetadata(body.gateway_metadata)
    })
    save('envelopes.json', envelopes)
  }
  return response
}

;(async () => {
try {
  const result = await adapter.requestOnce(plan.batches[0], AbortSignal.timeout(600_000))
  const parsed = parseTranslationResponse(result.raw, 'json-items', expectedIds, result.truncated)
  assert.equal(parsed.complete, true, 'canonical result must be complete')
  assert.deepEqual(parsed.items.map((item) => item.id), expectedIds, 'canonical result IDs differ from source')
  assert.equal(clientGenerationRequests, 2, 'a fresh fixture must use exactly two client generation requests')
  assert.equal(envelopes.length, 2, 'missing gateway envelopes')
  for (const envelope of envelopes) assertStrictSuccess(asRecord(envelope.gateway_metadata))
  const summary = {
    success: true,
    cues: expectedIds.length,
    client_generation_requests: clientGenerationRequests,
    total_upstream_attempts: envelopes.reduce((total, envelope) => total + Number(asRecord(envelope.gateway_metadata).upstream_attempts || 0), 0),
    observed_models: envelopes.map((envelope) => asRecord(envelope.gateway_metadata).observed_model),
    route_fingerprints: envelopes.map((envelope) => asRecord(envelope.gateway_metadata).route_fingerprint),
    retry_reasons: envelopes.map((envelope) => asRecord(envelope.gateway_metadata).upstream_retry_reasons)
  }
  save('result.json', { ...summary, parsed })
  console.log(JSON.stringify(summary))
} catch (error) {
  const failure = { success: false, client_generation_requests: clientGenerationRequests, message: error instanceof Error ? error.message : String(error) }
  save('failure.json', failure)
  console.error(JSON.stringify(failure))
  process.exitCode = 1
} finally {
  globalThis.fetch = originalFetch
}
})()
`
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: resolve(taskDir, 'live-two-pass.cjs'),
  logLevel: 'silent',
  plugins: [{
    name: 'mock-electron',
    setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        contents: "module.exports={app:{getPath:()=>require('node:os').tmpdir()}}",
        loader: 'js'
      }))
    }
  }]
})
