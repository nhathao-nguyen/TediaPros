import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FacebookReelsLibrary } from '../src/main/facebookReelsLibrary'
import { ReelsMonitorStore } from '../src/main/facebookReelsMonitorStore'
import { FacebookReelsMonitor, type ReelsMonitorDependencies } from '../src/main/facebookReelsMonitor'
import { facebookReelEntry, facebookReelsSource } from '../src/shared/facebookReels'
import { reelsDueDay, reelsWatchDue, validateReelsMonitorTime, type ReelsWatch } from '../src/shared/facebookReelsMonitor'

const source = { url: 'https://facebook.com/example.creator', name: 'My channel' }
const watch: ReelsWatch = { ...source, key: facebookReelsSource(source.url)!.key, enabled: true,
  enabledAt: '2026-10-01T01:00:00Z', useCookies: false, account: 'guest' }
const at = (time: string): number => Date.parse(time)
test('daily slots respect 09:00 Vietnam, midnight, offline catch-up and no duplicate due day', () => {
  assert.equal(reelsDueDay(at('2026-10-02T01:59:59Z'), '09:00'), '2026-10-01')
  assert.equal(reelsDueDay(at('2026-10-02T02:00:00Z'), '09:00'), '2026-10-02')
  assert.equal(reelsDueDay(at('2026-10-02T17:00:00Z'), '09:00'), '2026-10-02')
  assert.equal(reelsWatchDue({ ...watch, lastDay: '2026-10-02' }, at('2026-10-02T12:00:00Z'), '09:00'), false)
  assert.equal(reelsWatchDue({ ...watch, lastDay: '2026-09-20' }, at('2026-10-02T01:00:00Z'), '09:00'), true)
  assert.equal(reelsWatchDue({ ...watch, enabledAt: '2026-10-02T01:00:00Z' }, at('2026-10-02T01:30:00Z'), '09:00'), false)
})
async function fixture(run: (ctx: { library: FacebookReelsLibrary; store: ReelsMonitorStore; deps: ReelsMonitorDependencies; now: { value: number }; calls: { scans: number; downloads: string[] } }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'reels-monitor-')), folder = join(root, 'video')
  try {
    await mkdir(folder)
    const library = new FacebookReelsLibrary(join(root, 'library')); await library.track(source, folder)
    const store = new ReelsMonitorStore(join(root, 'monitor'))
    await store.setWatch(watch)
    const now = { value: at('2026-10-02T02:00:00Z') }, calls = { scans: 0, downloads: [] as string[] }
    const deps: ReelsMonitorDependencies = {
      library, now: () => now.value, account: async () => 'guest',
      scan: async () => { calls.scans++; return { isPlaylist: true, title: source.name, count: 3,
        entries: ['111111', '222222', '333333'].map(id => ({ ...facebookReelEntry(id, 'Caption', 'graphql'), facebook: { ...facebookReelEntry(id).facebook!, sourceVerified: id !== '333333' } })),
        facebook: { sourceUrl: source.url, completion: 'complete', stopReason: 'end-of-list', discoveredCount: 3, warnings: [] } } },
      download: async (entry, channel) => { calls.downloads.push(entry.id); const file = join(channel.outputDir, `${entry.id}.mp4`)
        await writeFile(file, 'video'); return { ok: true, id: entry.id, file, skipped: false, error: null } }
    }
    await run({ library, store, deps, now, calls })
  } finally { await rm(root, { recursive: true, force: true }) }
}
test('checks once a day, downloads only never-downloaded verified IDs, persists notices and read state', () => fixture(async ({ library, store, deps, calls, now }) => {
  const folder = (await library.list())[0].outputDir, file = join(folder, '111111.mp4'); await writeFile(file, 'video')
  await library.recordCopy('111111', file, folder); await rm(file) // deleted historical file is still not a new video
  const monitor = new FacebookReelsMonitor(store, deps)
  await Promise.all([monitor.tick(), monitor.tick()])
  assert.equal(calls.scans, 1); assert.deepEqual(calls.downloads, ['222222'])
  let state = await monitor.state()
  assert.equal(state.notices[0].downloaded, 1); assert.equal(state.notices[0].read, false)
  assert.equal(state.notices[0].status, 'partial') // unverified IDs cannot be reported as all processed
  await monitor.markRead([state.notices[0].id]); assert.equal((await monitor.state()).notices[0].read, true)
  const restarted = new FacebookReelsMonitor(store, deps); await restarted.initialize(); await restarted.tick()
  assert.equal(calls.scans, 1)
  now.value = at('2026-10-03T02:00:00Z'); await restarted.tick()
  assert.equal(calls.scans, 2); assert.deepEqual(calls.downloads, ['222222'])
  state = await restarted.state(); assert.equal(state.notices[0].downloaded, 0)
}))
test('rate limit/login failures consume daily attempt without download or immediate retry', () => fixture(async ({ store, deps, calls }) => {
  deps.scan = async () => { calls.scans++; return { isPlaylist: true, title: '', count: 0, entries: [], facebook: {
    sourceUrl: source.url, completion: 'partial', stopReason: 'login-required', discoveredCount: 0, warnings: [] } } }
  const monitor = new FacebookReelsMonitor(store, deps); await monitor.tick(); await monitor.tick()
  assert.equal(calls.scans, 1); assert.equal(calls.downloads.length, 0)
  assert.equal((await monitor.state()).notices[0].status, 'error')
}))
test('a changed account and disabled/removed channels cannot trigger a scan', () => fixture(async ({ store, deps, library, calls }) => {
  deps.account = async () => 'a'.repeat(64)
  const monitor = new FacebookReelsMonitor(store, deps); await monitor.tick()
  assert.equal(calls.scans, 0); assert.equal((await monitor.state()).notices[0].status, 'error')
  await store.setWatch({ ...watch, enabled: false }); await monitor.tick(); assert.equal(calls.scans, 0)
  await store.setWatch(watch); await library.remove(source.url); await monitor.tick(); assert.equal(calls.scans, 0)
}))
test('interrupted run becomes a notice after restart and is not replayed automatically the same day', () => fixture(async ({ store, deps, calls }) => {
  await store.reserve(watch.key, '2026-10-02', '2026-10-02T02:00:00Z', (await deps.library.list())[0].outputDir)
  const monitor = new FacebookReelsMonitor(store, deps); await monitor.initialize(); await monitor.tick()
  const state = await monitor.state()
  assert.equal(calls.scans, 0); assert.equal(state.notices[0].status, 'error'); assert.match(state.notices[0].message, /gián đoạn/)
}))
test('stopping during scanning cancels the active job and keeps a notification', () => fixture(async ({ store, deps }) => {
  let started!: () => void; const gate = new Promise<void>(resolve => { started = resolve })
  deps.scan = async (_watch, signal) => { started(); return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true })
  }) }
  const monitor = new FacebookReelsMonitor(store, deps), work = monitor.tick(); await gate
  monitor.cancel(); await work
  assert.equal((await monitor.state()).notices[0].status, 'cancelled')
}))
test('missed days collapse into one catch-up and manual checks never redownload successful IDs', () => fixture(async ({ store, deps, calls, now }) => {
  now.value = at('2026-10-10T01:00:00Z')
  const monitor = new FacebookReelsMonitor(store, deps); await monitor.tick(); await monitor.tick()
  assert.equal(calls.scans, 1); assert.equal((await monitor.state()).watches[0].lastDay, '2026-10-09')
  await monitor.tick(watch.key); await monitor.tick()
  assert.equal(calls.scans, 2); assert.deepEqual(calls.downloads, ['111111', '222222'])
  assert.equal((await monitor.state()).watches[0].lastDay, '2026-10-10')
}))
test('schedule persists and rejects malformed times without changing stored settings', () => fixture(async ({ store }) => {
  await store.setTime('18:30'); assert.equal((await store.read()).settings.time, '18:30')
  for (const time of ['24:00','9:00','09:60','garbage']) {
    assert.throws(() => validateReelsMonitorTime(time)); assert.throws(() => store.setTime(time))
  }
  assert.equal((await store.read()).settings.time, '18:30')
}))
test('disable while scanning stops downloads and cancelling waits until active browser is released', () => fixture(async ({ store, deps, calls }) => {
  let started!: () => void; const gate = new Promise<void>(resolve => { started = resolve })
  const scan = deps.scan
  deps.scan = async (w, signal) => { started(); await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return scan(w, signal) }
  const monitor = new FacebookReelsMonitor(store, deps), work = monitor.tick(); await gate
  await store.setWatch({ ...watch, enabled: false }); await monitor.cancelAndWait(watch.key); await work
  assert.equal(calls.downloads.length, 0); assert.equal((await monitor.state()).active, null)
  assert.equal((await monitor.state()).notices[0].status, 'cancelled')
}))
test('three failed video downloads stop the run and failed IDs remain eligible tomorrow', () => fixture(async ({ store, deps, calls, now }) => {
  const scan = deps.scan
  deps.scan = async (w, signal) => { const list = await scan(w, signal)
    list.entries = ['111111','222222','333333','444444'].map(id => ({ ...facebookReelEntry(id), facebook: { ...facebookReelEntry(id).facebook!, sourceVerified: true } })); return list }
  deps.download = async entry => { calls.downloads.push(entry.id); return { ok: false, id: entry.id, file: null, error: 'failed' } }
  const monitor = new FacebookReelsMonitor(store, deps); await monitor.tick()
  assert.equal(calls.downloads.length, 3); assert.equal((await monitor.state()).notices[0].failed, 3)
  assert.deepEqual(await deps.library.historyIds(), [])
  now.value = at('2026-10-03T02:00:00Z'); await monitor.tick(); assert.equal(calls.downloads.length, 6)
}))
test('stop prevents later ticks and suspended channels cannot start', () => fixture(async ({ store, deps, calls }) => {
  const monitor = new FacebookReelsMonitor(store, deps); monitor.suspend(watch.key); await monitor.tick()
  assert.equal(calls.scans, 0); monitor.resume(watch.key); await monitor.stop(); await monitor.tick()
  assert.equal(calls.scans, 0)
}))
test('completion is unread even when the user read the running notice', () => fixture(async ({ store, deps }) => {
  const folder = (await deps.library.list())[0].outputDir
  const running = (await store.reserve(watch.key, '2026-10-02', '2026-10-02T02:00:00Z', folder))!
  await store.markRead([running.id]); await store.updateNotice({ ...running, status: 'success' })
  assert.equal((await store.read()).notices[0].read, false)
}))
test('stopping while another job holds the cookie lock exits without a scan', () => fixture(async ({ store, deps, calls }) => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve })
  deps.account = () => { started(); return new Promise(() => {}) }
  const monitor = new FacebookReelsMonitor(store, deps), work = monitor.tick(); await ready
  await monitor.stop(); await work
  assert.equal(calls.scans, 0); assert.equal((await monitor.state()).notices[0].status, 'cancelled')
}))
test('deleting a completed notice persists but cannot reset daily claims or successful video history', () => fixture(async ({ store, deps, calls }) => {
  const monitor = new FacebookReelsMonitor(store, deps); await monitor.tick()
  const before = await monitor.state(), history = await deps.library.historyIds()
  await monitor.deleteNotices([before.notices[0].id])
  const restarted = new FacebookReelsMonitor(store, deps); await restarted.initialize(); await restarted.tick()
  const after = await restarted.state()
  assert.deepEqual(after.notices, []); assert.deepEqual(after.watches, before.watches)
  assert.deepEqual(after.settings, before.settings); assert.deepEqual(await deps.library.historyIds(), history)
  for (const id of history) assert.ok(await deps.library.existing(id))
  assert.equal(calls.scans, 1); assert.equal(calls.downloads.length, 2)
}))
test('bulk deletion keeps a concurrent running notice and rejects explicit deletion of that active notice atomically', () => fixture(async ({ store, deps }) => {
  const monitor = new FacebookReelsMonitor(store, deps); await monitor.tick()
  const old = (await monitor.state()).notices[0], folder = (await deps.library.list())[0].outputDir
  const running = (await store.reserve(watch.key, '2026-10-02', '2026-10-02T03:00:00Z', folder, true))!
  await assert.rejects(monitor.deleteNotices([old.id, running.id]), /kết thúc/)
  assert.equal((await monitor.state()).notices.length, 2)
  await monitor.deleteNotices([old.id]); assert.deepEqual((await monitor.state()).notices.map(n => n.id), [running.id])
  await store.updateNotice({ ...running, status: 'success' }) // progress/finalization still has its record
  await monitor.deleteNotices([running.id]); assert.equal((await monitor.state()).notices.length, 0)
}))
test('deletion rejects malformed IPC payloads and is safe to repeat for already deleted IDs', () => fixture(async ({ store, deps }) => {
  const monitor = new FacebookReelsMonitor(store, deps); await monitor.tick()
  const id = (await monitor.state()).notices[0].id
  for (const invalid of [null, 'all', [42], Array(101).fill(id)]) {
    await assert.rejects(monitor.deleteNotices(invalid as string[]), /không hợp lệ/)
  }
  assert.equal((await monitor.state()).notices.length, 1)
  await monitor.deleteNotices([id, id, 'unknown']); await monitor.deleteNotices([id])
  assert.equal((await monitor.state()).notices.length, 0)
}))
