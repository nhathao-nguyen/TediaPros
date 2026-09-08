import assert from 'node:assert/strict'
import test from 'node:test'
import { translateWithAdapter, type TranslationAdapter } from '../src/main/translation/orchestrator'
import { createTranslationBudget } from '../src/main/translation/budget'
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

test('expired active budget stops before dispatching another provider request', async () => {
  const seed = createTranslationBudget(1, () => 0).snapshot()
  const budget = createTranslationBudget(1, () => 0, {
    ...seed,
    activeElapsedMs: seed.activeBudgetMs
  })
  let calls = 0
  const adapter: TranslationAdapter = {
    capability,
    async requestOnce() {
      calls++
      return { raw: JSON.stringify({ items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }
  const result = await translateWithAdapter(input, adapter, new AbortController().signal, { budget })
  assert.equal(calls, 0)
  assert.equal(result.assessment.disposition, 'needs-review')
  assert.ok(result.assessment.issues.some((item) => item.code === 'budget-exhausted'))
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

test('a charged batch resumes as recovery work instead of bypassing the quota', async () => {
  const first = await translateWithAdapter(input, {
    capability,
    async requestOnce() {
      throw Object.assign(new Error('temporary provider failure'), { status: 503 })
    }
  }, new AbortController().signal, { sleep: async () => {} })
  assert.equal(first.assessment.disposition, 'needs-review')
  assert.equal(first.budget.normalUsed, 1)
  assert.equal(first.budget.recoveryUsed, 2)

  const resumed = await translateWithAdapter(input, {
    capability,
    async requestOnce(batch) {
      return { raw: JSON.stringify({ items: batch.input.cues.map((cue) => ({ id: cue.id, text: 'recovered' })) }), truncated: false, modelIdentity: 'fixture@resume' }
    }
  }, new AbortController().signal, {
    restoredBudget: first.budget,
    sleep: async () => {}
  })
  if (resumed.assessment.disposition !== 'validated') assert.fail(JSON.stringify(resumed.assessment))
  assert.equal(resumed.budget.normalUsed, 1)
  assert.equal(resumed.budget.recoveryUsed, 3)
})

test('resume plans the full source and filters completed IDs without renumbering batch quota', async () => {
  const multiInput: TranslationInput = {
    ...input,
    cues: Array.from({ length: 30 }, (_, index) => ({
      id: `cue-${index}`,
      sourceIndex: index,
      start: index * 2,
      end: index * 2 + 1,
      groupId: `g${index}`,
      text: `这是第${index}句需要保留完整上下文的测试文本。`.repeat(8)
    }))
  }
  let firstCalls = 0
  const firstRequested: string[][] = []
  const first = await translateWithAdapter(multiInput, {
    capability: { ...capability, contextTokens: 100_000, outputTokens: 512 },
    async requestOnce(batch) {
      firstCalls++
      const ids = batch.input.cues.map((cue) => cue.id)
      firstRequested.push(ids)
      if (firstCalls === 1) return { raw: JSON.stringify({ items: ids.map((id) => ({ id, text: `Translated ${id.split('-')[1]} `.repeat(8) })) }), truncated: false, modelIdentity: 'fixture@1' }
      throw Object.assign(new Error('temporary provider failure'), { status: 503 })
    }
  }, new AbortController().signal, { sleep: async () => {} })
  assert.ok(firstRequested.length > 1, 'fixture must create more than one normal batch')
  const restored = firstRequested[0]!.map((id) => ({ id, text: `Translated ${id.split('-')[1]} `.repeat(8) }))
  const resumedRequested: string[][] = []
  const resumed = await translateWithAdapter(multiInput, {
    capability: { ...capability, contextTokens: 100_000, outputTokens: 512 },
    async requestOnce(batch) {
      const ids = batch.input.cues.map((cue) => cue.id)
      resumedRequested.push(ids)
      return { raw: JSON.stringify({ items: ids.map((id) => ({ id, text: `Translated ${id.split('-')[1]} `.repeat(8) })) }), truncated: false, modelIdentity: 'fixture@resume' }
    }
  }, new AbortController().signal, { restoredBudget: first.budget, resumeItems: restored, sleep: async () => {} })
  if (resumed.assessment.disposition !== 'validated') assert.fail(JSON.stringify(resumed.assessment))
  assert.ok(resumedRequested.length > 0)
  assert.ok(resumedRequested.every((ids) => ids.every((id) => !restored.some((item) => item.id === id))))
  assert.equal(resumed.budget.normalUsed, first.budget.normalUsed)
})

test('resume keeps completed neighboring cues as read-only context for pending work', async () => {
  let observedContext: string[] = []
  const result = await translateWithAdapter(input, {
    capability: { ...capability, contextTokens: 100_000, outputTokens: 512 },
    async requestOnce(batch) {
      observedContext = [...batch.input.contextBefore, ...batch.input.contextAfter].map((cue) => cue.id)
      return { raw: JSON.stringify({ items: batch.input.cues.map((cue) => ({ id: cue.id, text: `translated ${cue.id}` })) }), truncated: false, modelIdentity: 'fixture@context' }
    }
  }, new AbortController().signal, {
    resumeItems: [{ id: 'a', text: 'đã xác thực' }]
  })
  assert.equal(result.assessment.disposition, 'validated')
  assert.deepEqual(observedContext, ['a'])
})

for (const [label, response] of [
  ['truncated response', { raw: JSON.stringify({ items: [{ id: 'a', t: 'A' }, { id: 'b', t: 'B' }] }), truncated: true }],
  ['unparsed continuation', { raw: '[a] A\n[b] B\ncontinuation was lost', truncated: false }]
] as const) {
  test(`rejects ${label} even when every cue ID is present`, async () => {
    let calls = 0
    const result = await translateWithAdapter(input, {
      capability: { ...capability, format: 'id-lines' },
      async requestOnce() {
        calls++
        return { ...response, modelIdentity: 'fixture@1' }
      }
    }, new AbortController().signal)
    assert.equal(result.assessment.disposition, 'needs-review')
    assert.ok(result.assessment.issues.some((item) => item.code === 'truncated-output' || item.code === 'unparsed-content'))
    assert.ok(calls > 1, 'invalid response must not be certified as complete')
  })
}
