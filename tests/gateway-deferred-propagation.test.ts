import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGeminiGatewayTranslationAdapter } from '../src/main/geminiGateway'
import { createAutoShortItemProcessor, type AutoShortItemCoordinatorDeps } from '../src/main/autoShortItemCoordinator'
import {
  calculateGatewaySourceDigest,
  GATEWAY_DRAFT_PARSER_VERSION,
  readGatewayReview,
  writeGatewayReview
} from '../src/main/geminiGatewayDraftCheckpoint'
import { GEMINI_GATEWAY_PROMPT_VERSION } from '../src/main/geminiGatewayPrompts'
import { planTranslation } from '../src/main/translation/planner'
import { translateWithAdapter } from '../src/main/translation/orchestrator'
import type { TranslationInput } from '../src/shared/translation'
import type { AutoShortConfig } from '../src/shared/types'

const routeFingerprint = '1'.repeat(64)

function source(): TranslationInput {
  return {
    sourceLanguage: 'en',
    targetLocale: 'vi-VN',
    mode: 'subtitles',
    cues: [{ id: 'cue-1', groupId: 'g-1', sourceIndex: 0, start: 0, end: 1, text: 'Hello' }],
    contextBefore: [],
    contextAfter: [],
    glossary: []
  }
}

test('production orchestrator preserves a durable gateway provider wait instead of converting it into a terminal assessment', async () => {
  const draftDir = await mkdtemp(join(tmpdir(), 'tedia-gateway-deferred-'))
  const previousFetch = globalThis.fetch
  let clientRequestId = ''
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
          gateway_model_routes: { 'gemini-advanced': { route_fingerprint: routeFingerprint } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        clientRequestId = envelope.client_request_id
        return new Response(JSON.stringify({
          id: 'op-deferred-1',
          client_request_id: clientRequestId,
          status: 'queued',
          dispatch_state: 'not-dispatched',
          upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00.000Z'
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.endsWith('/gateway/requests/op-deferred-1')) {
        return new Response(JSON.stringify({
          id: 'op-deferred-1',
          client_request_id: clientRequestId,
          status: 'waiting-provider',
          dispatch_state: 'not-dispatched',
          upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00.000Z',
          next_eligible_at_utc: '2026-09-17T00:10:00.000Z',
          reason: 'provider-throttled'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }

    const input = source()
    const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:8080', {
      draftDir,
      reviewMode: 'draft-only',
      deferOnProviderWait: true
    })
    await assert.rejects(
      translateWithAdapter(input, adapter, new AbortController().signal, { plan: planTranslation(input, adapter.capability) }),
      (error: unknown) => {
        const deferred = error as {
          name?: string
          providerCode?: string
          operationId?: string
          stage?: string
          nextEligibleAtUtc?: string | null
          cancelOperation?: () => Promise<void>
        }
        assert.equal(deferred.name, 'GatewayOperationDeferredError')
        assert.equal(deferred.providerCode, 'provider-throttled')
        assert.equal(deferred.operationId, 'op-deferred-1')
        assert.equal(deferred.stage, 'restore-translate')
        assert.equal(deferred.nextEligibleAtUtc, '2026-09-17T00:10:00.000Z')
        assert.equal(typeof deferred.cancelOperation, 'function')
        return true
      }
    )
    assert.equal((await stat(join(draftDir, 'restore-translate-operation.json'))).isFile(), true)
  } finally {
    globalThis.fetch = previousFetch
    await rm(draftDir, { recursive: true, force: true })
  }
})

test('adapter resumes a validated independent review checkpoint without creating another gateway generation', async () => {
  const draftDir = await mkdtemp(join(tmpdir(), 'tedia-gateway-review-resume-'))
  const previousFetch = globalThis.fetch
  const input = source()
  const expectedIds = input.cues.map((cue) => cue.id)
  const identity = `gemini-gateway:gemini-advanced:${GEMINI_GATEWAY_PROMPT_VERSION}:${GATEWAY_DRAFT_PARSER_VERSION}:json-items:vi-VN:${expectedIds.length}`
  const raw = JSON.stringify({ translations: { 'cue-1': 'Xin chào' } })
  try {
    await writeGatewayReview(draftDir, {
      schemaVersion: 1,
      state: 'review-validated',
      identity: `${identity}:review`,
      raw,
      rawSha256: createHash('sha256').update(raw).digest('hex'),
      observedModelId: 'gemini-3.1-pro-preview',
      observedModel: 'Gemini 3.1 Pro',
      routeFingerprint,
      sourceDigest: calculateGatewaySourceDigest(input),
      expectedIds,
      targetLocale: input.targetLocale,
      promptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
      parserVersion: GATEWAY_DRAFT_PARSER_VERSION,
      savedAtUtc: '2026-09-17T00:00:00.000Z'
    })
    const restored = await readGatewayReview(draftDir, {
      identity: `${identity}:review`,
      sourceDigest: calculateGatewaySourceDigest(input),
      expectedIds,
      targetLocale: input.targetLocale,
      promptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
      parserVersion: GATEWAY_DRAFT_PARSER_VERSION,
      routeFingerprint
    })
    assert.equal(restored?.raw, raw)
    assert.equal(await readGatewayReview(draftDir, {
      identity: `${identity}:review`,
      sourceDigest: calculateGatewaySourceDigest(input),
      expectedIds,
      targetLocale: input.targetLocale,
      promptVersion: GEMINI_GATEWAY_PROMPT_VERSION,
      parserVersion: GATEWAY_DRAFT_PARSER_VERSION,
      routeFingerprint: '2'.repeat(64)
    }), null)

    let generationPosts = 0
    globalThis.fetch = async (url: RequestInfo | URL) => {
      const target = String(url)
      if (target.endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          scheduler_contract_version: 1,
          request_jobs: true,
          provider_ready: true,
          models: ['gemini-advanced'],
          gateway_model_routes: { 'gemini-advanced': { route_fingerprint: routeFingerprint } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.endsWith('/gateway/requests')) generationPosts++
      return new Response('a generation must not be created from a validated review checkpoint', { status: 500 })
    }
    const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:8080', { draftDir })
    const plan = planTranslation(input, adapter.capability)
    const result = await adapter.requestOnce(plan.batches[0], new AbortController().signal, input)
    assert.deepEqual(JSON.parse(result.raw), { items: [{ id: 'cue-1', text: 'Xin chào' }] })
    assert.equal(generationPosts, 0)
  } finally {
    globalThis.fetch = previousFetch
    await rm(draftDir, { recursive: true, force: true })
  }
})

test('item coordinator rethrows a provider wait and retains its gateway lease after workDir cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-gateway-coordinator-deferred-'))
  const previousFetch = globalThis.fetch
  const workDir = join(root, 'work')
  const checkpointDir = join(root, 'checkpoint')
  const artifactDir = join(root, 'artifact')
  const outputDir = join(root, 'output')
  const video = join(root, 'source.mp4')
  const sourceSrt = join(root, 'source.srt')
  let clientRequestId = ''
  try {
    await mkdir(outputDir)
    await writeFile(video, 'video')
    await writeFile(sourceSrt, '1\n00:00:00,000 --> 00:00:01,000\nHello\n', 'utf8')
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      if (target.endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          scheduler_contract_version: 1,
          request_jobs: true,
          provider_ready: true,
          models: ['gemini-advanced'],
          gateway_model_routes: { 'gemini-advanced': { route_fingerprint: routeFingerprint } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        clientRequestId = envelope.client_request_id
        return new Response(JSON.stringify({
          id: 'op-coordinator-deferred',
          client_request_id: clientRequestId,
          status: 'queued',
          dispatch_state: 'not-dispatched',
          upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00.000Z'
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.endsWith('/gateway/requests/op-coordinator-deferred')) {
        return new Response(JSON.stringify({
          id: 'op-coordinator-deferred',
          client_request_id: clientRequestId,
          status: 'waiting-provider',
          dispatch_state: 'not-dispatched',
          upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00.000Z',
          next_eligible_at_utc: '2026-09-17T00:10:00.000Z',
          reason: 'provider-throttled'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }

    const config: AutoShortConfig = {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      blurRegions: [],
      lamMo: false,
      blurMode: 'manual',
      translateTarget: 'vi-VN',
      translateProvider: 'gemini-gateway',
      translateServerUrl: 'http://127.0.0.1:8080',
      ttsEnabled: false,
      voiceOverMode: false,
      audioMode: 'replace',
      originalAudioVolume: 20,
      outputDir
    }
    const deps: AutoShortItemCoordinatorDeps = {
      resolveFfmpeg: async () => 'ffmpeg.exe',
      resolveFfprobe: async () => 'ffprobe.exe',
      // This test exercises the legacy text-only gateway wait path. A silent
      // source deliberately bypasses the separate audio/OCR restoration path.
      probeMedia: async () => ({ w: 1280, h: 720, giay: 1, hasAudio: false, frameRate: 25 }),
      transcribeAudio: (async () => ({ ok: true, outputs: [sourceSrt], language: 'en' })) as AutoShortItemCoordinatorDeps['transcribeAudio'],
      runVisualOcr: (async () => { throw new Error('visual OCR must not run') }) as AutoShortItemCoordinatorDeps['runVisualOcr'],
      writeTimedMask: (async () => { throw new Error('mask must not run') }) as AutoShortItemCoordinatorDeps['writeTimedMask'],
      burn: (async () => { throw new Error('burn must not run before provider wait resumes') }) as AutoShortItemCoordinatorDeps['burn']
    }
    const processor = createAutoShortItemProcessor(deps)
    await assert.rejects(
      processor({
        jobId: 'gateway-deferred-job',
        request: { config, items: [{ id: 'gateway-deferred-item', filePath: video }] },
        item: { id: 'gateway-deferred-item', filePath: video },
        index: 0,
        total: 1,
        signal: new AbortController().signal,
        emit: () => {},
        checkpointDir,
        workDir,
        artifactDir,
        itemOutputDir: outputDir,
        separationProviderState: { mode: 'auto' }
      }),
      (error: unknown) => (error as { operationId?: string }).operationId === 'op-coordinator-deferred'
    )
    assert.equal(await stat(workDir).catch(() => null), null)
    assert.equal((await stat(join(checkpointDir, 'gemini-gateway', 'restore-translate-operation.json'))).isFile(), true)
  } finally {
    globalThis.fetch = previousFetch
    await rm(root, { recursive: true, force: true })
  }
})
