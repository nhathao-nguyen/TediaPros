import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGeminiGatewayTranslationAdapter, checkGeminiGateway, rephraseGeminiGateway, isPermanentGatewayError } from '../src/main/geminiGateway'
import { parseAiJsonObject } from '../src/shared/aiOutput'
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
      contract_version: 2,
      requested_model: 'gemini-advanced',
      resolved_model: 'gemini-advanced',
      observed_model_id: 'e6fa609c3fa255c0',
      model_verification: 'matched',
      completion_state: 'complete',
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
      assert.deepEqual(body.gateway_requirements, {
        contract_version: 2,
        require_verified_model: true,
        require_complete_response: true
      })
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
    assert.equal(audit.promptVersion, 'gemini-gateway-two-pass-v4')
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
      return new Response(JSON.stringify({ gateway_contract_version: 2, models: ['gemini-advanced'], model_selection: 'observed-id-required', schema_mode: 'prompt-only' }))
    }
    const result = await checkGeminiGateway('http://127.0.0.1:4982/openai/v1')
    assert.equal(result.ok, true)
    assert.deepEqual(request, { url: 'http://127.0.0.1:4982/openai/v1/gateway/capabilities', method: undefined })
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('Gemini Gateway connection check reports expired gateway cookies before model availability', async () => {
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      gateway_contract_version: 2,
      models: [],
      provider_ready: false,
      provider_error: 'authentication_required',
      model_selection: 'observed-id-required',
      schema_mode: 'prompt-only'
    }))
    const result = await checkGeminiGateway('http://127.0.0.1:4982/openai/v1')
    assert.equal(result.ok, false)
    assert.match(result.message, /cookie Gemini.*hết hạn hoặc không hợp lệ/iu)
    assert.doesNotMatch(result.message, /chưa cung cấp gemini-advanced/iu)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('Gemini Gateway connection check requires contract version 2', async () => {
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      gateway_contract_version: 1,
      models: ['gemini-advanced'],
      model_selection: 'exact',
      schema_mode: 'prompt-only'
    }))
    const result = await checkGeminiGateway('http://127.0.0.1:4982/openai/v1')
    assert.equal(result.ok, false)
    assert.match(result.message, /chưa hỗ trợ hợp đồng phiên bản 2/iu)
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
      gateway_metadata: {
        contract_version: 2,
        resolved_model: 'gemini-2.5-flash',
        observed_model_id: 'c80884df2d854497',
        model_verification: 'matched',
        completion_state: 'complete'
      },
      choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Volvo.' } }) }, finish_reason: 'stop' }]
    }))
    await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), /thay vì gemini-advanced/u)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('Gemini Gateway rejects responses lacking contract version 2 or verified model', async () => {
  const adapter = createGeminiGatewayTranslationAdapter()
  const batch = planTranslation(input(1), adapter.capability).batches[0]
  const oldFetch = globalThis.fetch
  try {
    // Missing contract version
    globalThis.fetch = async () => new Response(JSON.stringify({
      model: 'gemini-advanced',
      choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Volvo.' } }) }, finish_reason: 'stop' }]
    }))
    await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), /phiên bản 2/u)

    // Model verification not matched
    globalThis.fetch = async () => new Response(JSON.stringify({
      model: 'gemini-advanced',
      gateway_metadata: {
        contract_version: 2,
        resolved_model: 'gemini-advanced',
        observed_model_id: 'e6fa609c3fa255c0',
        model_verification: 'unverified',
        completion_state: 'complete'
      },
      choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Volvo.' } }) }, finish_reason: 'stop' }]
    }))
    await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), /trạng thái unverified/u)

    // Incomplete completion_state
    globalThis.fetch = async () => new Response(JSON.stringify({
      model: 'gemini-advanced',
      gateway_metadata: {
        contract_version: 2,
        resolved_model: 'gemini-advanced',
        observed_model_id: 'e6fa609c3fa255c0',
        model_verification: 'matched',
        completion_state: 'incomplete'
      },
      choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Volvo.' } }) }, finish_reason: 'stop' }]
    }))
    await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), /chưa hoàn tất/u)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('Gemini Gateway reports clear message for model-unavailable error', async () => {
  const adapter = createGeminiGatewayTranslationAdapter()
  const batch = planTranslation(input(1), adapter.capability).batches[0]
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { code: 'model-unavailable', message: 'model gemini-advanced is not available' }
    }), { status: 422 })
    await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), /chưa hỗ trợ Gemini 3.1 Pro/u)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('isPermanentGatewayError classifies permanent vs transient errors', () => {
  assert.equal(isPermanentGatewayError('Tài khoản Google của gateway chưa hỗ trợ Gemini 3.1 Pro (cần gói Google One AI Premium).'), true)
  assert.equal(isPermanentGatewayError('Gemini Gateway trả về model không khớp: expected 3.1 Pro'), true)
  assert.equal(isPermanentGatewayError('Cookie Gemini của gateway đã hết hạn hoặc không hợp lệ.'), true)
  assert.equal(isPermanentGatewayError('Gemini Gateway không thể chuẩn hóa JSON có cấu trúc: invalid-structured-json'), true)
  assert.equal(isPermanentGatewayError('Gemini Gateway không trả về hợp đồng phiên bản 2'), true)
  assert.equal(isPermanentGatewayError('Gemini Gateway không xác thực được model: trạng thái unverified.'), true)
  assert.equal(isPermanentGatewayError('Lỗi mạng tạm thời khi gọi gateway'), false)
  assert.equal(isPermanentGatewayError('Gateway timeout sau 60s'), false)
})

test('Gemini Gateway rephrase keeps the existing labelled-candidate grammar', async () => {
  const oldFetch = globalThis.fetch
  let body: any
  try {
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body || '{}'))
      return new Response(JSON.stringify({
        model: 'gemini-advanced',
        gateway_metadata: {
          contract_version: 2,
          resolved_model: 'gemini-advanced',
          observed_model_id: 'e6fa609c3fa255c0',
          model_verification: 'matched',
          completion_state: 'complete',
          upstream_attempts: 1
        },
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

test('Gemini Gateway structured JSON vectors parity with Go gateway normalizer', async () => {
  const casesPath = join(process.cwd(), 'tests', 'fixtures', 'gemini-gateway-structured-json-cases.json')
  const cases: Array<{
    name: string
    input: string
    expectedValid: boolean
    expectedOperations?: string[]
    expectedText?: string
    expectedErrorCode?: string
  }> = JSON.parse(await readFile(casesPath, 'utf8'))

  for (const tc of cases) {
    if (tc.expectedValid) {
      const parsed = parseAiJsonObject(tc.input, { allowFence: true, allowProseObject: false })
      assert.ok(parsed.value, `Case ${tc.name} should yield valid parsed object`)
    } else {
      assert.throws(
        () => parseAiJsonObject(tc.input, { allowFence: true, allowProseObject: false }),
        (err: any) => Boolean(err),
        `Case ${tc.name} must be rejected`
      )
    }
  }
})

test('checkGeminiGateway passes through cached verification from capabilities', async () => {
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          provider_ready: true,
          models: ['gemini-advanced'],
          model_selection: 'observed-id-required',
          gateway_verification: {
            state: 'verified',
            requested_model: 'gemini-advanced',
            observed_model_id: 'e6fa609c3fa255c0',
            observed_model: '3.1 Pro',
            verified_at_utc: '2026-09-14T13:00:00Z',
            expires_at_utc: '2026-09-14T13:15:00Z',
            verification_generation_requests: 0
          }
        }))
      }
      throw new Error(`Unexpected URL: ${url}`)
    }
    const status = await checkGeminiGateway('http://127.0.0.1:4982')
    assert.equal(status.ok, true)
    assert.equal(status.gatewayVerification?.state, 'verified')
    assert.equal(status.gatewayVerification?.observedModelId, 'e6fa609c3fa255c0')
    assert.equal(status.gatewayVerification?.observedModel, '3.1 Pro')
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('checkGeminiGateway with verifyModel calls POST /gateway/verify-model and handles verified and mismatch states', async () => {
  const oldFetch = globalThis.fetch
  let verifyBody: any
  try {
    // 1. Success (verified)
    globalThis.fetch = async (url, init) => {
      if (String(url).endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          provider_ready: true,
          models: ['gemini-advanced'],
          model_selection: 'observed-id-required'
        }))
      }
      if (String(url).endsWith('/gateway/verify-model')) {
        verifyBody = JSON.parse(String(init?.body || '{}'))
        return new Response(JSON.stringify({
          state: 'verified',
          requested_model: 'gemini-advanced',
          observed_model_id: 'e6fa609c3fa255c0',
          observed_model: '3.1 Pro',
          verified_at_utc: '2026-09-14T13:00:00Z',
          expires_at_utc: '2026-09-14T13:15:00Z',
          verification_generation_requests: 1
        }))
      }
      throw new Error(`Unexpected URL: ${url}`)
    }
    const statusVerified = await checkGeminiGateway('http://127.0.0.1:4982', { verifyModel: true, force: true })
    assert.equal(statusVerified.ok, true)
    assert.match(statusVerified.message, /Đã xác minh Gemini 3.1 Pro/)
    assert.equal(statusVerified.gatewayVerification?.state, 'verified')
    assert.equal(verifyBody.model, 'gemini-advanced')
    assert.equal(verifyBody.force, true)

    // 2. Mismatch
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          provider_ready: true,
          models: ['gemini-advanced'],
          model_selection: 'observed-id-required'
        }))
      }
      if (String(url).endsWith('/gateway/verify-model')) {
        return new Response(JSON.stringify({
          state: 'mismatch',
          requested_model: 'gemini-advanced',
          observed_model_id: 'flash-model-id',
          observed_model: '3.8 Flash',
          verification_generation_requests: 1,
          error_message: 'observed model mismatch'
        }))
      }
      throw new Error(`Unexpected URL: ${url}`)
    }
    const statusMismatch = await checkGeminiGateway('http://127.0.0.1:4982', { verifyModel: true })
    assert.equal(statusMismatch.ok, false)
    assert.match(statusMismatch.message, /Gateway trả sai model/)
    assert.equal(statusMismatch.gatewayVerification?.state, 'mismatch')
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('audit log redacts sensitive query parameters, tokens, and cookies', async () => {
  const auditDir = await mkdtemp(join(tmpdir(), 'tedia-gemini-audit-redact-'))
  const auditPath = join(auditDir, 'translation-audit.json')
  const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:4982/openai/v1', { auditPath })
  const source = input(1)
  const plan = planTranslation(source, adapter.capability)

  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      throw new Error('Connection failed to https://gemini.google.com/rpc?token=SECRET_TOKEN_12345&psid=SECURE1PSID_SECRET with Cookie: __Secure-1PSID=SECRET_COOKIE')
    }
    await adapter.requestOnce(plan.batches[0], new AbortController().signal).catch(() => {})

    const auditContent = await readFile(auditPath, 'utf8')
    assert.doesNotMatch(auditContent, /SECRET_TOKEN_12345/)
    assert.doesNotMatch(auditContent, /SECURE1PSID_SECRET/)
    assert.doesNotMatch(auditContent, /SECRET_COOKIE/)
    assert.match(auditContent, /\[redacted/i)
  } finally {
    globalThis.fetch = oldFetch
    await rm(auditDir, { recursive: true, force: true }).catch(() => {})
  }
})
