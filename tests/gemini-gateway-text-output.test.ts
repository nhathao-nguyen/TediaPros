import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeminiGatewayTranslationAdapter } from '../src/main/geminiGateway'
import { planTranslation } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'

const source: TranslationInput = {
  sourceLanguage: 'en',
  targetLocale: 'vi-VN',
  mode: 'subtitle',
  contextBefore: [],
  contextAfter: [],
  glossary: [],
  cues: [
    { id: 'cue-1', sourceIndex: 0, start: 0, end: 1, groupId: 'g-1', text: 'Open the lid.' },
    { id: 'cue-2', sourceIndex: 1, start: 1, end: 2, groupId: 'g-1', text: 'Stir slowly.' }
  ]
}

function completion(content: string, includeContract = true): Response {
  return new Response(JSON.stringify({
    model: 'gemini-advanced',
    gateway_metadata: {
      gateway_contract_version: 2,
      resolved_model: 'gemini-advanced',
      observed_model_id: 'fixture-model',
      observed_model: 'fixture',
      route_fingerprint: 'a'.repeat(64),
      model_verification: 'matched',
      completion_state: 'complete',
      completion_evidence: 'fixture-complete',
      upstream_attempts: 1,
      ...(includeContract ? { text_output_contract: 'cue-lines-v1' } : {})
    },
    choices: [{ finish_reason: 'stop', message: { content } }]
  }))
}

test('Gateway cue-lines-v1 omits response_format and normalizes exact labelled output', async () => {
  const adapter = createGeminiGatewayTranslationAdapter('http://fixture.invalid/openai/v1', { outputMode: 'cue-lines-v1' })
  const batch = planTranslation(source, adapter.capability).batches[0]!
  const previousFetch = globalThis.fetch
  const bodies: Array<Record<string, any>> = []
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, any>
      bodies.push(body)
      return completion('[cue-1] Mở nắp.\n[cue-2] Khuấy từ từ.')
    }
    const result = await adapter.requestOnce(batch, new AbortController().signal)
    assert.deepEqual(JSON.parse(result.raw), {
      items: [
        { id: 'cue-1', text: 'Mở nắp.' },
        { id: 'cue-2', text: 'Khuấy từ từ.' }
      ]
    })
  } finally {
    globalThis.fetch = previousFetch
  }
  assert.equal(bodies.length, 2)
  for (const body of bodies) {
    assert.equal(body.response_format, undefined)
    assert.deepEqual(body.gateway_requirements, {
      contract_version: 2,
      require_verified_model: false,
      require_complete_response: true,
      text_output_contract: 'cue-lines-v1'
    })
    assert.match(body.messages[0].content, /format=cue-lines-v1/u)
    assert.match(body.messages[0].content, /Do not wrap them in JSON/u)
  }
})

test('Gateway cue-lines-v1 refuses a response without echoed contract evidence', async () => {
  const adapter = createGeminiGatewayTranslationAdapter('http://fixture.invalid/openai/v1', { outputMode: 'cue-lines-v1' })
  const batch = planTranslation(source, adapter.capability).batches[0]!
  const previousFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => completion('[cue-1] Mở nắp.\n[cue-2] Khuấy từ từ.', false)
    await assert.rejects(
      adapter.requestOnce(batch, new AbortController().signal),
      /text_output_contract=cue-lines-v1/u
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})
