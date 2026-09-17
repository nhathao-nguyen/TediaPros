import assert from 'node:assert/strict'
import test from 'node:test'
import { createGeminiGatewayTranslationAdapter } from '../src/main/geminiGateway'
import { planTranslation } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'

const source: TranslationInput = {
  sourceLanguage: 'zh',
  targetLocale: 'vi-VN',
  mode: 'dubbing',
  sourceVideoDuration: 6,
  cues: [
    { id: 'cue-1', sourceIndex: 0, start: 0, end: 1, groupId: 'old-1', text: '先打开盖子' },
    { id: 'cue-2', sourceIndex: 1, start: 1, end: 2, groupId: 'old-2', text: '再慢慢搅拌。' },
    { id: 'cue-3', sourceIndex: 2, start: 2, end: 3, groupId: 'old-3', text: '最后关火。' }
  ],
  contextBefore: [],
  contextAfter: [],
  glossary: []
}

function completion(text: string): Response {
  return new Response(JSON.stringify({
    model: 'gemini-advanced',
    gateway_metadata: {
      gateway_contract_version: 2,
      resolved_model: 'gemini-advanced',
      observed_model_id: 'observed-model-id',
      observed_model: 'fixture',
      route_fingerprint: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      model_verification: 'mismatch',
      completion_state: 'complete',
      completion_evidence: 'fixture-complete',
      upstream_attempts: 1
    },
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify({ translations: { 'cue-2': text } }) }
    }]
  }))
}

test('Gateway uses the 1M capacity and retains the full immutable source ledger when only one output cue is requested', async () => {
  const adapter = createGeminiGatewayTranslationAdapter('http://fixture.invalid/openai/v1')
  assert.equal(adapter.capability.contextTokens, 1_000_000)
  assert.equal(adapter.capability.outputTokens, 16_384)

  const planned = planTranslation(source, adapter.capability).batches[0]!
  const requested = {
    ...planned,
    input: { ...planned.input, cues: [planned.input.cues[1]!] },
    mapping: planned.mapping.filter((item) => item.unitId === 'cue-2')
  }
  const previousFetch = globalThis.fetch
  const bodies: Array<Record<string, any>> = []
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'))
      bodies.push(body)
      return completion(bodies.length === 1 ? 'Sau đó khuấy đều.' : 'Sau đó khuấy thật đều.')
    }
    const result = await adapter.requestOnce(requested, new AbortController().signal, source)
    assert.match(result.raw, /Sau đó khuấy thật đều/u)
  } finally {
    globalThis.fetch = previousFetch
  }

  assert.equal(bodies.length, 2)
  const draftPayload = bodies[0]!.messages.map((item: { content: string }) => item.content).join('\n')
  const reviewPayload = bodies[1]!.messages.map((item: { content: string }) => item.content).join('\n')
  for (const payload of [draftPayload, reviewPayload]) {
    assert.match(payload, /\[FULL_SOURCE_LEDGER_JSONL\]/u)
    assert.match(payload, /先打开盖子/u)
    assert.match(payload, /最后关火。/u)
    assert.match(payload, /\[REQUESTED_OUTPUT_IDS\]\["cue-2"\]/u)
    assert.match(payload, /\[SPEECH_UNIT_PLAN_JSONL\]/u)
    assert.match(payload, /target_natural_seconds/u)
    assert.match(payload, /hard_max_natural_seconds/u)
  }
  assert.equal(bodies[0]!.max_tokens, 16_384)
})

test('a truncated Gateway draft returns control to the scheduler and strictly splits unfinished output IDs', async () => {
  const adapter = createGeminiGatewayTranslationAdapter('http://fixture.invalid/openai/v1')
  const previousFetch = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = async (_url, init) => {
      calls++
      const body = JSON.parse(String(init?.body || '{}')) as { messages: Array<{ content: string }> }
      const payload = body.messages.map((item) => item.content).join('\n')
      const ids = JSON.parse(payload.match(/\[REQUESTED_OUTPUT_IDS\](.*?)\[\/REQUESTED_OUTPUT_IDS\]/u)?.[1] || '[]') as string[]
      const translations = Object.fromEntries(ids.map((id) => [id, `Bản dịch ${id}.`]))
      if (calls === 1) delete translations[ids.at(-1)!]
      return new Response(JSON.stringify({
        model: 'gemini-advanced',
        gateway_metadata: {
          gateway_contract_version: 2, resolved_model: 'gemini-advanced', observed_model_id: 'fixture',
          observed_model: 'fixture', route_fingerprint: 'a'.repeat(64), model_verification: 'matched',
          completion_state: 'complete', completion_evidence: 'fixture-complete', upstream_attempts: 1
        },
        choices: [{ finish_reason: calls === 1 ? 'length' : 'stop', message: { content: JSON.stringify({ translations }) } }]
      }))
    }
    const input: TranslationInput = {
      sourceLanguage: 'en', targetLocale: 'vi-VN', mode: 'subtitle', contextBefore: [], contextAfter: [], glossary: [],
      cues: ['one', 'two', 'three', 'four'].map((id, sourceIndex) => ({ id, groupId: id, sourceIndex, start: sourceIndex, end: sourceIndex + 1, text: `Source ${id}.` }))
    }
    const { translateWithAdapter } = await import('../src/main/translation/orchestrator')
    const result = await translateWithAdapter(input, adapter, new AbortController().signal)
    assert.equal(result.assessment.disposition, 'validated')
    assert.deepEqual(result.items.map((item) => item.id), ['one', 'two', 'three', 'four'])
    assert.equal(calls, 5)
  } finally {
    globalThis.fetch = previousFetch
  }
})
