import { parseFacebookReelsPayload, type FacebookReelsParseContext, type FacebookReelsConnection } from './facebookReelsParser'
import { mergeFacebookReel } from '../shared/facebookReels'
import type { PlaylistEntry } from '../shared/types'

export interface ReelsDebugger {
  attach(): void
  detach(): void
  isAttached(): boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  removeListener(event: string, listener: (...args: any[]) => void): unknown
  sendCommand(method: string, params?: any): Promise<any>
}
export interface FacebookReelsNetworkSnapshot {
  entries: PlaylistEntry[]
  excludedIds?: string[]
  connections: FacebookReelsConnection[]
  pending: number
  revision: number
  warnings: string[]
}

interface ObservedRequest {
  startedAt: number
  chunks: Buffer[]
  bytes: number
  totalBytes: number
  frame: Buffer
  streamed: boolean
  streamReady?: Promise<void>
  finishing?: boolean
  cancelled: Promise<void>
  cancel: () => void
  timeout: ReturnType<typeof setTimeout>
}
const MAX_RECORD_BYTES = 4 * 1024 * 1024
const MAX_STREAM_BYTES = 24 * 1024 * 1024

/** CDP observes existing page requests. It never issues a GraphQL request or stores tokens. */
export function observeFacebookReelsNetwork(debuggerApi: ReelsDebugger,
  context: () => FacebookReelsParseContext) {
  const entries = new Map<string, PlaylistEntry>()
  const excludedIds=new Set<string>()
  const connections = new Map<string, FacebookReelsConnection>()
  const collectionIds = new Set<string>()
  const requests = new Map<string, ObservedRequest>()
  const tasks = new Set<Promise<void>>()
  const warnings = new Set<string>()
  let active = true; let revision = 0; let retainedBytes = 0; let attached = false; let streamBytes = 0
  const current = (id: string, request: ObservedRequest): boolean => active && requests.get(id) === request
  const release = (id: string, request: ObservedRequest): void => {
    clearTimeout(request.timeout); request.cancel()
    streamBytes -= request.bytes; request.bytes = 0; request.chunks = []; request.frame = Buffer.alloc(0)
    if (requests.get(id) === request) requests.delete(id)
  }
  const command = (request: ObservedRequest, method: string, params: any): Promise<any> =>
    Promise.race([debuggerApi.sendCommand(method, params), request.cancelled])
  const ingest = (raw: string): void => {
    if (!active) return
    const size = Buffer.byteLength(raw, 'utf8')
    if (size > 4 * 1024 * 1024) {
      warnings.add('Đã đạt ngưỡng dữ liệu mạng của lượt quét.'); return
    }
    const c = context()
    const parsed = parseFacebookReelsPayload(raw, { ...c, collectionIds,
      knownOwners:new Map([...entries.values()].filter(e=>e.facebook?.ownerId).map(e=>[e.id,e.facebook!.ownerId!])),
      knownIds: new Set([...(c.knownIds ?? []), ...entries.keys()]) })
    if (parsed.malformed) warnings.add('Một phản hồi Reels không phân tích được; chưa xác nhận đủ danh sách.')
    for (const id of parsed.collectionIds) collectionIds.add(id)
    let changed = false
    for(const id of parsed.excludedIds)if(!excludedIds.has(id)){
      if(excludedIds.size>=10000){warnings.add('Đã đạt ngưỡng dữ liệu mạng của lượt quét.');continue}
      excludedIds.add(id);const old=entries.get(id);if(old)retainedBytes-=Buffer.byteLength(JSON.stringify(old));entries.delete(id);changed=true
    }
    for (const entry of parsed.entries) {
      if(excludedIds.has(entry.id))continue
      const old = entries.get(entry.id)
      const merged = old ? mergeFacebookReel(old, entry) : entry
      if (merged !== old) {
        const delta = Buffer.byteLength(JSON.stringify(merged)) - (old ? Buffer.byteLength(JSON.stringify(old)) : 0)
        if ((!old && entries.size >= 10000) || retainedBytes + delta > 24 * 1024 * 1024) {
          warnings.add('Đã đạt ngưỡng dữ liệu mạng của lượt quét.'); continue
        }
        retainedBytes += delta; entries.set(entry.id, merged); changed = true
      }
    }
    for (const connection of parsed.connections) {
      const old = connections.get(connection.id)
      if (!old || old.cursor !== connection.cursor || old.hasNextPage !== connection.hasNextPage) changed = true
      connections.set(connection.id, connection)
    }
    if (changed) revision++
  }
  const consumeChunk = (id: string, request: ObservedRequest, chunk: Buffer): void => {
    let offset = 0
    while (offset < chunk.length && current(id, request)) {
      const newline = chunk.indexOf(10, offset)
      const end = newline < 0 ? chunk.length : newline + 1
      const part = chunk.subarray(offset, end)
      if (request.frame.length + part.length > MAX_RECORD_BYTES || streamBytes + part.length > MAX_STREAM_BYTES) {
        warnings.add('Đã đạt ngưỡng dữ liệu mạng của lượt quét.'); release(id, request); return
      }
      // Copy the incomplete tail so it cannot retain the entire buffered CDP response.
      request.frame = Buffer.concat([request.frame, part])
      request.bytes += part.length; streamBytes += part.length
      if (newline >= 0) {
        const raw = request.frame.toString('utf8')
        let complete = !raw.trim()
        if (!complete) {
          try { JSON.parse(raw.replace(/^\s*for\s*\(\s*;;\s*\)\s*;\s*/, '')); complete = true }
          catch { /* Keep pretty-printed JSON until the next line or loadingFinished. */ }
        }
        if (complete) {
          if (raw.trim()) ingest(raw)
          request.bytes -= request.frame.length; streamBytes -= request.frame.length; request.frame = Buffer.alloc(0)
        }
      }
      offset = end
    }
  }
  const appendStream = (id: string, request: ObservedRequest, data: string, prefix = false): void => {
    if (!current(id, request)) return
    // Bound transfer/temporary decoding, independently of the 4 MiB JSON record limit.
    if (data.length > Math.ceil(MAX_STREAM_BYTES / 3) * 4 || request.chunks.length >= 8192) {
      warnings.add('Một phản hồi Reels quá lớn; chưa xác nhận đủ danh sách.'); release(id, request); return
    }
    const chunk = Buffer.from(data, 'base64')
    request.totalBytes += chunk.length
    if (request.totalBytes > MAX_STREAM_BYTES) {
      warnings.add('Một phản hồi Reels quá lớn; chưa xác nhận đủ danh sách.'); release(id, request); return
    }
    if (prefix || request.streamed) consumeChunk(id, request, chunk)
    else if (chunk.length) {
      if (streamBytes + chunk.length > MAX_STREAM_BYTES) {
        warnings.add('Đã đạt ngưỡng dữ liệu mạng của lượt quét.'); release(id, request); return
      }
      request.chunks.push(chunk); request.bytes += chunk.length; streamBytes += chunk.length
    }
  }
  const finishRecords = (request: ObservedRequest): void => {
    if (request.frame.length) ingest(request.frame.toString('utf8'))
  }
  const onMessage = (_event: unknown, method: string, params: any): void => {
    if (!active) return
    const id = String(params?.requestId ?? '')
    if (method === 'Network.requestWillBeSent') {
      try {
        const url = new URL(params.request.url)
        if (url.hostname !== 'www.facebook.com' || !/^\/api\/graphql\/?$/.test(url.pathname)) return
        const form = new URLSearchParams(params.request.postData ?? '')
        const name = form.get('fb_api_req_friendly_name') ?? ''
        if (/reel|shorts|UnifiedVideo.*(?:Feedback|Comment)/i.test(name) && requests.size < 32 && !requests.has(id)) {
          let cancel!: () => void
          const cancelled = new Promise<void>(resolve => { cancel = resolve })
          const request: ObservedRequest = { startedAt: Date.now(), chunks: [], bytes: 0, totalBytes: 0,
            frame: Buffer.alloc(0), streamed: false, cancelled, cancel,
            timeout: setTimeout(() => {
              if (!current(id, request)) return
              warnings.add('Một yêu cầu Reels quá thời gian chờ; danh sách có thể chưa đủ.'); release(id, request)
            }, 30000) }
          request.timeout.unref(); requests.set(id, request)
        }
      } catch { /* Ignore unrelated/invalid requests. */ }
    } else if (method === 'Network.responseReceived' && requests.has(id)) {
      if (params.response?.status === 429) warnings.add('Facebook đang giới hạn truy cập.')
      if (params.response?.status !== 200) {
        warnings.add('Một yêu cầu Reels thất bại; danh sách có thể chưa đủ.'); release(id, requests.get(id)!)
      } else {
        const request = requests.get(id)!
        if (!request.streamReady) {
          // Capture while the response arrives, before other resources evict it from the inspector cache.
          // bufferedData precedes dataReceived chunks even if the command resolves after those events.
          request.streamReady = command(request, 'Network.streamResourceContent', { requestId: id })
            .then((result: { bufferedData?: string }) => {
              if (!current(id, request) || typeof result?.bufferedData !== 'string') return
              request.streamed = true
              appendStream(id, request, result.bufferedData, true)
              const queued = request.chunks; request.chunks = []
              for (const chunk of queued) {
                if (!current(id, request)) break
                request.bytes -= chunk.length; streamBytes -= chunk.length
                consumeChunk(id, request, chunk)
              }
            }).catch(() => { /* Older Chromium: getResponseBody remains the fallback. */ })
        }
      }
    } else if (method === 'Network.dataReceived' && requests.has(id)) {
      if (typeof params.data === 'string') appendStream(id, requests.get(id)!, params.data)
    } else if (method === 'Network.loadingFailed' && requests.has(id)) {
      warnings.add('Một yêu cầu Reels bị ngắt; danh sách có thể chưa đủ.'); release(id, requests.get(id)!)
    }
    else if (method === 'Network.loadingFinished' && requests.has(id)) {
      const request = requests.get(id)!
      if (request.finishing) return
      if (params.encodedDataLength > MAX_STREAM_BYTES) {
        warnings.add('Một phản hồi Reels quá lớn; chưa xác nhận đủ danh sách.'); release(id, request); return
      }
      request.finishing = true
      const task = (async () => {
        await request.streamReady
        if (!current(id, request)) return
        if (request.streamed) {
          finishRecords(request); return
        }
        const result = await command(request, 'Network.getResponseBody', { requestId: id })
        if (!current(id, request)) return
        if (typeof result?.body !== 'string') throw new Error('Missing response body')
        if ((result.base64Encoded ? result.body.length > Math.ceil(MAX_STREAM_BYTES / 3) * 4 :
          Buffer.byteLength(result.body, 'utf8') > MAX_STREAM_BYTES)) {
          warnings.add('Một phản hồi Reels quá lớn; chưa xác nhận đủ danh sách.'); return
        }
        consumeChunk(id, request, Buffer.from(result.body, result.base64Encoded ? 'base64' : 'utf8'))
        if (current(id, request)) finishRecords(request)
      })().catch(() => { if (current(id, request)) warnings.add('Một phản hồi mạng không đọc được; danh sách có thể chưa đủ.') })
        .finally(() => { release(id, request); tasks.delete(task) })
      tasks.add(task)
    }
  }
  const onDetach = (): void => { if (active) warnings.add('Theo dõi mạng bị ngắt; chưa thể xác nhận hết danh sách.') }
  const ready = (async () => {
    try {
      debuggerApi.attach(); attached = true
      debuggerApi.on('message', onMessage); debuggerApi.on('detach', onDetach)
      await debuggerApi.sendCommand('Network.enable', { maxResourceBufferSize: 4 * 1024 * 1024, maxTotalBufferSize: 24 * 1024 * 1024 })
    } catch { warnings.add('Không bật được theo dõi mạng; sử dụng danh sách DOM dự phòng.') }
  })()
  return {
    ready, ingest,
    snapshot(): FacebookReelsNetworkSnapshot {
      for (const [id, request] of requests) if (Date.now() - request.startedAt > 30000) {
        warnings.add('Một yêu cầu Reels quá thời gian chờ; danh sách có thể chưa đủ.'); release(id, request)
      }
      return { entries: [...entries.values()], excludedIds:[...excludedIds], connections: [...connections.values()], pending: requests.size,
        revision, warnings: [...warnings] }
    },
    async flush(): Promise<void> { while (tasks.size) await Promise.allSettled([...tasks]) },
    dispose(): void {
      active = false
      debuggerApi.removeListener('message', onMessage); debuggerApi.removeListener('detach', onDetach)
      if (attached && debuggerApi.isAttached()) { try { debuggerApi.detach() } catch { /* Already closed. */ } }
      for (const [id, request] of requests) release(id, request)
      entries.clear(); excludedIds.clear(); connections.clear()
    }
  }
}
