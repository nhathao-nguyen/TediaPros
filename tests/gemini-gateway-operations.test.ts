import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { operationAction } from '../src/shared/gatewayOperation'
import {
  submitGatewayOperation,
  pollGatewayOperation,
  cancelGatewayOperation,
  GatewayOperationDeferredError
} from '../src/main/geminiGatewayOperations'
import { createGeminiGatewayTranslationAdapter } from '../src/main/geminiGateway'
import { planTranslation } from '../src/main/translation/planner'
import { translateWithAdapter } from '../src/main/translation/orchestrator'
import { recoverUnknownGatewayOperation } from '../src/main/gatewayManualRecovery'
import type { TranslationInput } from '../src/shared/translation'

const gatewayMetadataFixture = {
  gateway_contract_version: 2,
  requested_model: 'gemini-advanced',
  resolved_model: 'gemini-advanced',
  observed_model_id: 'gemini-3.1-pro-preview',
  observed_model: 'Gemini 3.1 Pro',
  route_fingerprint: '11'.repeat(32),
  model_verification: 'matched',
  completion_state: 'complete',
  completion_evidence: 'stop-reason:stop',
  upstream_attempts: 1,
  upstream_retry_reasons: []
}

test('unknown outcome never causes resubmit', () => {
  assert.equal(operationAction('outcome-unknown'), 'stop')
  assert.equal(operationAction('running'), 'poll')
  assert.equal(operationAction('succeeded'), 'consume')
})

test('unknown outcome overrides a stale scheduler reason in the durable wait record', () => {
  const deferred = new GatewayOperationDeferredError({
    id: 'op-stale-reason',
    clientRequestId: 'cid-stale-reason',
    status: 'outcome-unknown',
    dispatchState: 'dispatched',
    upstreamAttempts: 1,
    createdAtUtc: '2026-09-17T00:00:00Z',
    reason: 'spacing',
    nextEligibleAtUtc: null
  })
  assert.equal(deferred.providerCode, 'outcome-unknown')
  assert.equal(deferred.reason, 'outcome-unknown')
})

test('terminal error statuses tell caller to stop', () => {
  assert.equal(operationAction('failed'), 'stop')
  assert.equal(operationAction('blocked'), 'stop')
  assert.equal(operationAction('cancelled'), 'stop')
})

test('in-flight and pending statuses tell caller to poll', () => {
  assert.equal(operationAction('queued'), 'poll')
  assert.equal(operationAction('waiting-provider'), 'poll')
  assert.equal(operationAction('cancelling'), 'poll')
})

test('submit and poll happy path returns response payload', async () => {
  const oldFetch = globalThis.fetch
  let pollCount = 0
  const headersCaptured: Record<string, string>[] = []
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(url)
    const headers = (init?.headers || {}) as Record<string, string>
    headersCaptured.push(headers)
    if (urlStr.endsWith('/gateway/requests')) {
      return new Response(JSON.stringify({
        id: 'op-123',
        client_request_id: 'cid-1',
        status: 'queued',
        dispatch_state: 'not-dispatched',
        upstream_attempts: 0,
        created_at_utc: '2026-09-17T00:00:00Z'
      }), { status: 202, headers: { 'Content-Type': 'application/json' } })
    }
    if (urlStr.includes('/gateway/requests/op-123')) {
      pollCount++
      if (pollCount === 1) {
        return new Response(JSON.stringify({
          id: 'op-123',
          client_request_id: 'cid-1',
          status: 'running',
          dispatch_state: 'dispatched',
          upstream_attempts: 1,
          created_at_utc: '2026-09-17T00:00:00Z'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        id: 'op-123',
        client_request_id: 'cid-1',
        status: 'succeeded',
        dispatch_state: 'dispatched',
        upstream_attempts: 1,
        created_at_utc: '2026-09-17T00:00:00Z',
        response: { id: 'resp-1', choices: [{ message: { content: 'translated text' } }] }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('Not found', { status: 404 })
  }

  try {
    const controller = new AbortController()
    const receipt = await submitGatewayOperation({
      baseUrl: 'http://127.0.0.1:8080',
      clientRequestId: 'cid-1',
      operationToken: 'tok-secret-abc',
      requestPayload: { prompt: 'test' },
      signal: controller.signal
    })
    assert.equal(receipt.id, 'op-123')
    assert.equal(receipt.status, 'queued')

    const response = await pollGatewayOperation({
      baseUrl: 'http://127.0.0.1:8080',
      operationId: receipt.id,
      operationToken: 'tok-secret-abc',
      signal: controller.signal,
      pollIntervalMs: 10
    })

    assert.deepEqual(response, { id: 'resp-1', choices: [{ message: { content: 'translated text' } }] })
    assert.equal(pollCount, 2)
    assert.ok(headersCaptured.some(h => h['X-Operation-Token'] === 'tok-secret-abc'))
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('idempotent resubmit returns existing receipt without creating new logical generation', async () => {
  const oldFetch = globalThis.fetch
  let submitCount = 0
  globalThis.fetch = async (url: RequestInfo | URL) => {
    const urlStr = String(url)
    if (urlStr.endsWith('/gateway/requests')) {
      submitCount++
      return new Response(JSON.stringify({
        id: 'op-idem-456',
        client_request_id: 'cid-idem',
        status: 'running',
        dispatch_state: 'dispatched',
        upstream_attempts: 1,
        created_at_utc: '2026-09-17T00:00:00Z'
      }), { status: 202, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('Not found', { status: 404 })
  }

  try {
    const controller = new AbortController()
    const r1 = await submitGatewayOperation({
      baseUrl: 'http://127.0.0.1:8080',
      clientRequestId: 'cid-idem',
      operationToken: 'tok-1',
      requestPayload: { prompt: 'same' },
      signal: controller.signal
    })
    const r2 = await submitGatewayOperation({
      baseUrl: 'http://127.0.0.1:8080',
      clientRequestId: 'cid-idem',
      operationToken: 'tok-1',
      requestPayload: { prompt: 'same' },
      signal: controller.signal
    })

    assert.equal(r1.id, 'op-idem-456')
    assert.equal(r2.id, 'op-idem-456')
    assert.equal(submitCount, 2)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('409 Conflict error on mismatched payload for same client_request_id', async () => {
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (url: RequestInfo | URL) => {
    const urlStr = String(url)
    if (urlStr.endsWith('/gateway/requests')) {
      return new Response(JSON.stringify({ error: 'Payload conflict for client_request_id cid-conflict' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return new Response('Not found', { status: 404 })
  }

  try {
    const controller = new AbortController()
    await assert.rejects(
      async () => {
        await submitGatewayOperation({
          baseUrl: 'http://127.0.0.1:8080',
          clientRequestId: 'cid-conflict',
          operationToken: 'tok-1',
          requestPayload: { prompt: 'different' },
          signal: controller.signal
        })
      },
      (err: any) => {
        assert.equal(err.status, 409)
        return true
      }
    )
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('cancelGatewayOperation sends POST to cancel route with token', async () => {
  const oldFetch = globalThis.fetch
  let cancelCalled = false
  let capturedToken = ''
  globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = String(url)
    if (urlStr.endsWith('/gateway/requests/op-789/cancel')) {
      cancelCalled = true
      capturedToken = (init?.headers as Record<string, string>)?.['X-Operation-Token'] || ''
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    return new Response('Not found', { status: 404 })
  }

  try {
    await cancelGatewayOperation('http://127.0.0.1:8080', 'op-789', 'tok-cancel-xyz')
    assert.ok(cancelCalled)
    assert.equal(capturedToken, 'tok-cancel-xyz')
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('polling aborts immediately when signal is aborted', async () => {
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({
      id: 'op-abort',
      client_request_id: 'cid-abort',
      status: 'queued',
      dispatch_state: 'not-dispatched',
      upstream_attempts: 0,
      created_at_utc: '2026-09-17T00:00:00Z'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const controller = new AbortController()
    const pollPromise = pollGatewayOperation({
      baseUrl: 'http://127.0.0.1:8080',
      operationId: 'op-abort',
      operationToken: 'tok',
      signal: controller.signal,
      pollIntervalMs: 5000
    })
    // Abort after small tick
    setTimeout(() => controller.abort(), 20)
    await assert.rejects(pollPromise, /Đã hủy tác vụ/)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('translation adapter uses async operation API and acks when scheduler is supported', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-test-'))
  const draftDir = join(tempDir, 'draft')
  const auditPath = join(tempDir, 'audit.json')
  const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:8080', {
    draftDir,
    auditPath,
    stageTimeoutMs: 5000,
    reviewMode: 'draft-only'
  })

  const source: TranslationInput = {
    sourceLanguage: 'en',
    cues: [{ id: 'cue-1', groupId: 'g-0', sourceIndex: 0, start: 0, end: 1, text: 'Hello world' }],
    mode: 'subtitles',
    targetLocale: 'vi-VN',
    contextBefore: [],
    contextAfter: [],
    glossary: []
  }
  const plan = planTranslation(source, adapter.capability)

  const oldFetch = globalThis.fetch
  const calls: string[] = []
  let ackCalled = false
  let checkpointExistedAtAck = false

  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url)
      calls.push(urlStr)
      if (urlStr.endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          scheduler_contract_version: 1,
          request_jobs: true,
          provider_ready: true,
          models: ['gemini-advanced'],
          model_selection: 'observed-id-required',
          gateway_model_routes: {
            'gemini-advanced': { route_fingerprint: gatewayMetadataFixture.route_fingerprint }
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        return new Response(JSON.stringify({
          id: 'op-batch-1',
          client_request_id: envelope.client_request_id,
          status: 'queued',
          dispatch_state: 'not-dispatched',
          upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00Z'
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.includes('/gateway/requests/op-batch-1/ack')) {
        ackCalled = true
        checkpointExistedAtAck = await stat(join(draftDir, 'gemini-gateway-draft.json')).then(info => info.isFile()).catch(() => false)
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      if (urlStr.includes('/gateway/requests/op-batch-1')) {
        return new Response(JSON.stringify({
          id: 'op-batch-1',
          client_request_id: JSON.parse(await readFile(join(draftDir, 'restore-translate-operation.json'), 'utf8')).clientRequestId,
          status: 'succeeded',
          dispatch_state: 'dispatched',
          upstream_attempts: 1,
          created_at_utc: '2026-09-17T00:00:00Z',
          response: {
            id: 'resp-op-1',
            model: 'gemini-advanced',
            gateway_metadata: gatewayMetadataFixture,
            choices: [{
              message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào thế giới' } }) },
              finish_reason: 'stop'
            }]
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    }

    const result = await translateWithAdapter(source, adapter, new AbortController().signal, { plan })
    assert.equal(result.items[0]?.text, 'Xin chào thế giới')
    assert.ok(calls.some(c => c.endsWith('/gateway/requests')), 'Must have called POST /gateway/requests')
    assert.ok(calls.some(c => c.includes('/gateway/requests/op-batch-1')), 'Must have polled operation')
    assert.ok(ackCalled, 'Must have acked operation after completion')
    assert.equal(checkpointExistedAtAck, true, 'Validated durable checkpoint must exist before ACK')
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('600s waiting-provider delay survives a short per-call deadline through the production adapter', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-wait-'))
  let nowMs = Date.parse('2026-09-17T00:00:00.000Z')
  let pollCount = 0
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/gateway/capabilities')) {
        return new Response(JSON.stringify({
          gateway_contract_version: 2,
          scheduler_contract_version: 1,
          request_jobs: true,
          provider_ready: true,
          models: ['gemini-advanced'],
          gateway_model_routes: { 'gemini-advanced': { route_fingerprint: gatewayMetadataFixture.route_fingerprint } }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        return new Response(JSON.stringify({
          id: 'op-wait-600', client_request_id: envelope.client_request_id, status: 'queued',
          dispatch_state: 'not-dispatched', upstream_attempts: 0, created_at_utc: new Date(nowMs).toISOString()
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/gateway/requests/op-wait-600/ack')) return new Response(null, { status: 204 })
      if (value.endsWith('/gateway/requests/op-wait-600')) {
        const lease = JSON.parse(await readFile(join(tempDir, 'restore-translate-operation.json'), 'utf8'))
        pollCount++
        if (pollCount === 1) {
          return new Response(JSON.stringify({
            id: 'op-wait-600', client_request_id: lease.clientRequestId, status: 'waiting-provider',
            dispatch_state: 'not-dispatched', upstream_attempts: 0,
            created_at_utc: '2026-09-17T00:00:00.000Z', next_eligible_at_utc: '2026-09-17T00:10:00.000Z', reason: 'provider-throttled'
          }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({
          id: 'op-wait-600', client_request_id: lease.clientRequestId, status: 'succeeded',
          dispatch_state: 'dispatched', upstream_attempts: 1, created_at_utc: '2026-09-17T00:00:00.000Z',
          response: {
            id: 'resp-wait-600', model: 'gemini-advanced', gateway_metadata: gatewayMetadataFixture,
            choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }) }, finish_reason: 'stop' }]
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('Not found', { status: 404 })
    }
    const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:8080', {
      draftDir: tempDir,
      stageTimeoutMs: 20,
      reviewMode: 'draft-only',
      operationRuntime: {
        nowMs: () => nowMs,
        delay: async (ms: number, signal: AbortSignal) => {
          assert.equal(signal.aborted, false)
          nowMs += ms
        }
      }
    })
    const source: TranslationInput = {
      sourceLanguage: 'en', targetLocale: 'vi-VN', mode: 'subtitles',
      cues: [{ id: 'cue-1', groupId: 'g-0', sourceIndex: 0, start: 0, end: 1, text: 'Hello' }],
      contextBefore: [], contextAfter: [], glossary: []
    }
    const result = await translateWithAdapter(source, adapter, new AbortController().signal, { plan: planTranslation(source, adapter.capability) })
    assert.equal(result.items[0]?.text, 'Xin chào')
    assert.equal(nowMs, Date.parse('2026-09-17T00:10:00.000Z'))
    assert.equal(pollCount, 2)
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('user abort posts cancel and retains the durable lease', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-cancel-'))
  const controller = new AbortController()
  const oldFetch = globalThis.fetch
  let cancelPosts = 0
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        return new Response(JSON.stringify({
          id: 'op-cancel-real', client_request_id: envelope.client_request_id, status: 'queued',
          dispatch_state: 'not-dispatched', upstream_attempts: 0, created_at_utc: '2026-09-17T00:00:00.000Z'
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/gateway/requests/op-cancel-real/cancel')) {
        cancelPosts++
        const lease = JSON.parse(await readFile(join(tempDir, 'restore-translate-operation.json'), 'utf8'))
        return new Response(JSON.stringify({
          id: 'op-cancel-real', client_request_id: lease.clientRequestId, status: 'cancelled',
          dispatch_state: 'not-dispatched', upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00.000Z', updated_at_utc: '2026-09-17T00:00:01.000Z'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/gateway/requests/op-cancel-real')) {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason || new Error('aborted')), { once: true })
        })
      }
      return new Response('Not found', { status: 404 })
    }
    const promise = import('../src/main/geminiGateway').then(({ requestGatewayOperation }) => requestGatewayOperation(
      'http://127.0.0.1:8080', [{ role: 'user', content: 'Hello' }], controller.signal, 256, true, 'json-items',
      { draftDir: tempDir, stage: 'restore-translate' }
    ))
    setTimeout(() => controller.abort(new Error('user-cancelled')), 20)
    await assert.rejects(promise, /cancel|hủy|aborted/iu)
    assert.equal(cancelPosts, 1)
    assert.equal((await stat(join(tempDir, 'restore-translate-operation.json'))).isFile(), true)
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('malformed operation receipt is rejected before polling', async () => {
  const oldFetch = globalThis.fetch
  let statusGets = 0
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        return new Response(JSON.stringify({
          id: '', client_request_id: `${envelope.client_request_id}-wrong`, status: 'invented',
          dispatch_state: 'completed', upstream_attempts: -1, created_at_utc: 'not-a-date'
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      statusGets++
      return new Response('Not found', { status: 404 })
    }
    await assert.rejects(submitGatewayOperation({
      baseUrl: 'http://127.0.0.1:8080', clientRequestId: 'cid-strict', operationToken: 'tok',
      requestPayload: { prompt: 'x' }, signal: new AbortController().signal
    }), /receipt|operation|client_request_id|status/iu)
    assert.equal(statusGets, 0)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('recovered-from-store block at poll resets scheduler and creates a fresh undispatched operation', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-recovered-store-'))
  const oldFetch = globalThis.fetch
  const submittedClientIds: string[] = []
  const ackedOperationIds: string[] = []
  let schedulerState: 'blocked' | 'ready' = 'blocked'
  let resetPosts = 0
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/gateway/scheduler')) {
        return new Response(JSON.stringify({
          state: schedulerState,
          egress_group: 'default',
          active_permits: 0,
          queued_requests: 0,
          reason: schedulerState === 'blocked' ? 'recovered-from-store' : '',
          revision: schedulerState === 'blocked' ? 0 : 1
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/gateway/reset')) {
        resetPosts++
        schedulerState = 'ready'
        return new Response(JSON.stringify({ ok: true, state: 'ready' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (value.endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        submittedClientIds.push(envelope.client_request_id)
        const first = submittedClientIds.length === 1
        return new Response(JSON.stringify({
          id: first ? 'op-stale' : 'op-fresh',
          client_request_id: envelope.client_request_id,
          status: first ? 'queued' : 'succeeded',
          dispatch_state: first ? 'not-dispatched' : 'dispatched',
          upstream_attempts: first ? 0 : 1,
          created_at_utc: '2026-09-17T00:00:00.000Z',
          ...(first ? {} : {
            response: {
              id: 'resp-fresh', model: 'gemini-advanced', gateway_metadata: gatewayMetadataFixture,
              choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }) }, finish_reason: 'stop' }]
            }
          })
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/gateway/requests/op-stale')) {
        return new Response(JSON.stringify({
          id: 'op-stale', client_request_id: submittedClientIds[0], status: 'blocked',
          dispatch_state: 'not-dispatched', upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00.000Z',
          error: 'upstream governor is blocked: recovered-from-store', error_code: 'recovered-from-store'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/gateway/requests/op-fresh')) {
        return new Response(JSON.stringify({
          id: 'op-fresh', client_request_id: submittedClientIds[1], status: 'succeeded',
          dispatch_state: 'dispatched', upstream_attempts: 1,
          created_at_utc: '2026-09-17T00:00:01.000Z',
          response: {
            id: 'resp-fresh', model: 'gemini-advanced', gateway_metadata: gatewayMetadataFixture,
            choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }) }, finish_reason: 'stop' }]
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/ack')) {
        ackedOperationIds.push(value.split('/').at(-2) || '')
        return new Response(null, { status: 204 })
      }
      return new Response('Not found', { status: 404 })
    }

    const { requestGatewayOperation } = await import('../src/main/geminiGateway')
    const result = await requestGatewayOperation(
      'http://127.0.0.1:8080',
      [{ role: 'user', content: 'Hello' }],
      new AbortController().signal,
      256,
      true,
      'json-items',
      { draftDir: tempDir, stage: 'restore-translate' }
    )
    assert.equal(result.completion.raw, JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }))
    assert.equal(resetPosts, 1)
    assert.equal(submittedClientIds.length, 2)
    assert.notEqual(submittedClientIds[0], submittedClientIds[1])
    assert.deepEqual(ackedOperationIds, ['op-stale'])
    await result.ack()
    assert.deepEqual(ackedOperationIds, ['op-stale', 'op-fresh'])
    assert.equal(await stat(join(tempDir, 'restore-translate-operation.json')).catch(() => null), null)
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('lost submit response restart reuses exact ID, token, and payload identity', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-restart-'))
  const oldFetch = globalThis.fetch
  const submits: Array<{ id: string; token: string; body: string }> = []
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/gateway/requests')) {
        const body = String(init?.body)
        const envelope = JSON.parse(body) as { client_request_id: string }
        submits.push({ id: envelope.client_request_id, token: (init?.headers as Record<string, string>)['X-Operation-Token'], body })
        if (submits.length === 1) throw new TypeError('lost response after dispatch')
        return new Response(JSON.stringify({
          id: 'op-reused', client_request_id: envelope.client_request_id, status: 'succeeded',
          dispatch_state: 'dispatched', upstream_attempts: 1, created_at_utc: '2026-09-17T00:00:00.000Z',
          response: { id: 'resp', model: 'gemini-advanced', gateway_metadata: gatewayMetadataFixture,
            choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }) }, finish_reason: 'stop' }] }
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/gateway/requests/op-reused')) {
        const lease = JSON.parse(await readFile(join(tempDir, 'restore-translate-operation.json'), 'utf8'))
        return new Response(JSON.stringify({
          id: 'op-reused', client_request_id: lease.clientRequestId, status: 'succeeded', dispatch_state: 'dispatched',
          upstream_attempts: 1, created_at_utc: '2026-09-17T00:00:00.000Z', response: {
            id: 'resp', model: 'gemini-advanced', gateway_metadata: gatewayMetadataFixture,
            choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }) }, finish_reason: 'stop' }]
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(null, { status: 204 })
    }
    const { requestGatewayOperation } = await import('../src/main/geminiGateway')
    const args = ['http://127.0.0.1:8080', [{ role: 'user' as const, content: 'Hello' }], new AbortController().signal, 256, true, 'json-items' as const,
      { draftDir: tempDir, stage: 'restore-translate' }] as const
    await assert.rejects(requestGatewayOperation(...args), /lost response/iu)
    const lease = JSON.parse(await readFile(join(tempDir, 'restore-translate-operation.json'), 'utf8'))
    assert.match(lease.payloadSha256, /^[a-f0-9]{64}$/u)
    await requestGatewayOperation(...args)
    assert.equal(submits.length, 2)
    assert.deepEqual(submits[1], submits[0])
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('checkpoint failure retains lease and prevents ACK', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-checkpoint-fail-'))
  await mkdir(join(tempDir, 'gemini-gateway-draft.json'))
  const oldFetch = globalThis.fetch
  let ackPosts = 0
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/gateway/capabilities')) return new Response(JSON.stringify({
        gateway_contract_version: 2, scheduler_contract_version: 1, request_jobs: true, provider_ready: true,
        models: ['gemini-advanced'], gateway_model_routes: { 'gemini-advanced': { route_fingerprint: gatewayMetadataFixture.route_fingerprint } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (value.endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        return new Response(JSON.stringify({ id: 'op-checkpoint-fail', client_request_id: envelope.client_request_id,
          status: 'succeeded', dispatch_state: 'dispatched', upstream_attempts: 1, created_at_utc: '2026-09-17T00:00:00.000Z',
          response: { id: 'resp', model: 'gemini-advanced', gateway_metadata: gatewayMetadataFixture,
            choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }) }, finish_reason: 'stop' }] }
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/ack')) { ackPosts++; return new Response(null, { status: 204 }) }
      const lease = JSON.parse(await readFile(join(tempDir, 'restore-translate-operation.json'), 'utf8'))
      return new Response(JSON.stringify({ id: 'op-checkpoint-fail', client_request_id: lease.clientRequestId,
        status: 'succeeded', dispatch_state: 'dispatched', upstream_attempts: 1, created_at_utc: '2026-09-17T00:00:00.000Z',
        response: { id: 'resp', model: 'gemini-advanced', gateway_metadata: gatewayMetadataFixture,
          choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }) }, finish_reason: 'stop' }] }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:8080', { draftDir: tempDir, reviewMode: 'draft-only' })
    const source: TranslationInput = { sourceLanguage: 'en', targetLocale: 'vi-VN', mode: 'subtitles',
      cues: [{ id: 'cue-1', groupId: 'g', sourceIndex: 0, start: 0, end: 1, text: 'Hello' }], contextBefore: [], contextAfter: [], glossary: [] }
    await translateWithAdapter(source, adapter, new AbortController().signal, { plan: planTranslation(source, adapter.capability) }).catch(() => undefined)
    assert.equal(ackPosts, 0)
    assert.equal((await stat(join(tempDir, 'restore-translate-operation.json'))).isFile(), true)
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('review response is canonicalized and durably checkpointed before its ACK', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-review-order-'))
  const oldFetch = globalThis.fetch
  let submitIndex = 0
  const operationClientIds = new Map<string, string>()
  let reviewCheckpointAtAck = false
  const ackUrls: string[] = []
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/gateway/capabilities')) return new Response(JSON.stringify({
        gateway_contract_version: 2, scheduler_contract_version: 1, request_jobs: true, provider_ready: true,
        models: ['gemini-advanced'], gateway_model_routes: { 'gemini-advanced': { route_fingerprint: gatewayMetadataFixture.route_fingerprint } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (value.endsWith('/gateway/requests')) {
        submitIndex++
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        const id = submitIndex === 1 ? 'op-draft-order' : 'op-review-order'
        operationClientIds.set(id, envelope.client_request_id)
        return new Response(JSON.stringify({ id, client_request_id: envelope.client_request_id, status: 'queued',
          dispatch_state: 'not-dispatched', upstream_attempts: 0, created_at_utc: '2026-09-17T00:00:00.000Z' }),
        { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (value.endsWith('/op-review-order/ack')) {
        reviewCheckpointAtAck = await stat(join(tempDir, 'gemini-gateway-review.json')).then(info => info.isFile()).catch(() => false)
        return new Response(null, { status: 204 })
      }
      if (value.endsWith('/ack')) { ackUrls.push(value); return new Response(null, { status: 204 }) }
      const id = value.includes('op-review-order') ? 'op-review-order' : 'op-draft-order'
      return new Response(JSON.stringify({ id, client_request_id: operationClientIds.get(id), status: 'succeeded',
        dispatch_state: 'dispatched', upstream_attempts: 1, created_at_utc: '2026-09-17T00:00:00.000Z',
        response: { id: `resp-${id}`, model: 'gemini-advanced', gateway_metadata: gatewayMetadataFixture,
          choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào' } }) }, finish_reason: 'stop' }] }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:8080', { draftDir: tempDir })
    const source: TranslationInput = { sourceLanguage: 'en', targetLocale: 'vi-VN', mode: 'subtitles',
      cues: [{ id: 'cue-1', groupId: 'g', sourceIndex: 0, start: 0, end: 1, text: 'Hello' }], contextBefore: [], contextAfter: [], glossary: [] }
    const plan = planTranslation(source, adapter.capability)
    await adapter.requestOnce(plan.batches[0], new AbortController().signal, source)
    assert.equal(await stat(join(tempDir, 'gemini-gateway-review.json')).then(info => info.isFile()).catch(() => false), true)
    assert.equal(reviewCheckpointAtAck, true, `review ACK URLs: ${ackUrls.join(',')}`)
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('mismatched payload cancels an undispatched queued operation and writes fresh lease', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-mismatch-'))
  const oldFetch = globalThis.fetch
  let cancelCalled = false
  let submitCount = 0
  const oldLease = {
    schemaVersion: 1,
    clientRequestId: 'cid-old',
    operationToken: 'tok-old',
    payloadSha256: '0'.repeat(64),
    stage: 'restore-translate',
    startedAtUtc: '2026-09-17T00:00:00Z',
    operationId: 'op-old'
  }
  await writeFile(join(tempDir, 'restore-translate-operation.json'), JSON.stringify(oldLease), 'utf8')
  let latestClientRequestId = ''
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = String(url)
      if (urlStr.endsWith('/gateway/requests/op-old') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({
          id: 'op-old', client_request_id: 'cid-old', status: 'queued',
          dispatch_state: 'not-dispatched', upstream_attempts: 0, created_at_utc: '2026-09-17T00:00:00Z'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.endsWith('/gateway/requests/op-old/cancel')) {
        cancelCalled = true
        return new Response(JSON.stringify({
          id: 'op-old', client_request_id: 'cid-old', status: 'cancelled',
          dispatch_state: 'not-dispatched', upstream_attempts: 0, created_at_utc: '2026-09-17T00:00:00Z'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.endsWith('/gateway/requests/op-new')) {
        return new Response(JSON.stringify({
          id: 'op-new',
          client_request_id: latestClientRequestId,
          status: 'succeeded',
          dispatch_state: 'dispatched',
          upstream_attempts: 1,
          created_at_utc: '2026-09-17T00:00:00Z',
          response: {
            id: 'resp-new',
            model: 'gemini-advanced',
            gateway_metadata: gatewayMetadataFixture,
            choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào mới' } }) }, finish_reason: 'stop' }]
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.endsWith('/gateway/requests')) {
        submitCount++
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string }
        latestClientRequestId = envelope.client_request_id
        return new Response(JSON.stringify({
          id: 'op-new',
          client_request_id: envelope.client_request_id,
          status: 'succeeded',
          dispatch_state: 'dispatched',
          upstream_attempts: 1,
          created_at_utc: '2026-09-17T00:00:00Z',
          response: { id: 'resp-new', choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': 'Xin chào mới' } }) } }] }
        }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      if (urlStr.endsWith('/gateway/requests/op-new/ack')) {
        return new Response(null, { status: 204 })
      }
      return new Response('Not found', { status: 404 })
    }
    const { requestGatewayOperation } = await import('../src/main/geminiGateway')
    const result = await requestGatewayOperation(
      'http://127.0.0.1:8080',
      [{ role: 'user', content: 'New content' }],
      new AbortController().signal,
      256,
      true,
      'json-items',
      { draftDir: tempDir, stage: 'restore-translate' }
    )
    assert.equal(cancelCalled, true)
    assert.equal(submitCount, 1)
    await result.ack()
    assert.equal(await stat(join(tempDir, 'restore-translate-operation.json')).catch(() => null), null)
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('mismatched payload never replays an outcome-unknown dispatched operation', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-mismatch-unknown-'))
  const oldFetch = globalThis.fetch
  let cancelCalled = false
  let submitCount = 0
  const leasePath = join(tempDir, 'restoration-draft-operation.json')
  const oldLease = {
    schemaVersion: 1,
    clientRequestId: 'cid-unknown',
    operationToken: 'tok-unknown',
    payloadSha256: '0'.repeat(64),
    stage: 'restoration-draft',
    startedAtUtc: '2026-09-17T00:00:00Z',
    operationId: 'op-unknown'
  }
  await writeFile(leasePath, JSON.stringify(oldLease), 'utf8')
  try {
    globalThis.fetch = async (url: RequestInfo | URL) => {
      const target = String(url)
      if (target.endsWith('/gateway/requests/op-unknown')) {
        return new Response(JSON.stringify({
          id: 'op-unknown', client_request_id: 'cid-unknown', status: 'outcome-unknown',
          dispatch_state: 'dispatched', upstream_attempts: 1, reason: 'outcome-unknown',
          created_at_utc: '2026-09-17T00:00:00Z'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (target.endsWith('/cancel')) { cancelCalled = true; return new Response(null, { status: 204 }) }
      if (target.endsWith('/gateway/requests')) { submitCount++; return new Response('unexpected submit', { status: 500 }) }
      return new Response('not found', { status: 404 })
    }
    const { requestGatewayOperation } = await import('../src/main/geminiGateway')
    await assert.rejects(
      () => requestGatewayOperation(
        'http://127.0.0.1:8080',
        [{ role: 'user', content: 'New schema content' }],
        new AbortController().signal,
        256,
        false,
        'json-items',
        { draftDir: tempDir, stage: 'restoration-draft', responseFormat: { type: 'json_object' } }
      ),
      (error: unknown) => {
        const value = error as { providerCode?: string; operationId?: string; stage?: string }
        return value.providerCode === 'outcome-unknown' && value.operationId === 'op-unknown' && value.stage === 'restoration-draft'
      }
    )
    assert.equal(cancelCalled, false)
    assert.equal(submitCount, 0)
    assert.deepEqual(JSON.parse(await readFile(leasePath, 'utf8')), oldLease)
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('explicit recovery verifies and archives the exact unknown operation before reset', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-manual-recovery-'))
  const oldFetch = globalThis.fetch
  const operationDir = join(tempDir, 'chunk-002')
  await mkdir(operationDir)
  const lease = {
    schemaVersion: 1, clientRequestId: 'cid-unknown', operationToken: 'tok-unknown', payloadSha256: 'a'.repeat(64),
    stage: 'restoration-draft', startedAtUtc: '2026-09-17T00:00:00Z', operationId: 'op-unknown'
  }
  await writeFile(join(operationDir, 'restoration-draft-operation.json'), JSON.stringify(lease), 'utf8')
  const calls: string[] = []
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      calls.push(`${init?.method || 'GET'} ${target}`)
      if (target.endsWith('/gateway/requests/op-unknown')) return new Response(JSON.stringify({
        id: 'op-unknown', client_request_id: 'cid-unknown', status: 'outcome-unknown', dispatch_state: 'dispatched',
        upstream_attempts: 1, reason: 'outcome-unknown', created_at_utc: '2026-09-17T00:00:00Z'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (target.endsWith('/gateway/scheduler')) return new Response(JSON.stringify({
        state: 'blocked', reason: 'outcome-unknown', active_permits: 0, queued_requests: 0, revision: 2
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (target.endsWith('/gateway/reset')) return new Response(JSON.stringify({ ok: true, state: 'ready' }), { status: 200 })
      if (target.endsWith('/gateway/requests/op-unknown/ack')) return new Response(null, { status: 204 })
      return new Response('not found', { status: 404 })
    }
    await recoverUnknownGatewayOperation('http://127.0.0.1:8080', tempDir, {
      // The durable journal may retain the earlier waiting-provider reason
      // even though the verified Gateway receipt has since become unknown.
      operationId: 'op-unknown', stage: 'restoration-draft', reason: 'spacing', nextEligibleAtUtc: null
    })
    assert.equal(await stat(join(operationDir, 'restoration-draft-operation.json')).catch(() => null), null)
    const retained = (await readdir(operationDir)).filter((name) => name.startsWith('restoration-draft-operation.abandoned-'))
    assert.equal(retained.length, 1)
    assert.ok(calls.some((call) => call.startsWith('POST ') && call.endsWith('/gateway/reset')))
    assert.ok(calls.some((call) => call.startsWith('POST ') && call.endsWith('/gateway/requests/op-unknown/ack')))
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('blocked outcome-unknown receipt throws GatewayOperationDeferredError when deferOnWaitingProvider is true', async () => {
  const oldFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        id: 'op-blocked-unknown',
        client_request_id: 'cid-blocked-unknown',
        status: 'blocked',
        dispatch_state: 'not-dispatched',
        upstream_attempts: 0,
        created_at_utc: '2026-09-17T00:00:00Z',
        error: 'upstream governor is blocked: outcome-unknown',
        error_code: 'outcome-unknown'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const { pollGatewayOperation, GatewayOperationDeferredError } = await import('../src/main/geminiGatewayOperations')
    await assert.rejects(
      () => pollGatewayOperation({
        baseUrl: 'http://127.0.0.1:8080',
        operationId: 'op-blocked-unknown',
        operationToken: 'tok-blocked-unknown',
        signal: new AbortController().signal,
        deferOnWaitingProvider: true
      }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayOperationDeferredError)
        assert.equal(error.providerCode, 'outcome-unknown')
        assert.equal(error.reason, 'outcome-unknown')
        assert.equal(error.operationId, 'op-blocked-unknown')
        assert.equal(error.nextEligibleAtUtc, null)
        return true
      }
    )
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('explicit recovery recovers an undispatched operation blocked by outcome-unknown governor', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-op-blocked-recovery-'))
  const oldFetch = globalThis.fetch
  const leasePath = join(tempDir, 'restoration-draft-operation.json')
  const lease = {
    schemaVersion: 1, clientRequestId: 'cid-blocked', operationToken: 'tok-blocked', payloadSha256: 'b'.repeat(64),
    stage: 'restoration-draft', startedAtUtc: '2026-09-17T00:00:00Z', operationId: 'op-blocked'
  }
  await writeFile(leasePath, JSON.stringify(lease), 'utf8')
  const calls: string[] = []
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url)
      calls.push(`${init?.method || 'GET'} ${target}`)
      if (target.endsWith('/gateway/requests/op-blocked')) return new Response(JSON.stringify({
        id: 'op-blocked', client_request_id: 'cid-blocked', status: 'blocked', dispatch_state: 'not-dispatched',
        upstream_attempts: 0, error: 'upstream governor is blocked: outcome-unknown', error_code: 'outcome-unknown',
        created_at_utc: '2026-09-17T00:00:00Z'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (target.endsWith('/gateway/scheduler')) return new Response(JSON.stringify({
        state: 'blocked', reason: 'outcome-unknown', active_permits: 0, queued_requests: 0, revision: 3
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (target.endsWith('/gateway/reset')) return new Response(JSON.stringify({ ok: true, state: 'ready' }), { status: 200 })
      if (target.endsWith('/gateway/requests/op-blocked/ack')) return new Response(null, { status: 204 })
      return new Response('not found', { status: 404 })
    }
    await recoverUnknownGatewayOperation('http://127.0.0.1:8080', tempDir, {
      operationId: 'op-blocked', stage: 'restoration-draft', reason: 'outcome-unknown', nextEligibleAtUtc: null
    })
    assert.equal(await stat(leasePath).catch(() => null), null)
    const retained = (await readdir(tempDir)).filter((name) => name.startsWith('restoration-draft-operation.abandoned-'))
    assert.equal(retained.length, 1)
    assert.ok(calls.some((call) => call.startsWith('POST ') && call.endsWith('/gateway/reset')))
    assert.ok(calls.some((call) => call.startsWith('POST ') && call.endsWith('/gateway/requests/op-blocked/ack')))
  } finally {
    globalThis.fetch = oldFetch
    await rm(tempDir, { recursive: true, force: true })
  }
})
