import { app } from 'electron'
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { startAutoShortJob, getAutoShortReadiness, retryAutoShortTranslation } from '../src/main/autoshort'
import { checkLocalTranslateKey, loadLocalKey, saveLocalKey } from '../src/main/localTranslate'
import { checkKey, loadKey, saveKey } from '../src/main/gemini'
import { checkTtsServerHealth, getTtsModels } from '../src/main/tts'
import type {
  AutoShortConfig,
  AutoShortEvent,
  AutoShortItemResult,
  AutoShortStartRequest
} from '../src/shared/types'

const REPO_ROOT = resolve(process.cwd())
const DEFAULT_INPUT_DIR = 'F:\\Son\\doyuin\\VideoInput'
const DEFAULT_OUTPUT_DIR = 'F:\\Test_video'
const DEFAULT_USER_DATA_DIR = 'C:\\Users\\PC\\AppData\\Roaming\\tedia-pros'
const SERVER_URL = 'http://192.168.1.16:8000'

type StringMap = Record<string, string>

function argValue(name: string): string | undefined {
  const args = process.argv.slice(2)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name)
}

function parseDotEnv(text: string): StringMap {
  const values: StringMap = {}
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u)
    if (!match) continue
    let value = match[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[match[1]!] = value
  }
  return values
}

async function readEnvFile(): Promise<StringMap> {
  try {
    return parseDotEnv(await readFile(join(REPO_ROOT, '.env'), 'utf8'))
  } catch {
    return {}
  }
}

async function enumerateVideos(inputDir: string): Promise<string[]> {
  const entries = await readdir(inputDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.mp4')
    .map((entry) => join(inputDir, entry.name))
    .sort((a, b) => basename(a).localeCompare(basename(b), 'zh-CN'))
}

function formatProgress(event: Extract<AutoShortEvent, { type: 'item-progress' }>): string {
  const phase = event.itemStatus || event.phase || 'progress'
  const percent = Number.isFinite(event.itemPercent) ? event.itemPercent.toFixed(1) : '?'
  const message = (event.itemMessage || event.message || '').replace(/\s+/gu, ' ').trim().slice(0, 220)
  return `[${event.batchIndex}/${event.batchTotal}] ${event.itemId} ${phase} ${percent}%${message ? ` — ${message}` : ''}`
}

async function findMp4Files(root: string): Promise<string[]> {
  const output: string[] = []
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (entry.isFile() && extname(entry.name).toLowerCase() === '.mp4') output.push(child)
    }
  }
  await visit(root)
  return output.sort((a, b) => a.localeCompare(b, 'en'))
}

/**
 * A batch rerun is an explicit retry action for any checkpoint that stopped in
 * needs-review.  Use the same guarded main-process operation as the renderer
 * retry button so a normal rerun cannot silently bypass the checkpoint gate.
 */
async function prepareNeedsReviewRetries(
  userDataDir: string,
  items: readonly { id: string }[]
): Promise<void> {
  if (!hasFlag('--retry-needs-review')) return
  const checkpointRoot = join(userDataDir, 'autoshort-checkpoints')
  for (const item of items) {
    const checkpointFile = join(checkpointRoot, item.id, 'checkpoint.json')
    let persisted: Record<string, unknown>
    try {
      persisted = JSON.parse(await readFile(checkpointFile, 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    const assessment = persisted.translationAssessment as { disposition?: unknown } | undefined
    const expectedIdentity = typeof persisted.translationKey === 'string' ? persisted.translationKey : ''
    if (assessment?.disposition !== 'needs-review' || !/^[a-f0-9]{64}$/iu.test(expectedIdentity)) continue
    const retry = await retryAutoShortTranslation({ itemId: item.id, expectedIdentity })
    if (retry.ok) {
      console.log(`[retry] ${item.id} translation retry prepared (generation=${retry.generation ?? '?'})`)
    } else if (!retry.error?.includes('đã được chuẩn bị')) {
      console.warn(`[retry] ${item.id} could not be prepared: ${retry.error || 'unknown error'}`)
    }
  }
}

function dependencySummary(readiness: Awaited<ReturnType<typeof getAutoShortReadiness>>): Record<string, unknown> {
  return {
    ready: readiness.ready,
    method: readiness.method,
    requestedDevice: readiness.requestedDevice,
    effectiveDevice: readiness.effectiveDevice,
    message: readiness.message,
    dependencies: readiness.dependencies.map((item) => ({
      id: item.id,
      ready: item.ready,
      message: item.message
    })),
    model: readiness.model
      ? { id: readiness.model.id, installed: readiness.model.installed, complete: readiness.model.complete, message: readiness.model.message }
      : undefined,
    separation: readiness.separation
      ? { offlineReady: readiness.separation.offlineReady, provider: readiness.separation.effectiveProvider, message: readiness.separation.message }
      : undefined
  }
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString()
  const inputDir = resolve(argValue('--input-dir') || DEFAULT_INPUT_DIR)
  const outputDir = resolve(argValue('--output-dir') || DEFAULT_OUTPUT_DIR)
  const requestedLimit = Number(argValue('--limit') || '0')
  const requestedStart = Number(argValue('--start') || '0')
  const userDataDir = resolve(process.env.TEDIAPROS_USER_DATA || DEFAULT_USER_DATA_DIR)
  await mkdir(userDataDir, { recursive: true })
  app.setName('tedia-pros')
  app.setPath('userData', userDataDir)
  await app.whenReady()

  const env = await readEnvFile()
  const envServerKey = env.api_key_server?.trim() || ''
  const envGeminiKey = env.gemini_api_key?.trim() || ''
  const serverKey = envServerKey || await loadLocalKey()
  const geminiKey = envGeminiKey || await loadKey()
  if (!serverKey) throw new Error('Không tìm thấy api_key_server trong .env hoặc khoá Local AI đã lưu.')
  if (envServerKey) await saveLocalKey(envServerKey)
  if (envGeminiKey) await saveKey(envGeminiKey)

  const allVideos = await enumerateVideos(inputDir)
  if (allVideos.length === 0) throw new Error(`Không tìm thấy MP4 trong ${inputDir}`)
  const start = Number.isInteger(requestedStart) && requestedStart >= 0 ? Math.min(requestedStart, allVideos.length) : 0
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, allVideos.length - start) : allVideos.length - start
  const videos = allVideos.slice(start, start + limit)
  await mkdir(outputDir, { recursive: true })

  const config: AutoShortConfig = {
    subtitleMethod: 'whisper',
    whisperModel: 'small',
    whisperDevice: 'cpu',
    whisperLanguage: 'zh',
    ocrRegion: { x0: 0, y0: 0.72, x1: 1, y1: 0.92 },
    blurRegions: [],
    lamMo: true,
    blurMode: 'ocr-auto',
    ocrBlurProfile: 'accurate',
    subRegion: { x0: 0.08, y0: 0.78, x1: 0.92, y1: 0.90 },
    fontId: null,
    textColor: '#ffffff',
    outlineColor: '#000000',
    outlinePx: 6.5,
    bgEnabled: false,
    bgColor: '#000000',
    bgOpacity: 60,
    subtitleDisplayStyle: 'standard',
    subtitleFontSize: undefined,
    subtitleFontScale: undefined,
    highlightColor: '#43e7d5',
    subtitleHighlightPop: true,
    subtitleLayoutProfile: 'vertical',
    subtitleAutoOptimize: true,
    outlineScale: 6.5 / 1920,
    translateTarget: 'en',
    translateProvider: 'local',
    translateServerUrl: SERVER_URL,
    translationGuidance: undefined,
    videoTitle: { provider: 'gemini', language: 'en' },
    ttsEnabled: true,
    ttsServerUrl: SERVER_URL,
    ttsModel: 'tts-multilingual',
    // The configured clone reference was not present on disk. The server's
    // built-in default voice keeps the run reproducible and still supports en.
    ttsVoice: 'default',
    ttsLanguage: 'en',
    ttsSpeed: 1,
    paceMode: 'source-adaptive',
    voiceOverMode: false,
    audioMode: 'separate-vocals',
    separationPreset: 'balanced',
    originalAudioVolume: 0,
    outputDir,
    executionPolicy: { maxActiveItems: 1, overlapIndependentStages: true, prefetchTts: false, ocrTransport: 'stream-roi' }
  }

  console.log(`[batch] input=${inputDir}`)
  console.log(`[batch] output=${outputDir}`)
  console.log(`[batch] videos=${videos.length}/${allVideos.length}`)
  console.log('[batch] tts voice=default (clone reference file was not found)')

  const readiness = await getAutoShortReadiness(config)
  const localTranslation = await checkLocalTranslateKey(SERVER_URL, serverKey, 'en', 'zh')
  const ttsHealth = await checkTtsServerHealth(SERVER_URL, serverKey)
  const ttsModels = await getTtsModels(SERVER_URL, serverKey)
  const gemini = geminiKey ? await checkKey(geminiKey) : { ok: false, message: 'Thiếu gemini_api_key' }
  console.log(`[preflight] readiness=${readiness.ready ? 'ready' : 'NOT_READY'}${readiness.message ? ` — ${readiness.message}` : ''}`)
  console.log(`[preflight] translation=${localTranslation.ok ? 'ok' : 'FAIL'}${localTranslation.message ? ` — ${localTranslation.message}` : ''}`)
  console.log(`[preflight] tts=${ttsHealth.ok ? 'ok' : 'FAIL'}${ttsHealth.error ? ` — ${ttsHealth.error}` : ''}`)
  console.log(`[preflight] tts-models=${ttsModels.ok ? ttsModels.models.map((model) => model.id).join(', ') : 'FAIL'}`)
  console.log(`[preflight] gemini-title=${gemini.ok ? 'ok' : 'warning'}${gemini.message ? ` — ${gemini.message}` : ''}`)
  if (!readiness.ready || !localTranslation.ok || !ttsHealth.ok || !ttsModels.ok) {
    throw new Error('Preflight chưa sẵn sàng; xem các dòng [preflight] ở trên.')
  }

  const items = videos.map((filePath, index) => ({ id: `video-input-${String(start + index + 1).padStart(2, '0')}`, filePath }))
  await prepareNeedsReviewRetries(userDataDir, items)
  const request: AutoShortStartRequest = { config, items }
  const progressKeys = new Map<string, string>()
  let startedJobId = ''
  const batch = await new Promise<Extract<AutoShortEvent, { type: 'batch-done' }>>((resolveBatch, rejectBatch) => {
    const startResult = startAutoShortJob(request, (event) => {
      if (event.type === 'item-progress') {
        const bucket = Math.floor(event.itemPercent / 5)
        const key = `${event.itemId}:${event.itemStatus}:${bucket}`
        if (progressKeys.get(event.itemId) !== key) {
          progressKeys.set(event.itemId, key)
          console.log(`[progress] ${formatProgress(event)}`)
        }
      } else if (event.type === 'item-done') {
        console.log(`[done] ${event.batchIndex}/${event.batchTotal} ${event.itemId} output=${event.result.outputPath || '(missing)'} title=${event.result.title || '(none)'}${event.result.titleError ? ` titleError=${event.result.titleError}` : ''}`)
      } else if (event.type === 'item-error') {
        console.error(`[error] ${event.batchIndex}/${event.batchTotal} ${event.itemId}: ${event.result.error || 'unknown error'}`)
      } else if (event.type === 'item-cancelled') {
        console.error(`[cancelled] ${event.batchIndex}/${event.batchTotal} ${event.itemId}`)
      } else if (event.type === 'batch-done') {
        resolveBatch(event)
      }
    })
    if (!startResult.ok) {
      rejectBatch(new Error(startResult.error))
      return
    }
    startedJobId = startResult.jobId
    console.log(`[batch] started job=${startedJobId}`)
  })

  const resultChecks: Array<Record<string, unknown>> = []
  for (const result of batch.results as AutoShortItemResult[]) {
    const info = result.outputPath ? await stat(result.outputPath).catch(() => null) : null
    resultChecks.push({
      itemId: result.itemId,
      filePath: result.filePath,
      status: result.status,
      outputPath: result.outputPath,
      outputBytes: info?.isFile() ? info.size : 0,
      outputExists: Boolean(info?.isFile() && info.size > 0),
      title: result.title,
      titlePath: result.titlePath,
      titleError: result.titleError,
      error: result.error
    })
  }
  const outputFiles = await findMp4Files(outputDir)
  const completedWithFiles = resultChecks.filter((item) => item.status === 'done' && item.outputExists === true).length
  const finishedOk = batch.errorCount === 0 && batch.cancelledCount === 0 && batch.completedCount === videos.length && completedWithFiles === videos.length
  const finishedAt = new Date().toISOString()
  const summary = {
    startedAt,
    finishedAt,
    jobId: startedJobId,
    inputDir,
    outputDir,
    requestedVideoCount: videos.length,
    discoveredVideoCount: allVideos.length,
    config: {
      ...config,
      videoTitle: config.videoTitle,
      ttsRefAudioPath: undefined,
      ttsVoice: 'default'
    },
    preflight: {
      readiness: dependencySummary(readiness),
      localTranslation: { ok: localTranslation.ok, message: localTranslation.message },
      ttsHealth: { ok: ttsHealth.ok, status: ttsHealth.status, error: ttsHealth.error },
      ttsModels: ttsModels.models.map((model) => ({ id: model.id, name: model.name, provider: model.provider, available: model.available })),
      geminiTitle: { ok: gemini.ok, message: gemini.message }
    },
    batch: {
      completedCount: batch.completedCount,
      errorCount: batch.errorCount,
      cancelledCount: batch.cancelledCount,
      totalCount: batch.totalCount,
      warningCount: batch.warningCount,
      needsReviewCount: batch.needsReviewCount
    },
    outputFileCount: outputFiles.length,
    outputFiles,
    results: resultChecks,
    ok: finishedOk
  }
  const summaryPath = join(outputDir, '.autoflow-batch-summary.json')
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  console.log(`[batch] summary=${summaryPath}`)
  console.log(`[batch] outputs=${outputFiles.length} completed=${batch.completedCount} errors=${batch.errorCount} cancelled=${batch.cancelledCount}`)
  return finishedOk ? 0 : 1
}

void main()
  .then(async (code) => {
    await app.quit()
    setTimeout(() => { process.exitCode = code }, 100)
  })
  .catch(async (error) => {
    console.error(`[fatal] ${error instanceof Error ? error.message : String(error)}`)
    await app.quit()
    setTimeout(() => { process.exitCode = 1 }, 100)
  })
