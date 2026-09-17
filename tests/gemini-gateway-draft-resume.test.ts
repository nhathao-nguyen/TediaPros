import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  calculateGatewaySourceDigest,
  GATEWAY_DRAFT_FILENAME,
  GATEWAY_DRAFT_PARSER_VERSION,
  GATEWAY_DRAFT_SCHEMA_VERSION,
  readGatewayDraft,
  writeGatewayDraft,
  type GatewayDraftExpectation,
  type GatewayDraftRecord
} from '../src/main/geminiGatewayDraftCheckpoint'
import { GEMINI_GATEWAY_PROMPT_VERSION } from '../src/main/geminiGatewayPrompts'
import { createGeminiGatewayTranslationAdapter } from '../src/main/geminiGateway'
import { planTranslation } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'

const ROUTE_A = 'a'.repeat(64)
const ROUTE_B = 'b'.repeat(64)

function testInput(cueCount = 3): TranslationInput {
  return {
    sourceLanguage: 'zh',
    targetLocale: 'vi-VN',
    mode: 'dubbing',
    cues: Array.from({ length: cueCount }, (_, i) => ({
      id: `cue-${i + 1}`,
      sourceIndex: i,
      start: i * 1.5,
      end: i * 1.5 + 1.2,
      groupId: `g-${Math.floor(i / 2)}`,
      text: `这是第${i + 1}句测试话语`
    })),
    contextBefore: [],
    contextAfter: [],
    glossary: []
  }
}

function compactRaw(input: TranslationInput): string {
  return JSON.stringify({
    translations: Object.fromEntries(input.cues.map((cue) => [cue.id, `Bản dịch ${cue.id}.`]))
  })
}

function draftRecord(input: TranslationInput, raw = compactRaw(input), routeFingerprint = ROUTE_A): GatewayDraftRecord {
  const expectedIds = input.cues.map((cue) => cue.id)
  return {
    schemaVersion: GATEWAY_DRAFT_SCHEMA_VERSION,
    state: 'draft-validated',
    identity: `gemini-gateway:gemini-advanced:${GEMINI_GATEWAY_PROMPT_VERSION}:${GATEWAY_DRAFT_PARSER_VERSION}:${input.targetLocale}:${expectedIds.length}`,
    raw,
    rawSha256: createHash('sha256').update(raw).digest('hex'),
    observedModelId: 'e6fa609c3fa255c0',
    observedModel: '3.1 Pro',
    routeFingerprint,
    sourceDigest: calculateGatewaySourceDigest(input),
    expectedIds,
    targetLocale: input.targetLocale,
    draftPromptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
    reviewPromptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
    parserVersion: GATEWAY_DRAFT_PARSER_VERSION,
    savedAtUtc: new Date().toISOString()
  }
}

function expectation(record: GatewayDraftRecord, overrides: Partial<GatewayDraftExpectation> = {}): GatewayDraftExpectation {
  return {
    identity: record.identity,
    sourceDigest: record.sourceDigest,
    expectedIds: record.expectedIds,
    targetLocale: record.targetLocale,
    draftPromptVersion: record.draftPromptVersion,
    reviewPromptVersion: record.reviewPromptVersion,
    parserVersion: record.parserVersion,
    routeFingerprint: record.routeFingerprint,
    ...overrides
  }
}

function capabilities(routeFingerprint = ROUTE_A): Response {
  return new Response(JSON.stringify({
    gateway_contract_version: 2,
    provider_ready: true,
    models: ['gemini-advanced'],
    model_selection: 'observed-id-required',
    gateway_model_routes: { 'gemini-advanced': { route_fingerprint: routeFingerprint } }
  }))
}

function completion(input: TranslationInput, routeFingerprint = ROUTE_A): Response {
  return new Response(JSON.stringify({
    model: 'gemini-advanced',
    gateway_metadata: {
      gateway_contract_version: 2,
      resolved_model: 'gemini-advanced',
      observed_model_id: 'e6fa609c3fa255c0',
      observed_model: '3.1 Pro',
      route_fingerprint: routeFingerprint,
      model_verification: 'matched',
      completion_state: 'complete',
      completion_evidence: 'observed-terminal-frame-v1',
      upstream_attempts: 1
    },
    choices: [{
      message: { content: compactRaw(input) },
      finish_reason: 'stop'
    }]
  }))
}

test('Gateway draft checkpoint: atomic write and exact read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-draft-test-'))
  try {
    const record = draftRecord(testInput())
    await writeGatewayDraft(dir, record)

    const read = await readGatewayDraft(dir, expectation(record))
    assert.ok(read)
    assert.equal(read.identity, record.identity)
    assert.equal(read.raw, record.raw)
    assert.equal(read.observedModelId, 'e6fa609c3fa255c0')
    assert.equal(read.schemaVersion, 2)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Gateway draft checkpoint: corrupt, stale, changed route and wrong cue identity are safe misses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-draft-tamper-'))
  try {
    const input = testInput()
    const record = draftRecord(input)
    const draftPath = join(dir, GATEWAY_DRAFT_FILENAME)

    assert.equal(await readGatewayDraft(dir, expectation(record)), null)
    await writeFile(draftPath, '{ this is not valid json', 'utf8')
    assert.equal(await readGatewayDraft(dir, expectation(record)), null)

    await writeGatewayDraft(dir, record)
    assert.equal(await readGatewayDraft(dir, expectation(record, { identity: 'different-identity' })), null)
    assert.equal(await readGatewayDraft(dir, expectation(record, { sourceDigest: 'c'.repeat(64) })), null)
    assert.equal(await readGatewayDraft(dir, expectation(record, { routeFingerprint: ROUTE_B })), null)
    assert.equal(await readGatewayDraft(dir, expectation(record, { expectedIds: [...record.expectedIds].reverse() })), null)
    assert.equal(await readGatewayDraft(dir, expectation(record, { parserVersion: 'different-parser' })), null)

    const tampered = { ...record, raw: compactRaw({ ...input, cues: input.cues.slice(0, 1) }) }
    await writeFile(draftPath, JSON.stringify(tampered), 'utf8')
    assert.equal(await readGatewayDraft(dir, expectation(record)), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Gateway draft checkpoint: writer rejects incomplete draft rather than persisting it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-draft-reject-'))
  try {
    const input = testInput(2)
    const invalid = draftRecord(input, JSON.stringify({ translations: { 'cue-1': 'Only one.' } }))
    await assert.rejects(writeGatewayDraft(dir, invalid), /invalid draft record/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Gateway checkpoints: adapter reuses only a current route-matched final review', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-draft-resume-'))
  const auditPath = join(dir, 'translation-audit.json')
  try {
    const input = testInput(3)
    const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:4982/openai/v1', {
      auditPath,
      draftDir: dir
    })
    const batch = planTranslation(input, adapter.capability).batches[0]
    const oldFetch = globalThis.fetch
    const stageCalls: string[] = []
    let route = ROUTE_A

    try {
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith('/gateway/capabilities')) return capabilities(route)
        const body = JSON.parse(String(init?.body || '{}')) as { messages?: Array<{ content?: string }> }
        const isReview = Boolean(body.messages?.some((message) => message.content?.includes('[CANDIDATE_JSON]')))
        stageCalls.push(isReview ? 'review' : 'draft')
        return completion(input, route)
      }

      const result1 = await adapter.requestOnce(batch, new AbortController().signal)
      assert.ok(result1.raw)
      assert.deepEqual(stageCalls, ['draft', 'review'])
      const savedDraftRaw = await readFile(join(dir, GATEWAY_DRAFT_FILENAME), 'utf8')
      assert.match(savedDraftRaw, /"schemaVersion": 2/u)
      const savedReviewRaw = await readFile(join(dir, 'gemini-gateway-review.json'), 'utf8')
      assert.match(savedReviewRaw, /"state": "review-validated"/u)

      stageCalls.length = 0
      const result2 = await adapter.requestOnce(batch, new AbortController().signal)
      assert.ok(result2.raw)
      assert.deepEqual(stageCalls, [])

      route = ROUTE_B
      stageCalls.length = 0
      const result3 = await adapter.requestOnce(batch, new AbortController().signal)
      assert.ok(result3.raw)
      assert.deepEqual(stageCalls, ['draft', 'review'])

      stageCalls.length = 0
      const modifiedInput: TranslationInput = {
        ...input,
        cues: [{ ...input.cues[0], text: 'Văn bản đã sửa đổi' }, ...input.cues.slice(1)]
      }
      const modifiedBatch = planTranslation(modifiedInput, adapter.capability).batches[0]
      const result4 = await adapter.requestOnce(modifiedBatch, new AbortController().signal)
      assert.ok(result4.raw)
      assert.deepEqual(stageCalls, ['draft', 'review'])
    } finally {
      globalThis.fetch = oldFetch
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
