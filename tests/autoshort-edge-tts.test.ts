import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildTtsCacheKey, TtsCacheStore } from '../src/main/dubbing/cache'
import { EDGE_TTS_ENDPOINT_ID } from '../src/main/edgeTtsIdentity'
import { generateEdgeTTS, getEdgeTtsModelInfo } from '../src/main/edgeTts'
import type { EdgeTtsTransport } from '../src/main/edgeTtsTransport'

test('Edge cache never aliases Local and changing the Edge voice invalidates it', () => {
  const base = {
    finalSpokenText: 'Hola',
    language: 'es',
    model: 'edge-tts',
    voice: 'es-ES-ElviraNeural',
    serverSpeed: 1
  }
  const local = buildTtsCacheKey({ ...base, endpoint: 'http://127.0.0.1:8000' })
  const edge = buildTtsCacheKey({ ...base, endpoint: EDGE_TTS_ENDPOINT_ID })
  assert.notEqual(edge, local)
  assert.notEqual(edge, buildTtsCacheKey({
    ...base,
    endpoint: EDGE_TTS_ENDPOINT_ID,
    voice: 'es-ES-AlvaroNeural'
  }))
})

test('dynamic Edge catalog capabilities carry dynamic languages into AutoShort model validation', () => {
  const model = getEdgeTtsModelInfo([
    { id: 'cy-GB-NiaNeural', name: 'Nia', gender: 'female', language: 'cy', locale: 'cy-GB' }
  ], 'cy-GB-NiaNeural')
  assert.deepEqual(model.languages, ['cy'])
  assert.deepEqual(model.voices, ['cy-GB-NiaNeural'])
  assert.equal(model.default_voice, 'cy-GB-NiaNeural')
})

test('AutoShort cache publishes decoded PCM WAV and reuses it on resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'autoshort-edge-cache-'))
  const store = new TtsCacheStore(root)
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00])
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(40)])
  let producerCalls = 0
  const transport: EdgeTtsTransport = {
    open: async () => ({
      async *audio() { yield mp3 },
      dispose() {}
    }),
    getVoices: async () => []
  }
  const producer = async (signal: AbortSignal, temporaryPath: string) => {
    producerCalls += 1
    const result = await generateEdgeTTS(
      { text: 'Croeso', language: 'cy-GB', model: 'edge-tts', voice: 'cy-GB-NiaNeural' },
      signal,
      temporaryPath,
      {
        transport,
        voices: [{ id: 'cy-GB-NiaNeural', name: 'Nia', gender: 'female', language: 'cy', locale: 'cy-GB' }],
        resolveFfmpeg: async () => 'ffmpeg',
        runMedia: async (_command, args) => {
          if (args.includes('pcm_s16le')) {
            await writeFile(args.at(-1)!, wav)
            return { stdout: '', stderr: '' }
          }
          return { stdout: 'duration=1.0\n', stderr: '' }
        }
      }
    )
    if (!result.ok || !result.savedPath) throw new Error(result.error || 'missing Edge output')
    return { path: result.savedPath, voice: result.voice }
  }
  try {
    const signal = new AbortController().signal
    const first = await store.getOrCreate('edge-cache-boundary', signal, producer)
    const second = await store.getOrCreate('edge-cache-boundary', signal, producer)
    assert.equal(first.fromCache, false)
    assert.equal(second.fromCache, true)
    assert.equal(producerCalls, 1)
    assert.equal((await readFile(second.path)).subarray(0, 12).toString('ascii', 0, 4), 'RIFF')
    assert.equal((await readFile(second.path)).subarray(8, 12).toString('ascii'), 'WAVE')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
