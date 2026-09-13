import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { isTrustedIpcSender, isTrustedRendererUrl } from '../src/main/ipcSecurity'

test('IPC origin accepts only the configured dev renderer origin', () => {
  const options = { packaged: false, devOrigin: 'http://localhost:5173/' }
  assert.equal(isTrustedRendererUrl('http://localhost:5173/index.html', options), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5174/index.html', options), false)
  assert.equal(isTrustedRendererUrl('file:///tmp/index.html', options), false)
  assert.equal(isTrustedRendererUrl('http://localhost:5173.evil.example/', options), false)
})

test('packaged IPC accepts file renderer and rejects a child/untrusted origin', () => {
  const options = { packaged: true, devOrigin: undefined }
  assert.equal(isTrustedRendererUrl('file:///C:/Program%20Files/TediaPros/index.html', options), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/', options), false)
  assert.equal(isTrustedIpcSender({ senderFrame: { url: 'file:///C:/app/index.html' } }, options), true)
  assert.equal(isTrustedIpcSender({ senderFrame: { url: 'file:///C:/app/index.html', parent: {} } }, options), false)
  assert.equal(isTrustedIpcSender({ senderFrame: { url: 'https://evil.example/' } }, options), false)
})

test('IPC falls back to sender URL only when a sender frame URL is unavailable', () => {
  const options = { packaged: false, devOrigin: 'http://127.0.0.1:3000' }
  assert.equal(isTrustedIpcSender({ sender: { getURL: () => 'http://127.0.0.1:3000/' } }, options), true)
  assert.equal(isTrustedIpcSender({ senderFrame: { url: 'https://evil.example/' }, sender: { getURL: () => 'http://127.0.0.1:3000/' } }, options), false)
})

test('AutoShort filesystem/process IPC and app navigation use the origin gate', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  for (const channel of [
    'autoshort:selectVideos',
    'autoshort:selectMusicFolder',
    'autoshort:listMusicTracks',
    'autoshort:getReadiness',
    'whisper:modelStatus',
    'gemini:listKeys',
    'gemini:addKeys',
    'gemini:replaceKeys',
    'gemini:removeKey',
    'whisper:installModel',
    'whisper:stopWorker',
    'tts:checkHealth',
    'tts:getModels',
    'tts:generateSpeech',
    'tts:generateClone',
    'tts:saveAudio',
    'tts:selectRefAudio',
    'tts:getEdgeVoices'
  ]) {
    assert.match(
      source,
      new RegExp(`${channel.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}[\\s\\S]{0,240}rejectUntrustedAutoShortIpc`, 'u')
    )
  }
  assert.match(source, /webContents\.on\('will-navigate', rejectUntrustedNavigation\)/u)
  assert.match(source, /webContents\.on\('will-redirect', rejectUntrustedNavigation\)/u)
})
