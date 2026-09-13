import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TtsCacheStore, buildTtsCacheKey } from '../src/main/dubbing/cache'

function validWavBytes(marker = 0): Buffer {
  const bytes = Buffer.alloc(44)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(36, 4)
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16_000, 24)
  bytes.writeUInt32LE(32_000, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(0, 40)
  bytes[42] = marker
  return bytes
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the cache producer to start')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('TTS cache single-flight commits atomically and never exposes producer temp bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-tts-cache-'))
  try {
    const store = new TtsCacheStore(root)
    let producerCalls = 0
    let resolveProducer: (() => void) | undefined
    const producerGate = new Promise<void>((resolve) => { resolveProducer = resolve })
    const producer = async (_signal: AbortSignal, tempPath: string) => {
      producerCalls++
      await writeFile(tempPath, validWavBytes(0x11))
      await producerGate
      return { path: tempPath, voice: 'voice-a' }
    }

    const first = store.getOrCreate('same-key', new AbortController().signal, producer)
    const second = store.getOrCreate('same-key', new AbortController().signal, producer)
    await waitFor(() => producerCalls === 1)
    assert.equal(producerCalls, 1)
    const cachePath = join(root, 'same-key.wav')
    assert.equal(await stat(cachePath).then(() => true).catch(() => false), false)
    resolveProducer!()
    const [a, b] = await Promise.all([first, second])
    assert.equal(a.path, b.path)
    assert.equal(a.fromCache, false)
    assert.deepEqual(await readFile(cachePath), validWavBytes(0x11))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('TTS cache cancelled waiter does not cancel a producer still serving another waiter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-tts-cache-cancel-'))
  try {
    const store = new TtsCacheStore(root)
    let producerAborted = false
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const producer = async (signal: AbortSignal, tempPath: string) => {
      signal.addEventListener('abort', () => { producerAborted = true }, { once: true })
      await gate
      await writeFile(tempPath, validWavBytes(0x12))
      return { path: tempPath }
    }
    const cancelled = new AbortController()
    const retained = new AbortController()
    const first = store.getOrCreate('cancel-key', cancelled.signal, producer)
    const second = store.getOrCreate('cancel-key', retained.signal, producer)
    cancelled.abort()
    await assert.rejects(first, /hủy|abort/i)
    assert.equal(producerAborted, false)
    release!()
    await second
    assert.equal(producerAborted, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('TTS cache rolls back a new commit when the last waiter cancels during publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-tts-cache-last-cancel-'))
  const controller = new AbortController()
  try {
    const store = new TtsCacheStore(root, { afterCommit: () => controller.abort() })
    const pending = store.getOrCreate('cancelled-commit', controller.signal, async (_signal, tempPath) => {
      await writeFile(tempPath, validWavBytes(0x31))
      return { path: tempPath }
    })
    await assert.rejects(pending, /hủy|abort/i)
    assert.equal(await stat(store.cachePath('cancelled-commit')).then(() => true).catch(() => false), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('TTS cache keeps rollback available while post-commit cleanup is still running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-tts-cache-late-cancel-'))
  const controller = new AbortController()
  try {
    const store = new TtsCacheStore(root, {
      afterCommit: () => { setImmediate(() => controller.abort()) }
    })
    const pending = store.getOrCreate('late-cancelled-commit', controller.signal, async (_signal, tempPath) => {
      await writeFile(tempPath, validWavBytes(0x39))
      return { path: tempPath }
    })
    await assert.rejects(pending, /hủy|abort/i)
    assert.equal(await stat(store.cachePath('late-cancelled-commit')).then(() => true).catch(() => false), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('TTS cache restores a previous entry when a bypass commit is cancelled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-tts-cache-bypass-rollback-'))
  const controller = new AbortController()
  try {
    const cachePath = join(root, 'rollback-key.wav')
    await writeFile(cachePath, validWavBytes(0x41))
    const store = new TtsCacheStore(root, { afterCommit: () => controller.abort() })
    const pending = store.getOrCreate('rollback-key', controller.signal, async (_signal, tempPath) => {
      await writeFile(tempPath, validWavBytes(0x42))
      return { path: tempPath }
    }, { bypass: true })
    await assert.rejects(pending, /hủy|abort/i)
    assert.deepEqual(await readFile(cachePath), validWavBytes(0x41))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('TTS cache key changes when reference content or model revision changes', () => {
  const base = {
    endpoint: 'http://127.0.0.1:8000',
    finalSpokenText: 'same text',
    language: 'vi',
    model: 'model-a',
    voice: 'voice-a',
    contentHash: 'hash-a',
    modelRevision: 'rev-1'
  }
  assert.notEqual(buildTtsCacheKey(base), buildTtsCacheKey({ ...base, contentHash: 'hash-b' }))
  assert.notEqual(buildTtsCacheKey(base), buildTtsCacheKey({ ...base, modelRevision: 'rev-2' }))
})

test('TTS cache treats positive-byte corruption as a miss and bypass replaces the prior entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-tts-cache-repair-'))
  try {
    const store = new TtsCacheStore(root)
    const key = 'repair-key'
    const cachePath = store.cachePath(key)
    await writeFile(cachePath, 'not-audio')
    let producerCalls = 0
    const producer = async (_signal: AbortSignal, tempPath: string) => {
      producerCalls++
      await writeFile(tempPath, validWavBytes(0x21))
      return { path: tempPath }
    }

    const repaired = await store.getOrCreate(key, new AbortController().signal, producer)
    assert.equal(repaired.fromCache, false)
    assert.equal(producerCalls, 1)
    assert.deepEqual(await readFile(cachePath), validWavBytes(0x21))

    const hit = await store.getOrCreate(key, new AbortController().signal, producer)
    assert.equal(hit.fromCache, true)
    assert.equal(producerCalls, 1)

    const bypassed = await store.getOrCreate(key, new AbortController().signal, async (_signal, tempPath) => {
      producerCalls++
      await writeFile(tempPath, validWavBytes(0x22))
      return { path: tempPath }
    }, { bypass: true })
    assert.equal(bypassed.fromCache, false)
    assert.equal(producerCalls, 2)
    assert.deepEqual(await readFile(cachePath), validWavBytes(0x22))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
