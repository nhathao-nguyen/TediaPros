import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FacebookReelsLibrary } from '../src/main/facebookReelsLibrary'
import { reuseReelMp4 } from '../src/main/facebookReelsReuse'
import { reelsOutputTemplate } from '../src/shared/facebookReels'

const source = { url: 'https://facebook.com/example.creator', name: 'Example creator' }
test('Reels filenames retain ID even for a title-only preset, preserving export stems', () => {
  assert.equal(reelsOutputTemplate('%(title)s.%(ext)s', '111111'), '%(title)s [%(id)s].%(ext)s')
  assert.equal(reelsOutputTemplate('001_111111.%(ext)s', '111111'), '001_111111.%(ext)s')
  assert.equal(reelsOutputTemplate('%(title)s [%(id)s].%(ext)s', '111111'), '%(title)s [%(id)s].%(ext)s')
})
async function fixture(run: (library: FacebookReelsLibrary, root: string) => Promise<void>): Promise<void> {
  // Windows CI exposes TEMP as RUNNER~1 while containment returns the long
  // canonical path. Compare the same filesystem identity in all assertions.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'reels-library-')))
  try { await run(new FacebookReelsLibrary(join(root, 'state')), root) }
  finally { await rm(root, { recursive: true, force: true }) }
}
test('persists channels, imports ID filenames and preserves history on folder changes/removal', () => fixture(async (library, root) => {
  const folder = join(root, 'videos'); await mkdir(folder)
  await writeFile(join(folder, 'Title [111111].mp4'), 'video')
  await writeFile(join(folder, '001_222222.mp4'), 'video')
  await writeFile(join(folder, 'Title [333333].jpg'), 'thumbnail')
  await writeFile(join(folder, 'Title [444444].mp4.part'), 'partial')
  await writeFile(join(folder, '20261002_Title [555555].mp4'), 'video')
  await writeFile(join(folder, '20261002_Title.mp4'), 'ambiguous date')
  let channels = await library.track(source, folder)
  assert.equal(channels[0].downloaded, 3)
  assert.ok(channels[0].downloadedIds.includes('555555'))
  assert.ok(!channels[0].downloadedIds.includes('20261002'))
  assert.equal(channels[0].url, 'https://www.facebook.com/example.creator/reels/')
  const restored = new FacebookReelsLibrary(join(root, 'state'))
  assert.deepEqual(await restored.list(), channels)
  const next = join(root, 'new'); await mkdir(next)
  channels = await restored.updateFolder(channels[0].url, next)
  assert.equal(channels[0].outputDir, next)
  assert.equal(channels[0].downloaded, 3)
  await restored.remove(channels[0].url)
  assert.deepEqual(await restored.list(), [])
  assert.equal(await readFile(join(folder, 'Title [111111].mp4'), 'utf8'), 'video')
  assert.equal((await restored.existing('111111'))?.file, join(folder, 'Title [111111].mp4'))
}))
test('keeps usable exported copies after the original file is deleted', () => fixture(async (library, root) => {
  const folder = join(root, 'videos'), exported = join(root, 'exported')
  await mkdir(folder); await mkdir(exported)
  const original = join(folder, '111111.mp4'), copy = join(exported, '001_111111.mp4')
  await writeFile(original, 'video'); await library.track(source, folder)
  await writeFile(copy, 'video'); await library.recordCopy('111111', copy, exported)
  await rm(original)
  assert.equal((await library.existing('111111'))?.file, copy)
  assert.equal((await library.list())[0].downloaded, 1)
}))
test('reuse copies MP4 without a download and converts other containers locally', () => fixture(async (_library, root) => {
  const sourceFolder = join(root, 'source'), targetFolder = join(root, 'target')
  await mkdir(sourceFolder); await mkdir(targetFolder)
  const original = join(sourceFolder, '111111.webm'); await writeFile(original, 'webm video')
  let conversions = 0
  const convert = async (input: string, output: string) => { conversions++; assert.equal(input, original); await writeFile(output, 'converted mp4') }
  const signal = new AbortController().signal
  const output = await reuseReelMp4(original, sourceFolder, targetFolder, '001_111111', signal, convert)
  assert.ok(output.endsWith('.mp4')); assert.equal(await readFile(output, 'utf8'), 'converted mp4')
  assert.equal(await readFile(original, 'utf8'), 'webm video'); assert.equal(conversions, 1)
  const second = await reuseReelMp4(output, targetFolder, sourceFolder, '001_111111', signal, convert)
  assert.equal(await readFile(second, 'utf8'), 'converted mp4'); assert.equal(conversions, 1)
  await reuseReelMp4(output, targetFolder, sourceFolder, '001_111111', signal, convert)
  await writeFile(second, 'unrelated existing file')
  await assert.rejects(reuseReelMp4(output, targetFolder, sourceFolder, '001_111111', signal, convert), /khác/)
  await assert.rejects(reuseReelMp4(original, sourceFolder, targetFolder, '../escape', signal, convert))
}))
test('serializes duplicate downloads, records only success and retries deleted files', () => fixture(async (library, root) => {
  const folder = join(root, 'videos'); await mkdir(folder)
  let calls = 0
  const request = { url: 'https://facebook.com/reel/111111/', kind: 'video' as const, outputDir: folder, reelsSource: source }
  const operation = async () => {
    calls++; const file = join(folder, 'reel [111111].mp4'); await writeFile(file, 'video')
    return { ok: true, id: 'job', file, skipped: false, error: null }
  }
  const results = await Promise.all([library.download(request, operation), library.download(request, operation)])
  assert.equal(calls, 1); assert.equal(results.filter(r => r.skipped).length, 1)
  assert.equal((await library.list())[0].downloaded, 1)
  await rm(results[0].file!)
  await library.download(request, operation); assert.equal(calls, 2)
  await library.download({ ...request, url: 'https://facebook.com/reel/222222/' }, async () =>
    ({ ok: false, id: 'failed', file: null, skipped: false, error: 'failed' }))
  assert.equal(await library.existing('222222'), null)
}))
test('rejects invalid sources, relative folders and output files outside the chosen root', () => fixture(async (library, root) => {
  await assert.rejects(library.track({ url: 'https://facebook.com/groups/123456', name: 'bad' }, root))
  await assert.rejects(library.track(source, '../escape'))
  const folder = join(root, 'videos'); await mkdir(folder)
  const foreign = join(root, 'outside.mp4'); await writeFile(foreign, 'video')
  await assert.rejects(library.download({ url: 'https://facebook.com/reel/111111/', kind: 'video', outputDir: folder, reelsSource: source },
    async () => ({ ok: true, id: 'job', file: foreign, skipped: false, error: null })), /ngoài/)
  assert.equal(await library.existing('111111'), null)
}))
test('concurrent successful different IDs cannot lose library updates', () => fixture(async (library, root) => {
  const folder = join(root, 'videos'); await mkdir(folder)
  await Promise.all(['111111', '222222'].map(id => library.download({ url: `https://facebook.com/reel/${id}/`, kind: 'video', outputDir: folder, reelsSource: source }, async () => {
    const file = join(folder, `${id}.mp4`); await writeFile(file, 'video')
    return { ok: true, id, file, skipped: false, error: null }
  })))
  assert.equal((await library.list())[0].downloaded, 2)
}))
test('export/reuse cannot change a manually selected channel folder or name', () => fixture(async (library, root) => {
  const chosen = join(root, 'chosen'), exported = join(root, 'exported')
  await mkdir(chosen); await mkdir(exported)
  await library.track({ ...source, name: 'My custom channel' }, chosen)
  const file = join(exported, '001_111111.mp4'); await writeFile(file, 'video')
  const req = { url: 'https://facebook.com/reel/111111/', kind: 'video' as const, outputDir: exported, reelsSource: source }
  await library.download(req, async () => ({ ok: true, id: 'job', file, skipped: false, error: null }))
  await library.download(req, async () => { throw Error('must reuse') })
  const channel = (await library.list())[0]
  assert.equal(channel.outputDir, chosen); assert.equal(channel.name, 'My custom channel')
}))
test('cancelling while waiting exits promptly but keeps the lock for a third request', { timeout: 2000 }, () => fixture(async (library, root) => {
  const folder = join(root, 'videos'); await mkdir(folder)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const req = { url: 'https://facebook.com/reel/111111/', kind: 'video' as const, outputDir: folder }
  const first = library.download(req, async () => {
    await gate; const file = join(folder, '111111.mp4'); await writeFile(file, 'video')
    return { ok: true, id: 'first', file, skipped: false, error: null }
  })
  const controller = new AbortController()
  const second = library.download(req, async () => { throw Error('must not start') }, controller.signal)
  controller.abort()
  await assert.rejects(second, /hủy/)
  const third = library.download(req, async () => { throw Error('third must reuse') })
  release(); await first; assert.equal((await third).skipped, true)
}))
test('a successful late cancellation preserves video history without resurrecting a removed channel', () => fixture(async (library, root) => {
  const folder = join(root, 'videos'); await mkdir(folder); await library.track(source, folder)
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { started = resolve })
  const controller = new AbortController(), req = { url: 'https://facebook.com/reel/111111/', kind: 'video' as const, outputDir: folder, reelsSource: source }
  const first = library.download(req, async () => {
    started(); await gate; const file = join(folder, '111111.mp4'); await writeFile(file, 'video')
    return { ok: true, id: 'first', file, error: null }
  }, controller.signal)
  await ready; controller.abort(); await assert.rejects(first, /hủy/); await library.remove(source.url)
  // A source-free successor waits until the original operation has recorded its result.
  const settled = library.download({ ...req, reelsSource: undefined }, async () => { throw Error('must reuse') })
  release(); assert.equal((await settled).skipped, true)
  assert.deepEqual(await library.historyIds(), ['111111']); assert.deepEqual(await library.list(), [])
}))
