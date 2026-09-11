// Bounded live regression: existing Local server, voice and failed source cues.
import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { rephraseDubbingCue, rephraseDubbingCues } from '../../src/main/autoshort'
import { loadLocalKey } from '../../src/main/localTranslate'
import { generateVoiceClone } from '../../src/main/tts'
import { buildDubbingPlan } from '../../src/main/dubbing/plan'
import { applyDubbingTranslations, dubbingSpeakingDurations } from '../../src/main/dubbing/translation'
import { createDurationPredictor } from '../../src/main/dubbing/durationPredictor'
import { synthesizeDubbingPlan } from '../../src/main/dubbing/synthesis'
import { buildAutoShortTtsTrimFilter } from '../../src/main/autoShortPolicy'

const [profileDir, evidenceDir, realUserData] = process.argv.slice(2)
app.setPath('userData', profileDir)
app.on('window-all-closed', () => {})
const exec = promisify(execFile)
const checkpoints = ['11ed92e2-66c3-4ad8-99fb-b879a14639b1', 'bf03032d-1fc8-4051-8fe9-149fdd31cc7f', '899932d5-067b-4acd-8a8d-89d0bc8fdcf2']

async function run() {
  await app.whenReady()
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Local regression</title>') })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(5173, 'localhost', resolve) })
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } })
  let settings: any
  try {
    await window.loadURL('http://localhost:5173/')
    settings = await window.webContents.executeJavaScript(`Object.fromEntries([
      'tblao.tts.clonedVoices', 'tblao.autoshort.ttsVoice', 'tblao.autoshort.ttsModel',
      'tblao.ai.serverUrl', 'tblao.autoshort.ttsSpeed', 'tblao.autoshort.paceMode'
    ].map(key => [key, JSON.parse(localStorage.getItem(key) || 'null')]))`)
  } finally { window.destroy(); await new Promise<void>((resolve) => server.close(() => resolve())) }
  const selected = settings['tblao.autoshort.ttsVoice']
  const voice = settings['tblao.tts.clonedVoices']?.find((v: any) => `clone:${v.id}` === selected || v.id === selected)
  if (!voice?.referenceAudioPath) throw new Error('Cannot resolve selected reference voice from the copied app settings')
  const endpoint = settings['tblao.ai.serverUrl']
  if (endpoint !== 'http://192.168.1.16:8000') throw new Error('Configured endpoint changed; do not run against another server')
  const config = { translateProvider: 'local', translateServerUrl: endpoint } as any
  const key = await loadLocalKey()
  if (!key) throw new Error('Saved Local key could not be decrypted in the isolated test profile')
  const ffmpeg = join(realUserData, 'bin', 'ffmpeg.exe')
  const ffprobe = join(realUserData, 'bin', 'ffprobe.exe')
  const reference = await readFile(voice.referenceAudioPath)
  const model = settings['tblao.autoshort.ttsModel'] || 'tts-multilingual'
  const report: any = { startedAt: new Date().toISOString(), model, reference: basename(voice.referenceAudioPath), results: [] }
  const signal = AbortSignal.timeout(12 * 60_000)
  let llm = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const response = await originalFetch(url, init)
    if (String(url).endsWith('/v1/chat/completions')) {
      const number = ++llm
      await writeFile(join(evidenceDir, `llm-${number}.json`), JSON.stringify({ request: JSON.parse(String(init?.body)), status: response.status, response: await response.clone().json() }, null, 2))
      console.log(`LIVE llm=${number} status=${response.status}`)
    }
    return response
  }
  const probe = async (path: string) => Number((await exec(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path], { windowsHide: true, signal })).stdout.trim())
  const filter = async (path: string, output: string, value: string) => {
    await exec(ffmpeg, ['-y', '-i', path, '-vn', '-ac', '2', '-ar', '44100', '-filter:a', value, output], { windowsHide: true, signal })
    return { path: output, duration: await probe(output) }
  }
  for (const checkpoint of checkpoints.filter((id) => !process.env.TEDIA_LIVE_CHECKPOINT || id === process.env.TEDIA_LIVE_CHECKPOINT)) {
    const data = JSON.parse(await readFile(join(realUserData, 'autoshort-checkpoints', checkpoint, 'checkpoint.json'), 'utf8'))
    const source = data.sourceCues[0]
    const text = data.translatedCues[0].text
    const available = data.sourceCues[1].start - source.start - 0.5
    if (checkpoint === checkpoints[0] && !process.env.TEDIA_LIVE_SKIP_PREFLIGHT) {
      const durations = dubbingSpeakingDurations(data.sourceCues, data.sourceCues.at(-1).end + 0.5)
      const predictor = createDurationPredictor()
      const requests = data.translatedCues.flatMap((cue: any, index: number) => predictor.estimate(cue.text, { locale: 'en' }).seconds > durations[index] * 1.25 ? [{
        cueId: cue.id, currentText: cue.text, targetDuration: durations[index] * 1.1,
        sourceText: data.sourceCues[index].text, contextBefore: index ? [data.sourceCues[index - 1].text] : [], contextAfter: data.sourceCues[index + 1] ? [data.sourceCues[index + 1].text] : []
      }] : []).slice(0, 24)
      const result = await rephraseDubbingCues(config, requests, 'en', 'zh', signal)
      report.preflight = { requested: requests.length, recovered: result.size, items: [...result] }
      console.log(`LIVE preflight recovered=${result.size}/${requests.length}`)
    }
    const plan = applyDubbingTranslations(buildDubbingPlan({ videoDuration: source.start + available + 0.5, paceMode: settings['tblao.autoshort.paceMode'] || 'source-adaptive', cues: [source] }), [{ id: source.id, text }])
    let ttsCalls = 0
    const record: any = { cueId: source.id, source: source.text, original: text, available, events: [], spoken: [], originalAudioReplay: process.env.TEDIA_LIVE_ORIGINAL_EVIDENCE || null }
    try {
      const result = await synthesizeDubbingPlan({
        plan, language: 'en', model, fixedTempo: settings['tblao.autoshort.ttsSpeed'] || 1, localTempoDelta: 0.15, signal,
        rephrase: (request, requestSignal) => rephraseDubbingCue(config, request.cueId, request.currentText, request.targetDuration, 'en', 'zh', requestSignal, source.text, [], [data.sourceCues[1].text], { measuredDuration: request.measuredDuration, maxDuration: request.maxDuration }),
        tts: { synthesize: async (request, requestSignal) => {
          const path = join(evidenceDir, `${source.id}-raw-${++ttsCalls}.wav`)
          record.spoken.push(request.text)
          if (ttsCalls === 1 && process.env.TEDIA_LIVE_ORIGINAL_EVIDENCE) {
            await writeFile(path, await readFile(join(process.env.TEDIA_LIVE_ORIGINAL_EVIDENCE, `${source.id}-raw-1.wav`)))
            console.log(`LIVE cue=${source.id} reusing the recorded original audio; replacements use live TTS`)
            return { path }
          }
          const audio = await generateVoiceClone({ serverUrl: endpoint, apiKey: key, model, language: 'en', text: request.text, speed: 1, referenceAudioPath: voice.referenceAudioPath, referenceTranscript: voice.referenceTranscript, referenceAudioBuffer: reference }, requestSignal, path)
          if (!audio.ok || !audio.savedPath) throw new Error(audio.error || 'No TTS audio')
          console.log(`LIVE cue=${source.id} tts=${ttsCalls} text=${request.text}`)
          return { path: audio.savedPath, voice: audio.voice }
        } },
        audio: {
          trim: (path, hint) => filter(path, join(evidenceDir, `${hint}.wav`), buildAutoShortTtsTrimFilter()),
          applyTempo: async (path, hint, target) => filter(path, join(evidenceDir, `${hint}.wav`), `atempo=${((await probe(path)) / target).toFixed(5)},asetpts=PTS-STARTPTS`)
        },
        onRephrase: (event) => { record.events.push(event); console.log(`LIVE ${JSON.stringify(event)}`) }
      })
      record.ok = true
      record.cue = result.plan.cues[0]
    } catch (error) { record.ok = false; record.error = String(error) }
    report.results.push(record)
    await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`LIVE result cue=${source.id} ok=${record.ok} tempo=${record.cue?.tempo ?? 'none'} error=${record.error || 'none'}`)
  }
  globalThis.fetch = originalFetch
  report.finishedAt = new Date().toISOString()
  await writeFile(join(evidenceDir, 'report.json'), JSON.stringify(report, null, 2))
  return report.results.every((result: any) => result.ok) ? 0 : 1
}
run().then((code) => app.exit(code)).catch((error) => { console.error(String(error)); app.exit(1) })
