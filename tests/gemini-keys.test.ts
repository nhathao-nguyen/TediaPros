import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as gemini from '../src/main/gemini'
import { GeminiKeyRotation, geminiRetryAfterMs, parseGeminiKeys } from '../src/main/geminiKeys'
import { translateStrict } from '../src/main/autoshort'
import { buildSrt, parseSrt } from '../src/main/translate-shared'
import { classifyTranslationError } from '../src/main/translation/budget'
import type { PlannedTranslationBatch } from '../src/main/translation/planner'
import type { AutoShortConfig } from '../src/shared/types'

const batch: PlannedTranslationBatch = {
  id: 'batch-0', maxOutputTokens: 512, mapping: [],
  input: {
    sourceLanguage: 'vi', targetLocale: 'en', mode: 'subtitle',
    cues: [{ id: 'cue-0', sourceIndex: 0, start: 0, end: 1, groupId: 'g', text: 'Xin chào' }],
    contextBefore: [], contextAfter: [], glossary: []
  }
}

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tedia-gemini-keys-'))
  const oldUserData = process.env.TEDIAPROS_TEST_USER_DATA
  const oldFetch = globalThis.fetch
  process.env.TEDIAPROS_TEST_USER_DATA = root
  try { await run(root) } finally {
    globalThis.fetch = oldFetch
    if (oldUserData === undefined) delete process.env.TEDIAPROS_TEST_USER_DATA
    else process.env.TEDIAPROS_TEST_USER_DATA = oldUserData
    await rm(root, { recursive: true, force: true })
  }
}

const ok = (): Response => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Ready' }] }, finishReason: 'STOP' }] }))
const models = (): Response => new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }))
const quota = (): Response => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } }), { status: 429, headers: { 'Retry-After': '120' } })

test('Gemini rotates on quota and keeps the successful key for following requests', async () => fixture(async () => {
  await gemini.saveKey('fixture-key-a\nfixture-key-b')
  const calls: string[] = []
  globalThis.fetch = async (url, init) => {
    if (!init?.body) return models()
    const parsed = new URL(String(url))
    const key = new Headers(init.headers).get('x-goog-api-key') || parsed.searchParams.get('key') || ''
    calls.push(key)
    return key === 'fixture-key-a' ? quota() : ok()
  }
  assert.equal(await gemini.rephraseGeminiCue('system', 'first'), 'Ready')
  assert.equal(await gemini.rephraseGeminiCue('system', 'second'), 'Ready')
  assert.deepEqual(calls, ['fixture-key-a', 'fixture-key-b', 'fixture-key-b'])
}))

test('Gemini migration, append, deduplication and removal retain secrets in the main process', async () => fixture(async root => {
  await writeFile(join(root, 'gk.bin'), 'fixture-legacy')
  assert.equal(await gemini.loadKey(), 'fixture-legacy')
  await Promise.all([gemini.addKeys('fixture-key-a\nfixture-key-a'), gemini.addKeys('fixture-key-b')])
  const list = await gemini.listKeys()
  assert.equal(list.length, 3)
  assert.ok(list.every(entry => typeof entry.id === 'string' && typeof entry.masked === 'string'))
  assert.ok(!JSON.stringify(list).includes('fixture-legacy'))
  assert.ok(!JSON.stringify(list).includes('fixture-key-a'))
  await gemini.removeKey(list[1].id)
  assert.equal((await gemini.listKeys()).length, 2)
  assert.equal(await gemini.loadKey(), 'fixture-legacy')
  const stored = JSON.parse(await readFile(join(root, 'gk.bin'), 'utf8'))
  assert.deepEqual(stored.keys, ['fixture-legacy', 'fixture-key-b'])
}))

test('Gemini does not rotate for malformed requests, permission errors or server failures', async () => fixture(async () => {
  for (const status of [400, 403, 500]) {
    await gemini.saveKey('fixture-key-a\nfixture-key-b')
    const calls: string[] = []
    globalThis.fetch = async (url, init) => {
      if (!init?.body) return models()
      calls.push(new Headers(init.headers).get('x-goog-api-key') || new URL(String(url)).searchParams.get('key') || '')
      return new Response('{}', { status })
    }
    assert.equal(await gemini.rephraseGeminiCue('system', 'request'), null)
    assert.ok(calls.length > 0)
    assert.ok(calls.every(key => key === 'fixture-key-a'))
  }
}))

test('all exhausted keys stop after one pass and cooldown blocks immediate repeat calls', async () => fixture(async () => {
  await gemini.saveKey('fixture-key-a\nfixture-key-b')
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    if (!init?.body) return models()
    calls++
    return quota()
  }
  assert.equal(await gemini.rephraseGeminiCue('system', 'request'), null)
  assert.equal(calls, 2)
  assert.equal(await gemini.rephraseGeminiCue('system', 'request'), null)
  assert.equal(calls, 2)
}))

test('AutoShort strict Gemini translation fails over without changing cue IDs or timestamps', async () => fixture(async root => {
  await gemini.saveKey('fixture-key-a\nfixture-key-b')
  const input = join(root, 'input.srt')
  const output = join(root, 'output.srt')
  await writeFile(input, buildSrt([{ ...batch.input.cues[0], time: '00:00:00,000 --> 00:00:01,000' }]))
  const calls: Array<{ key: string; body: string }> = []
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(String(url)).searchParams.has('key'), false, 'credentials must not appear in URLs')
    const key = new Headers(init?.headers).get('x-goog-api-key') || ''
    if (!init?.body) return models()
    calls.push({ key, body: String(init.body) })
    if (key === 'fixture-key-a') return quota()
    const body = JSON.parse(String(init.body))
    const user = body.contents[0].parts[0].text as string
    const sourceSection = user.split('[SOURCE_CUES_JSONL]')[1]?.split('[/SOURCE_CUES_JSONL]')[0] || ''
    const ids = sourceSection.split('\n').map(line => line.trim()).filter(line => line.startsWith('{'))
      .map(line => (JSON.parse(line) as { id: string }).id).filter(id => id.startsWith('cue-'))
    assert.equal(ids.length, 1)
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: ids.map(id => ({ id, text: 'Hello' })) }) }] }, finishReason: 'STOP' }] }))
  }
  await translateStrict({ translateProvider: 'gemini', translateTarget: 'en', ttsEnabled: false } as AutoShortConfig,
    input, output, () => {}, new AbortController().signal, 'vi')
  assert.deepEqual(calls.map(call => call.key), ['fixture-key-a', 'fixture-key-b'])
  assert.equal(calls[0].body, calls[1].body, 'failover must resend exactly the same request')
  const result = parseSrt(await readFile(output, 'utf8'))
  assert.equal(result[0].time, '00:00:00,000 --> 00:00:01,000')
  assert.equal(result[0].text, 'Hello')
}))

test('Gemini adapter surfaces exhaustion and Retry-After to the bounded translation scheduler', async () => fixture(async () => {
  await gemini.saveKey('fixture-key-a\nfixture-key-b')
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    if (!init?.body) return models()
    calls++
    return quota()
  }
  const adapter = await gemini.createGeminiTranslationAdapter()
  await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), error => {
    const failure = classifyTranslationError(error)
    assert.equal(failure.code, 'provider-transient')
    assert.equal(failure.status, 429)
    assert.ok(failure.retryAfterMs! > 119_000 && failure.retryAfterMs! <= 120_000)
    assert.match(failure.message, /Tất cả khóa Gemini/u)
    return true
  })
  assert.equal(calls, 2)
}))

test('Gemini cancellation prevents switching to another key, including pre-aborted discovery', async () => fixture(async () => {
  await gemini.saveKey('fixture-key-a\nfixture-key-b')
  const abort = new AbortController()
  const calls: string[] = []
  globalThis.fetch = async (_url, init) => {
    if (!init?.body) return models()
    calls.push(new Headers(init.headers).get('x-goog-api-key') || '')
    abort.abort()
    return quota()
  }
  await assert.rejects(gemini.rephraseGeminiCue('system', 'request', abort.signal), { name: 'AbortError' })
  assert.deepEqual(calls, ['fixture-key-a'])
  globalThis.fetch = async () => { assert.fail('pre-aborted request must not reach fetch') }
  await assert.rejects(gemini.createGeminiTranslationAdapter(undefined, abort.signal), { name: 'AbortError' })
}))

test('expired cooldown recovers and late success cannot erase a concurrent quota response', async () => {
  let now = 1000
  const rotation = new GeminiKeyRotation(() => now)
  const calls: string[] = []
  let finish!: (value: { ok: boolean; text: string }) => void
  const pending = rotation.run(['key-a'], () => new Promise(resolve => { finish = resolve }))
  const exhausted = await rotation.run(['key-a'], async () => ({ ok: false, status: 429, retryAfterMs: 2500 }))
  assert.equal(exhausted.retryAfterMs, 2500)
  finish({ ok: true, text: 'late success' })
  await pending
  await rotation.run(['key-a', 'key-b'], async key => { calls.push(key); return { ok: true, text: 'ready' } })
  assert.deepEqual(calls, ['key-b'])
  now = 3500
  await rotation.run(['key-a'], async key => { calls.push(key); return { ok: true, text: 'ready' } })
  assert.deepEqual(calls, ['key-b', 'key-a'])
})

test('Gemini cooldown honors both HTTP Retry-After and Google RetryInfo', () => {
  const response = new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })
  assert.equal(geminiRetryAfterMs(response, '{}'), 2000)
  assert.equal(geminiRetryAfterMs(response, JSON.stringify({ error: { details: [{
    '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3.5s'
  }] } })), 3500)
  assert.equal(geminiRetryAfterMs(new Response(), 'not json'), undefined)
})

test('Gemini validation errors never expose inputs and failed updates preserve existing keys', async () => fixture(async () => {
  await gemini.saveKey('fixture-key-a')
  assert.throws(() => parseGeminiKeys('private secret'), error => !String(error).includes('private secret'))
  assert.throws(() => parseGeminiKeys(Array.from({ length: 21 }, (_, i) => `fixture-key-${i}`).join('\n')), /Tối đa 20/u)
  await assert.rejects(async () => gemini.addKeys('bad key'))
  assert.equal(await gemini.loadKey(), 'fixture-key-a')
  await gemini.addKeys('fixture-key-b')
  for (const key of await gemini.listKeys()) await gemini.removeKey(key.id)
  assert.equal(await gemini.hasKey(), false)
  await gemini.addKeys('fixture-key-c')
  await gemini.saveKey('')
  assert.deepEqual(await gemini.listKeys(), [])
}))

test('explicit validation stays isolated and provider errors redact the submitted key', async () => fixture(async () => {
  await gemini.saveKey('fixture-saved-key')
  const calls: string[] = []
  globalThis.fetch = async (_url, init) => {
    if (!init?.body) return models()
    const key = new Headers(init.headers).get('x-goog-api-key') || ''
    calls.push(key)
    return new Response(`invalid key: ${key}`, { status: 403 })
  }
  const adapter = await gemini.createGeminiTranslationAdapter('fixture-explicit-key')
  await assert.rejects(adapter.requestOnce(batch, new AbortController().signal), error => {
    assert.ok(!String(error).includes('fixture-explicit-key'))
    assert.match(String(error), /\[REDACTED\]/u)
    return true
  })
  assert.deepEqual(calls, ['fixture-explicit-key'])
}))

for (const workflow of ['rephrase', 'check', 'adapter'] as const) {
  test(`Gemini ${workflow} retains model fallback when keys hit a model-specific quota`, async () => fixture(async () => {
    await gemini.saveKey('fixture-key-a\nfixture-key-b')
    const calls: Array<{ model: string; key: string }> = []
    globalThis.fetch = async (url, init) => {
      if (!init?.body) return new Response(JSON.stringify({ models: ['gemini-2.5-flash', 'gemini-2.5-pro'].map(name => ({
        name: `models/${name}`, supportedGenerationMethods: ['generateContent']
      })) }))
      const model = new URL(String(url)).pathname.split('/').at(-1)!.split(':')[0]
      calls.push({ model, key: new Headers(init.headers).get('x-goog-api-key') || '' })
      return model === calls[0].model ? quota() : ok()
    }
    if (workflow === 'rephrase') assert.equal(await gemini.rephraseGeminiCue('system', 'request'), 'Ready')
    if (workflow === 'check') assert.equal((await gemini.checkKey('')).ok, true)
    if (workflow === 'adapter') {
      const adapter = await gemini.createGeminiTranslationAdapter()
      assert.equal((await adapter.requestOnce(batch, new AbortController().signal)).raw, 'Ready')
    }
    assert.equal(calls.length, 3)
    assert.equal(calls[0].model, calls[1].model)
    assert.notEqual(calls[1].model, calls[2].model)
    assert.deepEqual(calls.map(call => call.key), ['fixture-key-a', 'fixture-key-b', 'fixture-key-a'])
  }))
}

test('unreadable key storage reports unavailable and can be explicitly replaced without losing it on append', async () => fixture(async root => {
  const path = join(root, 'gk.bin')
  await writeFile(path, '{broken-storage')
  assert.equal(await gemini.hasKey(), false)
  await assert.rejects(gemini.listKeys(), /Không thể đọc/u)
  await assert.rejects(gemini.addKeys('fixture-recovery-key'), /Không thể đọc/u)
  assert.equal(await readFile(path, 'utf8'), '{broken-storage')
  await gemini.saveKey('fixture-recovery-key')
  assert.equal(await gemini.hasKey(), true)
  assert.equal((await gemini.listKeys()).length, 1)
}))
