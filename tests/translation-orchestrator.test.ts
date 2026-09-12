import assert from 'node:assert/strict'
import test from 'node:test'
import { translateWithAdapter, type TranslationAdapter } from '../src/main/translation/orchestrator'
import { createTranslationBudget } from '../src/main/translation/budget'
import type { TranslationInput } from '../src/shared/translation'
import { planTranslation, type TranslationCapability } from '../src/main/translation/planner'
import { buildTranslationBatchMessages } from '../src/main/translation/prompts'

test('dubbing resume and missing-ID recovery retain the original source speech group', async () => {
  const source: TranslationInput = {
    sourceLanguage: 'zh', targetLocale: 'en', mode: 'dubbing', contextBefore: [], contextAfter: [], glossary: [],
    cues: [
      { id: 'first', sourceIndex: 0, start: 0, end: 1, text: '遇到墙角', groupId: 'cue-0' },
      { id: 'middle', sourceIndex: 1, start: 1, end: 2, text: '尺寸对不上', groupId: 'cue-1' },
      { id: 'last', sourceIndex: 2, start: 2, end: 3, text: '怎么办？', groupId: 'cue-2' }
    ]
  }
  const requested: string[][] = []
  const result = await translateWithAdapter(source, {
    capability: { provider: 'fixture', modelIdentity: 'fixture@1', revisionKnown: true, format: 'json-items', contextTokens: null, outputTokens: 2048 },
    async requestOnce(batch) {
      requested.push(batch.input.cues.map(cue => cue.id))
      assert.ok(batch.input.cues.every(cue => cue.groupId === 'source-speech-v1:first'))
      const messages = buildTranslationBatchMessages(batch, 'json-items')
      const groups = messages[1].content.split('[SOURCE_GROUP_CONTEXT_JSONL]')[1].split('[/SOURCE_GROUP_CONTEXT_JSONL]')[0]
      assert.match(groups, /"group_id":"source-speech-v1:first"/u)
      const items = requested.length === 1
        ? [{ id: 'middle', text: 'when the dimensions do not match' }]
        : [{ id: 'last', text: 'what should you do?' }]
      return { raw: JSON.stringify({ items }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal, { resumeItems: [{ id: 'first', text: 'At a wall corner' }] })
  assert.deepEqual(requested, [['middle', 'last'], ['last']])
  assert.deepEqual(result.items.map(item => item.id), ['first', 'middle', 'last'])
  assert.notEqual(result.assessment.disposition, 'needs-review')
})

test('sparse dubbing resume keeps the accepted middle negation in complete read-only group context', async () => {
  const source: TranslationInput = {
    sourceLanguage: 'zh', targetLocale: 'en', mode: 'dubbing', contextBefore: [], contextAfter: [], glossary: [],
    cues: [
      { id: 'a', sourceIndex: 0, start: 0, end: 1, text: '这个操作', groupId: 'cue-0' },
      { id: 'b', sourceIndex: 1, start: 1, end: 2, text: '绝对不能', groupId: 'cue-1' },
      { id: 'c', sourceIndex: 2, start: 2, end: 3, text: '直接执行。', groupId: 'cue-2' }
    ]
  }
  let groupText = ''
  let requestedIds: string[] = []
  const result = await translateWithAdapter(source, {
    capability: { provider: 'fixture', modelIdentity: 'fixture@1', revisionKnown: true, format: 'json-items', contextTokens: null, outputTokens: 2048 },
    async requestOnce(batch) {
      requestedIds = batch.input.cues.map(cue => cue.id)
      const user = buildTranslationBatchMessages(batch, 'json-items')[1].content
      groupText = user.split('[SOURCE_GROUP_CONTEXT_JSONL]')[1].split('[/SOURCE_GROUP_CONTEXT_JSONL]')[0]
      return { raw: JSON.stringify({ items: [{ id: 'a', text: 'This operation' }, { id: 'c', text: 'be performed directly.' }] }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal, { resumeItems: [{ id: 'b', text: 'must never' }] })
  assert.match(groupText, /这个操作绝对不能直接执行。/u)
  assert.match(groupText, /"ids":\["a","b","c"\]/u)
  assert.deepEqual(requestedIds, ['a', 'c'])
  assert.deepEqual(result.items.map(item => item.id), ['a', 'b', 'c'])
  assert.notEqual(result.assessment.disposition, 'needs-review')
})

test('malformed singleton receives a repair task with parser feedback', async () => {
  let calls = 0
  const result = await translateWithAdapter({ ...input, cues: input.cues.slice(0, 1) }, {
    capability,
    async requestOnce(batch) {
      calls++
      const messages = buildTranslationBatchMessages(batch, 'json-items')
      if (calls === 1) return { raw: 'bad format', truncated: false, modelIdentity: 'fixture@1' }
      assert.match(messages[0].content, /task=repair/u)
      assert.match(messages[1].content, /REPAIR_ISSUES_JSON/u)
      assert.ok(batch.repairIssues?.length)
      return { raw: JSON.stringify({ items: [{ id: batch.input.cues[0].id, text: 'First sentence.' }] }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal)
  assert.equal(calls, 2)
  assert.equal(result.items.length, 1)
  assert.notEqual(result.assessment.disposition, 'needs-review')
})

test('content warnings trigger one focused repair before publishing', async () => {
  let calls = 0
  const source: TranslationInput = {
    ...input,
    cues: [{ id: 'a', sourceIndex: 0, start: 0, end: 1, groupId: 'g0', text: '这里有十四个地方。' }]
  }
  const result = await translateWithAdapter(source, {
    capability,
    async requestOnce(batch) {
      calls++
      if (calls === 1) {
        return { raw: JSON.stringify({ items: [{ id: 'a', text: 'There are 13 places here.' }] }), truncated: false, modelIdentity: 'fixture@1' }
      }
      assert.ok(batch.repairIssues?.some((issue) => issue.code === 'protected-token-suspect'))
      assert.deepEqual(batch.input.cues.map((cue) => cue.id), ['a'])
      return { raw: JSON.stringify({ items: [{ id: 'a', text: 'There are 14 places here.' }] }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal)
  assert.equal(calls, 2)
  assert.deepEqual(result.items, [{ id: 'a', text: 'There are 14 places here.' }])
  assert.equal(result.assessment.disposition, 'validated')
})

test('content warning repair stops after one no-progress response', async () => {
  let calls = 0
  const source: TranslationInput = {
    ...input,
    cues: [{ id: 'a', sourceIndex: 0, start: 0, end: 1, groupId: 'g0', text: '这里有十四个地方。' }]
  }
  const result = await translateWithAdapter(source, {
    capability,
    async requestOnce() {
      calls++
      return { raw: JSON.stringify({ items: [{ id: 'a', text: 'There are 13 places here.' }] }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal)
  assert.equal(calls, 2)
  assert.equal(result.assessment.disposition, 'with-warnings')
  assert.ok(result.assessment.issues.some((issue) => issue.code === 'protected-token-suspect'))
})

test('unknown provider token limits do not surface as a user-action warning after success', async () => {
  let calls = 0
  const result = await translateWithAdapter({ ...input, cues: input.cues.slice(0, 1) }, {
    capability: { ...capability, contextTokens: null, outputTokens: null },
    async requestOnce() {
      calls++
      return { raw: JSON.stringify({ items: [{ id: 'a', text: 'First sentence.' }] }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal)
  assert.equal(calls, 1)
  assert.equal(result.assessment.disposition, 'validated')
  assert.equal(result.assessment.issues.length, 0)
})

test('natural translation of a Chinese A-not-A question needs no quality repair', async () => {
  let calls = 0
  const source: TranslationInput = {
    ...input,
    mode: 'dubbing',
    cues: [
      { id: 'a', sourceIndex: 0, start: 1.49, end: 2.9, speakingDuration: 1.42, groupId: 'g0', text: '不同的螃蟹能不能吃？' },
      { id: 'b', sourceIndex: 1, start: 3.41, end: 4, speakingDuration: 1.09, groupId: 'g1', text: '这种螃蟹可以吃。' }
    ]
  }
  const result = await translateWithAdapter(source, {
    capability: { ...capability, format: 'id-lines' },
    async requestOnce() {
      calls++
      return {
        raw: '[a] Which crabs are edible?\n[b] This crab is edible.',
        truncated: false,
        modelIdentity: 'fixture@1'
      }
    }
  }, new AbortController().signal)
  assert.equal(calls, 1, JSON.stringify(result.assessment))
  assert.equal(result.assessment.disposition, 'validated', JSON.stringify(result.assessment))
})

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

test('transient retries without Retry-After use bounded increasing jitter backoff', async () => {
  const sleeps: number[] = []
  let calls = 0
  const result = await translateWithAdapter(input, {
    capability,
    async requestOnce(batch) {
      if (++calls < 3) throw Object.assign(new Error('busy'), { status: 503 })
      return { raw: JSON.stringify({ items: batch.input.cues.map(cue => ({ id: cue.id, text: 'Translation.' })) }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal, { sleep: async ms => { sleeps.push(ms) }, random: () => 0.5 })
  assert.equal(calls, 3)
  assert.deepEqual(sleeps, [1250, 2500])
  assert.notEqual(result.assessment.disposition, 'needs-review')
})

test('oversized Retry-After is capped before reaching the sleep implementation', async () => {
  const sleeps: number[] = []
  let calls = 0
  await translateWithAdapter(input, {
    capability,
    async requestOnce(batch) {
      if (++calls === 1) throw Object.assign(new Error('busy'), { status: 503, retryAfterMs: 3_000_000_000 })
      return { raw: JSON.stringify({ items: batch.input.cues.map(cue => ({ id: cue.id, text: 'Translation.' })) }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal, { sleep: async ms => { sleeps.push(ms) } })
  assert.deepEqual(sleeps, [30_000])
})

test('repair payload is rechecked against known context capacity before dispatch', async () => {
  const source = { ...input, cues: input.cues.slice(0, 1) }
  const planningCapability: TranslationCapability = { ...capability, contextTokens: null, outputTokens: 1 }
  const plan = planTranslation(source, planningCapability)
  const normalCost = JSON.stringify(buildTranslationBatchMessages(plan.batches[0]!, 'json-items')).length
  let calls = 0
  const result = await translateWithAdapter(source, {
    capability: { ...planningCapability, contextTokens: normalCost + 1, countTokens: value => value.length },
    async requestOnce() {
      calls++
      return { raw: 'bad format', truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal, { plan })
  assert.equal(calls, 1)
  assert.ok(result.assessment.issues.some(issue => issue.code === 'unsupported-capability'))
})

test('custom cancellation during backoff stops dispatch and reports cancellation', async () => {
  const controller = new AbortController()
  let calls = 0
  const result = await translateWithAdapter(input, {
    capability,
    async requestOnce() { calls++; throw Object.assign(new Error('busy'), { status: 503 }) }
  }, controller.signal, { sleep: async () => { controller.abort(new Error('stop from UI')); throw controller.signal.reason } })
  assert.equal(calls, 1)
  assert.ok(result.assessment.issues.some(issue => issue.code === 'cancelled'))
  assert.ok(!result.assessment.issues.some(issue => issue.code === 'budget-exhausted'))
})

test('only missing work is retried and total requests is finite', async () => {
  const requested: string[][] = []
  const checkpoints: Array<{ ids: string[]; disposition: string }> = []
  const adapter: TranslationAdapter = {
    capability,
    async requestOnce(batch) {
      const ids = batch.input.cues.map((cue) => cue.id)
      requested.push(ids)
      const returned = requested.length === 1 ? ids.slice(0, -1) : ids
      return { raw: JSON.stringify({ items: returned.map((id) => ({ id, text: `translated ${id}` })) }), truncated: false, modelIdentity: 'fixture@1' }
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

test('a response with an unknown ID never contributes accepted or checkpointed items', async () => {
  const checkpoints: string[][] = []
  let calls = 0
  const result = await translateWithAdapter(input, {
    capability,
    async requestOnce() {
      calls++
      return {
        raw: JSON.stringify({ items: [{ id: 'a', text: 'A' }, { id: 'injected', text: 'Evil' }] }),
        truncated: false,
        modelIdentity: 'fixture@1'
      }
    }
  }, new AbortController().signal, {
    onBatch: (_batchId, batch) => checkpoints.push(batch.items.map((item) => item.id))
  })
  assert.equal(result.assessment.disposition, 'needs-review')
  assert.deepEqual(result.items, [])
  assert.deepEqual(checkpoints, [])
  assert.ok(calls > 0 && calls <= 5)
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

test('progressive missing-ID recovery completes after the former per-batch quota', async () => {
  const source: TranslationInput = { ...input, cues: Array.from({ length: 8 }, (_, index) => ({
    id: `cue-${index}`, sourceIndex: index, start: index, end: index + 1, groupId: `g${index}`, text: '你好。'
  })) }
  let calls = 0
  const result = await translateWithAdapter(source, {
    capability,
    async requestOnce(batch) {
      calls++
      return { raw: JSON.stringify({ items: [{ id: batch.input.cues[0].id, text: 'Hello.' }] }),
        truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal)
  assert.equal(result.plan.batches.length, 1)
  assert.equal(calls, 8)
  assert.equal(result.budget.recoveryUsed, 7)
  assert.deepEqual(result.items.map((item) => item.id), source.cues.map((cue) => cue.id))
  assert.notEqual(result.assessment.disposition, 'needs-review')
  assert.equal(result.assessment.issues.some((item) => item.code === 'budget-exhausted'), false)
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
      return { raw: JSON.stringify({ items: [{ id: 'a', text: 'A' }] }), truncated: false, modelIdentity: 'fixture@1' }
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
  }, true)
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
      return { raw: JSON.stringify({ items: batch.input.cues.map((cue) => ({ id: cue.id, text: `translated ${cue.id}` })) }), truncated: false, modelIdentity: 'fixture@1' }
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
  ['truncated response', { raw: JSON.stringify({ items: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }), truncated: true }],
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

test('all branches isolate malformed batches down to single cues', async () => {
  const source: TranslationInput = { ...input, cues: Array.from({ length: 16 }, (_, index) => ({
    id: `unit-${index}`, sourceIndex: index, start: index, end: index + 1, groupId: `g${index}`, text: '你好。'
  })) }
  let calls = 0
  const result = await translateWithAdapter(source, {
    capability,
    async requestOnce(batch) {
      calls++
      return { raw: batch.input.cues.length === 1
        ? JSON.stringify({ items: [{ id: batch.input.cues[0].id, text: 'Hello.' }] })
        : 'malformed batch', truncated: false, modelIdentity: 'fixture@1' }
    }
  }, new AbortController().signal)
  assert.equal(result.items.length, 16)
  assert.notEqual(result.assessment.disposition, 'needs-review')
  assert.ok(calls <= 31)
  const restored = createTranslationBudget(result.plan.batches.length, undefined, result.budget)
  assert.ok(restored.snapshot().perBatch)
})
