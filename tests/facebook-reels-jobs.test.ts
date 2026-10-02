import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, basename } from 'node:path'
import { FacebookReelsStore, reelsContext } from '../src/main/facebookReelsStore'
import { FacebookReelsJobs } from '../src/main/facebookReelsJobs'
import { facebookReelEntry } from '../src/shared/facebookReels'
import type { PlaylistProbe, VideoInfo } from '../src/shared/types'

const request = { url: 'https://facebook.com/profile.php?id=123456789' }
async function cleanupRoot(dir: string): Promise<void> {
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()))
  assert.ok(basename(dir).startsWith('tedia-reels-'))
  await rm(dir, { recursive: true, force: true })
}
const playlist = (): PlaylistProbe => ({ isPlaylist: true, title: 'Creator', count: 2,
  entries: [facebookReelEntry('111111'), facebookReelEntry('222222', 'Already correct', 'graphql')],
  facebook: { sourceUrl: request.url, completion: 'partial', stopReason: 'stalled', discoveredCount: 2, warnings: [] } })

test('checkpoint rejects traversal, foreign context, oversized and corrupt entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-reels-store-'))
  try {
    const store = new FacebookReelsStore(dir)
    const context = reelsContext(request, 'account-a')
    const key = await store.save(context, playlist())
    assert.equal((await store.load(key, context)).entries[1].title, 'Already correct')
    await assert.rejects(store.load('../escape', context))
    await assert.rejects(store.load(key, reelsContext({ ...request, proxy: 'localhost:8080' }, 'account-a')))
    await assert.rejects(store.load(key, reelsContext(request, 'account-b')))
    const path = join(dir, `${key}.json`)
    const data = JSON.parse(await readFile(path, 'utf8'))
    data.playlist.entries[0].facebook.links=[{url:'file:///secret',foundIn:'comment'}]
    await writeFile(path,JSON.stringify(data))
    await assert.rejects(store.load(key,context))
    delete data.playlist.entries[0].facebook.links
    data.playlist.entries[0].url = 'https://evil.example/reel/111111/'
    await writeFile(path, JSON.stringify(data))
    await assert.rejects(store.load(key, context))
    await writeFile(path, 'x'.repeat(8 * 1024 * 1024 + 1))
    await assert.rejects(store.load(key, context))
  } finally { await cleanupRoot(dir) }
})

test('jobs enforce ownership, verify metadata IDs, and preserve verified captions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-reels-jobs-'))
  try {
    let calls = 0
    const jobs = new FacebookReelsJobs(new FacebookReelsStore(dir), async () => playlist(), async () => {
      calls++; return { id: '999999', title: 'Wrong video', description: 'Wrong caption' } as VideoInfo
    })
    const id = await jobs.start(1, request)
    await assert.rejects(jobs.result(2, id))
    assert.throws(() => jobs.cancel(2, id))
    await jobs.result(1, id)
    await assert.rejects(jobs.enrich(2, id, ['111111']))
    await assert.rejects(jobs.enrich(1, id, ['999999']))
    const entries = await jobs.enrich(1, id, ['111111', '222222'])
    assert.equal(calls, 1)
    assert.equal(entries[0].title, 'Facebook Reel 111111')
    assert.equal(entries[0].facebook?.status, 'error')
    assert.equal(entries[1].title, 'Already correct')
    jobs.release(1)
  } finally { await cleanupRoot(dir) }
})

test('cancel returns partial entries and owner release aborts active work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-reels-cancel-'))
  try {
    const jobs = new FacebookReelsJobs(new FacebookReelsStore(dir), async (_r, o) => {
      await new Promise<void>(resolve => o.signal!.addEventListener('abort', () => resolve(), { once: true }))
      const p = playlist(); p.facebook!.completion = 'cancelled'; p.facebook!.stopReason = 'cancelled'; return p
    }, async () => { throw new Error('unused') })
    const id = await jobs.start(1, request)
    jobs.cancel(1, id)
    assert.equal((await jobs.result(1, id)).entries.length, 2)
    const next = await jobs.start(1, request)
    const result = jobs.result(1, next)
    jobs.release(1)
    assert.equal((await result).facebook?.completion, 'cancelled')
  } finally { await cleanupRoot(dir) }
})

test('metadata claims ownership before yielding, so duplicate calls and release cannot orphan work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-reels-exclusive-'))
  try {
    let calls = 0
    const jobs = new FacebookReelsJobs(new FacebookReelsStore(dir), async () => playlist(), async (_u,_p,_c,signal) => {
      calls++; await new Promise(resolve => setTimeout(resolve, 10))
      if (signal.aborted) throw new Error('aborted')
      return { id: '111111', description: 'Correct', uploader: null } as VideoInfo
    })
    const id = await jobs.start(1, request); await jobs.result(1, id)
    const first = jobs.enrich(1, id, ['111111'])
    await assert.rejects(jobs.enrich(1, id, ['111111']), /đang chạy/)
    await first
    assert.equal(calls, 1)
    const next = await jobs.start(1, request); await jobs.result(1, next)
    const pending = jobs.enrich(1, next, ['111111'])
    jobs.release(1)
    await pending
    assert.equal(calls, 1)
  } finally { await cleanupRoot(dir) }
})

test('an account switch rejects enrichment and does not send old-context metadata requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-reels-account-'))
  try {
    let account = 'account-a'; let calls = 0; let expected: string | undefined
    const jobs = new FacebookReelsJobs(new FacebookReelsStore(dir), async (_r,options) => {
      expected = options.expectedAccount; return playlist()
    }, async () => { calls++; throw new Error('unused') }, async () => account)
    const id = await jobs.start(1, request); await jobs.result(1,id)
    assert.equal(expected, 'account-a')
    account = 'account-b'
    await assert.rejects(jobs.enrich(1,id,['111111']), /Tài khoản Facebook đã thay đổi/)
    assert.equal(calls, 0)
  } finally { await cleanupRoot(dir) }
})

test('export is owner-bound, selects only scanned IDs and cancels active native pipeline',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'tedia-reels-export-owner-'))
  try {
    let calls=0,account='account-a',seen:string[]=[]
    const jobs=new FacebookReelsJobs(new FacebookReelsStore(dir),async()=>playlist(),async()=>{throw Error('unused')},async()=>account,
      async(_request,expected,entries,_options,signal)=>{
        calls++;assert.equal(expected,'account-a');seen=entries.map(e=>e.id)
        await new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true})})
        return {rows:[],directory:dir,excelPath:'',manifestPath:'',cancelled:signal.aborted}
      })
    const id=await jobs.start(1,request);await jobs.result(1,id)
    const options={ids:['111111'],outputRoot:dir,downloadVideos:true}
    await assert.rejects(jobs.export(2,id,options),/quyền/)
    await assert.rejects(jobs.export(1,id,{...options,ids:['999999']}),/thuộc/)
    const pending=jobs.export(1,id,options)
    await assert.rejects(jobs.export(1,id,options),/đang chạy/)
    await new Promise(resolve=>setTimeout(resolve,10));jobs.cancel(1,id)
    assert.equal((await pending).cancelled,true);assert.equal(calls,1);assert.deepEqual(seen,['111111'])
    account='account-b';await assert.rejects(jobs.export(1,id,options),/Tài khoản/);assert.equal(calls,1)
  }finally{await cleanupRoot(dir)}
})

test('enrichment processes every selected missing caption even when the batch exceeds one minute', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-reels-captions-all-'))
  const originalNow = Date.now
  let clock = originalNow()
  try {
    const p = playlist()
    p.entries = [p.entries[1], ...Array.from({ length: 8 }, (_, i) => facebookReelEntry(String(300000 + i)))]
    p.count = p.entries.length; p.facebook!.discoveredCount = p.count
    const seen: string[] = []
    const jobs = new FacebookReelsJobs(new FacebookReelsStore(dir), async () => p, async url => {
      const reelId = url.match(/reel\/(\d+)/)![1]
      seen.push(reelId); clock += 20000
      return { id: reelId, description: `Complete caption for ${reelId}` } as VideoInfo
    })
    const id = await jobs.start(1, request); await jobs.result(1, id)
    Date.now = () => clock
    const enriched = await jobs.enrich(1, id, p.entries.map(e => e.id))
    assert.equal(seen.length, 8)
    assert.ok(enriched.every(e => e.facebook?.status === 'verified'))
    assert.equal(enriched[0].facebook?.caption, 'Already correct')
    assert.equal((await jobs.result(1, id)).entries.at(-1)?.facebook?.caption, 'Complete caption for 300007')
  } finally { Date.now = originalNow; await cleanupRoot(dir) }
})

test('empty or failed yt-dlp metadata falls back to the selected Reel browser and closes it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-reels-captions-browser-'))
  try {
    const p = playlist(); p.entries[1] = facebookReelEntry('222222')
    let opened = 0, closed = 0, calls = 0
    const seen: string[] = []
    const jobs = new FacebookReelsJobs(new FacebookReelsStore(dir), async () => p, async () => {
      if (++calls === 1) return { id: '111111', description: null } as VideoInfo
      throw Error('metadata unavailable')
    }, async () => 'account-a', undefined, (_request, account) => {
      assert.equal(account, 'account-a'); opened++
      return { resolve: async (entry, signal) => {
        assert.equal(signal.aborted, false); seen.push(entry.id)
        return facebookReelEntry(entry.id, `Browser caption ${entry.id}`, 'graphql')
      }, dispose: async () => { closed++ } }
    })
    const id = await jobs.start(1, request); await jobs.result(1, id)
    const enriched = await jobs.enrich(1, id, ['111111', '222222'])
    assert.deepEqual(seen, ['111111', '222222'])
    assert.deepEqual(enriched.map(e => e.facebook?.caption), ['Browser caption 111111', 'Browser caption 222222'])
    assert.equal(opened, 1); assert.equal(closed, 1)
  } finally { await cleanupRoot(dir) }
})

test('stopping caption enrichment retains completed captions and does not start the remaining IDs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tedia-reels-captions-stop-'))
  try {
    const p = playlist(); p.entries = Array.from({ length: 4 }, (_, i) => facebookReelEntry(String(400000 + i)))
    p.count = 4; p.facebook!.discoveredCount = 4
    let calls = 0, jobId = ''
    const jobs = new FacebookReelsJobs(new FacebookReelsStore(dir), async () => p, async url => {
      const reelId = url.match(/reel\/(\d+)/)![1]
      if (++calls === 2) jobs.cancel(1, jobId)
      return { id: reelId, description: `Caption ${reelId}` } as VideoInfo
    })
    jobId = await jobs.start(1, request); await jobs.result(1, jobId)
    const enriched = await jobs.enrich(1, jobId, p.entries.map(e => e.id))
    assert.equal(calls, 2)
    assert.equal(enriched[0].facebook?.caption, 'Caption 400000')
    assert.equal(enriched[2].facebook?.status, 'missing')
    assert.equal(enriched[3].facebook?.caption, null)
  } finally { await cleanupRoot(dir) }
})
