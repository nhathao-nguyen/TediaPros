import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { generateEdgeTTS } from '../src/main/edgeTts'
import { EDGE_TTS_DEFAULT_SPACING_MS, EdgeTtsScheduler } from '../src/main/edgeTtsScheduler'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function percentile(values: readonly number[], ratio: number): number {
  if (!values.length) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1))]
}

async function main(): Promise<void> {
  const count = Number(argument('--count'))
  const concurrency = Number(argument('--concurrency')) === 2 ? 2 : 1
  const spacingMs = Number(argument('--spacing-ms') || String(EDGE_TTS_DEFAULT_SPACING_MS))
  const ffmpegPath = resolve(argument('--ffmpeg') || '')
  const outputPath = resolve(argument('--output') || '')
  if (!Number.isSafeInteger(count) || count < 1 || count > 500) throw new Error('--count phải trong 1..500')
  if (!Number.isSafeInteger(spacingMs) || spacingMs < 1_000 || spacingMs > 10_000) throw new Error('--spacing-ms phải trong 1000..10000')
  if (!ffmpegPath || !(await stat(ffmpegPath).catch(() => null))?.isFile()) throw new Error('--ffmpeg phải là managed FFmpeg tồn tại')
  if (!argument('--output')) throw new Error('Thiếu --output')

  const scratch = await mkdtemp(join(tmpdir(), `tedia-edge-live-${count}-`))
  const scheduler = new EdgeTtsScheduler({ concurrency, spacingMs })
  let peakActive = 0
  let peakQueued = 0
  let peakRss = process.memoryUsage().rss
  const unsubscribe = scheduler.subscribe((state) => {
  peakActive = Math.max(peakActive, state.active)
  peakQueued = Math.max(peakQueued, state.queued)
  peakRss = Math.max(peakRss, process.memoryUsage().rss)
  })
  const samples: Array<Record<string, unknown>> = new Array(count)
  let cursor = 0
  let stopReason: string | undefined
  const started = performance.now()

  async function worker(): Promise<void> {
  while (!stopReason) {
    const index = cursor++
    if (index >= count) return
    const itemStarted = performance.now()
    const file = join(scratch, `${String(index + 1).padStart(4, '0')}.wav`)
    const result = await generateEdgeTTS({
      text: `Mẫu kiểm tra Edge TTS số ${index + 1}. Hải sản tươi được chế biến ngay sau khi đánh bắt.`,
      language: 'vi-VN', model: 'edge-tts', voice: 'vi-VN-HoaiMyNeural', speed: 1
    }, undefined, file, { scheduler, resolveFfmpeg: async () => ffmpegPath })
    const failureCodes = result.requestSpans?.flatMap((span) => span.edgeFailureCode ? [span.edgeFailureCode] : []) || []
    const fileInfo = result.ok ? await stat(file).catch(() => null) : null
    const sha256 = fileInfo?.isFile()
      ? createHash('sha256').update(await readFile(file)).digest('hex')
      : undefined
    samples[index] = {
      index: index + 1,
      ok: result.ok,
      wallMs: Math.round(performance.now() - itemStarted),
      generationMs: result.generationMs,
      durationMs: result.durationMs,
      bytes: fileInfo?.size,
      sha256,
      attempts: result.requestSpans?.length || 0,
      failureCodes,
      requestSpans: result.requestSpans,
      error: result.ok ? undefined : result.error
    }
    if (failureCodes.includes('access_denied') || failureCodes.includes('rate_limited') || failureCodes.includes('circuit_open')) {
      stopReason = failureCodes.includes('access_denied')
        ? 'access_denied'
        : failureCodes.includes('rate_limited')
          ? 'rate_limited'
          : 'circuit_open'
    }
  }
  }

  try {
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const completed = samples.filter(Boolean)
  const wallValues = completed.map((sample) => Number(sample.wallMs))
  const failures = completed.filter((sample) => sample.ok !== true)
  const successes = completed.filter((sample) => sample.ok === true)
  const successWallValues = successes.map((sample) => Number(sample.wallMs))
  const networkSpans = completed
    .flatMap((sample) => Array.isArray(sample.requestSpans) ? sample.requestSpans as Array<Record<string, unknown>> : [])
    .filter((span) => span.edgeFailureCode !== 'circuit_open')
  const artifact = {
    schemaVersion: 1,
    checkedAtUtc: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    countRequested: count,
    countCompleted: completed.length,
    concurrency,
    spacingMs,
    fullDecodeAndProbe: true,
    elapsedMs: Math.round(performance.now() - started),
    wallP50Ms: percentile(wallValues, 0.5),
    wallP95Ms: percentile(wallValues, 0.95),
    successWallP50Ms: percentile(successWallValues, 0.5),
    successWallP95Ms: percentile(successWallValues, 0.95),
    peakSchedulerActive: peakActive,
    peakSchedulerQueued: peakQueued,
    peakRssBytes: peakRss,
    retryAttempts: completed.reduce((sum, sample) => sum + Math.max(0, Number(sample.attempts) - 1), 0),
    networkAttemptCount: networkSpans.length,
    networkFailureAttemptCount: networkSpans.filter((span) => Boolean(span.edgeFailureCode)).length,
    successCount: successes.length,
    failureCount: failures.length,
    stopReason: stopReason || (failures.length ? 'request_failed' : undefined),
    samples: completed
  }
  await mkdir(dirname(outputPath), { recursive: true })
  const partial = `${outputPath}.partial`
  await writeFile(partial, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  await rename(partial, outputPath)
  process.stdout.write(`${JSON.stringify({ outputPath, countCompleted: completed.length, failureCount: failures.length, stopReason: artifact.stopReason, elapsedMs: artifact.elapsedMs })}\n`)
  if (failures.length || completed.length !== count) process.exitCode = 1
  } finally {
    unsubscribe()
    await rm(scratch, { recursive: true, force: true })
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
