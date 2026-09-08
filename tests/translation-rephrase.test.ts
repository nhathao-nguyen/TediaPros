import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRephraseResponse } from '../src/main/translation/response'
import { buildRephraseMessages } from '../src/main/translation/prompts'
import { extractRephrasedTexts } from '../src/main/autoshort'
import * as responseModule from '../src/main/translation/response'
import { translateStrict } from '../src/main/autoshort'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseSrt } from '../src/shared/subtitles'
import { buildDubbingPlan } from '../src/main/dubbing/plan'
import { synthesizeDubbingPlan } from '../src/main/dubbing/synthesis'
import * as dubbingTranslation from '../src/main/dubbing/translation'

test('rephrase parser accepts at most three grounded candidates', () => {
  const result = parseRephraseResponse('[c1:1] Do not touch it.\n[c1:2] Please do not touch it.', 'c1')
  assert.equal(result.complete, true)
  assert.equal(result.items.length, 2)
  assert.deepEqual(result.items.map((item) => item.id), ['c1:1', 'c1:2'])
})

test('partial batch recovery keeps exact IDs and quarantines ambiguous or incomplete cues', () => {
  const recover = (responseModule as any).recoverBatchRephraseResponse
  assert.equal(typeof recover, 'function')
  for (const [raw, expected] of [
    ['[c1:1] One. [foreign:1] Ignore. [c2:1] Two.', ['c1:1', 'c2:1']],
    ['[c1] One.\n[c2] Two.', ['c1:1', 'c2:1']],
    ['[c1:1] One. [c1:1] Duplicate. [c2:1] Two.', ['c2:1']],
    ['[c1:1] One. [c1:4] Extra. [c2:1] Two.', ['c2:1']],
    ['[c1] One. [c1:1] Ambiguous. [c2:1] Two.', ['c2:1']],
    ['[c1] One. [c1:2] Ambiguous. [c2:1] Two.', ['c2:1']],
    ['[c1:1] One.\nUnparsed continuation.\n[c2:1] Two.', []],
    ['[c1:1] One. c1:2 Another.\n[c2:1] Two.', []],
    ['[c1:1] One. [foreign] Ignore. [c2:1] Two.', []]
  ] as const) {
    const result = recover(raw, ['c1', 'c2'])
    assert.deepEqual(result.items.map((item: { id: string }) => item.id), expected, raw)
  }
})

test('local batch repairs only missing cues once and preserves valid candidates from the first response', async () => {
  const { rephraseDubbingCues } = await import('../src/main/autoshort') as any
  assert.equal(typeof rephraseDubbingCues, 'function')
  const previousFetch = globalThis.fetch
  const received: string[][] = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const rows = body.messages[1].content.split('\n').filter((line: string) => line.startsWith('{')).map((line: string) => JSON.parse(line))
    received.push(rows.map((row: { id: string }) => row.id))
    const content = received.length === 1
      ? '[c1:1] Keep this safe choice.\n[wrong-id:1] Discard.\n[c2:1] First.\n[c2:1] Conflicting.'
      : '[c2:1] Repaired choice.'
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
  }
  try {
    const result = await rephraseDubbingCues({ translateProvider: 'local', translateServerUrl: 'http://fixture.invalid' },
      ['c1', 'c2'].map((cueId) => ({ cueId, currentText: 'A longer original sentence.', targetDuration: 1.5, measuredDuration: 2.4, maxDuration: 2.175 })), 'en')
    assert.deepEqual(received, [['c1', 'c2'], ['c2']])
    assert.deepEqual([...result], [['c1', ['Keep this safe choice.']], ['c2', ['Repaired choice.']]])
  } finally { globalThis.fetch = previousFetch }
})

test('local measured-overflow batches are capped at eight cues and carry measured timing fields', async () => {
  const { rephraseDubbingCues } = await import('../src/main/autoshort') as any
  const previousFetch = globalThis.fetch
  const received: Array<{ ids: string[]; rows: any[] }> = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const rows = body.messages[1].content.split('\n').filter((line: string) => line.startsWith('{')).map((line: string) => JSON.parse(line))
    received.push({ ids: rows.map((row: { id: string }) => row.id), rows })
    const content = rows.map((row: { id: string }) => `[${row.id}:1] Short ${row.id}.`).join('\n')
    return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
  }
  try {
    const requests = Array.from({ length: 9 }, (_, index) => ({
      cueId: `overflow-${index}`,
      currentText: `Original ${index} with extra words.`,
      sourceText: `Nguồn ${index}`,
      targetDuration: 1.1,
      measuredDuration: 2.4,
      maxDuration: 1.595,
      contextBefore: index > 0 ? [`Nguồn ${index - 1}`] : [],
      contextAfter: index < 8 ? [`Nguồn ${index + 1}`] : []
    }))
    const result = await rephraseDubbingCues({ translateProvider: 'local', translateServerUrl: 'http://fixture.invalid' }, requests, 'en')
    assert.deepEqual(received.map((batch) => batch.ids.length), [8, 1])
    assert.equal(received[0].rows[0].measured_natural_seconds, 2.4)
    assert.equal(received[0].rows[0].target_duration_seconds, 1.1)
    assert.equal(received[0].rows[0].hard_max_natural_seconds, 1.595)
    assert.equal(received[0].rows[0].source_text, 'Nguồn 0')
    assert.deepEqual([...result.keys()], requests.map((request) => request.cueId))
  } finally { globalThis.fetch = previousFetch }
})

test('measured rescue prompt carries the observed voice duration and feasible word budget', () => {
  const messages = buildRephraseMessages({ targetLocale: 'en', cues: [{
    id: 'cue-0-2320', sourceText: '吃鸡之前记得仔细看看',
    currentText: 'Remember to check carefully before eating chicken', targetDuration: 1.364,
    measuredDuration: 2.738, maxDuration: 1.798, contextBefore: [], contextAfter: []
  } as any] })
  const row = JSON.parse(messages[1].content.split('\n').find((line) => line.startsWith('{'))!)
  assert.equal(row.measured_natural_seconds, 2.738)
  assert.equal(row.hard_max_natural_seconds, 1.798)
  assert.equal(row.target_word_count, 4)
  assert.equal(row.max_word_count, 4)
})

test('compact English questions keep the demonstrative, subject, negation and question', () => {
  const compact = (dubbingTranslation as any).compactEnglishDubbingQuestion
  assert.equal(typeof compact, 'function')
  assert.equal(compact('Is this cow edible?', 'en'), 'This cow edible?')
  assert.equal(compact('Are those 3 samples not safe?', 'en-US'), 'Those 3 samples not safe?')
  for (const text of ['Can this cow be eaten?', 'This cow is edible.', 'Is this safe? Is that safe?', 'Is this', 'Is this?']) {
    assert.equal(compact(text, 'en'), null, text)
  }
  assert.equal(compact('Is this cow edible?', 'vi'), null)
})

test('measured 0.9s question rescue handles duplicate unhelpful LLM output within the existing audio budget', async () => {
  const plan = dubbingTranslation.applyDubbingTranslations(buildDubbingPlan({ videoDuration: 87, cues: [
    { id: 'cue-52-82640', start: 82.64, end: 84.04, text: '这种牛能吃吗' },
    { id: 'answer', start: 84.04, end: 86, text: '这是婆罗门牛' }
  ] }), [{ id: 'cue-52-82640', text: 'Is this cow edible?' }, { id: 'answer', text: 'This is a Brahman cow.' }])
  let llmCalls = 0
  const questionTexts: string[] = []
  const result = await synthesizeDubbingPlan({ plan, language: 'en', model: 'fixture',
    rephrase: async () => { llmCalls++; return ['Is this cow edible?', 'Can you eat this cow?', 'Is this cow edible?'] },
    tts: { synthesize: async (request) => { if (request.cueId === 'cue-52-82640') questionTexts.push(request.text); return { path: request.text } } },
    audio: {
      trim: async (path) => ({ path, duration: path === 'Is this cow edible?' ? 1.425397 : path === 'Can you eat this cow?' ? 1.348934 : 1.07 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration })
    }
  })
  assert.equal(llmCalls, 1)
  assert.equal(result.plan.cues[0].finalSpokenText, 'This cow edible?')
  assert.equal(result.plan.cues[0].subtitles[0].text, 'This cow edible?')
  assert.ok(result.plan.cues[0].tempo <= 1.45)
  assert.ok(questionTexts.length <= 4, 'original plus at most three rescue candidates')
})

test('compact question shares the three-audio limit with LLM candidates and cannot force an impossible fit', async () => {
  const plan = buildDubbingPlan({ videoDuration: 4, cues: [
    { id: 'question', start: 0, end: 1.4, text: 'Is this cow edible?' },
    { id: 'answer', start: 1.4, end: 3, text: 'This is a cow.' }
  ] })
  let llmCalls = 0
  const requests: string[] = []
  await assert.rejects(synthesizeDubbingPlan({ plan, language: 'en', model: 'fixture',
    rephrase: async () => { llmCalls++; return ['Can you eat this cow?', 'Is this cow safe to eat?', 'Can this cow be eaten?'] },
    tts: { synthesize: async (request) => { if (request.cueId === 'question') requests.push(request.text); return { path: request.text } } },
    audio: { trim: async path => ({ path, duration: 3 }), applyTempo: async () => { throw new Error('must not force fit') } }
  }), /vượt trần/u)
  assert.equal(llmCalls, 1)
  assert.equal(requests.length, 4, 'one original plus three rescue audio attempts total')
  assert.ok(requests.includes('This cow edible?'))
})

test('batch recovery has a bounded missing-only repair pass and keeps results if a repair fails', async () => {
  const { rephraseDubbingCues } = await import('../src/main/autoshort')
  const previousFetch = globalThis.fetch
  try {
    for (const failRepair of [false, true]) {
      const batches: string[][] = []
      globalThis.fetch = async (_url, init) => {
        const rows = JSON.parse(String(init?.body)).messages[1].content.split('\n').filter((line: string) => line.startsWith('{')).map((line: string) => JSON.parse(line))
        batches.push(rows.map((row: { id: string }) => row.id))
        if (batches.length > 1 && failRepair) return new Response('{}', { status: 503 })
        return new Response(JSON.stringify({ choices: [{ message: { content: batches.length === 1 ? '[c0:1] Keep me. [foreign:1] Ignore.' : '[foreign:1] Still wrong.' }, finish_reason: 'stop' }] }))
      }
      const requests = Array.from({ length: 24 }, (_, i) => ({ cueId: `c${i}`, currentText: 'Original text.', targetDuration: 1 }))
      const result = await rephraseDubbingCues({ translateProvider: 'local', translateServerUrl: 'http://fixture.invalid' } as any, requests, 'en')
      assert.deepEqual([...result], [['c0', ['Keep me.']]])
      assert.deepEqual(batches.map((batch) => batch.length), failRepair ? [24, 8] : [24, 8, 8, 7])
      assert.ok(batches.slice(1).every((batch) => !batch.includes('c0')))
    }
  } finally { globalThis.fetch = previousFetch }
})

test('single rescue rejects a truncated provider response before any partial candidate can be spoken', async () => {
  const { rephraseDubbingCue } = await import('../src/main/autoshort')
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '[c1:1] Do not' }, finish_reason: 'length' }] }))
  try {
    assert.deepEqual(await rephraseDubbingCue({ translateProvider: 'local', translateServerUrl: 'http://fixture.invalid' } as any, 'c1', 'Do not eat this food.', 1, 'en'), [])
  } finally { globalThis.fetch = previousFetch }
})

test('inline rephrase alternatives are separate candidates, never spoken metadata', () => {
  const raw = '[cue-0-1490:1] Check the crab carefully before eating. [cue-0-1490:2] Take a good look at this crab before you eat it. [cue-0-1490:3] Inspect the crab closely before eating.'
  assert.deepEqual(extractRephrasedTexts(raw, 'cue-0-1490'), [
    'Check the crab carefully before eating.',
    'Take a good look at this crab before you eat it.',
    'Inspect the crab closely before eating.'
  ])
  const batch = responseModule.parseBatchRephraseResponse('[c1:1] One. [c2:1] Two.\r\n[c1:2] First.', ['c1', 'c2'])
  assert.equal(batch.complete, true)
  assert.deepEqual(batch.items.map((item) => item.id), ['c1:1', 'c2:1', 'c1:2'])
})

test('inline normalization still rejects duplicate, unknown, invalid, or bare candidate labels', () => {
  for (const raw of [
    '[c1:1] One. [c1:1] Duplicate.',
    '[c1:1] One. [other:1] Unknown.',
    '[c1:1] One. [c1:4] Out of range.',
    '[c1:1] One. c1:2 Second.',
    '[c1:1] One.\nThis is an explanation.'
  ]) assert.deepEqual(extractRephrasedTexts(raw, 'c1'), [], raw)
})

test('inline rescue alternatives send exactly one clean choice to TTS', async () => {
    const id = 'cue-0-1490'
    const original = 'Take a close look before eating this crab.'
    const selected = 'Check the crab carefully before eating.'
    const raw = `[${id}:1] ${selected} [${id}:2] Take a good look at this crab before you eat it. [${id}:3] Inspect the crab closely before eating.`
    const spoken: string[] = []
    const result = await synthesizeDubbingPlan({
      plan: buildDubbingPlan({ videoDuration: 1.92, cues: [{ id, start: 0, end: 1.42, text: original }] }),
      language: 'en', model: 'fixture',
      predictor: { profile: { version: 2, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
        estimate: (text) => ({ seconds: text === original ? 4 : text.split(/\s+/u).length * 0.2, uncertaintySeconds: 0, confidence: 1 }),
        addSample: () => {} },
      rephrase: async () => extractRephrasedTexts(raw, id),
      tts: { synthesize: async (request) => { spoken.push(request.text); return { path: request.text } } },
      audio: { trim: async (path) => ({ path, duration: path === original ? 2.311 : 1.8 }),
        applyTempo: async (path, _hint, duration) => ({ path, duration }) }
    })
    assert.deepEqual(spoken, [original, selected])
    assert.equal(result.plan.cues[0].finalSpokenText, selected)
    assert.equal(result.plan.cues[0].subtitles[0].text, selected)
    assert.equal(result.plan.cues[0].translatedText, original)
    assert.ok(result.plan.cues[0].tempo <= 1.45)
})

test('rephrase parser rejects continuation and free-form prose', () => {
  const result = parseRephraseResponse('[c1:1] First line\nsecond line', 'c1')
  assert.equal(result.complete, false)
  assert.ok(result.issues.some((issue) => issue.code === 'unparsed-content'))
  assert.deepEqual(parseRephraseResponse('Here is a shorter option.', 'c1').items, [])
})

test('rephrase prompt carries source evidence and no translation cardinality contract', () => {
  const messages = buildRephraseMessages({ targetLocale: 'en', cues: [{
    id: 'c1', sourceText: '不要摸这只狗。', currentText: 'Do not touch this dog.', targetDuration: 2,
    contextBefore: [], contextAfter: []
  }] })
  assert.match(messages[0].content, /task=rephrase/u)
  assert.match(messages[1].content, /不要摸这只狗/u)
  assert.doesNotMatch(messages[0].content, /one translation per ID|đúng một.*cue/iu)
})

test('rephrase consumer rejects candidate text when the provider response has an unparsed continuation', () => {
  assert.deepEqual(extractRephrasedTexts('[c1:1] First line\nsecond line', 'c1'), [])
})

test('batch rephrase accepts requested cues and rejects unknown IDs or trailing prose', () => {
  const parse = (responseModule as any).parseBatchRephraseResponse
  assert.equal(typeof parse, 'function')
  const result = parse('[c1:1] Short one.\n[c2:1] Short two.', ['c1', 'c2'])
  assert.equal(result.complete, true)
  assert.equal(result.items.length, 2)
  assert.equal(parse('[c1:1] One.\n[c3:1] Other.', ['c1', 'c2']).complete, false)
  assert.equal(parse('[c1:1] One.\ncontinuation', ['c1']).complete, false)
})

test('AutoShort sends video-aware timing to the local translator and preserves source cue timing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-dubbing-budget-'))
  const previousFetch = globalThis.fetch
  try {
    const source = '1\n00:00:01,490 --> 00:00:02,900\n不同的螃蟹能不能吃？\n\n2\n00:00:03,410 --> 00:00:04,000\n这种螃蟹可以吃。\n'
    const inputPath = join(root, 'source.srt')
    const outputPath = join(root, 'target.srt')
    await writeFile(inputPath, source)
    const cues = parseSrt(source).cues
    let inspected = false
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      const prompt = body.messages[1].content as string
      const data = prompt.split('\n').filter((line) => /^\[.*?\] \{/u.test(line)).map((line) => JSON.parse(line.slice(line.indexOf('{'))))
      assert.equal(data.length, 2)
      assert.ok(Math.abs(data[0].speaking_duration_seconds - 1.42) < 0.001)
      assert.ok(Math.abs(data[1].speaking_duration_seconds - 1.09) < 0.001)
      inspected = true
      return new Response(JSON.stringify({ choices: [{ message: { content: cues.map((cue, i) => `[${cue.id}] ${i ? 'This crab is edible.' : 'Which crabs are edible?'}`).join('\n') }, finish_reason: 'stop' }] }))
    }
    await translateStrict({ translateProvider: 'local', translateTarget: 'en', ttsEnabled: true,
      translateServerUrl: 'http://fixture.invalid' } as any, inputPath, outputPath, () => {},
      new AbortController().signal, 'zh', undefined, undefined, [], undefined, 5)
    assert.equal(inspected, true)
    const translated = parseSrt(await readFile(outputPath, 'utf8')).cues
    assert.deepEqual(translated.map((cue) => [cue.id, cue.start, cue.end]), cues.map((cue) => [cue.id, cue.start, cue.end]))
  } finally {
    globalThis.fetch = previousFetch
    await rm(root, { recursive: true, force: true })
  }
})
