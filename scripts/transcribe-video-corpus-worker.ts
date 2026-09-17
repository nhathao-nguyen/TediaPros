import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { app } from 'electron'
import { parseSrt } from '../src/shared/subtitles'
import { transcribeAudio, type WhisperProgress } from '../src/main/whisper'

type VideoRecord = {
  index: number
  path: string
  sha256: string
  sizeBytes: number
  status: 'done' | 'failed' | 'resumed'
  outputDir: string
  srtPath?: string
  txtPath?: string
  alignmentPath?: string
  detectedLanguage?: string | null
  segments?: number
  speakers?: number
  warnings?: string[]
  error?: string
  elapsedMs: number
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function writeReport(path: string, report: Record<string, unknown>): Promise<void> {
  const temp = `${path}.partial`
  await writeFile(temp, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(path, await readFile(temp), 'utf8')
}

async function listVideos(root: string): Promise<string[]> {
  const entries = await (await import('node:fs/promises')).readdir(root, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.mp4')
    .map((entry) => join(root, entry.name))
    .sort((left, right) => basename(left).localeCompare(basename(right), 'zh-CN'))
}

function progressLine(progress: WhisperProgress): string {
  const pct = Number.isFinite(progress.percent) && progress.percent >= 0 ? `${progress.percent}%` : '?'
  return `${progress.status} ${pct}${progress.language ? ` lang=${progress.language}` : ''}${progress.line ? ` ${progress.line.replace(/\s+/gu, ' ').slice(0, 100)}` : ''}`
}

async function main(): Promise<void> {
  const inputRoot = resolve(argument('--input-dir') || 'F:\\Son\\test')
  const outputRoot = resolve(argument('--output-dir') || join(process.cwd(), '.ai', 'tasks', '2026-09-16-voice-aware-live-validation', 'full-64', 'transcripts'))
  const userData = resolve(argument('--user-data') || process.env.TEDIAPROS_USER_DATA || 'C:\\Users\\PC\\AppData\\Roaming\\tedia-pros')
  const model = argument('--model') || 'small'
  const device = (argument('--device') || 'cuda') as 'cpu' | 'cuda'
  const language = argument('--language') || 'zh'
  const start = Math.max(0, Number(argument('--start') || '0'))
  const limitArg = Number(argument('--limit') || '0')
  if (!Number.isInteger(start) || start < 0) throw new Error('--start phải là số nguyên >= 0')
  if (device !== 'cpu' && device !== 'cuda') throw new Error('--device chỉ nhận cpu hoặc cuda')
  await mkdir(outputRoot, { recursive: true })

  app.setName('tedia-pros')
  app.setPath('userData', userData)
  const allVideos = await listVideos(inputRoot)
  if (allVideos.length === 0) throw new Error(`Không tìm thấy MP4 trong ${inputRoot}`)
  const end = limitArg > 0 ? Math.min(allVideos.length, start + Math.floor(limitArg)) : allVideos.length
  const videos = allVideos.slice(start, end)
  const reportPath = join(outputRoot, 'transcription-report.json')
  const records: VideoRecord[] = []
  const startedAtUtc = new Date().toISOString()
  const baseReport = {
    schemaVersion: 1,
    kind: 'tediapros-whisper-corpus-transcription',
    startedAtUtc,
    inputRoot,
    outputRoot,
    userData,
    model,
    requestedDevice: device,
    language,
    discoveredVideoCount: allVideos.length,
    requestedVideoCount: videos.length,
    records
  }

  for (let offset = 0; offset < videos.length; offset += 1) {
    const absoluteIndex = start + offset
    const input = videos[offset]!
    const itemId = `video-input-${String(absoluteIndex + 1).padStart(2, '0')}`
    const outputDir = join(outputRoot, itemId)
    await mkdir(outputDir, { recursive: true })
    const expectedSrt = join(outputDir, `${basename(input, extname(input))}.srt`)
    const existing = await stat(expectedSrt).catch(() => null)
    const fileInfo = await stat(input)
    const sha256 = await sha256File(input)
    const itemStarted = Date.now()
    if (existing?.isFile() && existing.size > 0) {
      const parsed = parseSrt(await readFile(expectedSrt, 'utf8'))
      const resumed: VideoRecord = {
        index: absoluteIndex,
        path: input,
        sha256,
        sizeBytes: fileInfo.size,
        status: 'resumed',
        outputDir,
        srtPath: expectedSrt,
        segments: parsed.cues.length,
        warnings: parsed.warnings.map((warning) => warning.message),
        elapsedMs: Date.now() - itemStarted
      }
      records.push(resumed)
      console.log(`[transcribe] ${absoluteIndex + 1}/${allVideos.length} resumed cues=${parsed.cues.length} ${basename(input)}`)
      await writeReport(reportPath, { ...baseReport, updatedAtUtc: new Date().toISOString(), completedCount: records.length, successCount: records.filter((item) => item.status !== 'failed').length, failureCount: records.filter((item) => item.status === 'failed').length })
      continue
    }

    let lastProgress = ''
    const result = await transcribeAudio(itemId, {
      input,
      outputDir,
      model,
      device,
      language,
      task: 'transcribe',
      formats: ['srt', 'txt', 'json'],
      diarize: false,
      speakers: 0
    }, (progress) => {
      const line = progressLine(progress)
      if (line !== lastProgress) {
        lastProgress = line
        console.log(`[transcribe] ${absoluteIndex + 1}/${allVideos.length} ${line}`)
      }
    })

    const srtPath = result.outputs.find((path) => path.toLowerCase().endsWith('.srt'))
    const txtPath = result.outputs.find((path) => path.toLowerCase().endsWith('.txt'))
    const alignmentPath = result.alignmentPath || result.outputs.find((path) => path.toLowerCase().endsWith('.alignment.json'))
    let segments = result.segments
    let warnings: string[] = []
    if (srtPath) {
      const parsed = parseSrt(await readFile(srtPath, 'utf8'))
      segments = parsed.cues.length
      warnings = parsed.warnings.map((warning) => warning.message)
    }
    const record: VideoRecord = {
      index: absoluteIndex,
      path: input,
      sha256,
      sizeBytes: fileInfo.size,
      status: result.ok ? 'done' : 'failed',
      outputDir,
      srtPath,
      txtPath,
      alignmentPath: alignmentPath || undefined,
      detectedLanguage: result.language || null,
      segments,
      speakers: result.speakers,
      warnings,
      error: result.ok ? undefined : result.error,
      elapsedMs: Date.now() - itemStarted
    }
    records.push(record)
    console.log(`[transcribe] ${absoluteIndex + 1}/${allVideos.length} ${record.status} cues=${segments || 0}${record.error ? ` error=${record.error}` : ''}`)
    await writeReport(reportPath, { ...baseReport, updatedAtUtc: new Date().toISOString(), completedCount: records.length, successCount: records.filter((item) => item.status !== 'failed').length, failureCount: records.filter((item) => item.status === 'failed').length })
  }

  const final = {
    ...baseReport,
    finishedAtUtc: new Date().toISOString(),
    completedCount: records.length,
    successCount: records.filter((item) => item.status !== 'failed').length,
    failureCount: records.filter((item) => item.status === 'failed').length,
    outputSrtCount: records.filter((item) => Boolean(item.srtPath)).length
  }
  await writeReport(reportPath, final)
  console.log(JSON.stringify({ reportPath, discoveredVideoCount: allVideos.length, completedCount: records.length, successCount: final.successCount, failureCount: final.failureCount, outputSrtCount: final.outputSrtCount }))
  if (final.failureCount > 0 || records.length !== videos.length) process.exitCode = 1
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
