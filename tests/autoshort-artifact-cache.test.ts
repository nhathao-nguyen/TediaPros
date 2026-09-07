import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AutoShortArtifactCache } from '../src/main/autoShortArtifactCache'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tedia-artifact-cache-'))
  const source = join(root, 'source.wav')
  await writeFile(source, Buffer.from('immutable-audio'))
  return { root, source }
}

test('artifact cache publishes integrity-checked immutable entries and rejects traversal keys', async () => {
  const { root, source } = await fixture()
  try {
    const cache = new AutoShortArtifactCache({ rootDir: join(root, 'cache'), quotaBytes: 1024 })
    await cache.put('trim-pcm', 'a'.repeat(64), source, new AbortController().signal)
    const lease = await cache.get('trim-pcm', 'a'.repeat(64), new AbortController().signal)
    assert.ok(lease)
    assert.equal(await import('node:fs/promises').then((fs) => fs.readFile(lease!.path, 'utf8')), 'immutable-audio')
    lease!.release()

    await assert.rejects(() => cache.get('trim-pcm', '../escape', new AbortController().signal), /key|path|không hợp lệ/iu)
    await assert.rejects(() => cache.put('trim-pcm', 'nested/escape', source, new AbortController().signal), /key|path|không hợp lệ/iu)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('artifact cache ignores corrupt or schema-mismatched manifests and allows concurrent writers to share one entry', async () => {
  const { root, source } = await fixture()
  try {
    const cacheRoot = join(root, 'cache')
    const cache = new AutoShortArtifactCache({ rootDir: cacheRoot, quotaBytes: 1024 })
    const key = 'b'.repeat(64)
    await Promise.all([
      cache.put('asr', key, source, new AbortController().signal),
      cache.put('asr', key, source, new AbortController().signal)
    ])
    const manifestPath = join(cacheRoot, 'asr', key, 'manifest.json')
    const manifest = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(manifestPath, 'utf8')))
    await writeFile(manifestPath, JSON.stringify({ ...manifest, digest: '0'.repeat(64) }))
    assert.equal(await cache.get('asr', key, new AbortController().signal), null)

    await cache.put('asr', key, source, new AbortController().signal)
    const current = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(manifestPath, 'utf8')))
    await writeFile(manifestPath, JSON.stringify({ ...current, schemaVersion: 999 }))
    assert.equal(await cache.get('asr', key, new AbortController().signal), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('artifact cache prune evicts unpinned entries but keeps a pinned reader', async () => {
  const { root } = await fixture()
  const sourceA = join(root, 'a.wav')
  const sourceB = join(root, 'b.wav')
  await writeFile(sourceA, Buffer.from('aaaa'))
  await writeFile(sourceB, Buffer.from('bbbb'))
  try {
    const cache = new AutoShortArtifactCache({ rootDir: join(root, 'cache'), quotaBytes: 8, ttlMs: 0 })
    const signal = new AbortController().signal
    await cache.put('trim-pcm', 'c'.repeat(64), sourceA, signal)
    const pinned = await cache.get('trim-pcm', 'c'.repeat(64), signal)
    assert.ok(pinned)
    await cache.put('trim-pcm', 'd'.repeat(64), sourceB, signal)
    const result = await cache.prune(signal)
    assert.ok(result.removedBytes >= 4)
    assert.ok(await cache.get('trim-pcm', 'c'.repeat(64), signal))
    pinned!.release()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('artifact cache clear preserves pinned readers until their lease is released', async () => {
  const { root, source } = await fixture()
  try {
    const cache = new AutoShortArtifactCache({ rootDir: join(root, 'cache'), quotaBytes: 1024 })
    const key = 'e'.repeat(64)
    const signal = new AbortController().signal
    await cache.put('asr', key, source, signal)
    const pinned = await cache.get('asr', key, signal)
    assert.ok(pinned)
    await cache.clear(signal)
    const stillReadable = await cache.get('asr', key, signal)
    assert.ok(stillReadable)
    stillReadable!.release()
    pinned!.release()
    await cache.clear(signal)
    assert.equal(await cache.get('asr', key, signal), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
