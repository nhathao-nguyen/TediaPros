import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { localTranslateSrt, parseRetryAfterMs } from '../src/main/localTranslate'
import { buildSrt, buildTranslationBatches, parseSrt } from '../src/main/translate-shared'
import { buildSemanticGroups } from '../src/main/semanticGrouping'
import { getLogs } from '../src/main/logger'

const contentReply = (content: string) => new Response(JSON.stringify({
  choices: [{ message: { content }, finish_reason: 'stop' }]
}))

test('fenced JSON translations keep IDs and timing without splitting or retranslation', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(2)))
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return contentReply('```json\n{"items":[{"id":"cue-1","t":"The second view."},{"id":"cue-0","t":"The first view."}]}\n```')
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined,
    { mode: 'dubbing', sourceLanguage: 'zh', sleep: async () => {} })
  assert.equal(result.ok, true, result.error)
  assert.equal(calls, 1)
  const translated = parseSrt(await readFile(output, 'utf8'))
  assert.deepEqual(translated.map((cue) => cue.text), ['The first view.', 'The second view.'])
  assert.deepEqual(translated.map((cue) => cue.time), [
    '00:00:00,000 --> 00:00:01,800', '00:00:02,000 --> 00:00:03,800'
  ])
}))

test('single-cue JSON object uses its explicit ID instead of failing at the final split', async () => fixture(async (input, output) => {
  await writeFile(input, '39\n00:01:00,000 --> 00:01:01,800\n这是重庆的山城道路\n')
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return contentReply('{"id":"cue-38","text":"A street in Chongqing."}')
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined,
    { mode: 'dubbing', sleep: async () => {} })
  assert.equal(result.ok, true, result.error)
  assert.equal(calls, 1)
  assert.equal(parseSrt(await readFile(output, 'utf8'))[0].text, 'A street in Chongqing.')
}))

test('partial recovery retries ambiguous duplicate IDs instead of retaining the first translation', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  const requests: string[][] = []
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(init)
    requests.push(ids)
    if (requests.length === 1) {
      return contentReply(ids.filter((id) => id !== 'cue-11').map((id) => `[${id}] Draft ${id}`).join('\n') + '\n[cue-0] Conflicting translation')
    }
    return contentReply(ids.map((id) => `[${id}] Repaired ${id}`).join('\n'))
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined,
    { mode: 'dubbing', sleep: async () => {} })
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(requests[1], ['cue-0', 'cue-11'])
  assert.equal(parseSrt(await readFile(output, 'utf8'))[0].text, 'Repaired cue-0')
}))

test('unparsed continuation invalidates the whole local batch and never publishes its valid-looking prefix', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  await writeFile(output, 'previous output')
  const requests: string[][] = []
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(init)
    requests.push(ids)
    if (requests.length === 1) {
      return contentReply(ids.slice(0, -1).map((id) => `[${id}] First attempt.`).join('\n') + '\ncontinuation was lost')
    }
    return contentReply(ids.map((id) => `[${id}] Repaired.`).join('\n'))
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined,
    { mode: 'dubbing', sourceLanguage: 'zh', sleep: async () => {} })
  assert.equal(result.ok, true, result.error)
  const translated = parseSrt(await readFile(output, 'utf8'))
  assert.equal(translated.length, 12)
  assert.ok(translated.every((cue) => cue.text === 'Repaired.'))
  assert.ok(requests.length >= 2)
}))

test('source locale is used when building Korean dubbing context', async () => fixture(async (input, output) => {
  const koreanCues = makeCues(2).map((cue, index) => ({ ...cue, text: index === 0 ? '나는' : '학생입니다' }))
  koreanCues[1].start = 1.2
  koreanCues[1].end = 2.2
  await writeFile(input, buildSrt(koreanCues))
  let payload = ''
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(String(init?.body)).messages[1].content
    return contentReply(requestedIds(init).map((id) => `[${id}] A student.`).join('\n'))
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined,
    { mode: 'dubbing', sourceLanguage: 'ko', sleep: async () => {} })
  assert.equal(result.ok, true, result.error)
  assert.match(payload, /나는 학생입니다/u)
  assert.doesNotMatch(payload, /나는학생입니다/u)
}))

test('unlabelled output stays rejected and diagnostics explain the mismatch without raw text', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(1)))
  await writeFile(output, 'previous output')
  const logStart = getLogs().length
  globalThis.fetch = async () => contentReply('private-response-marker without any cue ID')
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined,
    { mode: 'dubbing', sleep: async () => {} })
  assert.equal(result.ok, false)
  assert.equal(await readFile(output, 'utf8'), 'previous output')
  const messages = getLogs().slice(logStart).map((entry) => entry.msg).join('\n')
  assert.match(messages, /expected=1 parsed=0 missing=1 duplicate=0/u)
  assert.doesNotMatch(messages, /private-response-marker/u)
}))

test('JSON compatibility never guesses cue identity or accepts truncated and source-language output', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt([{ ...makeCues(1)[0], text: '这是重庆的山城道路这是重庆的山城道路' }]))
  await writeFile(output, 'previous output')
  const cases = [
    { content: '{"id":"cue-99","t":"Wrong cue."}', finish: 'stop' },
    { content: '{"id":0,"t":"Numeric ID cannot be mapped by position."}', finish: 'stop' },
    { content: '```json\n[{"id":"cue-0","t":"Cut short"}]\n```', finish: 'length' },
    { content: '```json\n[{"id":"cue-0","t":"这是重庆的山城道路这是重庆的山城道路"}]\n```', finish: 'stop' },
    { content: '```json\n[{"id":"cue-0","t":"Conflicting A"},{"id":"cue-0","t":"Conflicting B"}]\n```', finish: 'stop' }
  ]
  for (const entry of cases) {
    globalThis.fetch = async () => new Response(JSON.stringify({
      choices: [{ message: { content: entry.content }, finish_reason: entry.finish }]
    }))
    const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined,
      { mode: 'dubbing', sourceLanguage: 'zh', sleep: async () => {} })
    assert.equal(result.ok, false, entry.content)
    assert.equal(await readFile(output, 'utf8'), 'previous output')
  }
}))

const makeCues = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `cue-${index}`, sourceIndex: index, start: index * 2, end: index * 2 + 1.8,
  time: `${String(Math.floor(index * 2 / 3600)).padStart(2, '0')}:${String(Math.floor(index * 2 / 60) % 60).padStart(2, '0')}:${String(index * 2 % 60).padStart(2, '0')},000 --> ${String(Math.floor(index * 2 / 3600)).padStart(2, '0')}:${String(Math.floor(index * 2 / 60) % 60).padStart(2, '0')}:${String(index * 2 % 60 + 1).padStart(2, '0')},800`,
  text: `这是重庆的第${index}处山城风景`
}))
const reply = (ids: string[], finishReason = 'stop') => new Response(JSON.stringify({
  choices: [{ message: { content: ids.map((id) => `[${id}] A view of Chongqing ${id}.`).join('\n') }, finish_reason: finishReason }]
}))
function requestedIds(init?: RequestInit): string[] {
  const body = JSON.parse(String(init?.body))
  const section = body.messages[1].content.split('[Nội dung cần dịch]:')[1]
    .split('[Ngữ cảnh phía sau')[0].split('[Toàn văn nhóm')[0]
  return [...section.matchAll(/^\[(cue-\d+)\]/gm)].map((match) => match[1])
}
async function fixture(run: (input: string, output: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tedia-translation-'))
  const oldFetch = globalThis.fetch
  const oldUserData = process.env.TEDIAPROS_TEST_USER_DATA
  process.env.TEDIAPROS_TEST_USER_DATA = root
  globalThis.fetch = async () => { throw new Error('Live network disabled') }
  try {
    await run(join(root, 'input.srt'), join(root, 'output.srt'))
  } finally {
    globalThis.fetch = oldFetch
    if (oldUserData === undefined) delete process.env.TEDIAPROS_TEST_USER_DATA
    else process.env.TEDIAPROS_TEST_USER_DATA = oldUserData
    // logger appends asynchronously; it retains no open stream.
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  }
}

test('bounded batches retain complete semantic groups, IDs and every source cue', () => {
  const cues = makeCues(117)
  const batches = buildTranslationBatches(cues, 2_000, 24)
  assert.equal(batches.length, 5)
  assert.deepEqual(batches.flat(), cues)
  assert.ok(batches.every((batch) => batch.length <= 24))
  for (const group of buildSemanticGroups(cues)) {
    assert.ok(batches.some((batch) => group.cues.every((cue) => batch.includes(cue))))
  }
  // Other providers retain their established default instead of inheriting the local limit.
  assert.equal(buildTranslationBatches(cues).length, 1)
  const long = [{ ...cues[0], text: 'word '.repeat(500) }]
  assert.deepEqual(buildTranslationBatches(long, 2_000, 24), [long], 'an indivisible cue must never be truncated')
})

test('117-cue local dubbing uses bounded requests and preserves timeline and explicit model', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(117)))
  const requested: string[][] = []
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(init)
    requested.push(ids)
    assert.equal(JSON.parse(String(init?.body)).model, 'selected-local-model')
    return reply(ids)
  }
  const result = await localTranslateSrt(input, output, 'en', 'http://localhost:12345', 'fixture-key', undefined,
    { mode: 'dubbing', sourceLanguage: 'zh', model: 'selected-local-model' })
  assert.equal(result.ok, true, result.error)
  assert.equal(requested.length, 5)
  assert.deepEqual(requested.flat(), makeCues(117).map((cue) => cue.id))
  assert.deepEqual(parseSrt(await readFile(output, 'utf8')).map((cue) => cue.time), makeCues(117).map((cue) => cue.time))
}))

test('missing IDs request only the missing cue instead of repeating translated work', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  const sizes: number[] = []
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(init)
    sizes.push(ids.length)
    return reply(ids.length === 12 ? ids.slice(0, -1) : ids)
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined, { mode: 'dubbing' })
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(sizes, [12, 1])
  assert.equal(parseSrt(await readFile(output, 'utf8')).length, 12)
}))

test('partial IDs across semantic groups request only the missing cues', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  const requested: string[][] = []
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(init)
    requested.push(ids)
    const missing = requested.length === 1 ? new Set(['cue-5', 'cue-11']) : new Set<string>()
    return reply(ids.filter((id) => !missing.has(id)))
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined, { mode: 'dubbing' })
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(requested.map((ids) => ids.length), [12, 2])
  assert.deepEqual(requested[1], ['cue-5', 'cue-11'])
  assert.equal(parseSrt(await readFile(output, 'utf8')).length, 12)
}))

test('extra context IDs do not force a duplicate translation request', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    const ids = requestedIds(init)
    const response = reply(ids)
    const data = await response.json() as { choices: Array<{ message: { content: string }; finish_reason: string }> }
    data.choices[0].message.content += '\n[context-only] Read-only context'
    return new Response(JSON.stringify(data))
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined, { mode: 'dubbing' })
  assert.equal(result.ok, true, result.error)
  assert.equal(calls, 1)
  assert.equal(parseSrt(await readFile(output, 'utf8')).length, 12)
}))

test('finish_reason length cannot silently accept a cut-off last sentence even with all IDs', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(6)))
  const sizes: number[] = []
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(init)
    sizes.push(ids.length)
    return reply(ids, ids.length === 6 ? 'length' : 'stop')
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined, { mode: 'dubbing' })
  assert.equal(result.ok, true, result.error)
  assert.deepEqual(sizes, [6, 3, 3])
}))

test('permanent access failure leaves previous output intact and is not retried', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  await writeFile(output, 'existing output')
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('{}', { status: 403 }) }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined, { mode: 'dubbing' })
  assert.equal(result.ok, false)
  assert.equal(calls, 1)
  assert.equal(await readFile(output, 'utf8'), 'existing output')
}))

test('cancellation between split batches stops the next server request and output publication', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  await writeFile(output, 'existing output')
  const controller = new AbortController()
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(init)
    calls++
    if (calls === 1) return reply(ids.slice(0, -1))
    controller.abort()
    return reply(ids)
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined,
    { mode: 'dubbing', signal: controller.signal })
  assert.equal(result.ok, false)
  assert.equal(calls, 2)
  assert.equal(await readFile(output, 'utf8'), 'existing output')
}))

test('persistent invalid responses stop at the workload recovery budget', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    void init
    return reply([])
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined, {
    mode: 'dubbing',
    sleep: async () => {}
  })
  assert.equal(result.ok, false)
  assert.match(result.error || '', /ngân sách request dịch/u)
  assert.ok(calls <= 5, `workload recovery budget allowed ${calls} requests`)
}))

test('an explicit maxRequests option can re-enable a request ceiling', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt(makeCues(12)))
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return reply([])
  }
  const result = await localTranslateSrt(input, output, 'en', undefined, 'fixture-key', undefined, {
    mode: 'dubbing',
    maxRequests: 3,
    sleep: async () => {}
  })
  assert.equal(result.ok, false)
  assert.match(result.error || '', /ngân sách request dịch \(3 lượt\)/u)
  assert.equal(calls, 3)
}))

test('Retry-After accepts seconds and HTTP-date without sending before the requested time', () => {
  const wallNow = Date.parse('2026-09-06T00:00:00.000Z')
  assert.equal(parseRetryAfterMs('2', wallNow), 2000)
  assert.equal(parseRetryAfterMs('Sun, 06 Sep 2026 00:00:03 GMT', wallNow), 3000)
  assert.equal(parseRetryAfterMs('Sun, 06 Sep 2026 00:00:00 GMT', wallNow), 0)
  assert.equal(parseRetryAfterMs('not-a-date', wallNow), null)
})
