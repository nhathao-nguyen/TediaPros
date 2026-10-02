import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseFacebookReelsPayload } from '../src/main/facebookReelsParser'
import { EventEmitter } from 'node:events'
import { facebookReelsSource, facebookReelEntry as rawReelEntry } from '../src/shared/facebookReels'
import { runFacebookReelsController } from '../src/main/facebookReelsController'
import { observeFacebookReelsNetwork } from '../src/main/facebookReelsNetwork'

const source = facebookReelsSource('https://facebook.com/profile.php?id=123456789')!
// The controller fixture models source-scoped discovery, independently of caption availability.
const facebookReelEntry = (...args: Parameters<typeof rawReelEntry>) => {
  const entry = rawReelEntry(...args); entry.facebook!.sourceVerified = true; return entry
}

test('collects more than 250 IDs over more than 40 scrolls and only completes with scoped evidence', async () => {
  let page = 0; let time = 0
  const result = await runFacebookReelsController(source, {}, {
    readPage: async () => ({ title: 'Creator', entries: Array.from({ length: 6 }, (_, i) =>
      facebookReelEntry(String(100000 + page * 6 + i))), loading: false, atBottom: true, url: source.url }),
    scroll: async () => { page++ },
    network: () => ({ entries: [], connections: page >= 55 ? [{ id: 'collection', hasNextPage: false, cursor: 'end' }] : [],
      pending: 0, revision: page, warnings: [] }),
    wait: async ms => { time += ms }, now: () => time
  })
  assert.ok(result.count > 250)
  assert.equal(new Set(result.entries.map(e => e.id)).size, result.count)
  assert.equal(result.facebook?.completion, 'complete')
})

test('does not describe a quiet DOM as a complete list', async () => {
  let time = 0
  const result = await runFacebookReelsController(source, {}, {
    readPage: async () => ({ title: 'Creator', entries: [facebookReelEntry('111111')], loading: false, atBottom: true, url: source.url }),
    scroll: async () => {}, network: () => ({ entries: [], connections: [], pending: 0, revision: 0, warnings: [] }),
    wait: async ms => { time += ms }, now: () => time
  })
  assert.equal(result.count, 1)
  assert.equal(result.facebook?.completion, 'partial')
  assert.equal(result.facebook?.stopReason, 'stalled')
})

test('entry limit is enforced inside a batch, and cancellation retains entries', async () => {
  const abort = new AbortController(); let time = 0
  const env = { readPage: async () => ({ title: 'Creator', entries: Array.from({ length: 260 }, (_, i) =>
    facebookReelEntry(String(100000 + i))), loading: false, atBottom: true, url: source.url }),
    scroll: async () => {}, network: () => ({ entries: [], connections: [], pending: 0, revision: 0, warnings: [] }),
    wait: async (ms: number) => { time += ms }, now: () => time }
  const limited = await runFacebookReelsController(source, { maxEntries: 250 }, env)
  assert.equal(limited.count, 250)
  assert.equal(limited.facebook?.stopReason, 'limit')
  const cancelled = await runFacebookReelsController(source, {}, env, {
    signal: abort.signal, onProgress: p => { if (p.discoveredCount) abort.abort() }
  })
  assert.equal(cancelled.count, 260)
  assert.equal(cancelled.facebook?.completion, 'cancelled')
})

test('slow pending data does not cause an early stalled result', async () => {
  let time = 0; let page = 0
  const result = await runFacebookReelsController(source, {}, {
    readPage: async () => ({ title: 'Creator', entries: [facebookReelEntry('111111')], loading: time < 15000, atBottom: true, url: source.url }),
    scroll: async () => { page++ }, network: () => ({ entries: time >= 15000 ? [facebookReelEntry('222222', 'New', 'graphql')] : [],
      connections: time >= 15000 ? [{ id: 'collection', hasNextPage: false, cursor: 'end' }] : [],
      pending: time < 15000 ? 1 : 0, revision: page, warnings: [] }),
    wait: async ms => { time += ms }, now: () => time
  })
  assert.equal(result.count, 2)
  assert.equal(result.facebook?.completion, 'complete')
})

test('resume advances through duplicate batches without falsely stalling', async () => {
  let page = 0; let time = 0
  const result = await runFacebookReelsController(source, {}, {
    readPage: async () => ({ title: 'Creator', entries: [facebookReelEntry(String(100000 + page))], loading: false, atBottom: true, url: source.url }),
    scroll: async () => { page++ }, network: () => ({ entries: [],
      connections: [{ id: 'collection', hasNextPage: page < 60, cursor: String(page) }], pending: 0, revision: page, warnings: [] }),
    wait: async ms => { time += ms }, now: () => time
  }, { initialEntries: Array.from({ length: 60 }, (_, i) => facebookReelEntry(String(100000 + i))) })
  assert.equal(result.count, 61)
  assert.equal(result.facebook?.completion, 'complete')
})

test('network observer waits for loadingFinished, associates IDs, and drops events after cleanup', async () => {
  class Debugger extends EventEmitter {
    attached = false
    attach() { this.attached = true }
    detach() { this.attached = false }
    isAttached() { return this.attached }
    async sendCommand(method: string) {
      if (method === 'Network.getResponseBody') return { body: Buffer.from(JSON.stringify({ data: { video: {
        id: '111111', creation_story: { message: { text: 'Correct network caption' } }
      } } })).toString('base64'), base64Encoded: true }
      return {}
    }
  }
  const debuggerApi = new Debugger()
  const observer = observeFacebookReelsNetwork(debuggerApi, () => ({ source, knownIds: new Set(['111111']) }))
  await observer.ready
  debuggerApi.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'r1', request: {
    url: 'https://www.facebook.com/api/graphql/', postData: 'fb_api_req_friendly_name=VideoReelViewerQuery' } })
  debuggerApi.emit('message', {}, 'Network.responseReceived', { requestId: 'r1', response: { status: 200 } })
  assert.equal(observer.snapshot().entries.length, 0)
  debuggerApi.emit('message', {}, 'Network.loadingFinished', { requestId: 'r1', encodedDataLength: 1000 })
  await observer.flush()
  assert.equal(observer.snapshot().entries[0].title, 'Correct network caption')
  observer.dispose()
  assert.equal(debuggerApi.listenerCount('message'), 0)
  assert.equal(debuggerApi.attached, false)
})

test('network budget bounds retained metadata rather than bytes already discarded', async () => {
  const api = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true,
    sendCommand: async () => ({}) })
  const observer = observeFacebookReelsNetwork(api, () => ({ source, knownIds: new Set(['111111']) }))
  await observer.ready
  const raw = JSON.stringify({ padding: 'x'.repeat(1024 * 1024), data: { video: {
    id: '111111', creation_story: { message: { text: 'Caption' } }
  } } })
  for (let i = 0; i < 26; i++) observer.ingest(raw)
  observer.ingest(JSON.stringify({ data: { video: { id: '111111',
    creation_story: { message: { text: 'Caption completed after many batches' } } } } }))
  assert.equal(observer.snapshot().entries[0].title, 'Caption completed after many batches')
  assert.deepEqual(observer.snapshot().warnings, [])
  observer.dispose()
})

test('cancel preserves metadata parsed during the last wait', async () => {
  const abort = new AbortController(); let fresh = false
  const result = await runFacebookReelsController(source, {}, {
    readPage: async () => ({ title: 'Creator', entries: [facebookReelEntry('111111')], loading: false, atBottom: true, url: source.url }),
    scroll: async () => {}, network: () => ({ entries: fresh ? [facebookReelEntry('222222', 'Parsed before stop', 'graphql')] : [],
      connections: [], pending: 0, revision: fresh ? 1 : 0, warnings: [] }),
    wait: async () => { fresh = true; abort.abort() }, now: () => 0
  }, { signal: abort.signal })
  assert.equal(result.facebook?.completion, 'cancelled')
  assert.deepEqual(result.entries.map(e => e.id), ['111111', '222222'])
})

test('terminal pagination cannot verify an extra DOM card of unknown source', async () => {
  let time = 0
  const result = await runFacebookReelsController(source, {}, {
    readPage: async () => ({ title: 'Creator', entries: [facebookReelEntry('111111'), rawReelEntry('222222')], loading: false, atBottom: true, url: source.url }),
    scroll: async () => {}, network: () => ({ entries: [], connections: [{ id: 'own', hasNextPage: false, cursor: 'end' }], pending: 0, revision: 1, warnings: [] }),
    wait: async ms => { time += ms }, now: () => time
  })
  assert.equal(result.facebook?.completion, 'partial')
})

test('an explicitly foreign owner removes a DOM recommendation from the selectable/exportable result',async()=>{
  let time=0
  const parsed=parseFacebookReelsPayload(JSON.stringify({data:{video:{id:'222222',owner:{id:'987654321'},creation_story:{message:{text:'Foreign caption'}}}}}),
    {source,knownIds:new Set(['222222'])})
  const result=await runFacebookReelsController(source,{}, {
    readPage:async()=>({title:'Creator',url:source.url,entries:[facebookReelEntry('111111'),facebookReelEntry('222222')],loading:false,atBottom:true}),
    network:()=>({entries:parsed.entries,excludedIds:parsed.excludedIds,connections:[],pending:0,revision:1,warnings:[]}),
    scroll:async()=>{},wait:async ms=>{time+=ms},now:()=>time
  })
  assert.deepEqual(result.entries.map(e=>e.id),['111111'])
})

test('foreign ownership received before the first DOM read still excludes its later card',async()=>{
  const debuggerApi=Object.assign(new EventEmitter(),{attach(){},detach(){},isAttached:()=>true,sendCommand:async()=>({})})
  const knownIds=new Set<string>()
  const observer=observeFacebookReelsNetwork(debuggerApi,()=>({source,knownIds}));await observer.ready
  observer.ingest(JSON.stringify({data:{video:{id:'222222',owner:{id:'987654321'},creation_story:{message:{text:'Foreign'}}}}}))
  let time=0
  try{
    const result=await runFacebookReelsController(source,{}, {
      readPage:async()=>{knownIds.add('222222');return {title:'Creator',url:source.url,entries:[facebookReelEntry('222222')],loading:false,atBottom:true}},
      network:()=>observer.snapshot(),scroll:async()=>{},wait:async ms=>{time+=ms},now:()=>time
    })
    assert.equal(result.count,0);assert.deepEqual(observer.snapshot().excludedIds,['222222'])
  }finally{observer.dispose()}
})

function terminalReelsPayload(caption = 'Trang cuối 👇') {
  return JSON.stringify({ data: { node: { id: source.profileId, aggregated_fb_shorts: {
    edges: [{ profile_reel_node: { node: { video: { id: '222222', owner: { id: source.profileId } },
      message: { text: caption } } } }], page_info: { has_next_page: false, end_cursor: 'last' }
  } } } })
}
function beginReelsResponse(api: EventEmitter, id = 'page') {
  api.emit('message', {}, 'Network.requestWillBeSent', { requestId: id, request: {
    url: 'https://www.facebook.com/api/graphql/',
    postData: 'fb_api_req_friendly_name=ProfileCometAppCollectionReelsRendererPaginationQuery' } })
  api.emit('message', {}, 'Network.responseReceived', { requestId: id, response: { status: 200 } })
}

test('streams terminal pagination before the inspector evicts its response body', async () => {
  const raw = Buffer.from(terminalReelsPayload())
  const split = raw.indexOf(Buffer.from('👇')) + 1 // Split a UTF-8 character across the two sources.
  let bodyReads = 0
  const api = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true,
    async sendCommand(method: string) {
      if (method === 'Network.streamResourceContent') return { bufferedData: raw.subarray(0, split).toString('base64') }
      if (method === 'Network.getResponseBody') { bodyReads++; throw new Error('Request content was evicted from inspector cache') }
      return {}
    } })
  const observer = observeFacebookReelsNetwork(api, () => ({ source }))
  try {
    await observer.ready; beginReelsResponse(api)
    api.emit('message', {}, 'Network.dataReceived', { requestId: 'page', data: raw.subarray(split).toString('base64') })
    api.emit('message', {}, 'Network.loadingFinished', { requestId: 'page', encodedDataLength: raw.length })
    await observer.flush()
    assert.equal(observer.snapshot().entries[0]?.title, 'Trang cuối 👇')
    assert.deepEqual(observer.snapshot().warnings, [])
    assert.equal(bodyReads, 0)
    let time = 0
    const result = await runFacebookReelsController(source, {}, {
      readPage: async () => ({ title: 'Creator', entries: [rawReelEntry('222222')], loading: false, atBottom: true, url: source.url }),
      network: () => observer.snapshot(), scroll: async () => {}, wait: async ms => { time += ms }, now: () => time
    })
    assert.equal(result.facebook?.completion, 'complete')
  } finally { observer.dispose() }
})

test('stream prefix remains first when data and finish arrive before the stream command resolves', async () => {
  const raw = Buffer.from(terminalReelsPayload('Đầy đủ caption'))
  let resolveStream!: (result: { bufferedData: string }) => void
  const api = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true,
    async sendCommand(method: string) {
      if (method === 'Network.streamResourceContent') return new Promise<{ bufferedData: string }>(resolve => { resolveStream = resolve })
      if (method === 'Network.getResponseBody') throw new Error('Evicted')
      return {}
    } })
  const observer = observeFacebookReelsNetwork(api, () => ({ source }))
  try {
    await observer.ready; beginReelsResponse(api)
    api.emit('message', {}, 'Network.dataReceived', { requestId: 'page', data: raw.subarray(40).toString('base64') })
    api.emit('message', {}, 'Network.loadingFinished', { requestId: 'page', encodedDataLength: raw.length })
    assert.equal(observer.snapshot().pending, 1)
    assert.equal(typeof resolveStream, 'function')
    resolveStream({ bufferedData: raw.subarray(0, 40).toString('base64') })
    await observer.flush()
    assert.equal(observer.snapshot().entries[0]?.title, 'Đầy đủ caption')
    assert.equal(observer.snapshot().connections[0]?.hasNextPage, false)
    assert.deepEqual(observer.snapshot().warnings, [])
  } finally { observer.dispose() }
})

test('unsupported response streaming falls back to reading the body without a false warning', async () => {
  let streamAttempts = 0; let bodyReads = 0
  const api = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true,
    async sendCommand(method: string) {
      if (method === 'Network.streamResourceContent') { streamAttempts++; throw new Error('Method not found') }
      if (method === 'Network.getResponseBody') { bodyReads++; return { body: terminalReelsPayload() } }
      return {}
    } })
  const observer = observeFacebookReelsNetwork(api, () => ({ source }))
  try {
    await observer.ready; beginReelsResponse(api)
    api.emit('message', {}, 'Network.loadingFinished', { requestId: 'page', encodedDataLength: 1000 })
    await observer.flush()
    assert.equal(streamAttempts, 1); assert.equal(bodyReads, 1)
    assert.equal(observer.snapshot().connections[0]?.hasNextPage, false)
    assert.deepEqual(observer.snapshot().warnings, [])
  } finally { observer.dispose() }
})

test('a multi-record pagination response larger than the inspector buffer retains terminal evidence', async () => {
  const raw = Buffer.from([terminalReelsPayload(), ...Array.from({ length: 70 }, () =>
    JSON.stringify({ extensions: { padding: 'x'.repeat(95000) } }))].join('\n') + '\n')
  assert.ok(raw.length > 4 * 1024 * 1024)
  const api = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true,
    async sendCommand(method: string) {
      if (method === 'Network.streamResourceContent') return { bufferedData: raw.toString('base64') }
      if (method === 'Network.getResponseBody') throw new Error('Evicted')
      return {}
    } })
  const observer = observeFacebookReelsNetwork(api, () => ({ source }))
  try {
    await observer.ready; beginReelsResponse(api)
    api.emit('message', {}, 'Network.loadingFinished', { requestId: 'page', encodedDataLength: raw.length })
    await observer.flush()
    assert.equal(observer.snapshot().entries[0]?.title, 'Trang cuối 👇')
    assert.equal(observer.snapshot().connections[0]?.hasNextPage, false)
    assert.deepEqual(observer.snapshot().warnings, [])
    assert.equal(observer.snapshot().pending, 0)
  } finally { observer.dispose() }
})

test('dispose and expiry settle flush even when a CDP response command never settles', async t => {
  for (const mode of ['stream-dispose', 'stream-expire', 'body-dispose']) {
    let clock = 1000
    const restoreNow = t.mock.method(Date, 'now', () => clock)
    const api = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true,
      async sendCommand(method: string) {
        if (method === 'Network.streamResourceContent') return mode.startsWith('stream') ? new Promise(() => {}) : {}
        if (method === 'Network.getResponseBody') return new Promise(() => {})
        return {}
      } })
    const observer = observeFacebookReelsNetwork(api, () => ({ source }))
    try {
      await observer.ready; beginReelsResponse(api)
      api.emit('message', {}, 'Network.loadingFinished', { requestId: 'page', encodedDataLength: 1000 })
      await new Promise(resolve => setImmediate(resolve))
      if (mode.endsWith('expire')) { clock += 31000; assert.equal(observer.snapshot().pending, 0) }
      else observer.dispose()
      const flushed = await Promise.race([observer.flush().then(() => true),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50))])
      assert.equal(flushed, true, mode)
      assert.equal(observer.snapshot().entries.length, 0)
    } finally { observer.dispose(); restoreNow.mock.restore() }
  }
})

test('stream framing keeps pretty JSON and rejects an oversized record after terminal evidence', async () => {
  const api = Object.assign(new EventEmitter(), { attach() {}, detach() {}, isAttached: () => true,
    async sendCommand(method: string) { return method === 'Network.streamResourceContent' ? { bufferedData: '' } : {} } })
  const observer = observeFacebookReelsNetwork(api, () => ({ source }))
  try {
    await observer.ready; beginReelsResponse(api)
    await new Promise(resolve => setImmediate(resolve))
    const pretty = Buffer.from(JSON.stringify(JSON.parse(terminalReelsPayload()), null, 2) + '\n')
    for (let i = 0; i < pretty.length; i += 11) api.emit('message', {}, 'Network.dataReceived', {
      requestId: 'page', data: pretty.subarray(i, i + 11).toString('base64') })
    assert.equal(observer.snapshot().entries[0]?.title, 'Trang cuối 👇')
    assert.equal(observer.snapshot().connections[0]?.hasNextPage, false)
    api.emit('message', {}, 'Network.dataReceived', { requestId: 'page',
      data: Buffer.from(JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024) })).toString('base64') })
    api.emit('message', {}, 'Network.loadingFinished', { requestId: 'page', encodedDataLength: 1000 })
    await observer.flush()
    assert.ok(observer.snapshot().warnings.length > 0)
    assert.equal(observer.snapshot().pending, 0)
    let time = 0
    const result = await runFacebookReelsController(source, {}, {
      readPage: async () => ({ title: 'Creator', entries: [rawReelEntry('222222')], loading: false, atBottom: true, url: source.url }),
      network: () => observer.snapshot(), scroll: async () => {}, wait: async ms => { time += ms }, now: () => time
    })
    assert.equal(result.facebook?.completion, 'partial')
  } finally { observer.dispose() }
})
