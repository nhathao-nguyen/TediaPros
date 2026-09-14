import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  calculateGatewaySourceDigest,
  readGatewayDraft,
  writeGatewayDraft,
  GATEWAY_DRAFT_FILENAME,
  type GatewayDraftRecord
} from '../src/main/geminiGatewayDraftCheckpoint'
import { createGeminiGatewayTranslationAdapter } from '../src/main/geminiGateway'
import { planTranslation } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'

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

test('Gateway draft checkpoint: atomic write and valid read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-draft-test-'))
  try {
    const input = testInput()
    const digest = calculateGatewaySourceDigest(input)
    const raw = JSON.stringify({
      translations: {
        'cue-1': 'Bản dịch 1.',
        'cue-2': 'Bản dịch 2.',
        'cue-3': 'Bản dịch 3.'
      }
    })
    const sha = createHash('sha256').update(raw).digest('hex')

    const record: GatewayDraftRecord = {
      schemaVersion: 1,
      state: 'draft-validated',
      identity: 'gemini-gateway:gemini-advanced:two-pass-v4:vi-VN:3',
      raw,
      rawSha256: sha,
      observedModelId: 'e6fa609c3fa255c0',
      observedModel: '3.1 Pro',
      routeFingerprint: 'route-abc-123',
      sourceDigest: digest,
      expectedIds: ['cue-1', 'cue-2', 'cue-3'],
      targetLocale: 'vi-VN',
      savedAtUtc: new Date().toISOString()
    }

    await writeGatewayDraft(dir, record)

    const read = await readGatewayDraft(dir, record.identity, digest)
    assert.ok(read)
    assert.equal(read.identity, record.identity)
    assert.equal(read.raw, raw)
    assert.equal(read.observedModelId, 'e6fa609c3fa255c0')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Gateway draft checkpoint: returns null on corrupt, mismatched or tampered files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-draft-tamper-'))
  try {
    const input = testInput()
    const digest = calculateGatewaySourceDigest(input)
    const identity = 'gemini-gateway:gemini-advanced:two-pass-v4:vi-VN:3'

    // Missing file
    assert.equal(await readGatewayDraft(dir, identity, digest), null)

    // Corrupt JSON
    const draftPath = join(dir, GATEWAY_DRAFT_FILENAME)
    await writeFile(draftPath, '{ this is not valid json', 'utf8')
    assert.equal(await readGatewayDraft(dir, identity, digest), null)

    // Mismatched identity
    const validRaw = JSON.stringify({ translations: { 'cue-1': 'A' } })
    const validSha = createHash('sha256').update(validRaw).digest('hex')
    const baseRecord: GatewayDraftRecord = {
      schemaVersion: 1,
      state: 'draft-validated',
      identity,
      raw: validRaw,
      rawSha256: validSha,
      observedModelId: 'e6fa609c3fa255c0',
      observedModel: '3.1 Pro',
      routeFingerprint: 'fingerprint-123',
      sourceDigest: digest,
      expectedIds: ['cue-1'],
      targetLocale: 'vi-VN',
      savedAtUtc: new Date().toISOString()
    }

    await writeGatewayDraft(dir, { ...baseRecord, identity: 'different-identity' })
    assert.equal(await readGatewayDraft(dir, identity, digest), null)

    // Mismatched sourceDigest
    await writeGatewayDraft(dir, { ...baseRecord, sourceDigest: 'wrong-digest' })
    assert.equal(await readGatewayDraft(dir, identity, digest), null)

    // Tampered raw content (raw does not match rawSha256)
    await writeGatewayDraft(dir, { ...baseRecord, raw: 'tampered-content' })
    assert.equal(await readGatewayDraft(dir, identity, digest), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Gateway draft checkpoint: adapter reuses valid draft and skips draft generation on retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-draft-resume-'))
  const auditPath = join(dir, 'translation-audit.json')
  try {
    const input = testInput(3)
    const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:4982/openai/v1', {
      auditPath,
      draftDir: dir
    })
    const plan = planTranslation(input, adapter.capability)
    const batch = plan.batches[0]

    const oldFetch = globalThis.fetch
    const stageCalls: string[] = []

    try {
      // First run: mock draft and review
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body || '{}'))
        const isReview = body.messages.some((m: any) => m.content?.includes?.('[CANDIDATE_JSON]'))
        stageCalls.push(isReview ? 'review' : 'draft')

        const items = input.cues.map((c) => ({ id: c.id, text: `Dịch ${c.id}.` }))
        return new Response(JSON.stringify({
          model: 'gemini-advanced',
          gateway_metadata: {
            contract_version: 2,
            resolved_model: 'gemini-advanced',
            observed_model_id: 'e6fa609c3fa255c0',
            observed_model: '3.1 Pro',
            route_fingerprint: 'route-xyz',
            model_verification: 'matched',
            completion_state: 'complete',
            upstream_attempts: 1
          },
          choices: [{
            message: { content: JSON.stringify({ translations: Object.fromEntries(items.map((i) => [i.id, i.text])) }) },
            finish_reason: 'stop'
          }]
        }))
      }

      const result1 = await adapter.requestOnce(batch, new AbortController().signal)
      assert.ok(result1.raw)
      assert.deepEqual(stageCalls, ['draft', 'review'])

      // Verify draft checkpoint was saved
      const savedDraftRaw = await readFile(join(dir, GATEWAY_DRAFT_FILENAME), 'utf8')
      assert.ok(savedDraftRaw.includes('draft-validated'))

      // Second run with same input and draftDir: should SKIP draft and ONLY call review!
      stageCalls.length = 0
      const result2 = await adapter.requestOnce(batch, new AbortController().signal)
      assert.ok(result2.raw)
      assert.deepEqual(stageCalls, ['review'])

      // Third run with modified source cue text: should MISS draft and call both draft + review!
      stageCalls.length = 0
      const modifiedInput: TranslationInput = {
        ...input,
        cues: [{ ...input.cues[0], text: 'Văn bản đã sửa đổi' }, ...input.cues.slice(1)]
      }
      const modifiedBatch = planTranslation(modifiedInput, adapter.capability).batches[0]
      const result3 = await adapter.requestOnce(modifiedBatch, new AbortController().signal)
      assert.ok(result3.raw)
      assert.deepEqual(stageCalls, ['draft', 'review'])
    } finally {
      globalThis.fetch = oldFetch
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
