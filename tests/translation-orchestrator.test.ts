import assert from 'node:assert/strict'
import test from 'node:test'
import { translateWithAdapter, type TranslationAdapter } from '../src/main/translation/orchestrator'
import type { TranslationInput } from '../src/shared/translation'
import type { TranslationCapability } from '../src/main/translation/planner'

const capability: TranslationCapability = {
  provider: 'fixture', modelIdentity: 'fixture@1', revisionKnown: true, format: 'json-items',
  contextTokens: 8192, outputTokens: 2048
}
const input: TranslationInput = {
  sourceLanguage: 'zh', targetLocale: 'en', mode: 'subtitle',
  cues: [
    { id: 'a', sourceIndex: 0, start: 0, end: 1, groupId: 'g0', text: '第一句。' },
    { id: 'b', sourceIndex: 1, start: 1, end: 2, groupId: 'g1', text: '第二句。' }
  ],
  contextBefore: [], contextAfter: [], glossary: []
}

test('only missing work is retried and total requests is finite', async () => {
  const requested: string[][] = []
  const checkpoints: Array<{ ids: string[]; disposition: string }> = []
  const adapter: TranslationAdapter = {
    capability,
    async requestOnce(batch) {
      const ids = batch.input.cues.map((cue) => cue.id)
      requested.push(ids)
      const returned = requested.length === 1 ? ids.slice(0, -1) : ids
      return { raw: JSON.stringify({ items: returned.map((id) => ({ id, t: `translated ${id}` })) }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }
  const result = await translateWithAdapter(input, adapter, new AbortController().signal, {
    onBatch: (_batchId, batch) => checkpoints.push({ ids: batch.items.map((item) => item.id), disposition: batch.assessment.disposition })
  })
  assert.equal(result.items.length, 2)
  assert.deepEqual(requested[1], ['b'])
  assert.deepEqual(checkpoints[0]?.ids, ['a'])
  assert.notEqual(result.assessment.disposition, 'needs-review')
})

test('persistent malformed responses terminate with needs-review instead of looping', async () => {
  let calls = 0
  const adapter: TranslationAdapter = {
    capability,
    async requestOnce() {
      calls++
      return { raw: 'model prose without ids', truncated: false, modelIdentity: 'fixture@1' }
    }
  }
  const result = await translateWithAdapter(input, adapter, new AbortController().signal)
  assert.equal(result.assessment.disposition, 'needs-review')
  assert.ok(calls <= 5)
  assert.ok(result.assessment.issues.some((issue) => issue.code === 'unparsed-content' || issue.code === 'budget-exhausted' || issue.code === 'no-progress'))
})

test('structured provider auth failure does not retry', async () => {
  let calls = 0
  const adapter: TranslationAdapter = {
    capability,
    async requestOnce() {
      calls++
      throw Object.assign(new Error('unauthorized'), { status: 401, providerCode: 'invalid_api_key' })
    }
  }
  const result = await translateWithAdapter(input, adapter, new AbortController().signal)
  assert.equal(calls, 1)
  assert.equal(result.assessment.issues[0]?.code, 'provider-auth')
})

test('cancellation never dispatches a sibling request', async () => {
  const controller = new AbortController()
  let calls = 0
  const adapter: TranslationAdapter = {
    capability,
    async requestOnce() {
      calls++
      controller.abort()
      return { raw: JSON.stringify({ items: [{ id: 'a', t: 'A' }] }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }
  const result = await translateWithAdapter(input, adapter, controller.signal)
  assert.equal(calls, 1)
  assert.equal(result.assessment.issues[0]?.code, 'cancelled')
})

test('transient provider failure honors bounded Retry-After before one recovery request', async () => {
  let calls = 0
  const sleeps: number[] = []
  const adapter: TranslationAdapter = {
    capability,
    async requestOnce(batch) {
      calls++
      if (calls === 1) throw Object.assign(new Error('busy'), { status: 503, retryAfterMs: 25 })
      return { raw: JSON.stringify({ items: batch.input.cues.map((cue) => ({ id: cue.id, t: `translated ${cue.id}` })) }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }
  const result = await translateWithAdapter(input, adapter, new AbortController().signal, {
    sleep: async (delayMs) => { sleeps.push(delayMs) }
  })
  assert.equal(calls, 2)
  assert.deepEqual(sleeps, [25])
  assert.equal(result.assessment.disposition, 'validated')
})
