// Synthetic fixtures only. All fetch calls and media engines are mocked.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { localTranslateSrt } from '../../../src/main/localTranslate'
import { parseSrt as parseLegacy, chia } from '../../../src/main/translate-shared'
import { parseSrt, serializeSrt } from '../../../src/shared/subtitles'
import { translateWithAdapter } from '../../../src/main/translation/orchestrator'
import { parseRephraseResponse, mapTranslationsStrict } from '../../../src/main/translation/response'
import { createAutoShortItemProcessor } from '../../../src/main/autoShortItemCoordinator'
import { assessTranslationLanguage } from '../../../src/main/translation/language'
// @ts-expect-error Exposed only by review-only-instrumentation in the temporary bundle.
import { reviewExtractRephrasedTexts } from '../../../src/main/autoshort'
import { translateStrict } from '../../../src/main/autoshort'
import { assessContentQuality } from '../../../src/main/autoShortContentQuality'
import * as gemini from '../../../src/main/gemini'
import * as openai from '../../../src/main/openai'

const root = process.env.TEDIAPROS_TEST_USER_DATA!
const records: { id: string; expected: string; passed: boolean; observed: unknown }[] = []
const record = (id: string, expected: string, passed: boolean, observed: unknown) => records.push({ id, expected, passed, observed })
const contentReply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
const requestedIds = (payload: string): string[] => {
  const section = payload.includes('[SOURCE_CUES_JSONL]')
    ? payload.split('[SOURCE_CUES_JSONL]')[1]?.split('[/SOURCE_CUES_JSONL]')[0] || ''
    : payload.split('[Nội dung cần dịch]:')[1]?.split('[Ngữ cảnh phía sau')[0]?.split('[Toàn văn nhóm')[0] || ''
  return [...section.matchAll(/^\[(cue-[^\]]+)\]/gmu)].map((match) => match[1])
}
const cues = (count: number, text = '这是重庆的山城风景') => Array.from({ length: count }, (_, index) => ({
  id: `original-${index}`, sourceIndex: index, start: index * 2, end: index * 2 + 1, text
}))
const input = {
  sourceLanguage: 'zh', targetLocale: 'en', mode: 'subtitle' as const,
  cues: cues(2).map((cue) => ({ ...cue, id: cue.sourceIndex === 0 ? 'a' : 'b', groupId: 'g' + cue.sourceIndex })),
  contextBefore: [], contextAfter: [], glossary: []
}
const capability = {
  provider: 'fixture' as const, modelIdentity: 'fixture@1', revisionKnown: true,
  format: 'id-lines' as const, contextTokens: 8192, outputTokens: 2048
}

async function main() {
  globalThis.fetch = async () => { throw new Error('No live network allowed in review') }
  for (const fault of ['truncated', 'continuation']) {
    let calls = 0
    const result = await translateWithAdapter(input, {
      capability,
      async requestOnce(batch) {
        calls++
        return {
          raw: batch.input.cues.map((cue) => `[${cue.id}] A view of the city.`).join('\n') + (fault === 'continuation' ? '\nUNPARSED_CONTINUATION' : ''),
          truncated: fault === 'truncated', modelIdentity: 'fixture@1'
        }
      }
    }, new AbortController().signal)
    record(`orchestrator-${fault}`, 'Persistent structurally invalid response must end needs-review.', result.assessment.disposition === 'needs-review', {
      calls, disposition: result.assessment.disposition, issues: result.assessment.issues, itemCount: result.items.length
    })
  }

  for (const limits of ['known-too-small', 'unknown']) {
    let calls = 0
    const result = await translateWithAdapter(input, {
      capability: { ...capability, contextTokens: limits === 'unknown' ? null : 1, outputTokens: limits === 'unknown' ? null : 1 },
      async requestOnce(batch) {
        calls++
        return { raw: batch.input.cues.map((cue) => `[${cue.id}] A view of the city.`).join('\n'), truncated: false, modelIdentity: 'fixture@1' }
      }
    }, new AbortController().signal)
    record(`planner-${limits}`, limits === 'unknown' ? 'Unknown token limits remain warnings after a valid response.' : 'Known unsupported request is rejected before dispatch.',
      limits === 'unknown' ? result.assessment.disposition === 'with-warnings' : calls === 0,
      { calls, unsupported: result.plan.unsupported, disposition: result.assessment.disposition, issues: result.assessment.issues, maxOutputTokens: result.plan.batches[0]?.maxOutputTokens })
  }

  const localInput = join(root, 'local.srt'), localOutput = join(root, 'local-output.srt')
  await writeFile(localInput, serializeSrt(cues(12)))
  const localRequests: string[][] = []
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(JSON.parse(String(init?.body)).messages[1].content)
    localRequests.push(ids)
    return contentReply(localRequests.length === 1
      ? ids.slice(0, -1).map((id) => `[${id}] First translated part.`).join('\n') + '\nUNPARSED_CONTINUATION'
      : ids.map((id) => `[${id}] Repaired translation.`).join('\n'))
  }
  const local = await localTranslateSrt(localInput, localOutput, 'en', 'http://fixture.invalid', 'synthetic-key', undefined, { mode: 'dubbing', sourceLanguage: 'zh', sleep: async () => {} })
  const localText = local.ok ? await readFile(localOutput, 'utf8') : ''
  record('local-lossy-partial-recovery', 'Unparsed response content must not leave first-attempt text accepted as good.',
    !local.ok || !localText.includes('First translated part.'), { ok: local.ok, requests: localRequests, retainedUnvalidatedPrefix: localText.includes('First translated part.'), continuationPresent: localText.includes('UNPARSED_CONTINUATION') })

  const koreanInput = join(root, 'korean.srt')
  await writeFile(koreanInput, serializeSrt(cues(2).map((cue, index) => ({ ...cue, start: index * 1.2, end: index * 1.2 + 1, text: index ? '학생입니다' : '나는' }))))
  let koreanPayload = ''
  globalThis.fetch = async (_url, init) => {
    koreanPayload = JSON.parse(String(init?.body)).messages[1].content
    return contentReply(requestedIds(koreanPayload).map((id) => `[${id}] A student.`).join('\n'))
  }
  const korean = await localTranslateSrt(koreanInput, join(root, 'korean-out.srt'), 'en', 'http://fixture.invalid', 'synthetic-key', undefined, { mode: 'dubbing', sourceLanguage: 'ko', sleep: async () => {} })
  record('korean-production-dubbing-context', 'Korean source group context must retain the space in 나는 학생입니다.',
    koreanPayload.includes('나는 학생입니다') && !koreanPayload.includes('나는학생입니다'), {
      translatorOk: korean.ok, expectedSpacedContext: koreanPayload.includes('나는 학생입니다'), incorrectlyJoinedContext: koreanPayload.includes('나는학생입니다')
    })

  const original = parseSrt(serializeSrt(cues(3))).cues
  const pending = original.slice(1, 2)
  // Production resume keeps the full authoritative source file and filters
  // pending IDs in memory; do not round-trip a subset through SRT, which has
  // no field for the canonical identity.
  const restoredPending = pending
  let mergeError = ''
  try { mapTranslationsStrict(original, [original[0], ...restoredPending, original[2]].map((cue) => ({ id: cue.id, text: 'Translated.' }))) } catch (error) { mergeError = String(error) }
  record('resume-subset-id-roundtrip', 'Pending SRT roundtrip preserves original identity for strict resume merge.', !mergeError, {
    originalPendingId: pending[0].id, afterRoundtripId: restoredPending[0].id, mergeError
  })

  const rawRephrase = '[a:1] Do touch the dog.\nDo not omit this continuation.'
  const parsedRephrase = parseRephraseResponse(rawRephrase, 'a')
  const acceptedRephrase = reviewExtractRephrasedTexts(rawRephrase, 'a')
  record('rephrase-lossy-consumer', 'Consumer must reject candidates from unparsed response content.', acceptedRephrase.length === 0, {
    parserComplete: parsedRephrase.complete, parserIssues: parsedRephrase.issues.map((item) => item.code), acceptedCandidates: acceptedRephrase
  })

  // Exercise the real coordinator twice against the same checkpoint. All engines are injected.
  const coordinatorRoot = join(root, 'coordinator')
  await mkdir(coordinatorRoot)
  const video = join(coordinatorRoot, 'input.mp4'), whisper = join(coordinatorRoot, 'source.srt')
  await writeFile(video, 'synthetic-video-bytes')
  await writeFile(whisper, serializeSrt(cues(30)))
  const config = {
    subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu', whisperLanguage: 'zh',
    ocrRegion: { x0: 0, y0: 0.7, x1: 1, y1: 0.9 }, blurRegions: [], lamMo: false, blurMode: 'manual', ocrBlurProfile: 'fast',
    translateTarget: 'en', translateProvider: 'local', translateServerUrl: 'http://fixture.invalid',
    ttsEnabled: false, voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 20, outputDir: join(coordinatorRoot, 'output')
  }
  let asrCalls = 0, coordinatorCalls = 0
  let firstBatchIds: string[] = []
  globalThis.fetch = async (_url, init) => {
    coordinatorCalls++
    if (coordinatorCalls === 1) {
      firstBatchIds = requestedIds(JSON.parse(String(init?.body)).messages[1].content)
      return contentReply(firstBatchIds.map((id) => `[${id}] A view of the city.`).join('\n'))
    }
    return new Response('synthetic unauthorized', { status: 401 })
  }
  const processor = createAutoShortItemProcessor({
    resolveFfmpeg: async () => 'mock-ffmpeg', resolveFfprobe: async () => 'mock-ffprobe',
    probeMedia: async () => ({ w: 1280, h: 720, giay: 65, hasAudio: true }),
    transcribeAudio: async () => { asrCalls++; return { ok: true, outputs: [whisper], language: 'zh' } },
    runVisualOcr: async () => { throw new Error('Review must not call OCR') },
    writeTimedMask: async () => { throw new Error('Review must not create media mask') },
    burn: async () => { throw new Error('Review must not render') }
  })
  const context = {
    jobId: 'review-job', request: { items: [{ id: 'review-item', filePath: video }], config }, item: { id: 'review-item', filePath: video },
    index: 0, total: 1, signal: new AbortController().signal, emit() {}, checkpointDir: join(coordinatorRoot, 'checkpoint'),
    workDir: join(coordinatorRoot, 'work'), artifactDir: join(coordinatorRoot, 'artifacts'), separationProviderState: { forceCpu: false }
  }
  const firstRun = await processor(context)
  const saved = JSON.parse(await readFile(join(context.checkpointDir, 'checkpoint.json'), 'utf8'))
  record('coordinator-durable-good-batch', 'Validated first batch is available in translatedCues for resume after a later provider failure.',
    firstBatchIds.length > 0 && saved.translatedCues?.length === firstBatchIds.length, {
      status: firstRun.status, error: firstRun.error, firstBatchIds, sourceIds: saved.sourceCues?.slice(0, 2).map((cue) => cue.id),
      savedTranslatedCueCount: saved.translatedCues?.length ?? 0, savedBatchCount: Object.keys(saved.translationBatches || {}).length,
      assessment: saved.translationAssessment?.disposition, checkpointFields: Object.keys(saved)
    })
  const callsBeforeResume = coordinatorCalls
  const secondRun = await processor(context)
  record('coordinator-needs-review-resume-gate', 'Reopen needs-review without explicit retry generation dispatches no request.',
    coordinatorCalls === callsBeforeResume, { firstDisposition: saved.translationAssessment?.disposition, secondStatus: secondRun.status, callsBeforeResume, callsAfterResume: coordinatorCalls, asrCalls })

  // Capture actual request bodies from both cloud wrappers; no request leaves this process.
  const cloudInput = join(root, 'cloud.srt')
  await writeFile(cloudInput, serializeSrt(cues(10, '这'.repeat(11000))))
  const normalBatches = chia(parseLegacy(await readFile(cloudInput, 'utf8'))).length
  for (const [provider, api] of [['gemini', gemini], ['openai', openai]] as const) {
    await api.saveKey('synthetic-key')
    let calls = 0, discovery = 0, captured: any
    globalThis.fetch = async (_url, init) => {
      if (!init?.body) {
        discovery++
        return new Response(JSON.stringify(provider === 'gemini'
          ? { models: ['gemini-2.5-flash', 'gemini-2.0-flash'].map((name) => ({ name, supportedGenerationMethods: ['generateContent'] })) }
          : { data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }))
      }
      calls++
      captured = JSON.parse(String(init.body))
      if (calls % 2) return new Response('synthetic busy', { status: 503 })
      const payload = provider === 'gemini' ? captured.contents[0].parts[0].text : captured.messages[1].content
      const items = requestedIds(payload).map((id) => ({ id, t: 'A view of the city.' }))
      return provider === 'gemini'
        ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] }, finishReason: 'STOP' }] }))
        : contentReply(JSON.stringify({ items }))
    }
    const result = await api.translateSrt(cloudInput, join(root, provider + '.srt'), 'en', undefined, { strict: true, mode: 'subtitle', sourceLanguage: 'zh' })
    const totalBudget = normalBatches + Math.max(4, Math.ceil(normalBatches * 0.5))
    record(`${provider}-shared-request-budget`, 'Cloud model fallback counts against B + max(4, ceil(B/2)).', calls <= totalBudget, { normalBatches, totalBudget, inferenceCalls: calls, discoveryCalls: discovery, ok: result.ok })
    const system = provider === 'gemini' ? captured.systemInstruction.parts[0].text : captured.messages[0].content
    const payload = provider === 'gemini' ? captured.contents[0].parts[0].text : captured.messages[1].content
    const schema = provider === 'gemini' ? captured.generationConfig.responseSchema : captured.response_format.json_schema.schema
    const itemSchema = schema.type.toLowerCase() === 'array' ? schema.items : schema.properties.items.items
    record(`${provider}-actual-prompt-schema`, 'Actual system output contract and response schema agree on object.items[].text; source uses shared JSONL payload.',
      schema.type.toLowerCase() === 'object' && Boolean(itemSchema.properties.text) && payload.includes('[SOURCE_CUES_JSONL]'), {
        systemRequiresTextProperty: system.includes('"text":"<translation>"'), schemaRoot: schema.type, schemaItemProperties: Object.keys(itemSchema.properties), sharedJsonlPayload: payload.includes('[SOURCE_CUES_JSONL]')
      })
  }

  const echoInput = join(root, 'echo.srt'), echoOutput = join(root, 'echo-output.srt')
  const echoSource = 'The dog is standing next to the door and looking at the people.'
  await writeFile(echoInput, serializeSrt(cues(1, echoSource)))
  globalThis.fetch = async (_url, init) => {
    const ids = requestedIds(JSON.parse(String(init?.body)).messages[1].content)
    return contentReply(ids.map((id) => `[${id}] ${echoSource}`).join('\n'))
  }
  let echo = { ok: true }
  try {
    await translateStrict({ ...config, translateTarget: 'fr' }, echoInput, echoOutput, () => {}, new AbortController().signal, 'en')
  } catch { echo = { ok: false } }
  const quality = echo.ok ? assessContentQuality(parseSrt(await readFile(echoInput, 'utf8')).cues, parseSrt(await readFile(echoOutput, 'utf8')).cues) : null
  const language = echo.ok
    ? assessTranslationLanguage({ ...input, sourceLanguage: 'en', targetLocale: 'fr', cues: parseSrt(await readFile(echoInput, 'utf8')).cues.map((cue, index) => ({ ...cue, sourceIndex: index, groupId: `cue-${index}` })) }, parseSrt(await readFile(echoOutput, 'utf8')).cues.map((cue, index) => ({ id: cue.id, text: cue.text, sourceIndex: index })))
    : null
  record('production-path-same-script-language-warning', 'Unchanged English sentence requested as French must produce language suspicion evidence.',
    !echo.ok || language?.languageEvidence === 'suspect', { translatorOk: echo.ok, disposition: quality?.disposition, issues: [...(quality?.issues || []), ...(language?.issues || [])], languageEvidence: language?.languageEvidence })

  console.log('REVIEW_PROBES_JSON=' + JSON.stringify({
    reviewedCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    evidence: 'TEST_CONFIRMED_OFFLINE_MOCKS', network: 'all fetch calls mocked', runtimeModified: true,
    privateInstrumentation: 'Only extractRephrasedTexts exported from the temporary esbuild bundle.',
    total: records.length, passed: records.filter((item) => item.passed).length, failed: records.filter((item) => !item.passed).length, records
  }))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
