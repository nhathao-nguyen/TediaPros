import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectEdgeAudio, createMsEdgeTtsTransport, escapeEdgeTtsText, msEdgeTtsTransport, withEdgeDeadline, type EdgeAudioSession, type EdgeTtsTransport } from '../src/main/edgeTtsTransport'
import { generateEdgeTTS, probeEdgeTtsSynthesis } from '../src/main/edgeTts'

function session(chunks: readonly Uint8Array[], delayMs = 0): EdgeAudioSession & { disposed: number } {
  const value = {
    disposed: 0,
    async *audio(): AsyncGenerator<Uint8Array> {
      for (const chunk of chunks) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
        yield chunk
      }
    },
    dispose(): void {
      value.disposed += 1
    }
  }
  return value
}

test('Edge transport escapes XML metacharacters exactly at its SSML input boundary', () => {
  assert.equal(escapeEdgeTtsText(`A & B < C > D "quote" 'single'`), 'A &amp; B &lt; C &gt; D &quot;quote&quot; &apos;single&apos;')
})

test('collecting Edge audio rejects an oversized response and disposes the session once', async () => {
  const active = session([new Uint8Array([1, 2]), new Uint8Array([3, 4])])
  await assert.rejects(collectEdgeAudio(active, new AbortController().signal, 3), /quá giới hạn/u)
  assert.equal(active.disposed, 1)
})

test('collecting Edge audio aborts during streaming and disposes the session once', async () => {
  const controller = new AbortController()
  const active = session([new Uint8Array([1]), new Uint8Array([2])], 15)
  const pending = collectEdgeAudio(active, controller.signal, 10)
  setTimeout(() => controller.abort(), 2)
  await assert.rejects(pending, /hủy/u)
  assert.equal(active.disposed, 1)
})

test('collecting Edge audio interrupts a stream that stops producing chunks', async () => {
  const controller = new AbortController()
  let disposed = 0
  const active: EdgeAudioSession = {
    async *audio(): AsyncGenerator<Uint8Array> {
      await new Promise(() => undefined)
      yield new Uint8Array([1])
    },
    dispose(): void { disposed += 1 }
  }
  const pending = collectEdgeAudio(active, controller.signal, 10)
  controller.abort()
  const outcome = await Promise.race([
    pending.then(() => 'resolved', () => 'rejected'),
    new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 100))
  ])
  assert.equal(outcome, 'rejected')
  assert.equal(disposed, 1)
})

test('collecting Edge audio rejects an empty response', async () => {
  const active = session([])
  await assert.rejects(collectEdgeAudio(active, new AbortController().signal, 10), /không trả về/u)
  assert.equal(active.disposed, 1)
})

test('Edge request validation rejects a foreign model and renderer-owned timeout before networking', async () => {
  const foreignModel = await generateEdgeTTS({ text: 'Xin chào', language: 'vi', model: 'tts-local' })
  assert.equal(foreignModel.ok, false)
  assert.match(foreignModel.error || '', /model edge-tts/u)

  const rendererTimeout = await generateEdgeTTS({
    text: 'Xin chào',
    language: 'vi',
    model: 'edge-tts',
    options: { timeoutMs: 1 }
  })
  assert.equal(rendererTimeout.ok, false)
  assert.match(rendererTimeout.error || '', /không được hỗ trợ/u)
})

test('Edge generation aborts while opening and never publishes a final file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edge-tts-open-abort-'))
  const output = join(root, 'voice.wav')
  const controller = new AbortController()
  let disposed = 0
  const transport: EdgeTtsTransport = {
    open: async (_input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        disposed += 1
        reject(new Error('open aborted'))
      }, { once: true })
    }),
    getVoices: async () => []
  }
  try {
    const pending = generateEdgeTTS(
      { text: 'Xin chào', language: 'vi', model: 'edge-tts' },
      controller.signal,
      output,
      { transport, deadlineMs: 1_000, resolveFfmpeg: async () => 'ffmpeg' }
    )
    controller.abort()
    const result = await pending
    assert.equal(result.ok, false)
    assert.match(result.error || '', /hủy|aborted/u)
    assert.equal(disposed, 1)
    await assert.rejects(stat(output), /ENOENT/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the real Edge transport closes a WebSocket initialized after open was aborted', async () => {
  const controller = new AbortController()
  let releaseMetadata: (() => void) | undefined
  const metadataGate = new Promise<void>((resolve) => { releaseMetadata = resolve })
  let socketOpened = false
  let closesAfterSocketOpened = 0
  const transport = createMsEdgeTtsTransport(() => ({
    async setMetadata(): Promise<void> {
      await metadataGate
      socketOpened = true
    },
    toStream(): never {
      throw new Error('stream must not start after cancellation')
    },
    close(): void {
      if (socketOpened) closesAfterSocketOpened += 1
    }
  }))
  const pending = transport.open({ text: 'Xin chào', voice: 'vi-VN-HoaiMyNeural' }, controller.signal)
  controller.abort()
  await assert.rejects(pending, /hủy/u)
  releaseMetadata!()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(socketOpened, true)
  assert.equal(closesAfterSocketOpened, 1)
})

test('Edge generation enforces its Main-owned deadline while opening', async () => {
  const transport: EdgeTtsTransport = {
    open: async (_input, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('opening stopped')), { once: true })
    }),
    getVoices: async () => []
  }
  const result = await generateEdgeTTS(
    { text: 'Xin chào', language: 'vi', model: 'edge-tts' },
    undefined,
    undefined,
    { transport, deadlineMs: 10, resolveFfmpeg: async () => 'ffmpeg' }
  )
  assert.equal(result.ok, false)
  assert.match(result.error || '', /hết thời gian chờ/u)
})

test('an already-aborted parent signal is propagated into the Edge deadline', async () => {
  const controller = new AbortController()
  controller.abort()
  let observedAborted = false
  await assert.rejects(
    withEdgeDeadline(async (signal) => {
      observedAborted = signal.aborted
      if (signal.aborted) throw new Error('aborted before start')
      return 'unexpected'
    }, controller.signal, 1_000),
    /aborted/u
  )
  assert.equal(observedAborted, true)
})

test('Edge catalog timeout aborts the underlying fetch request', async () => {
  const originalFetch = globalThis.fetch
  let fetchWasAborted = false
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => {
      fetchWasAborted = true
      reject(new Error('catalog fetch aborted'))
    }, { once: true })
  })) as typeof fetch
  try {
    await assert.rejects(
      withEdgeDeadline((signal) => msEdgeTtsTransport.getVoices(signal), undefined, 10),
      /hết thời gian chờ/u
    )
    assert.equal(fetchWasAborted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Edge readiness probes the synthesis transport instead of trusting catalog HTTP alone', async () => {
  let opened = 0
  const transport: EdgeTtsTransport = {
    open: async () => {
      opened += 1
      return session([Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])])
    },
    getVoices: async () => []
  }
  await probeEdgeTtsSynthesis('vi-VN-HoaiMyNeural', undefined, { transport, deadlineMs: 100 })
  assert.equal(opened, 1)
})

test('Edge generation normalizes a fully decoded response to PCM WAV before publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edge-tts-normalize-'))
  const output = join(root, 'voice.wav')
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00])
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(40)])
  const calls: string[][] = []
  const transport: EdgeTtsTransport = {
    open: async () => session([mp3]),
    getVoices: async () => []
  }
  try {
    const result = await generateEdgeTTS(
      { text: 'Xin chào', language: 'vi', model: 'edge-tts' },
      undefined,
      output,
      {
        transport,
        resolveFfmpeg: async () => 'ffmpeg',
        runMedia: async (_command, args) => {
          calls.push(args)
          if (args.includes('pcm_s16le')) {
            await writeFile(args.at(-1)!, wav)
            return { stdout: '', stderr: '' }
          }
          return { stdout: 'duration=1.250000\n', stderr: '' }
        }
      }
    )
    assert.equal(result.ok, true)
    assert.equal(result.audioMimeType, 'audio/wav')
    assert.equal(result.durationMs, 1_250)
    assert.equal((await readFile(output)).subarray(0, 4).toString(), 'RIFF')
    assert.ok(calls.some((args) => args.includes('pcm_s16le')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Edge generation rejects corrupt full decode and cleans partial and final files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edge-tts-corrupt-'))
  const output = join(root, 'voice.wav')
  const transport: EdgeTtsTransport = {
    open: async () => session([Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])]),
    getVoices: async () => []
  }
  try {
    const result = await generateEdgeTTS(
      { text: 'Xin chào', language: 'vi', model: 'edge-tts' },
      undefined,
      output,
      {
        transport,
        resolveFfmpeg: async () => 'ffmpeg',
        runMedia: async () => { throw new Error('invalid compressed audio') }
      }
    )
    assert.equal(result.ok, false)
    assert.match(result.error || '', /invalid compressed audio/u)
    await assert.rejects(stat(output), /ENOENT/u)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancelling after decode prevents final publication and removes scratch files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edge-tts-publish-abort-'))
  const output = join(root, 'voice.wav')
  const controller = new AbortController()
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(40)])
  const transport: EdgeTtsTransport = {
    open: async () => session([Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])]),
    getVoices: async () => []
  }
  try {
    const result = await generateEdgeTTS(
      { text: 'Xin chào', language: 'vi', model: 'edge-tts' },
      controller.signal,
      output,
      {
        transport,
        resolveFfmpeg: async () => 'ffmpeg',
        runMedia: async (_command, args) => {
          if (args.includes('pcm_s16le')) {
            await writeFile(args.at(-1)!, wav)
            controller.abort()
            return { stdout: '', stderr: '' }
          }
          return { stdout: 'duration=1.0\n', stderr: '' }
        }
      }
    )
    assert.equal(result.ok, false)
    assert.match(result.error || '', /hủy/u)
    await assert.rejects(stat(output), /ENOENT/u)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancelling immediately after atomic rename removes the published final file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edge-tts-post-publish-abort-'))
  const output = join(root, 'voice.wav')
  const controller = new AbortController()
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(40)])
  const transport: EdgeTtsTransport = {
    open: async () => session([Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])]),
    getVoices: async () => []
  }
  try {
    const result = await generateEdgeTTS(
      { text: 'Xin chào', language: 'vi', model: 'edge-tts' },
      controller.signal,
      output,
      {
        transport,
        resolveFfmpeg: async () => 'ffmpeg',
        runMedia: async (_command, args) => {
          if (args.includes('pcm_s16le')) {
            await writeFile(args.at(-1)!, wav)
            return { stdout: '', stderr: '' }
          }
          return { stdout: 'duration=1.0\n', stderr: '' }
        },
        afterPublish: () => controller.abort()
      }
    )
    assert.equal(result.ok, false)
    assert.match(result.error || '', /hủy/u)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancelling after the final stat still rolls back the published file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'edge-tts-post-stat-abort-'))
  const output = join(root, 'voice.wav')
  const controller = new AbortController()
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(40)])
  const transport: EdgeTtsTransport = {
    open: async () => session([Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00])]),
    getVoices: async () => []
  }
  try {
    const result = await generateEdgeTTS(
      { text: 'Xin chào', language: 'vi', model: 'edge-tts' },
      controller.signal,
      output,
      {
        transport,
        resolveFfmpeg: async () => 'ffmpeg',
        runMedia: async (_command, args) => {
          if (args.includes('pcm_s16le')) {
            await writeFile(args.at(-1)!, wav)
            return { stdout: '', stderr: '' }
          }
          return { stdout: 'duration=1.0\n', stderr: '' }
        },
        afterFinalStat: () => controller.abort()
      }
    )
    assert.equal(result.ok, false)
    assert.match(result.error || '', /hủy/u)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
