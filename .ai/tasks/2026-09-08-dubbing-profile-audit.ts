import { app, BrowserWindow } from 'electron'
import { createServer } from 'node:http'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadLocalKey } from '../../src/main/localTranslate'
import { getTtsModels } from '../../src/main/tts'
import { durationProfileKey } from '../../src/main/dubbing/durationPredictor'
import { loadDurationProfile } from '../../src/main/dubbing/profileStore'
const [profile, evidence, realUserData] = process.argv.slice(2)
app.setPath('userData', profile)
app.on('window-all-closed', () => {})
async function run() {
  await app.whenReady()
  const server = createServer((_req, res) => res.end('<!doctype html><title>Profile audit</title>'))
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(5173, 'localhost', resolve) })
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  let settings: any
  try {
    await window.loadURL('http://localhost:5173/')
    settings = await window.webContents.executeJavaScript(`Object.fromEntries(['tblao.tts.clonedVoices','tblao.autoshort.ttsVoice','tblao.autoshort.ttsModel','tblao.ai.serverUrl'].map(k=>[k,JSON.parse(localStorage.getItem(k)||'null')]))`)
  } finally { window.destroy(); await new Promise<void>(resolve => server.close(() => resolve())) }
  const selected = settings['tblao.autoshort.ttsVoice']
  const clone = settings['tblao.tts.clonedVoices'].find((v: any) => `clone:${v.id}` === selected || v.id === selected)
  if (!clone) throw new Error('No clone')
  const endpoint = settings['tblao.ai.serverUrl']
  const models = await getTtsModels(endpoint, await loadLocalKey())
  const model = models.models.find(m => m.id === settings['tblao.autoshort.ttsModel'])
  if (!model) throw new Error('No configured model')
  const info = await stat(clone.referenceAudioPath)
  const key = durationProfileKey({ endpoint, model: model.id,
    voice: model.supports_named_voice === false ? undefined : clone.name, language: 'en',
    referenceAudio: { path: clone.referenceAudioPath, size: info.size, mtimeMs: info.mtimeMs } })
  const saved = await loadDurationProfile(join(realUserData, 'autoshort-duration-profiles'), key)
  const result = { checkedAt: new Date().toISOString(), profileKey: key, profileExists: Boolean(saved), samples: saved?.samples ?? 0, supportsNamedVoice: model.supports_named_voice }
  await writeFile(join(evidence, 'profile-audit.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
run().then(() => app.exit(0)).catch(e => { console.error(String(e)); app.exit(1) })
