import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rephraseDubbingCue, rephraseDubbingCues } from '../../src/main/autoshort'
import { loadLocalKey } from '../../src/main/localTranslate'
import { generateVoiceClone } from '../../src/main/tts'
import { buildDubbingPlan, groupDubbingPlanForSpeech, validateDubbingPlan } from '../../src/main/dubbing/plan'
import { applyDubbingTranslations, dubbingSpeakingDurations } from '../../src/main/dubbing/translation'
import { synthesizeDubbingPlan } from '../../src/main/dubbing/synthesis'
import { buildAutoShortTtsTrimFilter, validateAutoShortTimelineSync } from '../../src/main/autoShortPolicy'
import { serializeSrt } from '../../src/shared/subtitles'

const [profileDir, evidenceDir, realUserData] = process.argv.slice(2)
app.setPath('userData', profileDir)
app.on('window-all-closed', () => {})
const exec = promisify(execFile)
const ids = ['11ed92e2-66c3-4ad8-99fb-b879a14639b1', 'bf03032d-1fc8-4051-8fe9-149fdd31cc7f', '899932d5-067b-4acd-8a8d-89d0bc8fdcf2', 'cecd1b20-843e-4225-ad0b-f152f6dafb99']

async function run() {
  await app.whenReady()
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local regression</title>') })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(5173, 'localhost', resolve) })
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  let settings: any
  try {
    await window.loadURL('http://localhost:5173/')
    settings = await window.webContents.executeJavaScript(`Object.fromEntries([
      'tblao.tts.clonedVoices', 'tblao.autoshort.ttsVoice', 'tblao.autoshort.ttsModel', 'tblao.autoshort.tasks',
      'tblao.ai.serverUrl', 'tblao.autoshort.ttsSpeed', 'tblao.autoshort.paceMode'
    ].map(key => [key, JSON.parse(localStorage.getItem(key) || 'null')]))`)
  } finally { window.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())) }
  const selected = settings['tblao.autoshort.ttsVoice']
  const voice = settings['tblao.tts.clonedVoices']?.find((v: any) => `clone:${v.id}` === selected || v.id === selected)
  if (!voice?.referenceAudioPath) throw new Error('Selected voice not found')
  const endpoint = settings['tblao.ai.serverUrl']
  if (endpoint !== 'http://192.168.1.16:8000') throw new Error('Local endpoint changed')
  const key = await loadLocalKey()
  if (!key) throw new Error('No saved Local key')
  const ffmpeg = join(realUserData, 'bin', 'ffmpeg.exe')
  const ffprobe = join(realUserData, 'bin', 'ffprobe.exe')
  const reference = await readFile(voice.referenceAudioPath)
  const model = settings['tblao.autoshort.ttsModel'] || 'tts-multilingual'
  const config = { translateProvider: 'local', translateServerUrl: endpoint } as any
  const signal = AbortSignal.timeout(90 * 60_000)
  const probe = async (path: string) => Number((await exec(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { windowsHide: true, signal })).stdout.trim())
  const filter = async (path: string, output: string, value: string) => {
    await exec(ffmpeg, ['-y', '-i', path, '-vn', '-ac', '2', '-ar', '44100', '-filter:a', value, output], { windowsHide: true, signal })
    return { path: output, duration: await probe(output) }
  }
  let llm = 0
  const replay = new Map<string, any>()
  if (process.env.TEDIA_LIVE_LLM_REPLAY) {
    for (const file of await readdir(process.env.TEDIA_LIVE_LLM_REPLAY)) {
      if (!/^llm-\d+\.json$/u.test(file)) continue
      const saved = JSON.parse(await readFile(join(process.env.TEDIA_LIVE_LLM_REPLAY, file), 'utf8'))
      if (saved.status === 200) replay.set(JSON.stringify(saved.request), saved.response)
    }
  }
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const cached = String(url).endsWith('/v1/chat/completions') ? replay.get(JSON.stringify(JSON.parse(String(init?.body)))) : undefined
    const response = cached ? new Response(JSON.stringify(cached), { status: 200, headers: { 'Content-Type': 'application/json' } }) : await fetchOriginal(url, init)
    if (String(url).endsWith('/v1/chat/completions')) {
      const n = ++llm
      await writeFile(join(evidenceDir, `llm-${n}.json`), JSON.stringify({ request: JSON.parse(String(init?.body)), status: response.status, replayed: Boolean(cached), response: await response.clone().json() }, null, 2))
      console.log(`GROUP_LIVE llm=${n} status=${response.status} replayed=${Boolean(cached)}`)
    }
    return response
  }
  const report: any = { startedAt: new Date().toISOString(), model, voice: basename(voice.referenceAudioPath), results: [] }
  const cacheDir = process.env.TEDIA_LIVE_AUDIO_CACHE || join(evidenceDir, 'audio-cache')
  await mkdir(cacheDir, { recursive: true })
  for (const id of ids.filter((id) => !process.env.TEDIA_LIVE_CHECKPOINT || id === process.env.TEDIA_LIVE_CHECKPOINT)) {
    const data = JSON.parse(await readFile(join(realUserData, 'autoshort-checkpoints', id, 'checkpoint.json'), 'utf8'))
    const task = settings['tblao.autoshort.tasks']?.find((task: any) => task.id === id)
    if (!task?.filePath) throw new Error(`No source video for checkpoint ${id}`)
    const duration = await probe(task.filePath)
    const dir = join(evidenceDir, id)
    await mkdir(dir, { recursive: true })
    const plan = groupDubbingPlanForSpeech(applyDubbingTranslations(buildDubbingPlan({ videoDuration: duration, paceMode: settings['tblao.autoshort.paceMode'] || 'source-adaptive', cues: data.sourceCues }), data.translatedCues), 'en')
    const windows = dubbingSpeakingDurations(plan.cues.map((cue) => ({ id: cue.id, start: cue.sourceStart, end: cue.sourceEnd, text: cue.sourceText })), duration)
    const record: any = { checkpoint: id, sourceVideo: basename(task.filePath), videoDuration: duration, sourceCues: data.sourceCues.length, units: plan.cues.length, initialPlan: plan, events: [], tts: [] }
    console.log(`GROUP_LIVE START ${id} sources=${data.sourceCues.length} units=${plan.cues.length} shortestWindow=${Math.min(...windows).toFixed(3)}`)
    try {
      const result = await synthesizeDubbingPlan({ plan, language: 'en', model,
        fixedTempo: settings['tblao.autoshort.ttsSpeed'] || 1, localTempoDelta: 0.15, signal,
        rephraseBatch: (requests, s) => rephraseDubbingCues(config, requests, 'en', 'zh', s),
        rephrase: (request, s) => {
          const i = plan.cues.findIndex((cue) => cue.id === request.cueId)
          return rephraseDubbingCue(config, request.cueId, request.currentText, request.targetDuration, 'en', 'zh', s,
            plan.cues[i].sourceText, i ? [plan.cues[i - 1].sourceText] : [], plan.cues[i + 1] ? [plan.cues[i + 1].sourceText] : [], request)
        },
        tts: { synthesize: async (request, s) => {
          const hash = createHash('sha256').update(JSON.stringify([model, reference.toString('base64'), voice.referenceTranscript, request.text])).digest('hex')
          const path = join(cacheDir, `${hash}.wav`)
          const hit = await stat(path).then((st) => st.size > 44).catch(() => false)
          if (!hit) {
            const result = await generateVoiceClone({ serverUrl: endpoint, apiKey: key, model, language: 'en', text: request.text, speed: 1, referenceAudioPath: voice.referenceAudioPath, referenceTranscript: voice.referenceTranscript, referenceAudioBuffer: reference }, s, path)
            if (!result.ok || !result.savedPath) throw new Error(result.error || 'No TTS audio')
          }
          record.tts.push({ cueId: request.cueId, text: request.text, cache: hit, hash })
          console.log(`GROUP_LIVE TTS ${id} cue=${request.cueId} cache=${hit} text=${request.text}`)
          return { path }
        } },
        audio: {
          trim: (path, hint) => filter(path, join(dir, `${hint}.wav`), buildAutoShortTtsTrimFilter()),
          applyTempo: async (path, hint, target) => filter(path, join(dir, `${hint}.wav`), `atempo=${((await probe(path)) / target).toFixed(5)},asetpts=PTS-STARTPTS`)
        },
        onRephrase: (event) => { record.events.push(event); console.log(`GROUP_LIVE ${JSON.stringify(event)}`) },
        onProgress: (done, count, cueId) => console.log(`GROUP_LIVE PROGRESS ${id} ${done}/${count} cue=${cueId}`)
      })
      const validation = validateDubbingPlan(result.plan)
      if (!validation.ok) throw new Error(validation.violations.join('; '))
      const units = result.plan.cues.map((cue) => ({ id: cue.id, timingPolicy: 'source-anchored-v2', sourceCueIds: cue.sourceCueIds,
        sourceStart: cue.sourceStart, sourceEnd: cue.sourceEnd, sourceText: cue.sourceText, translatedText: cue.translatedText,
        finalSpokenText: cue.finalSpokenText, naturalDuration: cue.naturalDuration, finalDuration: cue.actualDuration,
        plannedStart: cue.start, plannedEnd: cue.voiceEnd, tempo: cue.tempo, hardEnd: cue.hardEnd, subtitles: cue.subtitles }))
      const groups = units.map((unit) => ({ id: unit.id, start: unit.sourceStart, end: unit.sourceEnd, text: unit.sourceText }))
      const sync = validateAutoShortTimelineSync(units as any, duration, groups, groups.map((g, i) => ({ ...g, text: units[i].finalSpokenText })))
      if (!sync.ok) throw new Error(sync.violations.join('; '))
      await writeFile(join(dir, 'dubbing-plan.json'), JSON.stringify(result.plan, null, 2))
      await writeFile(join(dir, 'timed.srt'), serializeSrt(result.subtitles))
      record.ok = true; record.metrics = result.metrics; record.validation = validation; record.sync = sync
      record.covered = result.plan.cues.flatMap((cue) => cue.sourceCueIds).length
    } catch (error) { record.ok = false; record.error = String(error) }
    report.results.push(record)
    await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`GROUP_LIVE RESULT ${id} ok=${record.ok} covered=${record.covered} maxTempo=${record.metrics?.maxTempo} error=${record.error || 'none'}`)
  }
  globalThis.fetch = fetchOriginal
  report.finishedAt = new Date().toISOString()
  await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2))
  return report.results.every((result: any) => result.ok) ? 0 : 1
}
run().then((code) => app.exit(code)).catch((error) => { console.error(String(error)); app.exit(1) })
