import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AutoShortTelemetryCollector,
  AutoShortTelemetryJobBudget,
  sanitizeEndpointAlias,
  sanitizeTelemetryPath,
  MAX_DIAGNOSTICS_BYTES
} from '../src/main/autoShortTelemetry'
import type { AutoShortStageSummaryV1 } from '../src/shared/types'

test('sanitizeEndpointAlias masks LAN IPs and preserves ports', () => {
  assert.equal(sanitizeEndpointAlias('http://192.168.1.16:8000/v1'), 'internal-lan:8000')
  assert.equal(sanitizeEndpointAlias('http://10.0.0.5:8080/generate'), 'internal-lan:8080')
  assert.equal(sanitizeEndpointAlias('http://127.0.0.1:5000'), 'localhost:5000')
  assert.equal(sanitizeEndpointAlias('https://api.openai.com/v1/chat'), 'api.openai.com')
  assert.equal(sanitizeEndpointAlias(undefined), undefined)
})

test('sanitizeTelemetryPath hides local user profile username', () => {
  const raw = 'C:\\Users\\PC\\AppData\\Local\\Temp\\test.mp4'
  const sanitized = sanitizeTelemetryPath(raw)
  assert.equal(sanitized, '<user>\\AppData\\Local\\Temp\\test.mp4')
})

test('AutoShortTelemetryCollector writes JSONL and atomic summary JSON', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-telemetry-test-'))
  try {
    const collector = new AutoShortTelemetryCollector({
      jobId: 'job-123',
      itemId: 'item-456',
      attemptId: 'attempt-789',
      diagnosticsDir: tempDir
    })

    // Validate stage span
    await collector.withStageSpan('validate', {}, async (span) => {
      span.updateCounters({ inputBytes: 1024 })
    })

    // ASR stage span
    const asrSpan = collector.startSpan('asr', { requestedProvider: 'cpu', effectiveProvider: 'cpu' })
    asrSpan.setPhase('running')
    asrSpan.recordActive(150)
    asrSpan.succeed({ cueCount: 10 })

    // Translate stage span with request spans
    await collector.withStageSpan('translate', { endpointAlias: 'internal-lan:8000' }, async (span) => {
      span.addRequestSpan({
        batchCueCount: 10,
        sourceChars: 150,
        tokenBudget: 2048,
        actualTokens: 180,
        status: 200
      })
      span.updateCounters({ cueCount: 10, requestCount: 1 })
    })

    // Finalize
    const summary = await collector.finalize('succeeded')
    assert.equal(summary.schemaVersion, 1)
    assert.equal(summary.jobId, 'job-123')
    assert.equal(summary.itemId, 'item-456')
    assert.equal(summary.status, 'succeeded')
    assert.equal(summary.stages.validate?.status, 'succeeded')
    assert.equal(summary.stages.asr?.status, 'succeeded')
    assert.equal(summary.stages.translate?.status, 'succeeded')
    assert.equal(summary.stages.asr?.counters?.cueCount, 10)

    // Verify files created
    const jsonlContent = await readFile(join(tempDir, 'events.jsonl'), 'utf8')
    const lines = jsonlContent.trim().split('\n')
    assert.ok(lines.length >= 6)
    const firstEvent = JSON.parse(lines[0])
    assert.equal(firstEvent.schemaVersion, 1)
    assert.equal(firstEvent.jobId, 'job-123')

    const summaryContent = JSON.parse(await readFile(join(tempDir, 'summary.json'), 'utf8')) as AutoShortStageSummaryV1
    assert.equal(summaryContent.jobId, 'job-123')
    assert.equal(summaryContent.status, 'succeeded')
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('withStageSpan captures failures and AbortError correctly', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-telemetry-err-'))
  try {
    const collector = new AutoShortTelemetryCollector({
      jobId: 'job-err',
      itemId: 'item-err',
      diagnosticsDir: tempDir
    })

    await assert.rejects(async () => {
      await collector.withStageSpan('visual_ocr', {}, async () => {
        throw new Error('OCR failed to detect boxes')
      })
    }, /OCR failed to detect boxes/)

    const summary = await collector.finalize('failed', 'OCR failed to detect boxes')
    assert.equal(summary.status, 'failed')
    assert.equal(summary.stages.visual_ocr?.status, 'failed')
    assert.match(summary.stages.visual_ocr?.error || '', /OCR failed to detect boxes/)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('R5 reproduction: withStageSpan sanitizes private paths, tokens, LAN IPs, UNC, and credentials from all outputs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-telemetry-r5-'))
  try {
    const collector = new AutoShortTelemetryCollector({
      jobId: 'job-r5',
      itemId: 'item-r5',
      diagnosticsDir: tempDir
    })

    // Fail stage with fake secrets, private Windows path, LAN IP, and query token
    await assert.rejects(async () => {
      await collector.withStageSpan('visual_ocr', {}, async (span) => {
        span.addRequestSpan({
          url: 'http://admin:secretPass@192.168.1.16:8000/v1?token=FAKE_SPAN_TOKEN',
          error: 'Nested error in \\\\review-server\\share\\nested\\file.mp4 with Bearer FAKE_BEARER_TOKEN'
        })
        throw new Error('Cannot read C:\\Users\\ReviewUser\\private-video.mp4 via http://192.168.1.16:8000/path?token=FAKE_REVIEW_TOKEN')
      })
    })

    const summary = await collector.finalize('failed', 'Failed at /Users/ReviewUser/mac-path.mp4')
    const events = collector.getEvents()
    const jsonlContent = await readFile(join(tempDir, 'events.jsonl'), 'utf8')
    const summaryContent = await readFile(join(tempDir, 'summary.json'), 'utf8')

    for (const text of [JSON.stringify(events), jsonlContent, summaryContent]) {
      // Must not leak user profile or private usernames
      assert.equal(text.includes('ReviewUser'), false, 'Leaked ReviewUser in telemetry')
      // Must not leak private query token
      assert.equal(text.includes('FAKE_REVIEW_TOKEN'), false, 'Leaked FAKE_REVIEW_TOKEN in telemetry')
      assert.equal(text.includes('FAKE_SPAN_TOKEN'), false, 'Leaked FAKE_SPAN_TOKEN in telemetry')
      // Must not leak Bearer token
      assert.equal(text.includes('FAKE_BEARER_TOKEN'), false, 'Leaked FAKE_BEARER_TOKEN in telemetry')
      // Must not leak private LAN IP
      assert.equal(text.includes('192.168.1.16'), false, 'Leaked private LAN IP in telemetry')
      // Must not leak URL credentials
      assert.equal(text.includes('secretPass'), false, 'Leaked URL credential password in telemetry')
      // Must not leak UNC server
      assert.equal(text.includes('review-server'), false, 'Leaked UNC server name in telemetry')
    }

    assert.equal(summary.status, 'failed')
    assert.match(summary.stages.visual_ocr?.error || '', /<user>/)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('sanitizeEndpointAlias handles IPv6 loopback, LAN subnets, and strips credentials/queries', () => {
  assert.equal(sanitizeEndpointAlias('http://[::1]:8000/v1?token=secret'), 'localhost:8000')
  assert.equal(sanitizeEndpointAlias('http://[0:0:0:0:0:0:0:1]:5000'), 'localhost:5000')
  assert.equal(sanitizeEndpointAlias('http://user:pass@10.0.0.5:8080/generate?key=xyz'), 'internal-lan:8080')
  assert.equal(sanitizeEndpointAlias('http://172.20.1.2:9000'), 'internal-lan:9000')
})

test('AutoShortTelemetryJobBudget preserves terminal records when non-terminal budget is full', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-telemetry-budget-'))
  try {
    // 5000 bytes total budget: 1000 bytes reserved for terminal records, 4000 bytes for nonterminal
    const budget = new AutoShortTelemetryJobBudget({
      maxTotalBytes: 5000,
      reservedTerminalBytes: 1000
    })

    const collector1 = new AutoShortTelemetryCollector({
      jobId: 'job-budget',
      itemId: 'item-1',
      diagnosticsDir: tempDir,
      budget
    })
    const collector2 = new AutoShortTelemetryCollector({
      jobId: 'job-budget',
      itemId: 'item-2',
      diagnosticsDir: tempDir,
      budget
    })

    // Write non-terminal events until non-terminal budget (4000) is filled
    for (let i = 0; i < 30; i++) {
      collector1.recordEvent({
        stage: 'validate',
        stageId: `span-c1-${i}`,
        phase: 'queued',
        counters: { test: i }
      })
      collector2.recordEvent({
        stage: 'validate',
        stageId: `span-c2-${i}`,
        phase: 'queued',
        counters: { test: i }
      })
    }

    // A non-terminal event should now be blocked from writing to disk
    assert.ok(budget.isQuotaExceeded())

    // Now emit terminal events from both collectors
    collector1.recordEvent({
      stage: 'validate',
      stageId: 'terminal-1',
      phase: 'succeeded',
      counters: { final: 1 }
    })
    collector2.recordEvent({
      stage: 'validate',
      stageId: 'terminal-2',
      phase: 'failed',
      error: 'Simulated terminal failure'
    })

    const summary1 = await collector1.finalize('succeeded')
    const summary2 = await collector2.finalize('failed', 'Simulated terminal failure')

    assert.equal(summary1.status, 'succeeded')
    assert.equal(summary2.status, 'failed')

    // Read events.jsonl and assert terminal events ARE preserved in the file
    const jsonlContent = await readFile(join(tempDir, 'events.jsonl'), 'utf8')
    assert.ok(jsonlContent.includes('"phase":"succeeded"'), 'Terminal succeeded event must be preserved on disk')
    assert.ok(jsonlContent.includes('"phase":"failed"'), 'Terminal failed event must be preserved on disk')
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('in-memory ring buffer is bounded to 1,000 events and preserves terminal events', () => {
  const collector = new AutoShortTelemetryCollector({
    jobId: 'job-ring',
    itemId: 'item-ring'
  })

  // Push 10 terminal events
  for (let i = 0; i < 10; i++) {
    collector.recordEvent({
      stage: 'validate',
      stageId: `term-${i}`,
      phase: 'succeeded'
    })
  }

  // Push 1,050 non-terminal events
  for (let i = 0; i < 1050; i++) {
    collector.recordEvent({
      stage: 'validate',
      stageId: `non-term-${i}`,
      phase: 'queued'
    })
  }

  const events = collector.getEvents()
  assert.equal(events.length, 1000)

  // Verify all 10 terminal events are still preserved
  const terminalCount = events.filter((e) => e.phase === 'succeeded').length
  assert.equal(terminalCount, 10, 'All terminal events must be preserved in ring buffer')
})

test('progress events are coalesced at <= 1Hz per item', () => {
  const collector = new AutoShortTelemetryCollector({
    jobId: 'job-progress',
    itemId: 'item-progress'
  })

  // Record 5 rapid progress events
  for (let i = 0; i < 5; i++) {
    collector.recordEvent({
      stage: 'visual_ocr',
      stageId: 'span-progress',
      phase: 'progress',
      counters: { percent: i * 20 }
    })
  }

  const events = collector.getEvents()
  // Only 1 progress event should be recorded because they were emitted within 1 second
  const progressEvents = events.filter((e) => e.phase === 'progress')
  assert.equal(progressEvents.length, 1)
})

test('crash recovery: unfinished running spans are never reported as succeeded in summary', async () => {
  const collector = new AutoShortTelemetryCollector({
    jobId: 'job-crash',
    itemId: 'item-crash'
  })

  const span = collector.startSpan('asr')
  span.setPhase('running')

  // Finalize with failed without closing the span
  const summary = await collector.finalize('failed', 'Process crashed')

  assert.equal(summary.status, 'failed')
  assert.equal(summary.stages.asr?.status, 'failed')
  assert.notEqual(summary.stages.asr?.status, 'succeeded')
})

test('finalize is idempotent and returns the same summary on repeated calls', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tedia-telemetry-idem-'))
  try {
    const collector = new AutoShortTelemetryCollector({
      jobId: 'job-idem',
      itemId: 'item-idem',
      diagnosticsDir: tempDir
    })

    const summary1 = await collector.finalize('succeeded')
    const summary2 = await collector.finalize('succeeded')

    assert.equal(summary1.status, 'succeeded')
    assert.equal(summary2.status, 'succeeded')
    assert.equal(summary1.completedAtUtc, summary2.completedAtUtc)
    assert.equal(summary1.totalWallMs, summary2.totalWallMs)
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})
