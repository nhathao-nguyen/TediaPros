import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGeminiGatewayTranslationAdapter, checkGeminiGateway, rephraseGeminiGateway } from '../src/main/geminiGateway'
import { planTranslation } from '../src/main/translation/planner'
import { translateWithAdapter } from '../src/main/translation/orchestrator'
import type { TranslationInput } from '../src/shared/translation'

function input(count = 44): TranslationInput {
  return {
    sourceLanguage: 'zh',
    targetLocale: 'vi-VN',
    mode: 'dubbing',
    cues: Array.from({ length: count }, (_, index) => ({
      id: `cue-${index + 1}`,
      sourceIndex: index,
      start: index * 1.2,
      end: index * 1.2 + 1,
      groupId: `g-${Math.floor(index / 4)}`,
      text: index === 0 ? '沃尔沃的声音' : index === 42 ? '窝耳窝的按键声' : `这是第${index + 1}句`
    })),
    contextBefore: [],
    contextAfter: [],
    glossary: []
  }
}

function completion(items: Array<{ id: string; text: string }>): Response {
  return new Response(JSON.stringify({
    model: 'gemini-advanced',
    gateway_metadata: {
      requested_model: 'gemini-advanced',
      resolved_model: 'gemini-advanced',
      upstream_attempts: 2,
      upstream_retry_reasons: ['invalid-json-object']
    },
    choices: [{ message: { content: JSON.stringify({
      translations: Object.fromEntries(items.map((item) => [item.id, item.text]))
    }) }, finish_reason: 'stop' }]
  }))
}

test('Gemini Gateway keeps a 44-cue short in one batch and performs exactly draft plus review', async () => {
  const auditDir = await mkdtemp(join(tmpdir(), 'tedia-gemini-audit-'))
  const auditPath = join(auditDir, 'translation-audit.json')
  const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:4982/openai/v1', { auditPath })
  const source = input()
  const plan = planTranslation(source, adapter.capability)
  assert.equal(plan.batches.length, 1)
  assert.equal(plan.batches[0].input.cues.length, 44)
  assert.equal(plan.batches[0].maxOutputTokens, 16_384)

  const oldFetch = globalThis.fetch
  const requests: Array<{ url: string; body: any }> = []
  try {
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body || '{}'))
      requests.push({ url: String(url), body })
      assert.equal(body.model, 'gemini-advanced')
      assert.equal(body.temporary, true)
      assert.equal(body.response_format.json_schema.strict, true)
      assert.deepEqual(body.response_format.json_schema.schema.required, ['translations'])
      const final = requests.length === 2
      const items = source.cues.map((cue) => ({
        id: cue.id,
        text: cue.id === 'cue-43'
          ? (final ? 'Âm thanh nút bấm của Volvo.' : 'Âm thanh bàn phím Wooting.')
          : `Bản dịch ${cue.id}.`
      }))
      return completion(items)
    }
    const result = await translateWithAdapter(source, adapter, new AbortController().signal, {
      plan
    })
    assert.equal(result.assessment.disposition === 'needs-review', false)
    assert.equal(result.items.find((item) => item.id === 'cue-43')?.text, 'Âm thanh nút bấm của Volvo.')
    assert.equal(requests.length, 2)
    assert.ok(requests.every((request) => request.url === 'http://127.0.0.1:4982/openai/v1/chat/completions'))
    assert.match(requests[0].body.messages[0].content, /Read the complete source ledger/u)
    assert.match(requests[0].body.messages[0].content, /established automotive wording/u)
    assert.match(requests[0].body.messages[0].content, /Restore natural target-language punctuation/u)
    assert.doesNotMatch(requests[0].body.messages[0].content, /Translated punctuation must not redefine speech boundaries/u)
    assert.doesNotMatch(requests[0].body.messages[0].content, /form one speech unit established before translation/u)
    assert.match(requests[0].body.messages[0].content, /context hints, not target sentence boundaries/u)
    assert.match(requests[0].body.messages[0].content, /translations.*cue-id.*translation/iu)
    assert.match(requests[1].body.messages[0].content, /fresh translation reviewer/u)
    assert.match(requests[1].body.messages[0].content, /computer-keyboard or legal-exclusivity wording/u)
    assert.match(requests[1].body.messages[0].content, /Rebuild punctuation/u)
    assert.match(requests[1].body.messages[1].content, /CANDIDATE_JSON/u)
    assert.match(requests[1].body.messages[1].content, /Wooting/u)
    assert.match(requests[1].body.messages[1].content, /沃尔沃/u)
    const audit = JSON.parse(await readFile(auditPath, 'utf8'))
    assert.equal(audit.promptVersion, 'gemini-gateway-two-pass-v3')
    assert.deepEqual(audit.records.map((record: any) => record.stage), ['restore-translate', 'independent-review'])
    assert.equal(audit.records[1].response.sha256.length, 64)
    assert.deepEqual(audit.records[1].response.upstreamRetryReasons, ['invalid-json-object'])
    assert.equal(audit.records[1].request.messages[1].content.includes('CANDIDATE_JSON'), true)
  } finally {
    globalThis.fetch = oldFetch
    await rm(auditDir, { recursive: true, force: true })
  }
})

test('Gemini Gateway uses compact keyed output for a 113-cue video while returning canonical items', async () => {
  const source = input(113)
  const adapter = createGeminiGatewayTranslationAdapter()
  const plan = planTranslation(source, adapter.capability)
  const oldFetch = globalThis.fetch
  const rawSizes: number[] = []
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'))
      assert.deepEqual(body.response_format.json_schema.schema.required, ['translations'])
      const items = source.cues.map((cue) => ({ id: cue.id, text: `Bản dịch ${cue.id}.` }))
      const compact = JSON.stringify({ translations: Object.fromEntries(items.map((item) => [item.id, item.text])) })
      const legacy = JSON.stringify({ items })
      rawSizes.push(compact.length)
      assert.ok(compact.length < legacy.length)
      return completion(items)
    }
    const result = await translateWithAdapter(source, adapter, new AbortController().signal, { plan })
    assert.equal(result.items.length, 113)
    assert.notEqual(result.assessment.disposition, 'needs-review')
    assert.equal(rawSizes.length, 2)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('Gemini Gateway rejects an unpunctuated dubbing review before publication', async () => {
  const source = input(12)
  const adapter = createGeminiGatewayTranslationAdapter()
  const batch = planTranslation(source, adapter.capability).batches[0]
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => completion(source.cues.map((cue) => ({ id: cue.id, text: 'mảnh lời chưa có dấu câu' })))
    await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), /dấu kết thúc cho câu cuối/u)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('Gemini Gateway connection check discovers gemini-advanced without a generation request', async () => {
  const oldFetch = globalThis.fetch
  let request: { url: string; method?: string } | undefined
  try {
    globalThis.fetch = async (url, init) => {
      request = { url: String(url), method: init?.method }
      return new Response(JSON.stringify({ models: ['gemini-advanced'], model_selection: 'exact', schema_mode: 'prompt-only' }))
    }
    const result = await checkGeminiGateway('http://127.0.0.1:4982/openai/v1')
    assert.equal(result.ok, true)
    assert.deepEqual(request, { url: 'http://127.0.0.1:4982/openai/v1/gateway/capabilities', method: undefined })
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('Gemini Gateway rejects a model fallback reported by the gateway', async () => {
  const adapter = createGeminiGatewayTranslationAdapter()
  const batch = planTranslation(input(1), adapter.capability).batches[0]
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      model: 'gemini-2.5-flash',
      gateway_metadata: { resolved_model: 'gemini-2.5-flash' },
      choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Volvo.' } }) }, finish_reason: 'stop' }]
    }))
    await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), /thay vì gemini-advanced/u)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('Gemini Gateway rephrase keeps the existing labelled-candidate grammar', async () => {
  const oldFetch = globalThis.fetch
  let body: any
  try {
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({
        model: 'gemini-advanced',
        gateway_metadata: { resolved_model: 'gemini-advanced', upstream_attempts: 1 },
        choices: [{ message: { content: '[cue-1:1] Bản ngắn hơn' }, finish_reason: 'stop' }]
      }))
    }
    const output = await rephraseGeminiGateway(undefined, [
      { role: 'system', content: 'Return labelled candidates.' },
      { role: 'user', content: 'cue-1' }
    ], new AbortController().signal)
    assert.equal(output, '[cue-1:1] Bản ngắn hơn')
    assert.equal(body.temporary, true)
    assert.equal(body.response_format, undefined)
  } finally {
    globalThis.fetch = oldFetch
  }
})
