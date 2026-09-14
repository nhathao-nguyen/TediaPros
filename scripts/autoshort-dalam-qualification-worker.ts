import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { appendFileSync } from 'node:fs'
import { lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { app, safeStorage } from 'electron'
import type { AutoShortConfig, AutoShortEvent, AutoShortItemResult } from '../src/shared/types'

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function linkDirectory(source: string, destination: string): Promise<void> {
  const current = await lstat(destination).catch(() => null)
  if (current) return
  await symlink(source, destination, 'junction')
}

async function main(): Promise<void> {
  const source = resolve(argument('--source') || '')
  const outputRoot = resolve(argument('--output-root') || '')
  const profile = resolve(argument('--profile') || '')
  const evidenceDir = resolve(argument('--evidence-dir') || '')
  const runtimeUserData = resolve(argument('--runtime-user-data') || '')
  const expectedSha256 = (argument('--source-sha256') || '').toLowerCase()
  const concurrency = Number(argument('--concurrency')) === 2 ? 2 : 1
  const translateTarget = argument('--translate-target') || 'vi'
  const translateServerUrl = argument('--translate-server-url') || 'http://127.0.0.1:8000'
  const edgeVoice = argument('--edge-voice') || 'vi-VN-HoaiMyNeural'
  const ttsLanguage = argument('--tts-language') || (translateTarget === 'none' ? 'zh' : translateTarget)
  const runId = argument('--run-id') || `dalam-${Date.now()}`
  if (!argument('--source') || !existsSync(source)) throw new Error('Thiếu source video tồn tại.')
  if (!argument('--output-root') || !argument('--profile') || !argument('--evidence-dir') || !argument('--runtime-user-data')) {
    throw new Error('Thiếu output/profile/evidence/runtime user data.')
  }
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) throw new Error('Thiếu SHA-256 nguồn hợp lệ.')

  // safeStorage loads its encryption context from userData during Electron
  // startup. Point it at the source profile before app.whenReady(), decrypt
  // once, then move all AutoShort state to the isolated qualification profile.
  app.setPath('userData', runtimeUserData)
  await app.whenReady()
  const actualBefore = await sha256File(source)
  if (actualBefore !== expectedSha256) throw new Error(`SHA-256 nguồn không khớp trước chạy: ${actualBefore}`)

  let localKey = ''
  if (translateTarget !== 'none') {
    try {
      const encrypted = await readFile(join(runtimeUserData, 'lk.bin'))
      localKey = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(encrypted)
        : encrypted.toString('utf8')
    } catch {
      throw new Error('Không đọc được khóa dịch local đã lưu; dừng trước khi xử lý video.')
    }
  }

  await mkdir(profile, { recursive: true })
  await mkdir(outputRoot, { recursive: true })
  await mkdir(evidenceDir, { recursive: true })
  await linkDirectory(join(runtimeUserData, 'bin'), join(profile, 'bin'))
  await linkDirectory(join(runtimeUserData, 'whisper-models'), join(profile, 'whisper-models'))
  app.setPath('userData', profile)
  const isolatedKeyPath = join(profile, 'lk.bin')
  if (translateTarget !== 'none') {
    await writeFile(isolatedKeyPath, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(localKey) : Buffer.from(localKey, 'utf8'))
  }
  localKey = ''

  const config: AutoShortConfig = {
    subtitleMethod: 'whisper',
    whisperModel: 'small',
    whisperDevice: 'cpu',
    whisperLanguage: 'zh',
    ocrRegion: { x0: 0.05, y0: 0.72, x1: 0.95, y1: 0.94 },
    blurRegions: [],
    lamMo: false,
    blurMode: 'manual',
    ocrBlurProfile: 'accurate',
    subRegion: { x0: 0.05, y0: 0.76, x1: 0.95, y1: 0.92 },
    subtitlePlacementMode: 'manual',
    fontId: null,
    textColor: '#ffffff',
    outlineColor: '#000000',
    outlinePx: 6.5,
    bgEnabled: false,
    subtitleDisplayStyle: 'standard',
    subtitleLayoutProfile: 'vertical',
    subtitleAutoOptimize: true,
    translateTarget,
    translateProvider: 'local',
    ...(translateTarget === 'none' ? {} : { translateServerUrl }),
    ttsEnabled: true,
    ttsProvider: 'edge-tts',
    ttsModel: 'edge-tts',
    ttsVoice: edgeVoice,
    ttsLanguage,
    ttsSpeed: 1,
    paceMode: 'source-adaptive',
    voiceOverMode: false,
    audioMode: 'replace',
    originalAudioVolume: 20,
    outputDir: outputRoot,
    executionPolicy: {
      edgeTtsConcurrency: concurrency,
      maxActiveItems: 1,
      overlapIndependentStages: true,
      prefetchTts: false,
      ocrTransport: 'legacy-disk'
    }
  }

  const configSnapshot = {
    schemaVersion: 1,
    runId,
    source,
    sourceSha256: actualBefore,
    appVersion: app.getVersion(),
    platform: `${process.platform}-${process.arch}`,
    config,
    secretFieldsPersisted: false
  }
  await writeFile(join(evidenceDir, `${runId}-config.json`), `${JSON.stringify(configSnapshot, null, 2)}\n`, 'utf8')

  const eventsPath = join(evidenceDir, `${runId}-events.jsonl`)
  await rm(eventsPath, { force: true })
  const started = performance.now()
  let itemResult: AutoShortItemResult | undefined
  try {
    const { getAutoShortReadiness, startAutoShortJob } = await import('../src/main/autoshort')
    const readiness = await getAutoShortReadiness(config)
    await writeFile(join(evidenceDir, `${runId}-readiness.json`), `${JSON.stringify(readiness, null, 2)}\n`, 'utf8')
    if (!readiness.ready) throw new Error(readiness.message || 'AutoShort readiness không đạt.')

    await new Promise<void>((resolveRun, rejectRun) => {
      const startedJob = startAutoShortJob({
        config,
        items: [{ id: `${runId}-item`, filePath: source }]
      }, (event: AutoShortEvent) => {
        appendFileSync(eventsPath, `${JSON.stringify({ receivedAtUtc: new Date().toISOString(), ...event })}\n`, 'utf8')
        if (event.type === 'item-done' || event.type === 'item-error') itemResult = event.result
        if (event.type === 'batch-done') resolveRun()
      })
      if (!startedJob.ok) rejectRun(new Error(startedJob.error))
    })
  } finally {
    await rm(isolatedKeyPath, { force: true })
  }

  const actualAfter = await sha256File(source)
  const report = {
    schemaVersion: 1,
    runId,
    checkedAtUtc: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - started),
    source,
    sourceSha256Before: actualBefore,
    sourceSha256After: actualAfter,
    sourceUnchanged: actualBefore === actualAfter,
    itemResult
  }
  const reportPath = join(evidenceDir, `${runId}-report.json`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ reportPath, elapsedMs: report.elapsedMs, sourceUnchanged: report.sourceUnchanged, status: itemResult?.status, output: itemResult?.outputPath, error: itemResult?.error })}\n`)
  if (!itemResult || itemResult.status !== 'done' || !report.sourceUnchanged) process.exitCode = 1
  app.quit()
}

void main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
  try { app.quit() } catch { /* Electron may not have initialized. */ }
})
