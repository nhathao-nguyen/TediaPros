import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveKey as saveGeminiKey, translateSrt as translateGemini } from '../src/main/gemini'
import { saveKey as saveOpenAiKey, translateSrt as translateOpenAi } from '../src/main/openai'
import { retryAutoShortTranslation, translateStrict } from '../src/main/autoshort'
import { buildSrt, parseSrt } from '../src/main/translate-shared'
import { createLocalTranslationAdapter } from '../src/main/localTranslate'
import { translateWithAdapter } from '../src/main/translation/orchestrator'
import { translateFileWithAdapter } from '../src/main/translation/fileRunner'
import type { AutoShortConfig } from '../src/shared/types'

const source = [{ id: 'cue-0', sourceIndex: 0, start: 0, end: 1, time: '00:00:00,000 --> 00:00:01,000', text: 'Xin chào' }]
const contentReply = (content: string): Response => new Response(JSON.stringify({
  choices: [{ message: { content }, finish_reason: 'stop' }]
}))
const sourceIdsFromPrompt = (prompt: unknown): string[] => {
  const section = String(prompt || '').split('[SOURCE_CUES_JSONL]')[1]?.split('[/SOURCE_CUES_JSONL]')[0] || ''
  return section.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('{')).flatMap((line) => {
    try {
      const id = (JSON.parse(line) as { id?: unknown }).id
      return typeof id === 'string' ? [id] : []
    } catch {
      return []
    }
  })
}
const response = (provider: 'gemini' | 'openai', body: any): Response => {
  const payload = provider === 'gemini' ? body.contents?.[0]?.parts?.[0]?.text : body.messages?.[1]?.content
  const ids = sourceIdsFromPrompt(payload).filter((id) => id.startsWith('cue-'))
  const items = (ids.length > 0 ? ids : ['cue-0']).map((id) => ({ id, text: 'Hello' }))
  if (provider === 'gemini') return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items }) }] }, finishReason: 'STOP' }] }))
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) }, finish_reason: 'stop' }] }))
}

async function fixture(run: (input: string, output: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tedia-provider-contract-'))
  const oldFetch = globalThis.fetch
  const oldUserData = process.env.TEDIAPROS_TEST_USER_DATA
  process.env.TEDIAPROS_TEST_USER_DATA = root
  try { await run(join(root, 'input.srt'), join(root, 'output.srt')) }
  finally {
    globalThis.fetch = oldFetch
    if (oldUserData === undefined) delete process.env.TEDIAPROS_TEST_USER_DATA
    else process.env.TEDIAPROS_TEST_USER_DATA = oldUserData
    await rm(root, { recursive: true, force: true })
  }
}

for (const [provider, saveKey, translate] of [
  ['gemini', saveGeminiKey, translateGemini],
  ['openai', saveOpenAiKey, translateOpenAi]
] as const) {
  test(`${provider} sends the canonical object.items[].text contract and complete user message`, async () => fixture(async (input, output) => {
    await writeFile(input, buildSrt(source))
    await saveKey('fixture-key')
    let captured: any
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)) }
      return response(provider, captured.body)
    }
    const result = await translate(input, output, 'en', undefined, { strict: true, mode: 'subtitle', sourceLanguage: 'vi' })
    assert.equal(result.ok, true, result.error)
    const body = captured.body
    const system = provider === 'gemini' ? body.systemInstruction.parts[0].text : body.messages[0].content
    const user = provider === 'gemini' ? body.contents[0].parts[0].text : body.messages[1].content
    const schema = provider === 'gemini' ? body.generationConfig.responseSchema : body.response_format.json_schema.schema
    const itemSchema = schema.type === 'array' ? schema.items : schema.properties.items.items
    assert.equal(schema.type.toLowerCase(), 'object')
    assert.ok(itemSchema.properties.text)
    assert.equal(itemSchema.properties.t, undefined)
    assert.match(system, /target_locale=en/u)
    assert.match(user, /\[SOURCE_CUES_JSONL\]/u)
    assert.match(user, /SOURCE_CUES_JSONL/u)
    assert.deepEqual(parseSrt(await readFile(output, 'utf8')).map((item) => item.text), ['Hello'])
  }))
}

for (const [provider, saveKey, translate] of [
  ['gemini', saveGeminiKey, translateGemini],
  ['openai', saveOpenAiKey, translateOpenAi]
] as const) {
  test(`${provider} rejects ambiguous translation candidates instead of taking the first`, async () => fixture(async (input, output) => {
    await writeFile(input, buildSrt(source))
    await saveKey('fixture-key')
    globalThis.fetch = async (_url, init) => {
      if (!init?.method) return provider === 'gemini'
        ? new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }))
        : new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }))
      const body = JSON.parse(String(init.body))
      const prompt = provider === 'gemini' ? body.contents?.[0]?.parts?.[0]?.text : body.messages?.[1]?.content
      const id = sourceIdsFromPrompt(prompt)[0]
      const content = JSON.stringify({ items: [{ id, text: 'Hello' }] })
      return provider === 'gemini'
        ? new Response(JSON.stringify({ candidates: [
          { content: { parts: [{ text: content }] }, finishReason: 'STOP' },
          { content: { parts: [{ text: content }] }, finishReason: 'STOP' }
        ] }))
        : new Response(JSON.stringify({ choices: [
          { message: { content }, finish_reason: 'stop' },
          { message: { content }, finish_reason: 'stop' }
        ] }))
    }
    const result = await translate(input, output, 'en', undefined, { strict: true, mode: 'subtitle', sourceLanguage: 'vi' })
    assert.equal(result.ok, false)
    await assert.rejects(readFile(output, 'utf8'), { code: 'ENOENT' })
  }))

  test(`${provider} rejects filtered or refused translation content even when its JSON is valid`, async () => fixture(async (input, output) => {
    await writeFile(input, buildSrt(source))
    await saveKey('fixture-key')
    globalThis.fetch = async (_url, init) => {
      if (!init?.method) return provider === 'gemini'
        ? new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }))
        : new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }))
      const body = JSON.parse(String(init.body))
      const prompt = provider === 'gemini' ? body.contents?.[0]?.parts?.[0]?.text : body.messages?.[1]?.content
      const id = sourceIdsFromPrompt(prompt)[0]
      const content = JSON.stringify({ items: [{ id, text: 'Hello' }] })
      return provider === 'gemini'
        ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'SAFETY' }] }))
        : new Response(JSON.stringify({ choices: [{ message: { content, refusal: 'policy' }, finish_reason: 'content_filter' }] }))
    }
    const result = await translate(input, output, 'en', undefined, { strict: true, mode: 'subtitle', sourceLanguage: 'vi' })
    assert.equal(result.ok, false)
    await assert.rejects(readFile(output, 'utf8'), { code: 'ENOENT' })
  }))
}

test('local production adapter is provider-neutral and uses the shared bounded orchestrator', async () => {
  const adapter = createLocalTranslationAdapter('fixture-key', 'http://fixture.invalid')
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    const ids = sourceIdsFromPrompt(body.messages[1].content)
    return contentReply(ids.map((id) => `[${id}] Hello`).join('\n'))
  }
  const result = await translateWithAdapter({
    sourceLanguage: 'vi', targetLocale: 'en', mode: 'subtitle',
    cues: [{ id: 'cue-0', sourceIndex: 0, start: 0, end: 1, groupId: 'g', text: 'Xin chào' }],
    contextBefore: [], contextAfter: [], glossary: []
  }, adapter, new AbortController().signal)
  assert.equal(result.assessment.disposition, 'validated')
  assert.equal(result.assessment.issues.length, 0)
  assert.equal(calls, 1)
})

test('file runner reports an empty source as a structured needs-review result', async () => fixture(async (input, output) => {
  await writeFile(input, '')
  let calls = 0
  const result = await translateFileWithAdapter(input, output, 'en', {
    capability: {
      provider: 'fixture', modelIdentity: 'fixture@1', revisionKnown: true,
      format: 'json-items', contextTokens: 4096, outputTokens: 512
    },
    async requestOnce() {
      calls++
      return { raw: JSON.stringify({ items: [] }), truncated: false, modelIdentity: 'fixture@1' }
    }
  }, { sourceLanguage: 'vi', mode: 'subtitle' })
  assert.equal(result.ok, false)
  assert.equal(calls, 0)
  assert.equal(result.assessment?.disposition, 'needs-review')
  assert.ok(result.assessment?.issues.some((issue) => issue.code === 'invalid-source'))
}))

test('AutoShort translateStrict uses canonical IDs and publishes only after full validation', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt([
    { ...source[0], id: 'cue-0', sourceIndex: 0, start: 0, end: 1, time: '00:00:00,000 --> 00:00:01,000', text: 'Xin chào' },
    { ...source[0], id: 'cue-1', sourceIndex: 1, start: 2, end: 3, time: '00:00:02,000 --> 00:00:03,000', text: 'Tạm biệt' }
  ]))
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    const ids = sourceIdsFromPrompt(body.messages[1].content)
    return contentReply(ids.map((id) => `[${id}] ${id.startsWith('cue-0-') ? 'Hello' : 'Goodbye'}`).join('\n'))
  }
  const config = {
    translateProvider: 'local',
    translateTarget: 'en',
    translateServerUrl: 'http://fixture.invalid',
    ttsEnabled: false
  } as AutoShortConfig
  await translateStrict(config, input, output, () => {}, new AbortController().signal, 'vi')
  assert.equal(calls, 1)
  const translated = parseSrt(await readFile(output, 'utf8'))
  assert.deepEqual(translated.map((cue) => cue.text), ['Hello', 'Goodbye'])
  assert.deepEqual(translated.map((cue) => cue.time), ['00:00:00,000 --> 00:00:01,000', '00:00:02,000 --> 00:00:03,000'])
}))

test('strict public wrapper surfaces same-script language suspicion as a warning', async () => fixture(async (input, output) => {
  await writeFile(input, buildSrt([{ ...source[0], text: 'Hello world' }]))
  await saveOpenAiKey('fixture-key')
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}'))
    if (body.messages) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ items: [{ id: 'cue-0-0', text: 'Hello world' }] }) }, finish_reason: 'stop' }]
      }))
    }
    return new Response(JSON.stringify({ data: [] }))
  }
  const result = await translateOpenAi(input, output, 'fr', undefined, {
    strict: true,
    mode: 'subtitle',
    sourceLanguage: 'en'
  })
  assert.equal(result.ok, true, result.error)
  assert.equal(result.assessment?.disposition, 'with-warnings')
  assert.ok(result.assessment?.issues.some((issue) => issue.code === 'language-suspect'))
}))

test('AutoShort strict path blocks a strong cross-script echo with structured evidence', async () => fixture(async (input, output) => {
  const sourceText = '这是一个需要完整翻译的中文句子。'
  await writeFile(input, buildSrt([{ ...source[0], text: sourceText }]))
  let calls = 0
  globalThis.fetch = async (_url, init) => {
    calls++
    const body = JSON.parse(String(init?.body))
    const ids = sourceIdsFromPrompt(body.messages[1].content).filter((id) => id.startsWith('cue-'))
    return contentReply(ids.map((id) => `[${id}] ${sourceText}`).join('\n'))
  }
  const config = {
    translateProvider: 'local',
    translateTarget: 'en',
    translateServerUrl: 'http://fixture.invalid',
    ttsEnabled: false
  } as AutoShortConfig
  await assert.rejects(
    translateStrict(config, input, output, () => {}, new AbortController().signal, 'zh'),
    (error: unknown) => {
      const value = error as { translationAssessment?: { disposition?: string; issues?: Array<{ code?: string; severity?: string }> } }
      return value.translationAssessment?.disposition === 'needs-review' &&
        value.translationAssessment.issues?.some((issue) => issue.code === 'language-suspect' && issue.severity === 'error') === true
    }
  )
  assert.equal(calls, 2)
}))

test('translation retry rehydrates its checkpoint after a main-process restart', async () => fixture(async (_input, _output) => {
  const itemId = 'restart-retry-item'
  const identity = 'b'.repeat(64)
  const checkpointDir = join(process.env.TEDIAPROS_TEST_USER_DATA!, 'autoshort-checkpoints', itemId)
  await mkdir(checkpointDir, { recursive: true })
  await writeFile(join(checkpointDir, 'checkpoint.json'), JSON.stringify({
    translationKey: identity,
    translationAssessment: { version: 'translation-assessment-v2', disposition: 'needs-review', issues: [], languageEvidence: 'unknown' },
    translationRetryGeneration: 0
  }), 'utf8')
  const result = await retryAutoShortTranslation({ itemId, expectedIdentity: identity })
  assert.equal(result.ok, true, result.error)
  const checkpoint = JSON.parse(await readFile(join(checkpointDir, 'checkpoint.json'), 'utf8')) as Record<string, unknown>
  assert.equal(checkpoint.translationRetryGeneration, 1)
  assert.equal(checkpoint.translationAssessment, undefined)
}))
