import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createGeminiGatewayTranslationAdapter } from '../src/main/geminiGateway'
import { loadVoiceMeasurementProfile, voiceMeasurementProfileKey, voicePromptHintFromProfile } from '../src/main/dubbing/voiceMeasurements'
import { EDGE_TTS_ENDPOINT_ID } from '../src/main/edgeTtsIdentity'
import { parseSrt, serializeSrt, type SubtitleCue } from '../src/shared/subtitles'
import type { TranslationInput, TranslationItem } from '../src/shared/translation'

const execFileAsync = promisify(execFile)

type ArmName = 'a-baseline' | 'b-voice-hint'

type ArmResult = {
  status: 'done' | 'failed' | 'resumed'
  outputPath?: string
  auditPath?: string
  cueCount: number
  translatedCueCount: number
  disposition?: string
  languageEvidence?: string
  issueCodes: string[]
  issueCount: number
  semanticReview: 'pending-human'
  estimatedFit: {
    cueCount: number
    fitAt1_10: number
    fitAt1_25: number
    fitAt1_80: number
    overAt1_80: number
    estimatedNaturalSeconds: number
    sourceWindowSeconds: number
  }
  modelIdentity?: string
  budget?: Record<string, unknown>
  error?: string
  elapsedMs: number
}

type VideoResult = {
  index: number
  itemId: string
  sourcePath: string
  sourceSha256: string
  sourceDurationSec: number | null
  sourceSrtPath: string
  arms: Partial<Record<ArmName, ArmResult>>
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.partial`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await writeFile(path, await readFile(temp), 'utf8')
}

async function probeDuration(ffprobe: string, path: string): Promise<number | null> {
  try {
    const result = await execFileAsync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { windowsHide: true, timeout: 30_000 })
    const value = Number(String(result.stdout).trim().split(/\s+/u)[0])
    return Number.isFinite(value) && value > 0 ? Number(value.toFixed(3)) : null
  } catch {
    return null
  }
}

function spokenUnits(text: string, locale = 'vi-VN'): number {
  const normalized = text.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!normalized) return 0
  try {
    const segmenter = new Intl.Segmenter(locale, { granularity: 'word' })
    const count = Array.from(segmenter.segment(normalized)).filter((segment) => segment.isWordLike).length
    if (count > 0) return count
  } catch {
    // Fallback is intentionally conservative and remains a proxy, not syllables.
  }
  return (normalized.match(/[\p{L}\p{N}]+/gu) || []).length
}

function timingEstimate(cues: readonly SubtitleCue[], items: readonly TranslationItem[], rateMedian: number | null): ArmResult['estimatedFit'] {
  const byId = new Map(items.map((item) => [item.id, item.text]))
  const rate = rateMedian && rateMedian > 0 ? rateMedian : 2
  let fitAt1_10 = 0
  let fitAt1_25 = 0
  let fitAt1_80 = 0
  let overAt1_80 = 0
  let estimatedNaturalSeconds = 0
  let sourceWindowSeconds = 0
  for (const cue of cues) {
    const duration = Math.max(0, cue.end - cue.start)
    const estimate = spokenUnits(byId.get(cue.id) || '', 'vi-VN') / rate
    estimatedNaturalSeconds += estimate
    sourceWindowSeconds += duration
    if (estimate <= duration * 1.10) fitAt1_10 += 1
    if (estimate <= duration * 1.25) fitAt1_25 += 1
    if (estimate <= duration * 1.80) fitAt1_80 += 1
    if (estimate > duration * 1.80) overAt1_80 += 1
  }
  const cueCount = cues.length
  return {
    cueCount,
    fitAt1_10,
    fitAt1_25,
    fitAt1_80,
    overAt1_80,
    estimatedNaturalSeconds: Number(estimatedNaturalSeconds.toFixed(3)),
    sourceWindowSeconds: Number(sourceWindowSeconds.toFixed(3))
  }
}

function toInput(cues: readonly SubtitleCue[], sourceDurationSec: number | null): TranslationInput {
  const translated = cues.map((cue, index) => ({
    id: cue.id.trim(),
    sourceIndex: Number.isInteger(cue.sourceIndex) ? cue.sourceIndex! : index,
    start: cue.start,
    end: cue.end,
    text: cue.text,
    groupId: `cue-${Number.isInteger(cue.sourceIndex) ? cue.sourceIndex : index}`
  }))
  return {
    sourceLanguage: 'zh',
    targetLocale: 'vi',
    mode: 'dubbing',
    ...(sourceDurationSec && sourceDurationSec > 0 ? { sourceVideoDuration: sourceDurationSec } : {}),
    cues: translated,
    contextBefore: [],
    contextAfter: [],
    glossary: []
  }
}

async function loadVoiceHint(profileRoot: string): Promise<{ median: number; p10: number; p90: number } | undefined> {
  const profileKey = voiceMeasurementProfileKey({
    endpoint: EDGE_TTS_ENDPOINT_ID,
    model: 'edge-tts',
    voice: 'vi-VN-HoaiMyNeural',
    language: 'vi-VN',
    options: {}
  })
  const profile = await loadVoiceMeasurementProfile(profileRoot, profileKey)
  const hint = voicePromptHintFromProfile(profile, 'vi-VN')
  return hint ? { median: hint.median, p10: hint.p10, p90: hint.p90 } : undefined
}

async function runArm(
  arm: ArmName,
  input: TranslationInput,
  sourceCues: readonly SubtitleCue[],
  videoDir: string,
  serverUrl: string,
  voiceHint: { median: number; p10: number; p90: number } | undefined,
  reviewMode: 'two-pass' | 'draft-only'
): Promise<ArmResult> {
  const started = Date.now()
  const armDir = join(videoDir, arm)
  const outputPath = join(armDir, 'translated.vi.srt')
  const auditPath = join(armDir, 'gateway-audit.json')
  await mkdir(armDir, { recursive: true })
  const rateHint = arm === 'b-voice-hint' && voiceHint
    ? {
        version: 1 as const,
        locale: 'vi-vn',
        metric: 'estimated-spoken-units-per-second' as const,
        normalizerVersion: 'nfc-nfkc-space-v1' as const,
        status: 'advisory' as const,
        eligibleSamples: 8,
        median: voiceHint.median,
        p10: voiceHint.p10,
        p90: voiceHint.p90,
        uncertaintyReasons: ['numbers', 'abbreviations']
      }
    : undefined
  const adapter = createGeminiGatewayTranslationAdapter(serverUrl, {
    auditPath,
    draftDir: join(armDir, 'drafts'),
    voiceHint: rateHint,
    // The live Gateway advertises schema_mode=prompt-only.  Use the
    // line-oriented contract for both arms so A/B isolates the voice hint
    // rather than provider JSON/response_format behaviour.
    outputMode: 'cue-lines-v1',
    // Keep the live evaluation bounded; 512 leaves enough room for a compact
    // cue batch while forcing the planner to split long runs before the model
    // starts dropping IDs or emitting a transient partial response.
    outputTokens: 512,
    stageTimeoutMs: 180_000,
    reviewMode
  })
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('A/B video timeout')), 600_000)
    let result
    try {
      result = await import('../src/main/translation/orchestrator').then(({ translateWithAdapter }) =>
        translateWithAdapter(input, adapter, controller.signal, { requestTimeoutMs: 180_000 }))
    } finally {
      clearTimeout(timer)
    }
    const items = result.items
    const byId = new Map(items.map((item) => [item.id, item.text]))
    const translated = sourceCues
      .filter((cue) => byId.has(cue.id))
      .map((cue) => ({ ...cue, text: byId.get(cue.id) || '' }))
    if (translated.length === sourceCues.length && result.assessment.disposition !== 'needs-review') {
      await writeFile(outputPath, serializeSrt(translated), 'utf8')
    }
    const issueCodes = result.assessment.issues.map((issue) => issue.code)
    return {
      status: translated.length === sourceCues.length && result.assessment.disposition !== 'needs-review' ? 'done' : 'failed',
      ...(translated.length === sourceCues.length && result.assessment.disposition !== 'needs-review' ? { outputPath } : {}),
      auditPath,
      cueCount: sourceCues.length,
      translatedCueCount: translated.length,
      disposition: result.assessment.disposition,
      languageEvidence: result.assessment.languageEvidence,
      issueCodes,
      issueCount: issueCodes.length,
      semanticReview: 'pending-human',
      estimatedFit: timingEstimate(sourceCues, items, voiceHint?.median || null),
      modelIdentity: result.modelIdentity,
      budget: result.budget as unknown as Record<string, unknown> | undefined,
      ...(translated.length === sourceCues.length && result.assessment.disposition !== 'needs-review' ? {} : { error: result.assessment.issues[0]?.message || 'translation incomplete' }),
      elapsedMs: Date.now() - started
    }
  } catch (error) {
    return {
      status: 'failed',
      auditPath,
      cueCount: sourceCues.length,
      translatedCueCount: 0,
      issueCodes: ['provider-protocol'],
      issueCount: 1,
      semanticReview: 'pending-human',
      estimatedFit: timingEstimate(sourceCues, [], voiceHint?.median || null),
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started
    }
  }
}

async function main(): Promise<void> {
  const transcriptRoot = resolve(argument('--transcript-root') || join(process.cwd(), '.ai', 'tasks', '2026-09-16-voice-aware-live-validation', 'full-64', 'transcripts'))
  const outputRoot = resolve(argument('--output-dir') || join(process.cwd(), '.ai', 'tasks', '2026-09-16-voice-aware-live-validation', 'full-64', 'ab'))
  const reportPath = join(transcriptRoot, 'transcription-report.json')
  const serverUrl = (argument('--server-url') || 'http://127.0.0.1:4982/openai/v1').replace(/\/+$/u, '')
  const ffprobe = resolve(argument('--ffprobe') || 'C:\\Users\\PC\\AppData\\Roaming\\tedia-pros\\bin\\ffmpeg\\ffprobe.exe')
  const profileRoot = resolve(argument('--profile-root') || join(process.cwd(), '.ai', 'tasks', '2026-09-16-voice-aware-live-validation', 'edge-voice-calibration', 'profiles'))
  const start = Math.max(0, Number(argument('--start') || '0'))
  const limitArg = Number(argument('--limit') || '0')
  const reviewMode: 'two-pass' | 'draft-only' = process.argv.includes('--single-pass') ? 'draft-only' : 'two-pass'
  const userData = resolve(argument('--user-data') || process.env.TEDIAPROS_USER_DATA || 'C:\\Users\\PC\\AppData\\Roaming\\tedia-pros')
  app.setName('tedia-pros')
  app.setPath('userData', userData)
  const transcription = JSON.parse(await readFile(reportPath, 'utf8')) as { records?: Array<{ index: number; itemId?: string; path: string; srtPath?: string; sha256?: string }> }
  const all = (transcription.records || []).filter((record) => record.srtPath).sort((a, b) => a.index - b.index)
  if (all.length === 0) throw new Error('Không có SRT transcription thành công để chạy A/B.')
  const selected = all.slice(start, limitArg > 0 ? start + limitArg : undefined)
  const existing = await readFile(join(outputRoot, 'ab-report.json'), 'utf8').then((raw) => JSON.parse(raw) as Record<string, unknown>).catch(() => null)
  const results: VideoResult[] = Array.isArray(existing?.videos) ? existing!.videos as VideoResult[] : []
  const byIndex = new Map(results.map((record) => [record.index, record]))
  const voiceHint = await loadVoiceHint(profileRoot)
  await mkdir(outputRoot, { recursive: true })
  const runStarted = new Date().toISOString()
  for (const record of selected) {
    const existingVideo = byIndex.get(record.index)
    if (existingVideo?.arms['a-baseline']?.status === 'done' && existingVideo?.arms['b-voice-hint']?.status === 'done') {
      console.log(`[ab] ${record.index + 1}/${all.length} resumed both arms ${basename(record.path)}`)
      continue
    }
    const raw = await readFile(record.srtPath!, 'utf8')
    const parsed = parseSrt(raw)
    if (parsed.warnings.length > 0 || parsed.cues.length === 0) {
      const failed: VideoResult = {
        index: record.index,
        itemId: record.itemId || `video-input-${String(record.index + 1).padStart(2, '0')}`,
        sourcePath: record.path,
        sourceSha256: record.sha256 || await sha256File(record.path),
        sourceDurationSec: null,
        sourceSrtPath: record.srtPath!,
        arms: {
          'a-baseline': { status: 'failed', cueCount: parsed.cues.length, translatedCueCount: 0, issueCodes: ['invalid-source'], issueCount: 1, semanticReview: 'pending-human', estimatedFit: timingEstimate(parsed.cues, [], voiceHint?.median || null), error: 'SRT parser warning or empty source', elapsedMs: 0 },
          'b-voice-hint': { status: 'failed', cueCount: parsed.cues.length, translatedCueCount: 0, issueCodes: ['invalid-source'], issueCount: 1, semanticReview: 'pending-human', estimatedFit: timingEstimate(parsed.cues, [], voiceHint?.median || null), error: 'SRT parser warning or empty source', elapsedMs: 0 }
        }
      }
      byIndex.set(record.index, failed)
      results.splice(0, results.length, ...[...byIndex.values()].sort((a, b) => a.index - b.index))
      await writeJson(join(outputRoot, 'ab-report.json'), { schemaVersion: 1, kind: 'tediapros-gemini-ab-corpus', runStarted, updatedAtUtc: new Date().toISOString(), serverUrl, transcriptRoot, profileRoot, reviewMode, sourceVideoCount: all.length, selectedVideoCount: selected.length, arms: { baseline: 'a-baseline: cue-lines-v1, no voice hint', candidate: 'b-voice-hint: cue-lines-v1 + advisory vi-VN-HoaiMyNeural profile' }, voiceHint, videos: results })
      continue
    }
    const sourceDurationSec = await probeDuration(ffprobe, record.path)
    const input = toInput(parsed.cues, sourceDurationSec)
    const videoDir = join(outputRoot, `video-${String(record.index + 1).padStart(2, '0')}`)
    console.log(`[ab] ${record.index + 1}/${all.length} sourceCues=${parsed.cues.length} ${basename(record.path)}`)
    const armResults: Partial<Record<ArmName, ArmResult>> = existingVideo?.arms || {}
    if (armResults['a-baseline']?.status !== 'done') {
      console.log(`[ab] ${record.index + 1}/${all.length} arm=a-baseline`)
      armResults['a-baseline'] = await runArm('a-baseline', input, parsed.cues, videoDir, serverUrl, undefined, reviewMode)
      console.log(`[ab] ${record.index + 1}/${all.length} arm=a-baseline ${armResults['a-baseline'].status} fit@1.25=${armResults['a-baseline'].estimatedFit.fitAt1_25}/${parsed.cues.length}`)
    }
    if (armResults['b-voice-hint']?.status !== 'done') {
      console.log(`[ab] ${record.index + 1}/${all.length} arm=b-voice-hint`)
      armResults['b-voice-hint'] = await runArm('b-voice-hint', input, parsed.cues, videoDir, serverUrl, voiceHint, reviewMode)
      console.log(`[ab] ${record.index + 1}/${all.length} arm=b-voice-hint ${armResults['b-voice-hint'].status} fit@1.25=${armResults['b-voice-hint'].estimatedFit.fitAt1_25}/${parsed.cues.length}`)
    }
    const video: VideoResult = {
      index: record.index,
      itemId: record.itemId || `video-input-${String(record.index + 1).padStart(2, '0')}`,
      sourcePath: record.path,
      sourceSha256: record.sha256 || await sha256File(record.path),
      sourceDurationSec,
      sourceSrtPath: record.srtPath!,
      arms: armResults
    }
    byIndex.set(record.index, video)
    results.splice(0, results.length, ...[...byIndex.values()].sort((a, b) => a.index - b.index))
    await writeJson(join(outputRoot, 'ab-report.json'), { schemaVersion: 1, kind: 'tediapros-gemini-ab-corpus', runStarted, updatedAtUtc: new Date().toISOString(), serverUrl, transcriptRoot, profileRoot, reviewMode, sourceVideoCount: all.length, selectedVideoCount: selected.length, arms: { baseline: 'a-baseline: cue-lines-v1, no voice hint', candidate: 'b-voice-hint: cue-lines-v1 + advisory vi-VN-HoaiMyNeural profile' }, voiceHint, videos: results })
  }
  const doneVideos = results.filter((video) => video.arms['a-baseline']?.status === 'done' && video.arms['b-voice-hint']?.status === 'done').length
  const failedArms = results.reduce((sum, video) => sum + Object.values(video.arms).filter((arm) => arm?.status === 'failed').length, 0)
  await writeJson(join(outputRoot, 'ab-report.json'), { schemaVersion: 1, kind: 'tediapros-gemini-ab-corpus', runStarted, finishedAtUtc: new Date().toISOString(), updatedAtUtc: new Date().toISOString(), serverUrl, transcriptRoot, profileRoot, reviewMode, sourceVideoCount: all.length, selectedVideoCount: selected.length, doneVideoCount: doneVideos, failedArmCount: failedArms, semanticReview: 'pending-human', arms: { baseline: 'a-baseline: cue-lines-v1, no voice hint', candidate: 'b-voice-hint: cue-lines-v1 + advisory vi-VN-HoaiMyNeural profile' }, voiceHint, videos: results })
  console.log(JSON.stringify({ reportPath: join(outputRoot, 'ab-report.json'), sourceVideoCount: all.length, selectedVideoCount: selected.length, doneVideoCount: doneVideos, failedArmCount: failedArms }))
  if (doneVideos !== selected.length || failedArms > 0) process.exitCode = 1
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
