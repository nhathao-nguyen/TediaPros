import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAutoShortQueue, type QueueItemOutcome } from '../src/main/autoShortQueueRunner'
import { createGeminiGatewayTranslationAdapter } from '../src/main/geminiGateway'
import { planTranslation } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'
import type { AutoShortItemResult, AutoShortQueueItemInput } from '../src/shared/types'
import {
  recoverInterruptedBatch,
  resumeCandidateIds,
  validateBatchSnapshot,
  type BatchSnapshot
} from '../src/shared/autoShortBatchJournal'

interface RecoveryHarnessReport {
  maxUpstreamInflight: number
  generationsDuringCooldown: number
  duplicateDispatches: number
  failedPendingItems: number
  completedItems: number
}

test('callback harness preserves 100 journal entries across an explicit two-pass resume', async () => {
  const report: RecoveryHarnessReport = {
    maxUpstreamInflight: 0,
    generationsDuringCooldown: 0,
    duplicateDispatches: 0,
    failedPendingItems: 0,
    completedItems: 0
  }

  let currentClockMs = Date.parse('2026-09-17T00:00:00.000Z')
  let cooldownUntilMs = 0
  let activeUpstreamInflight = 0
  const processedClientRequestIds = new Set<string>()

  // Simulate 100 video items in queue
  const totalItems = 100
  const items: AutoShortQueueItemInput[] = Array.from({ length: totalItems }, (_, i) => ({
    id: `video-${String(i).padStart(3, '0')}`,
    filePath: `F:/media/video-${String(i).padStart(3, '0')}.mp4`
  }))

  // Initial journal snapshot
  let snapshot: BatchSnapshot = {
    schemaVersion: 2,
    jobId: 'batch-test-100',
    revision: 0,
    createdAtUtc: new Date(currentClockMs).toISOString(),
    updatedAtUtc: new Date(currentClockMs).toISOString(),
    items: items.map((it, idx) => ({
      itemId: it.id,
      inputPath: it.filePath,
      inputDigest: 'a'.repeat(64),
      configDigest: 'b'.repeat(64),
      ordinal: idx,
      attempt: 0,
      state: 'pending'
    }))
  }

  // Helper simulating single video processor through the upstream governor
  let job3Throttled = false
  const runBatchPass = async (
    candidateItems: AutoShortQueueItemInput[],
    signal: AbortSignal
  ): Promise<AutoShortItemResult[]> => {
    return runAutoShortQueue({
      items: candidateItems,
      signal,
      maxActiveItems: 1, // Strictly governed concurrency = 1
      circuitBreakerThreshold: 5,
      getNowMs: () => currentClockMs,
      pauseOnDeferred: true,
      processItem: async (item): Promise<AutoShortItemResult | QueueItemOutcome> => {
        // Track upstream inflight concurrency
        activeUpstreamInflight++
        if (activeUpstreamInflight > report.maxUpstreamInflight) {
          report.maxUpstreamInflight = activeUpstreamInflight
        }

        try {
          // Check if generation is attempted during cooldown
          if (currentClockMs < cooldownUntilMs) {
            report.generationsDuringCooldown++
          }

          // Check duplicate dispatch
          if (processedClientRequestIds.has(item.id)) {
            report.duplicateDispatches++
          }

          // Trigger 429 at the 3rd job (video-002) once
          if (item.id === 'video-002' && !job3Throttled) {
            job3Throttled = true
            cooldownUntilMs = currentClockMs + 600_000 // 600 seconds cooldown
            return {
              kind: 'deferred',
              wait: {
                operationId: `op-${item.id}`,
                stage: 'restore-translate',
                reason: 'Gemini Gateway rate limit (HTTP 429, Retry-After 600s)',
                nextEligibleAtUtc: new Date(cooldownUntilMs).toISOString()
              }
            }
          }

          processedClientRequestIds.add(item.id)
          return {
            itemId: item.id,
            filePath: item.filePath,
            status: 'done'
          }
        } finally {
          activeUpstreamInflight--
        }
      },
      onTerminal: (result) => {
        // Update journal
        snapshot = {
          ...snapshot,
          revision: snapshot.revision + 1,
          items: snapshot.items.map((it) =>
            it.itemId === result.itemId
              ? {
                  ...it,
                  state: result.status === 'done' ? 'succeeded' : 'failed',
                  providerWait: undefined,
                  ...(result.status === 'done'
                    ? {
                        outputReceipt: {
                          path: `F:/out/${result.itemId}.mp4`,
                          sha256: 'c'.repeat(64),
                          bytes: 1024,
                          durationSeconds: 15
                        }
                      }
                    : {})
                }
              : it
          )
        }
      },
      onDeferred: (wait, _index, item) => {
        // Update journal with waiting-provider record
        snapshot = {
          ...snapshot,
          revision: snapshot.revision + 1,
          items: snapshot.items.map((it) =>
            it.itemId === item.id
              ? {
                  ...it,
                  state: 'waiting-provider',
                  providerWait: {
                    operationId: wait.operationId,
                    stage: wait.stage,
                    reason: wait.reason,
                    nextEligibleAtUtc: wait.nextEligibleAtUtc
                  }
                }
              : it
          )
        }
      }
    })
  }

  // First pass: runs until item 3 encounters 429
  const controller1 = new AbortController()
  const firstPassCandidates = resumeCandidateIds(snapshot).map((id) => items.find((it) => it.id === id)!)
  const pass1Results = await runBatchPass(firstPassCandidates, controller1.signal)

  // Validate state after pass 1
  assert.equal(pass1Results[0].status, 'done')
  assert.equal(pass1Results[1].status, 'done')
  assert.equal(pass1Results[2].status, 'waiting_provider')
  assert.equal(pass1Results[2].providerWait?.operationId, 'op-video-002')

  // Verify journal validation
  const validatedSnap1 = validateBatchSnapshot(snapshot)
  const item2Journal = validatedSnap1.items.find((it) => it.itemId === 'video-002')
  assert.equal(item2Journal?.state, 'waiting-provider')
  assert.equal(item2Journal?.providerWait?.operationId, 'op-video-002')

  // Verify pending items have NOT failed
  const failedItemsPass1 = validatedSnap1.items.filter((it) => it.state === 'failed')
  assert.equal(failedItemsPass1.length, 0, 'Pending items must not fail en masse')
  report.failedPendingItems = failedItemsPass1.length

  // Candidates for resume must include item 3 and all remaining items (98 items)
  const resumeCandidates = resumeCandidateIds(validatedSnap1)
  assert.equal(resumeCandidates.length, 98)
  assert.equal(resumeCandidates[0], 'video-002')
  assert.equal(resumeCandidates.at(-1), 'video-099')

  // Advance fake clock by 601 seconds (past 600s cooldown)
  currentClockMs += 601_000

  // Second pass: resume the remaining items
  const controller2 = new AbortController()
  const pass2CandidateItems = resumeCandidates.map((id) => items.find((it) => it.id === id)!)
  await runBatchPass(pass2CandidateItems, controller2.signal)

  // Verify final journal and completion
  const finalSnap = validateBatchSnapshot(snapshot)
  const completedSnapItems = finalSnap.items.filter((it) => it.state === 'succeeded')
  report.completedItems = completedSnapItems.length

  // Core assertions required by the specification:
  assert.equal(report.maxUpstreamInflight, 1, 'Max upstream inflight concurrency must strictly be 1')
  assert.equal(report.generationsDuringCooldown, 0, 'No generation should occur during cooldown')
  assert.equal(report.duplicateDispatches, 0, 'No duplicate dispatches without idempotency lease')
  assert.equal(report.failedPendingItems, 0, 'Pending items must never fail en masse')
  assert.equal(report.completedItems, 100, 'All 100 items must successfully complete')
})

test('cancellation during provider cooldown stops queue cleanly without failing pending items', async () => {
  const controller = new AbortController()
  const items: AutoShortQueueItemInput[] = [
    { id: 'video-0', filePath: 'F:/video-0.mp4' },
    { id: 'video-1', filePath: 'F:/video-1.mp4' },
    { id: 'video-2', filePath: 'F:/video-2.mp4' }
  ]

  let generationsCount = 0
  const results = await runAutoShortQueue({
    items,
    signal: controller.signal,
    maxActiveItems: 1,
    processItem: async (item, index) => {
      generationsCount++
      if (index === 0) {
        // First item encounters cooldown, user then cancels
        controller.abort()
        return {
          kind: 'deferred',
          wait: {
            operationId: 'op-0',
            stage: 'restore-translate',
            reason: 'Rate limited',
            nextEligibleAtUtc: new Date(Date.now() + 600_000).toISOString()
          }
        }
      }
      return { itemId: item.id, filePath: item.filePath, status: 'done' }
    },
    onTerminal: () => {}
  })

  // Only the first item was dispatched; subsequent items were stopped by abort signal
  assert.equal(generationsCount, 1)
  assert.equal(results[0].status, 'waiting_provider')
  assert.equal(results[1].status, 'cancelled')
  assert.equal(results[2].status, 'cancelled')
})

test('production adapter and queue reuse one operation while the journal waits 600s, then resume the same item', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-batch-integration-'))
  const oldFetch = globalThis.fetch
  let nowMs = Date.parse('2026-09-17T00:00:00.000Z')
  const events: string[] = []
  const starts: string[] = []
  const clientIds = new Map<string, string>()
  const statusReads = new Map<string, number>()
  const items: AutoShortQueueItemInput[] = [
    { id: 'video-0', filePath: 'F:/video-0.mp4' },
    { id: 'video-1', filePath: 'F:/video-1.mp4' }
  ]
  let snapshot: BatchSnapshot = {
    schemaVersion: 2,
    jobId: 'adapter-queue-integration', revision: 0,
    createdAtUtc: new Date(nowMs).toISOString(), updatedAtUtc: new Date(nowMs).toISOString(),
    items: items.map((item, ordinal) => ({ itemId: item.id, inputPath: item.filePath,
      inputDigest: 'a'.repeat(64), configDigest: 'b'.repeat(64), ordinal, attempt: 0, state: 'pending' }))
  }
  const metadata = {
    gateway_contract_version: 2, requested_model: 'gemini-advanced', resolved_model: 'gemini-advanced',
    observed_model_id: 'gemini-3.1-pro-preview', observed_model: 'Gemini 3.1 Pro', route_fingerprint: '11'.repeat(32),
    model_verification: 'matched', completion_state: 'complete', completion_evidence: 'stop-reason:stop',
    upstream_attempts: 1, upstream_retry_reasons: []
  }
  try {
    globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
      const value = String(url)
      if (value.endsWith('/gateway/capabilities')) return new Response(JSON.stringify({
        gateway_contract_version: 2, scheduler_contract_version: 1, request_jobs: true, provider_ready: true,
        models: ['gemini-advanced'], gateway_model_routes: { 'gemini-advanced': { route_fingerprint: metadata.route_fingerprint } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      if (value.endsWith('/gateway/requests')) {
        const envelope = JSON.parse(String(init?.body)) as { client_request_id: string; request: unknown }
        const itemId = JSON.stringify(envelope.request).includes('video-0') ? 'video-0' : 'video-1'
        const operationId = `op-${itemId}`
        clientIds.set(operationId, envelope.client_request_id)
        events.push(`submit:${operationId}:${envelope.client_request_id}`)
        return new Response(JSON.stringify({ id: operationId, client_request_id: envelope.client_request_id,
          status: 'queued', dispatch_state: 'not-dispatched', upstream_attempts: 0, created_at_utc: new Date(nowMs).toISOString() }),
        { status: 202, headers: { 'Content-Type': 'application/json' } })
      }
      const operationId = value.includes('op-video-0') ? 'op-video-0' : 'op-video-1'
      if (value.endsWith('/ack')) { events.push(`ack:${operationId}`); return new Response(null, { status: 204 }) }
      const reads = (statusReads.get(operationId) || 0) + 1
      statusReads.set(operationId, reads)
      events.push(`status:${operationId}:${reads}`)
      if (operationId === 'op-video-0' && reads === 1) {
        return new Response(JSON.stringify({ id: operationId, client_request_id: clientIds.get(operationId),
          status: 'waiting-provider', dispatch_state: 'not-dispatched', upstream_attempts: 0,
          created_at_utc: '2026-09-17T00:00:00.000Z', next_eligible_at_utc: '2026-09-17T00:10:00.000Z', reason: 'provider-throttled' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ id: operationId, client_request_id: clientIds.get(operationId),
        status: 'succeeded', dispatch_state: 'dispatched', upstream_attempts: 1, created_at_utc: '2026-09-17T00:00:00.000Z',
        response: { id: `resp-${operationId}`, model: 'gemini-advanced', gateway_metadata: metadata,
          choices: [{ message: { content: JSON.stringify({ translations: { 'cue-1': `done-${operationId}` } }) }, finish_reason: 'stop' }] }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const results = await runAutoShortQueue({
      items, signal: new AbortController().signal, maxActiveItems: 1, getNowMs: () => nowMs,
      waitForProviderWait: async (wait) => { nowMs = Date.parse(wait.nextEligibleAtUtc!) },
      processItem: async (item) => {
        starts.push(item.id)
        const source: TranslationInput = { sourceLanguage: 'en', targetLocale: 'vi-VN', mode: 'subtitles',
          cues: [{ id: 'cue-1', groupId: 'g', sourceIndex: 0, start: 0, end: 1, text: item.id }],
          contextBefore: [], contextAfter: [], glossary: [] }
        const adapter = createGeminiGatewayTranslationAdapter('http://127.0.0.1:8080', {
          draftDir: join(root, item.id), reviewMode: 'draft-only', deferOnProviderWait: true
        })
        try {
          const plan = planTranslation(source, adapter.capability)
          await adapter.requestOnce(plan.batches[0], new AbortController().signal, source)
          return { itemId: item.id, filePath: item.filePath, status: 'done' }
        } catch (error) {
          const wait = error as { operationId?: string; stage?: 'restore-translate'; reason?: string; nextEligibleAtUtc?: string | null }
          if (!wait.operationId) throw error
          return { kind: 'deferred', wait: { operationId: wait.operationId, stage: wait.stage || 'restore-translate',
            reason: wait.reason || 'waiting-provider', nextEligibleAtUtc: wait.nextEligibleAtUtc ?? null } }
        }
      },
      onDeferred: (wait, _index, item) => {
        snapshot = { ...snapshot, revision: snapshot.revision + 1, updatedAtUtc: new Date(nowMs).toISOString(),
          items: snapshot.items.map(record => record.itemId === item.id ? { ...record, state: 'waiting-provider', providerWait: { ...wait } } : record) }
      },
      onTerminal: (result, _index, item) => {
        snapshot = { ...snapshot, revision: snapshot.revision + 1, updatedAtUtc: new Date(nowMs).toISOString(),
          items: snapshot.items.map(record => record.itemId === item.id ? { ...record, state: 'succeeded', providerWait: undefined,
            outputReceipt: { path: `F:/out/${item.id}.mp4`, sha256: 'c'.repeat(64), bytes: 10, durationSeconds: 1 } } : record) }
      }
    })

    assert.deepEqual(starts, ['video-0', 'video-0', 'video-1'])
    assert.equal(events.filter(event => event.startsWith('submit:op-video-0:')).length, 1)
    assert.equal(events.indexOf('status:op-video-0:2') < events.indexOf(events.find(event => event.startsWith('submit:op-video-1:'))!), true)
    assert.deepEqual(results.map(result => result.status), ['done', 'done'])
    assert.deepEqual(validateBatchSnapshot(snapshot).items.map(item => item.state), ['succeeded', 'succeeded'])
  } finally {
    globalThis.fetch = oldFetch
    await rm(root, { recursive: true, force: true })
  }
})
