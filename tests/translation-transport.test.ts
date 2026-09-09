import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createLocalTranslationAdapter } from '../src/main/localTranslate'
import { AutoShortResourceManager, setGlobalResourceManager } from '../src/main/autoShortResourceManager'
import { classifyTranslationError } from '../src/main/translation/budget'
import type { PlannedTranslationBatch } from '../src/main/translation/planner'

const batch: PlannedTranslationBatch = {
  id: 'batch-0', maxOutputTokens: 512, mapping: [],
  input: {
    sourceLanguage: 'vi', targetLocale: 'en', mode: 'subtitle',
    cues: [{ id: 'cue-0', sourceIndex: 0, start: 0, end: 1, groupId: 'g', text: 'Xin chào' }],
    contextBefore: [], contextAfter: [], glossary: []
  }
}
const payload = JSON.stringify({ choices: [{ message: { content: '[cue-0] Hello' }, finish_reason: 'stop' }] })
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
const adapter = () => createLocalTranslationAdapter('fixture-key', 'http://fixture.invalid')
const signal = () => new AbortController().signal

async function fixture(run: (manager: AutoShortResourceManager) => Promise<void>): Promise<void> {
  const previous = globalThis.fetch
  const manager = new AutoShortResourceManager()
  setGlobalResourceManager(manager)
  try { await run(manager) }
  finally { globalThis.fetch = previous; setGlobalResourceManager(null) }
}

for (const status of [200, 503]) {
  test(`local adapter keeps inference lease through delayed HTTP ${status} body`, () => fixture(async (manager) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    let calls = 0
    globalThis.fetch = async () => ++calls === 1 ? new Response(body, { status }) : new Response(payload)
    const first = adapter().requestOnce(batch, signal()).catch((error: unknown) => error)
    await tick()
    const second = adapter().requestOnce(batch, signal())
    try {
      await tick()
      assert.equal(calls, 1, 'request B must wait while request A is reading its body')
      assert.equal(manager.getAllocated('server-inference'), 1)
    } finally {
      controller.enqueue(new TextEncoder().encode(status === 200 ? payload : '{"code":"busy"}'))
      controller.close()
      await Promise.all([first, second])
    }
    assert.equal(manager.getAllocated('server-inference'), 0)
    assert.equal((await second).raw, '[cue-0] Hello')
    if (status === 503) assert.equal(classifyTranslationError(await first).code, 'provider-transient')
  }))
}

for (const [header, expected] of [['2', 2000], ['Tue, 08 Sep 2026 00:00:03 GMT', 3000], ['invalid', undefined], ['-1', undefined], ['2026-09-08', undefined]] as const) {
  test(`local adapter propagates Retry-After ${header} as structured metadata`, () => fixture(async () => {
    globalThis.fetch = async () => new Response('{"code":"busy"}', { status: 429, headers: { 'Retry-After': header } })
    const local = createLocalTranslationAdapter('key', 'http://fixture.invalid', 'llm-default', {
      wallNow: () => Date.parse('2026-09-08T00:00:00Z')
    })
    await assert.rejects(local.requestOnce(batch, signal()), (error: unknown) => {
      const failure = classifyTranslationError(error)
      assert.equal(failure.code, 'provider-transient')
      assert.equal(failure.retryAfterMs, expected)
      return true
    })
  }))
}

test('native fetch aborts a delayed response body and frees capacity for the next request', () => fixture(async (manager) => {
  let finishHeaders!: () => void
  const headersSent = new Promise<void>((resolve) => { finishHeaders = resolve })
  let calls = 0
  const server = createServer((_request, response) => {
    calls++
    if (calls === 1) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.write('{"choices":[')
      finishHeaders()
    } else response.end(payload)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const local = createLocalTranslationAdapter('key', `http://127.0.0.1:${address.port}`)
  const abort = new AbortController()
  const pending = local.requestOnce(batch, abort.signal).catch((error: unknown) => error)
  try {
    await headersSent
    await tick()
    assert.equal(manager.getAllocated('server-inference'), 1)
    abort.abort(new Error('stop after headers'))
    assert.equal(classifyTranslationError(await pending).code, 'cancelled')
    assert.equal((await local.requestOnce(batch, signal())).raw, '[cue-0] Hello')
    assert.equal(manager.getAllocated('server-inference'), 0)
    assert.equal(calls, 2)
  } finally {
    abort.abort()
    await pending
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}))

test('local adapter cancels an unread error body before releasing its lease', () => fixture(async (manager) => {
  let cancelStarted = false
  let finishCancel!: () => void
  const body = new ReadableStream({ cancel() {
    cancelStarted = true
    return new Promise<void>((resolve) => { finishCancel = resolve })
  } })
  const response = new Response(body, { status: 503 })
  response.text = async () => { throw new TypeError('terminated', { cause: { code: 'ECONNRESET' } }) }
  globalThis.fetch = async () => response
  const pending = adapter().requestOnce(batch, signal()).catch((error: unknown) => error)
  try {
    await tick()
    assert.equal(cancelStarted, true)
    assert.equal(manager.getAllocated('server-inference'), 1)
  } finally { finishCancel?.(); await pending }
  assert.equal(classifyTranslationError(await pending).code, 'provider-transient')
  assert.equal(manager.getAllocated('server-inference'), 0)
}))

for (const reason of [new Error('user stopped'), 'custom cancellation']) {
  test(`local adapter preserves cancellation classification after headers with ${typeof reason} reason`, () => fixture(async (manager) => {
    const abort = new AbortController()
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    globalThis.fetch = async (_url, init) => {
      init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
      return new Response(body)
    }
    const pending = adapter().requestOnce(batch, abort.signal).catch((error: unknown) => error)
    await tick()
    abort.abort(reason)
    const failure = classifyTranslationError(await pending)
    assert.equal(failure.code, 'cancelled')
    assert.equal(failure.retryable, false)
    globalThis.fetch = async () => new Response(payload)
    assert.equal((await adapter().requestOnce(batch, signal())).raw, '[cue-0] Hello')
    assert.equal(manager.getAllocated('server-inference'), 0)
  }))
}

test('local adapter classifies socket reset as transient without retrying internally', () => fixture(async (manager) => {
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }) }
  await assert.rejects(adapter().requestOnce(batch, signal()), (error: unknown) => {
    assert.equal(classifyTranslationError(error).code, 'provider-transient')
    return true
  })
  assert.equal(calls, 1)
  assert.equal(manager.getAllocated('server-inference'), 0)
}))

test('local adapter treats malformed response JSON as protocol failure without transport retry', () => fixture(async (manager) => {
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('{malformed') }
  await assert.rejects(adapter().requestOnce(batch, signal()), (error: unknown) => {
    assert.equal(classifyTranslationError(error).code, 'provider-protocol')
    assert.equal(classifyTranslationError(error).retryable, false)
    return true
  })
  assert.equal(calls, 1)
  assert.equal(manager.getAllocated('server-inference'), 0)
}))

for (const status of [401, 403, 422]) {
  test(`local adapter keeps HTTP ${status} non-retryable after reading its error body`, () => fixture(async () => {
    globalThis.fetch = async () => new Response('{"code":"denied"}', { status })
    await assert.rejects(adapter().requestOnce(batch, signal()), (error: unknown) => {
      const failure = classifyTranslationError(error)
      assert.equal(failure.retryable, false)
      assert.equal(failure.code, status === 422 ? 'provider-protocol' : 'provider-auth')
      return true
    })
  }))
}
