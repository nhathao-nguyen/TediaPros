import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import ExcelJS from 'exceljs'
import { FacebookReelsMonitor, type ReelsMonitorDependencies } from '../src/main/facebookReelsMonitor'
import { FacebookReelsLibrary } from '../src/main/facebookReelsLibrary'
import { ReelsMonitorStore } from '../src/main/facebookReelsMonitorStore'
import { ReelsWorkflowStore } from '../src/main/reelsWorkflowStore'
import { runReelsAutoShort, type ReelsAutoShortEngine } from '../src/main/reelsAutoShortRunner'
import { saveWorkflowAutoShortConfig, getWorkflowAutoShortConfig } from '../src/main/autoShortWorkflowConfig'
import { fetchArticle, findSiblingChapterUrls, parseStoryChapters, type FacebookArticleTransport } from '../src/main/facebookArticle'
import { facebookReelEntry, facebookReelsSource } from '../src/shared/facebookReels'
import type { ReelsWatch } from '../src/shared/facebookReelsMonitor'
import type { AutoShortConfig, AutoShortEvent, AutoShortItemResult } from '../src/shared/types'

const config: AutoShortConfig = { subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu',
  blurRegions: [], lamMo: false, blurMode: 'manual', ocrBlurProfile: 'fast', translateTarget: 'none',
  translateProvider: 'gemini', ttsEnabled: false, voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 20, outputDir: 'C:\\media\\output' }
const source = { url: 'https://facebook.com/workflow.creator', name: 'Workflow' }
const key = facebookReelsSource(source.url)!.key
const entry = (id: string, link = false) => {
  const e = facebookReelEntry(id, `Caption ${id}${link ? '\nhttps://news.example/story' : ''}`, 'graphql')
  e.facebook!.sourceVerified = true
  return e
}
async function fixture(run: (ctx: { root: string; channelRoot: string; watch: ReelsWatch; deps: ReelsMonitorDependencies; monitor: FacebookReelsMonitor; ledger: ReelsWorkflowStore; calls: string[] }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tedia-workflow-')), channelRoot = join(root, 'channel')
  try {
    await mkdir(channelRoot)
    const library = new FacebookReelsLibrary(join(root, 'library')); await library.track(source, channelRoot)
    const store = new ReelsMonitorStore(join(root, 'monitor'))
    const watch: ReelsWatch = { ...source, key, enabled: true, enabledAt: '2026-10-01T00:00:00Z', useCookies: false, account: 'guest', autoExportArticle: true, autoRunAutoShort: true }
    await store.setWatch(watch)
    const calls: string[] = []
    const deps: ReelsMonitorDependencies = { library, now: () => Date.parse('2026-10-13T01:00:00Z'), account: async () => 'guest',
      scan: async () => ({ isPlaylist: true, title: 'Workflow', count: 1, entries: [entry('111111')],
        facebook: { sourceUrl: source.url, completion: 'complete', stopReason: 'end-of-list', discoveredCount: 1, warnings: [] } }),
      download: async (e, _c, _w, _s, dir, stem) => { calls.push(e.id); const file = join(dir!, `${stem}.mp4`); await writeFile(file, 'fixture video'); return { ok: true, id: e.id, file, skipped: false, error: null } },
      runAutoShort: async (paths, out) => Promise.all(paths.map(async filePath => { const outputPath = join(out, `done-${filePath.split(/[\\/]/).pop()}`); await writeFile(outputPath, 'fixture output'); return { itemId: filePath, filePath, status: 'done' as const, outputPath } })) }
    const monitor = new FacebookReelsMonitor(store, deps), ledger = new ReelsWorkflowStore(channelRoot, key)
    await run({ root, channelRoot, watch, deps, monitor, ledger, calls })
    await monitor.stop()
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('processes over 100 videos independently of notice cap and uses actual crawl date during catch-up', () => fixture(async ({ deps, monitor, ledger }) => {
  deps.scan = async () => ({ isPlaylist: true, title: 'Workflow', count: 101, entries: Array.from({ length: 101 }, (_, i) => entry(String(111111 + i))),
    facebook: { sourceUrl: source.url, completion: 'complete', stopReason: 'end-of-list', discoveredCount: 101, warnings: [] } })
  await monitor.tick()
  const notice = (await monitor.state()).notices[0]
  assert.equal(notice.status, 'success'); assert.equal(notice.downloaded, 101); assert.equal(notice.videos.length, 100)
  assert.equal(notice.autoShortProcessed, 101)
  assert.ok((await ledger.read()).every(i => i.day === '2026-10-13' && i.autoshort === 'done' && i.outputPath && i.configRevision === undefined))
  assert.ok(notice.outputDir.endsWith('2026-10-13'))
}))

test('mixed AutoShort results remain partial and retry only failed work without downloading again', () => fixture(async ({ deps, monitor, ledger, calls }) => {
  const original = deps.scan
  deps.scan = async (watch, signal) => { const scanned = await original(watch, signal); scanned.entries = [entry('111111'), entry('222222')]; return scanned }
  deps.runAutoShort = async (paths, out) => Promise.all(paths.map(async (filePath, i) => {
    if (i === 0) return { itemId: filePath, filePath, status: 'error' as const, error: 'encoder failed' }
    const outputPath = join(out, 'second.mp4'); await writeFile(outputPath, 'output')
    return { itemId: filePath, filePath, status: 'done' as const, outputPath }
  }))
  await monitor.tick(key)
  let notice = (await monitor.state()).notices[0]
  assert.equal(notice.status, 'partial'); assert.equal(notice.autoShortProcessed, 1); assert.equal(notice.autoShortFailed, 1)
  deps.runAutoShort = async (paths, out) => { assert.equal(paths.length, 1); return Promise.all(paths.map(async filePath => { const outputPath = join(out, 'success.mp4'); await writeFile(outputPath, 'output'); return { itemId: filePath, filePath, status: 'done' as const, outputPath } })) }
  await monitor.tick(key)
  notice = (await monitor.state()).notices[0]
  assert.equal(notice.status, 'success'); assert.equal(notice.autoShortProcessed, 1); assert.deepEqual(calls, ['111111','222222'])
  assert.equal((await ledger.read())[0].autoshort, 'done')
}))

test('oversized discovery reports a limit without corrupting persisted notices or starting downloads', () => fixture(async ({ deps, monitor, calls }) => {
  const original = deps.scan
  deps.scan = async (w, s) => { const result = await original(w, s); result.entries = Array.from({ length: 10001 }, (_, i) => entry(String(111111 + i))); return result }
  await monitor.tick(key)
  const notice = (await monitor.state()).notices[0]
  assert.equal(notice.status, 'error'); assert.match(notice.message, /10.000/); assert.equal(notice.found, 0); assert.equal(calls.length, 0)
}))

test('article failure recovers after restart; same-day workbook retains old rows and chapter TXT', () => fixture(async ({ deps, monitor, ledger, root, calls }) => {
  const scan = deps.scan
  deps.scan = async (w, s) => { const p = await scan(w, s); p.entries = [entry('111111', true)]; return p }
  deps.fetchArticle = async () => { throw Error('network down') }
  await monitor.tick(key); assert.equal((await monitor.state()).notices[0].status, 'partial')
  deps.fetchArticle = async () => ({ url: 'https://news.example/story', title: 'Story', content: 'Complete story', status: 'success', completion: 'complete', stopReason: 'end-of-story', chapters: [{ index: 1, title: 'Chapter 1', content: 'Complete story', wordCount: 2 }] })
  deps.scan = async (w, s) => { const p = await scan(w, s); p.entries = [entry('111111', true), entry('222222')]; return p }
  const restarted = new FacebookReelsMonitor(new ReelsMonitorStore(join(root, 'monitor')), deps)
  await restarted.initialize(); await restarted.tick(key)
  const items = await ledger.read(); assert.equal(items.length, 2); assert.equal(items[0].article, 'done'); assert.deepEqual(calls, ['111111','222222'])
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(join(ledger.root, '2026-10-13', 'excel', 'reels_content.xlsx'))
  assert.equal(wb.worksheets[0].rowCount, 3)
  assert.match(await readFile(join(ledger.root, '2026-10-13', 'article', `${items[0].stem}_chapters`, 'chapter_01.txt'), 'utf8'), /Complete story/)
  await restarted.stop()
}))

test('caption and workbook export remain enabled when article and AutoShort are both off', () => fixture(async ({ monitor, watch, ledger }) => {
  await monitor.store.setWatch({ ...watch, autoExportArticle: false, autoRunAutoShort: false }); await monitor.tick(key)
  const item = (await ledger.read())[0]
  assert.equal(item.article, 'disabled'); assert.equal(item.autoshort, 'disabled'); assert.equal(item.caption, 'done'); assert.equal(item.excel, 'done')
  assert.match(await readFile(item.captionPath!, 'utf8'), /Caption/)
}))

test('Excel write failure is durable and retries even when no new Reel is discovered', () => fixture(async ({ monitor, ledger }) => {
  const dirs = await ledger.directories('2026-10-13'), target = join(dirs.excel, 'reels_content.xlsx')
  await mkdir(target); await monitor.tick(key)
  assert.equal((await monitor.state()).notices[0].status, 'partial'); assert.equal((await ledger.read())[0].excel, 'error')
  await rmdir(target); await monitor.tick(key)
  assert.equal((await ledger.read())[0].excel, 'done'); assert.equal((await monitor.state()).notices[0].status, 'success')
}))

test('reconciles committed core output after a crash instead of rendering it again', () => fixture(async ({ monitor, ledger, deps }) => {
  await monitor.tick(key)
  const items = await ledger.read(); items[0].autoshort = 'running'; items[0].jobId = 'crashed-job'; items[0].outputPath = undefined
  await ledger.save(items)
  const out = join(ledger.root, '2026-10-13', 'autoshort', 'committed.mp4'); await writeFile(out, 'core receipt')
  deps.recoverAutoShort = async jobId => { assert.equal(jobId, 'crashed-job'); return [{ itemId: 'recovered', filePath: items[0].file!, status: 'done', outputPath: out }] }
  deps.runAutoShort = async () => { throw Error('must not render twice') }
  await monitor.tick(key); assert.equal((await ledger.read())[0].outputPath, out); assert.equal((await monitor.state()).notices[0].status, 'success')
}))

test('snapshot updates preserve off toggles, serialize writes, block invalid edits and survive reload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-snapshot-')), previous = process.env.TEDIAPROS_TEST_USER_DATA
  process.env.TEDIAPROS_TEST_USER_DATA = root
  try {
    await assert.rejects(getWorkflowAutoShortConfig(root), /AutoShort/)
    await Promise.all([saveWorkflowAutoShortConfig({ ...config, lamMo: true }), saveWorkflowAutoShortConfig(config)])
    let saved = await getWorkflowAutoShortConfig(root)
    assert.equal(saved.lamMo, false); assert.equal(saved.ttsEnabled, false); assert.equal(saved.translateTarget, 'none')
    await assert.rejects(saveWorkflowAutoShortConfig({ ...config, ttsEnabled: 'false' }), /bật\/tắt/)
    await assert.rejects(getWorkflowAutoShortConfig(root), /cần sửa/)
    await saveWorkflowAutoShortConfig(config)
    await assert.rejects(saveWorkflowAutoShortConfig(config, 'Glossary không hợp lệ'), /Glossary/)
    await assert.rejects(getWorkflowAutoShortConfig(root), /Glossary/)
    await saveWorkflowAutoShortConfig(config)
    // Legacy plain snapshots migrate through the same validation.
    await writeFile(join(root, 'autoshort-workflow-config.json'), JSON.stringify(config))
    saved = await getWorkflowAutoShortConfig(root); assert.equal(saved.blurMode, 'manual')
    await rm(join(root, 'autoshort-workflow-config.json')); await mkdir(join(root, 'autoshort-workflow-config.json'))
    await assert.rejects(saveWorkflowAutoShortConfig(config), /file thông thường/)
    await assert.rejects(getWorkflowAutoShortConfig(root), /lưu lại/)
  } finally { if (previous === undefined) delete process.env.TEDIAPROS_TEST_USER_DATA; else process.env.TEDIAPROS_TEST_USER_DATA = previous; await rm(root, { recursive: true, force: true }) }
})

test('runner binds abort to its owned job, joins cancellation and keeps real result statuses', async () => {
  const controller = new AbortController()
  let emit!: (event: AutoShortEvent) => void, input = '', ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  const engine: ReelsAutoShortEngine = { start: (request, callback) => { input = request.items[0].filePath; emit = callback; return { ok: true, jobId: 'owned-job' } }, cancel: async jobId => {
    assert.equal(jobId, 'owned-job')
    const result: AutoShortItemResult = { itemId: 'id', filePath: input, status: 'cancelled', error: 'cancelled' }
    emit({ type: 'item-cancelled', jobId, itemId: 'id', batchIndex: 1, batchTotal: 1, result: result as AutoShortItemResult & { status: 'cancelled' } })
    emit({ type: 'batch-done', jobId, completedCount: 0, errorCount: 0, cancelledCount: 1, totalCount: 1, results: [result] })
  } }
  const calls: string[] = []
  const running = runReelsAutoShort(['C:\\media\\video.mp4'], config, controller.signal, engine, undefined, {
    started: async (_job, revision) => { assert.match(revision, /^[a-f0-9]{64}$/); calls.push('started'); ready() }, result: async result => { calls.push(result.status) }
  })
  await started; controller.abort()
  assert.equal((await running)[0].status, 'cancelled'); assert.deepEqual(calls, ['started','cancelled'])
  await assert.rejects(runReelsAutoShort(['C:\\media\\a.mp4'], config, controller.signal, engine), /abort/i)
  await assert.rejects(runReelsAutoShort(['C:\\media\\a.mp4'], config, new AbortController().signal, { ...engine, start: () => ({ ok: false, error: 'busy' }) }), /busy/)
})

test('runReelsAutoShort reports progress accurately without formatting undefined%', async () => {
  let emit!: (event: AutoShortEvent) => void
  const engine: ReelsAutoShortEngine = {
    start: (_req, callback) => {
      emit = callback
      return { ok: true, jobId: 'progress-job' }
    },
    cancel: async () => {}
  }
  const progressCalls: Array<{ index: number; total: number; message: string }> = []
  const running = runReelsAutoShort(
    ['C:\\media\\a.mp4', 'C:\\media\\b.mp4'],
    config,
    new AbortController().signal,
    engine,
    p => progressCalls.push(p)
  )

  emit({
    type: 'item-progress',
    jobId: 'progress-job',
    taskId: 'item-1',
    itemId: 'item-1',
    itemStatus: 'extracting_sub',
    itemPercent: 25,
    itemMessage: 'Đang quét chữ trong video…',
    batchIndex: 1,
    batchTotal: 2
  })

  emit({
    type: 'item-progress',
    jobId: 'progress-job',
    taskId: 'item-1',
    itemId: 'item-1',
    itemStatus: 'extracting_sub',
    itemPercent: 50,
    itemMessage: '',
    batchIndex: 1,
    batchTotal: 2
  })

  emit({
    type: 'item-done',
    jobId: 'progress-job',
    itemId: 'item-1',
    batchIndex: 1,
    batchTotal: 2,
    result: { itemId: 'item-1', filePath: 'C:\\media\\a.mp4', status: 'done', outputPath: 'C:\\media\\out-a.mp4' }
  })

  emit({
    type: 'item-progress',
    jobId: 'progress-job',
    taskId: 'item-2',
    itemId: 'item-2',
    itemStatus: 'rendering_video',
    itemPercent: 80,
    itemMessage: 'Đang xuất video… 80%',
    batchIndex: 2,
    batchTotal: 2
  })

  const results: AutoShortItemResult[] = [
    { itemId: 'item-1', filePath: 'C:\\media\\a.mp4', status: 'done', outputPath: 'C:\\media\\out-a.mp4' },
    { itemId: 'item-2', filePath: 'C:\\media\\b.mp4', status: 'done', outputPath: 'C:\\media\\out-b.mp4' }
  ]
  emit({
    type: 'item-done',
    jobId: 'progress-job',
    itemId: 'item-2',
    batchIndex: 2,
    batchTotal: 2,
    result: { itemId: 'item-2', filePath: 'C:\\media\\b.mp4', status: 'done', outputPath: 'C:\\media\\out-b.mp4' }
  })
  emit({
    type: 'batch-done',
    jobId: 'progress-job',
    completedCount: 2,
    errorCount: 0,
    cancelledCount: 0,
    totalCount: 2,
    results
  })

  await running
  assert.deepEqual(progressCalls, [
    { index: 1, total: 2, message: 'Đang quét chữ trong video…' },
    { index: 1, total: 2, message: 'Đang xử lý 50%' },
    { index: 1, total: 2, message: 'Đã xuất video' },
    { index: 2, total: 2, message: 'Đang xuất video… 80%' },
    { index: 2, total: 2, message: 'Đã xuất video' }
  ])
})

test('cancelAndWait joins the real runner adapter and persists cancellation in the ledger', () => fixture(async ({ monitor, deps, ledger }) => {
  let ready!: () => void
  const started = new Promise<void>(resolve => { ready = resolve })
  deps.runAutoShort = (paths, out, signal, progress, hooks) => {
    let emit!: (event: AutoShortEvent) => void
    const engine: ReelsAutoShortEngine = {
      start: (_request, callback) => { emit = callback; return { ok: true, jobId: 'monitor-owned' } },
      cancel: async jobId => {
        const result: AutoShortItemResult & { status: 'cancelled' } = { itemId: 'item', filePath: paths[0], status: 'cancelled' }
        emit({ type: 'item-cancelled', jobId, itemId: 'item', batchIndex: 1, batchTotal: 1, result })
        emit({ type: 'batch-done', jobId, completedCount: 0, errorCount: 0, cancelledCount: 1, totalCount: 1, results: [result] })
      }
    }
    return runReelsAutoShort(paths, { ...config, outputDir: out }, signal, engine, progress, {
      ...hooks, started: async (id, revision) => { await hooks?.started?.(id, revision); ready() }
    })
  }
  const running = monitor.tick(key)
  await started; await monitor.cancelAndWait(key); await running
  assert.equal((await monitor.state()).notices[0].status, 'cancelled')
  assert.equal((await ledger.read())[0].autoshort, 'cancelled')
}))

test('ledger rejects altered external file paths and mismatched Reel URLs', () => fixture(async ({ monitor, ledger, root }) => {
  await monitor.tick(key)
  const items = await ledger.read(); items[0].file = join(root, 'outside.mp4'); await ledger.save(items)
  await assert.rejects(ledger.read(), /ngoài/)
  items[0].file = join(ledger.root, 'video.mp4'); items[0].entry.url = 'https://facebook.com/reel/999999'; await ledger.save(items)
  await assert.rejects(ledger.read(), /không hợp lệ/)
}))

test('inline chapter numbers remain intact and an introduction does not overwrite chapter one', async () => {
  const inline = parseStoryChapters('Intro words\n\nChapter 1\n\nFirst chapter\n\nChapter 2\n\nSecond chapter')
  assert.deepEqual(inline.map(ch => ch.index), [1, 2]); assert.match(inline[0].content, /Intro words/)
  const url = 'https://news.example/story'
  const result = await fetchArticle(url, new AbortController().signal, transportFor({ [url]: html(3) }))
  assert.equal(result.chapters?.[0].index, 3); assert.equal(result.completion, 'partial')
})

const html = (chapter: number, links = '') => `<html><head><title>Chapter ${chapter}</title></head><body><article><h1>Chapter ${chapter}</h1>${Array.from({ length: 5 }, (_, i) => `<p>Chapter ${chapter} paragraph ${i}. ${'The story continues with clear details and conversation. '.repeat(10)}</p>`).join('')}</article>${links}</body></html>`
function transportFor(pages: Record<string, string | Error>): FacebookArticleTransport {
  return { resolveHost: async () => [{ address: '8.8.8.8', family: 4 }], request: (url, _options, receive) => {
    const req = Object.assign(new EventEmitter(), { end() { queueMicrotask(() => {
      const page = pages[url.href]
      if (!page || page instanceof Error) { req.emit('error', page || Error('404')); return }
      const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, resume() {}, destroy() {} })
      receive(res as never); res.emit('data', Buffer.from(page)); res.emit('end')
    }) }, destroy() {} })
    return req as never
  } }
}
test('chapter discovery rejects unrelated stories in the same category or TOC', () => {
  const result = findSiblingChapterUrls('<div class="toc"><a href="/stories/other/chapter-2">Chapter 2</a><a href="/stories/ours/chapter-2">Chapter 2</a></div>', 'https://news.example/stories/ours/chapter-1')
  assert.deepEqual(result.map(i => i.url), ['https://news.example/stories/ours/chapter-2'])
})
test('follows Next-only navigation and retains true starting chapter number', async () => {
  const one = 'https://news.example/story?page=1', two = 'https://news.example/story?page=2'
  const result = await fetchArticle(one, new AbortController().signal, transportFor({ [one]: html(1, `<a rel="next" href="${two}">Next</a>`), [two]: html(2) }))
  assert.equal(result.chapters?.length, 2); assert.equal(result.completion, 'complete')
  const three = 'https://news.example/ours/chapter-3'
  const partial = await fetchArticle(three, new AbortController().signal, transportFor({ [three]: html(3) }))
  assert.equal(partial.chapters?.[0].index, 3); assert.equal(partial.completion, 'partial'); assert.equal(partial.stopReason, 'started-after-first')
})
test('chapter network errors and chapter cap return partial rather than false success', async () => {
  const base = 'https://news.example/ours/chapter-'
  let result = await fetchArticle(base + '1', new AbortController().signal, transportFor({ [base + '1']: html(1, '<a href="chapter-2" rel="next">Next</a>'), [base + '2']: Error('network') }))
  assert.equal(result.completion, 'partial'); assert.equal(result.stopReason, 'request-error')
  const pages = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [base + (i + 1), html(i + 1, `<a rel="next" href="chapter-${i + 2}">Next</a>`)]))
  result = await fetchArticle(base + '1', new AbortController().signal, transportFor(pages))
  assert.equal(result.chapters?.length, 25); assert.equal(result.completion, 'partial'); assert.equal(result.stopReason, 'chapter-limit')
})
