import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AutoShortConfig, OcrVisualTimeline } from '../src/shared/types'
import { createAutoShortItemProcessor, type AutoShortItemCoordinatorDeps } from '../src/main/autoShortItemCoordinator'
import { calculateRestorationOutputTokenLimit, partitionRestorationCues, runGatewayRestoration } from '../src/main/geminiGatewayRestoration'

const routeFingerprint = '9'.repeat(64)
const audioFixture = Buffer.from('deterministic-restoration-audio-fixture', 'utf8')

test('restoration output ceiling scales with cue count and remains bounded', () => {
  assert.equal(calculateRestorationOutputTokenLimit(1), 2048)
  assert.equal(calculateRestorationOutputTokenLimit(23), 3968)
  assert.equal(calculateRestorationOutputTokenLimit(100), 8192)
})

test('restoration partitions long cue lists without reordering or dropping cue identity', () => {
  const cues = Array.from({ length: 23 }, (_, index) => ({
    id: `cue-${index + 1}`,
    start: index,
    end: index + 0.9,
    text: `source ${index + 1}`
  }))
  const chunks = partitionRestorationCues(cues)
  assert.deepEqual(chunks.map((chunk) => chunk.length), [8, 8, 7])
  assert.deepEqual(chunks.flat().map((cue) => cue.id), cues.map((cue) => cue.id))
})

test('gateway restoration executes and combines independent chunks for more than eight cues', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-gateway-restoration-chunks-'))
  const previousFetch = globalThis.fetch
  const cues = Array.from({ length: 9 }, (_, index) => ({
    id: `cue-${index + 1}`,
    start: index,
    end: index + 0.9,
    text: `source ${index + 1}`
  }))
  const operationResponses = new Map<string, { clientRequestId: string; raw: string }>()
  const requestCueIds: string[][] = []
  let requestCount = 0
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      if (target.endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          scheduler_contract_version: 1,
          request_jobs: true,
          provider_ready: true,
          models: ['gemini-advanced'],
          max_request_body_bytes: 4 * 1024 * 1024,
          gateway_model_routes: { 'gemini-advanced': { route_fingerprint: routeFingerprint } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.endsWith('/gateway/requests')) {
        requestCount++
        const operationId = `chunk-operation-${requestCount}`
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string; request: Record<string, unknown> }
        const messages = envelope.request.messages as Array<{ content?: unknown }>
        const userContent = messages.find((message) => Array.isArray(message.content))?.content as Array<Record<string, unknown>>
        const text = String(userContent.find((part) => part.type === 'text')?.text || '')
        const payload = JSON.parse(text) as {
          schemaVersion: string
          evidenceDigest: string
          candidateDigest?: string
          cues?: Array<{ id: string }>
          draft?: { items: Array<{ id: string; target: string }> }
        }
        const ids = payload.cues?.map((cue) => cue.id) || payload.draft?.items.map((item) => item.id) || []
        requestCueIds.push(ids)
        const raw = payload.schemaVersion === 'restoration-draft-input-v1'
          ? JSON.stringify({
            schemaVersion: 'restoration-translation-v1', evidenceDigest: payload.evidenceDigest,
            sourceEdits: [], sentenceEndIds: ids, entities: [],
            items: ids.map((id) => ({ id, target: `translated ${id}` }))
          })
          : JSON.stringify({
            schemaVersion: 'restoration-review-v1', candidateDigest: payload.candidateDigest,
            reviewedCueIds: ids, status: 'approved', confidenceScore: 0.99,
            reviewerNotes: 'chunk fixture approved',
            groupAssessments: [{ groupId: 'all', cueIds: ids, status: 'approved', reason: 'fixture' }],
            findings: [], replacements: []
          })
        operationResponses.set(operationId, { clientRequestId: envelope.client_request_id, raw })
        return new Response(JSON.stringify({
          id: operationId, client_request_id: envelope.client_request_id, status: 'queued',
          dispatch_state: 'not-dispatched', upstream_attempts: 0, created_at_utc: '2026-09-17T00:00:00.000Z'
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      const operation = /\/gateway\/requests\/(chunk-operation-\d+)$/u.exec(target)
      if (operation) {
        const stored = operationResponses.get(operation[1])!
        return new Response(JSON.stringify({
          id: operation[1], client_request_id: stored.clientRequestId, status: 'succeeded',
          dispatch_state: 'dispatched', upstream_attempts: 1, created_at_utc: '2026-09-17T00:00:00.000Z',
          response: completion(stored.raw, operation[1])
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (/\/gateway\/requests\/chunk-operation-\d+\/ack$/u.test(target)) return new Response(null, { status: 204 })
      return new Response('not found', { status: 404 })
    }
    const result = await runGatewayRestoration({
      baseUrl: 'http://127.0.0.1:8080', sourceCues: cues,
      mediaDigest: 'b'.repeat(64), sourceLanguage: 'en', targetLocale: 'vi', mode: 'subtitle', glossary: [],
      audio: { data: audioFixture, format: 'mp3', durationSeconds: 9, sampleRate: 16_000, channels: 1,
        sha256: createHash('sha256').update(audioFixture).digest('hex') },
      ocrFrames: [], signal: new AbortController().signal, draftDir: join(root, 'gateway')
    })
    assert.equal(requestCount, 4)
    assert.deepEqual(requestCueIds.map((ids) => ids.length), [8, 8, 1, 1])
    assert.deepEqual(result.translatedItems.map((item) => item.id), cues.map((cue) => cue.id))
    assert.deepEqual(result.translatedItems.map((item) => item.text), cues.map((cue) => `translated ${cue.id}`))
    assert.equal(result.metrics.cueCountPreserved, true)
    assert.ok(await stat(join(root, 'gateway', 'chunk-001', 'restoration-draft-v1.json')))
    assert.ok(await stat(join(root, 'gateway', 'chunk-002', 'restoration-review-v1.json')))
  } finally {
    globalThis.fetch = previousFetch
    await rm(root, { recursive: true, force: true })
  }
})

function completion(content: string, logicalRequestId: string): Record<string, unknown> {
  return {
    id: `completion-${logicalRequestId}`,
    model: 'gemini-advanced',
    choices: [{ message: { content }, finish_reason: 'stop' }],
    gateway_metadata: {
      gateway_contract_version: 2,
      model_verification: 'matched',
      observed_model_id: 'gemini-3.1-pro-test',
      observed_model: 'Gemini 3.1 Pro Test',
      resolved_model: 'gemini-advanced',
      completion_state: 'complete',
      completion_evidence: `fixture-${logicalRequestId}`,
      route_fingerprint: routeFingerprint,
      upstream_attempts: 1,
      logical_request_id: logicalRequestId
    }
  }
}

test('production coordinator sends decoded bounded audio and timestamped OCR evidence through gateway restoration while preserving cue identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-gateway-restoration-'))
  const previousFetch = globalThis.fetch
  const outputDir = join(root, 'output')
  const workDir = join(root, 'work')
  const checkpointDir = join(root, 'checkpoint')
  const artifactDir = join(root, 'artifact')
  const video = join(root, 'source.mp4')
  const sourceSrt = join(root, 'source.srt')
  const outgoing: Array<Record<string, unknown>> = []
  const clientRequestIds = new Map<string, string>()
  const extractionSources: string[] = []
  let burnTitleSrt = ''
  let burnTitleSrtContent = ''
  let requestCount = 0
  let burnAttempts = 0
  let asrRuns = 0
  let ocrRuns = 0
  try {
    await mkdir(outputDir)
    await writeFile(video, 'prepared-media-fixture')
    await writeFile(sourceSrt, [
      '1',
      '00:00:00,000 --> 00:00:01,000',
      '窝耳窝 XC90 rất êm.',
      '',
      '2',
      '00:00:01,000 --> 00:00:02,000',
      'B6 智雅豪华版.',
      ''
    ].join('\n'), 'utf8')

    const draft = JSON.stringify({
      schemaVersion: 'restoration-translation-v1',
      evidenceDigest: 'resolved-by-test-after-wire-capture',
      sourceEdits: [{ id: '1', text: '沃尔沃 XC90 rất êm.', kind: 'ocr_alignment', evidenceRefs: ['ocr_0'] }],
      sentenceEndIds: ['1', '2'],
      entities: [],
      items: [{ id: '1', target: 'Volvo XC90 chạy rất êm.' }, { id: '2', target: 'Bản B6 Momentum Luxury.' }]
    })

    // The fake gateway fills the evidence digest only after it sees the real
    // request, so the test proves the coordinator created the local evidence
    // pack before the first generation is dispatched.
    let draftForResponse = draft
    let reviewForResponse = ''
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      if (target.endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          scheduler_contract_version: 1,
          request_jobs: true,
          provider_ready: true,
          models: ['gemini-advanced'],
          max_request_body_bytes: 4 * 1024 * 1024,
          gateway_model_routes: { 'gemini-advanced': { route_fingerprint: routeFingerprint } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.endsWith('/gateway/requests')) {
        requestCount++
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string; request: Record<string, unknown> }
        clientRequestIds.set(`restoration-operation-${requestCount}`, envelope.client_request_id)
        outgoing.push(envelope.request)
        const messages = envelope.request.messages as Array<{ content?: unknown }>
        const userContent = messages.find((message) => Array.isArray(message.content))?.content as Array<Record<string, unknown>> | undefined
        const evidenceText = userContent?.find((part) => part.type === 'text')?.text
        if (typeof evidenceText === 'string' && requestCount === 1) {
          const payload = JSON.parse(evidenceText) as { evidenceDigest: string; cues: Array<{ id: string }> }
          const [firstCue, secondCue] = payload.cues
          const resolvedDraft = {
            schemaVersion: 'restoration-translation-v1',
            evidenceDigest: payload.evidenceDigest,
            sourceEdits: [{ id: firstCue.id, text: '沃尔沃 XC90 rất êm.', kind: 'ocr_alignment', evidenceRefs: ['ocr_0'] }],
            sentenceEndIds: payload.cues.map((cue) => cue.id),
            entities: [],
            items: [{ id: firstCue.id, target: 'Volvo XC90 chạy rất êm.' }, { id: secondCue.id, target: 'Bản B6 Momentum Luxury.' }]
          }
          draftForResponse = JSON.stringify(resolvedDraft)
          const candidateDigest = createHash('sha256').update(JSON.stringify({
            schemaVersion: 'restoration-translation-v1',
            evidenceDigest: payload.evidenceDigest,
            sourceEdits: [{ id: firstCue.id, text: '沃尔沃 XC90 rất êm.', kind: 'ocr_alignment', evidenceRefs: ['ocr_0'] }],
            sentenceEndIds: payload.cues.map((cue) => cue.id),
            entities: [],
            items: [{ id: firstCue.id, target: 'Volvo XC90 chạy rất êm.' }, { id: secondCue.id, target: 'Bản B6 Momentum Luxury.' }]
          })).digest('hex')
          reviewForResponse = JSON.stringify({
            schemaVersion: 'restoration-review-v1',
            candidateDigest,
            reviewedCueIds: payload.cues.map((cue) => cue.id),
            status: 'approved',
            confidenceScore: 0.99,
            reviewerNotes: 'fixture independently reviewed',
            groupAssessments: [{ groupId: 'all', cueIds: payload.cues.map((cue) => cue.id), status: 'approved', reason: 'grounded by fixture evidence' }],
            findings: [],
            replacements: []
          })
        }
        return new Response(JSON.stringify({
          id: `restoration-operation-${requestCount}`,
          client_request_id: envelope.client_request_id,
          status: 'queued',
          dispatch_state: 'not-dispatched',
          upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00.000Z'
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      const operation = /\/gateway\/requests\/(restoration-operation-\d+)$/u.exec(target)
      if (operation) {
        const operationId = operation[1]
        const content = operationId.endsWith('-1') ? draftForResponse : reviewForResponse
        const clientRequestId = clientRequestIds.get(operationId) || ''
        return new Response(JSON.stringify({
          id: operationId,
          client_request_id: clientRequestId,
          status: 'succeeded',
          dispatch_state: 'dispatched',
          upstream_attempts: 1,
          created_at_utc: '2026-09-17T00:00:00.000Z',
          response: completion(content, operationId)
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (/\/gateway\/requests\/restoration-operation-\d+\/ack$/u.test(target)) return new Response(null, { status: 204 })
      return new Response('not found', { status: 404 })
    }

    const timeline: OcrVisualTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: { width: 1280, height: 720, durationSeconds: 2, sampleFps: 8, frameCount: 16, geometryFingerprint: 'f'.repeat(64) },
      profile: 'accurate',
      scanRegion: { x0: 0, y0: 480, x1: 1280, y1: 720 },
      segments: [{
        id: 'ocr-segment-1', startFrame: 0, endFrameExclusive: 8, start: 0, end: 1,
        text: '沃尔沃 XC90', confidence: 0.98,
        boxes: [{ text: '沃尔沃 XC90', confidence: 0.98, x0: 100, y0: 550, x1: 500, y1: 620 }]
      }]
    }
    const config: AutoShortConfig = {
      subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu',
      blurRegions: [], lamMo: false, blurMode: 'manual',
      translateTarget: 'vi-VN', translateProvider: 'gemini-gateway', translateServerUrl: 'http://127.0.0.1:8080',
      ttsEnabled: false, voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 20, outputDir
    }
    const deps = {
      resolveFfmpeg: async () => 'fake-ffmpeg.exe',
      resolveFfprobe: async () => 'fake-ffprobe.exe',
      probeMedia: async () => ({ w: 1280, h: 720, giay: 2, hasAudio: true, frameRate: 25, geometry: {
        codedWidth: 1280, codedHeight: 720, rotation: 0, sampleAspectRatio: { numerator: 1, denominator: 1 }, videoStart: 0,
        displayWidth: 1280, displayHeight: 720, fingerprint: 'f'.repeat(64)
      } }),
      transcribeAudio: async () => {
        asrRuns++
        return { ok: true, outputs: [sourceSrt], language: 'zh' }
      },
      runVisualOcr: async () => {
        ocrRuns++
        return { timeline, sourceSrtPath: '', sidecarPath: '', engineVersion: 'test-ocr', engineProtocol: 'ocr-local/1' as const, visualSegmentCount: 1, boxSegmentCount: 1 }
      },
      writeTimedMask: async () => { throw new Error('mask is not part of this fixture') },
      burn: async (request: { titleSrt?: string }, options: { finalOutputPath: string }) => {
        burnAttempts++
        burnTitleSrt = request.titleSrt || ''
        burnTitleSrtContent = burnTitleSrt ? await readFile(burnTitleSrt, 'utf8') : ''
        if (burnAttempts === 1) throw new Error('intentional render fault after restoration checkpoint')
        await writeFile(options.finalOutputPath, 'rendered-fixture')
        return { ok: true, output: options.finalOutputPath }
      },
      extractRestorationAudio: async (input: { sourcePath: string }) => {
        extractionSources.push(input.sourcePath)
        return {
          data: audioFixture,
          format: 'mp3' as const,
          durationSeconds: 2,
          sampleRate: 16_000,
          channels: 1,
          sha256: createHash('sha256').update(audioFixture).digest('hex')
        }
      }
    } as unknown as AutoShortItemCoordinatorDeps

    const processor = createAutoShortItemProcessor(deps)
    const createContext = () => ({
      jobId: 'restoration-job',
      request: { config, items: [{ id: 'restoration-item', filePath: video }] },
      item: { id: 'restoration-item', filePath: video }, index: 0, total: 1,
      signal: new AbortController().signal, emit: () => {}, checkpointDir, workDir, artifactDir,
      itemOutputDir: outputDir, separationProviderState: { mode: 'auto' }
    })
    const failedAfterCommit = await processor(createContext())

    assert.equal(failedAfterCommit.status, 'error')
    assert.deepEqual(extractionSources, [video])
    assert.equal(outgoing.length, 2)
    const draftFormat = outgoing[0].response_format as { json_schema?: { name?: string } }
    const reviewFormat = outgoing[1].response_format as {
      json_schema?: {
        name?: string
        schema?: {
          required?: string[]
          properties?: {
            groupAssessments?: { items?: { required?: string[]; additionalProperties?: boolean; properties?: Record<string, unknown> } }
          }
        }
      }
    }
    assert.equal(draftFormat.json_schema?.name, 'restoration_translation_v1')
    assert.equal(reviewFormat.json_schema?.name, 'restoration_review_v1')
    assert.deepEqual(reviewFormat.json_schema?.schema?.required, [
      'schemaVersion', 'candidateDigest', 'reviewedCueIds', 'status', 'confidenceScore',
      'reviewerNotes', 'groupAssessments', 'findings', 'replacements'
    ])
    const reviewGroupSchema = reviewFormat.json_schema?.schema?.properties?.groupAssessments?.items
    assert.deepEqual(reviewGroupSchema?.required, ['groupId', 'cueIds', 'status', 'reason'])
    assert.equal(reviewGroupSchema?.additionalProperties, false)
    assert.equal('replacements' in (reviewGroupSchema?.properties || {}), false)
    const multimodalUser = (outgoing[0].messages as Array<{ content: unknown }>).find((message) => Array.isArray(message.content))!.content as Array<Record<string, unknown>>
    const audioPart = multimodalUser.find((part) => part.type === 'input_audio')!
    assert.equal(audioPart.input_audio && typeof audioPart.input_audio === 'object' ? (audioPart.input_audio as { format?: string }).format : undefined, 'mp3')
    const audioData = audioPart.input_audio && typeof audioPart.input_audio === 'object' ? (audioPart.input_audio as { data?: string }).data : ''
    assert.deepEqual(Buffer.from(audioData || '', 'base64'), audioFixture)
    const evidencePayload = JSON.parse(String(multimodalUser.find((part) => part.type === 'text')?.text)) as { evidenceItems: Array<{ text: string; start?: number; region?: unknown }> }
    assert.equal(evidencePayload.evidenceItems.find((item) => item.text === '沃尔沃 XC90')?.region, undefined)
    assert.equal(evidencePayload.evidenceItems.find((item) => item.text === '沃尔沃 XC90')?.start, 0)
    const translated = burnTitleSrtContent
    assert.match(translated, /Volvo XC90 chạy rất êm\./u)
    assert.match(translated, /00:00:00,000 --> 00:00:01,000/u)
    assert.match(translated, /00:00:01,000 --> 00:00:02,000/u)

    const checkpointText = await readFile(join(checkpointDir, 'checkpoint.json'), 'utf8')
    const draftRecordText = await readFile(join(checkpointDir, 'gemini-gateway', 'restoration-draft-v1.json'), 'utf8')
    const reviewRecordText = await readFile(join(checkpointDir, 'gemini-gateway', 'restoration-review-v1.json'), 'utf8')
    const audioBase64 = audioFixture.toString('base64')
    assert.equal(checkpointText.includes(audioBase64), false)
    assert.equal(draftRecordText.includes(audioBase64), false)
    assert.equal(reviewRecordText.includes(audioBase64), false)

    // Prove the persisted top-level checkpoint, rather than a leftover work
    // file, controls recovery after a failure downstream of the commit point.
    await rm(workDir, { recursive: true, force: true })
    const postsBeforeResume = requestCount
    const resumed = await processor(createContext())
    assert.equal(resumed.status, 'done', resumed.error)
    assert.equal(requestCount, postsBeforeResume)
    assert.equal(asrRuns, 1)
    assert.equal(ocrRuns, 1)
    assert.deepEqual(extractionSources, [video])
    assert.equal(burnAttempts, 2)
  } finally {
    globalThis.fetch = previousFetch
    await rm(root, { recursive: true, force: true })
  }
})

test('media restoration checks advertised scheduler body capacity before dispatch and leaves no lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-gateway-restoration-capacity-'))
  const previousFetch = globalThis.fetch
  const draftDir = join(root, 'checkpoint', 'gemini-gateway')
  let posts = 0
  try {
    globalThis.fetch = async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          scheduler_contract_version: 1,
          request_jobs: true,
          provider_ready: true,
          models: ['gemini-advanced'],
          max_request_body_bytes: 256,
          gateway_model_routes: { 'gemini-advanced': { route_fingerprint: routeFingerprint } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (String(url).endsWith('/gateway/requests')) posts++
      return new Response('unexpected request', { status: 500 })
    }
    const data = Buffer.alloc(1024, 7)
    await assert.rejects(runGatewayRestoration({
      baseUrl: 'http://127.0.0.1:8080',
      sourceCues: [{ id: 'cue-1', start: 0, end: 1, text: 'Một câu nguồn.' }],
      mediaDigest: 'a'.repeat(64), sourceLanguage: 'vi', targetLocale: 'en', mode: 'subtitle', glossary: [],
      audio: { data, format: 'mp3', durationSeconds: 1, sampleRate: 16_000, channels: 1, sha256: createHash('sha256').update(data).digest('hex') },
      ocrFrames: [], signal: new AbortController().signal, draftDir
    }), /max_request_body_bytes/u)
    assert.equal(posts, 0)
    assert.equal(await stat(draftDir).catch(() => null), null)
  } finally {
    globalThis.fetch = previousFetch
    await rm(root, { recursive: true, force: true })
  }
})
