import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm, lstat, readdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { facebookReelId, facebookReelsSource, type FacebookReelsChannelSource,
  type FacebookReelsChannel } from '../shared/facebookReels'
import type { DownloadResult } from '../shared/types'

interface VideoRecord { file: string; root: string }
interface StoredVideo extends VideoRecord { copies?: VideoRecord[] }
interface ChannelRecord { key: string; url: string; name: string; outputDir: string; ids: string[]; lastUpdated: string }
interface LibraryState { version: 1; channels: ChannelRecord[]; videos: Record<string, StoredVideo> }
type ReelRequest = { url: string; kind: 'video' | 'audio'; outputDir: string; reelsSource?: FacebookReelsChannelSource; forceOverwrite?: boolean }
const videoId = /^\d{5,30}$/
const mediaExtension = /\.(mp4|mkv|webm|mov|m4v|avi)$/i

/** Persistent successful Reel IDs, independent of titles and the destination chosen next. */
export class FacebookReelsLibrary {
  private mutations: Promise<unknown> = Promise.resolve()
  private downloads = new Map<string, Promise<unknown>>()
  constructor(private readonly root: string) {}

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const work = this.mutations.then(action)
    this.mutations = work.catch(() => undefined)
    return work
  }
  private source(input: FacebookReelsChannelSource): { key: string; url: string; name: string } {
    const source = facebookReelsSource(input?.url)
    if (!source || source.kind !== 'profile') throw Error('Hãy nhập link profile/fanpage Facebook hợp lệ.')
    return { key: source.key, url: source.url, name: typeof input.name === 'string' && input.name.trim()
      ? input.name.trim().slice(0, 200) : source.slug ?? source.profileId ?? 'Kênh Facebook' }
  }
  private async folder(folder: string): Promise<void> {
    if (typeof folder !== 'string' || !isAbsolute(folder) || /[\x00-\x1f]/.test(folder)) throw Error('Hãy chọn thư mục tuyệt đối hợp lệ.')
    const st = await lstat(folder)
    if (!st.isDirectory() || st.isSymbolicLink()) throw Error('Thư mục không hợp lệ hoặc là liên kết.')
    await assertContainedParentDirectory(join(folder, '.reels-check'), folder, 'Thư mục Reels')
  }
  private async load(): Promise<LibraryState> {
    await mkdir(this.root, { recursive: true })
    const file = join(this.root, 'library.json')
    try { await lstat(file) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, channels: [], videos: {} }
      throw error
    }
    const safe = await assertContainedRegularFile(file, this.root, 'Thư viện Reels')
    if ((await lstat(safe)).size > 16 * 1024 * 1024) throw Error('Thư viện Reels quá lớn.')
    const data = JSON.parse(await readFile(safe, 'utf8')) as LibraryState
    if (data.version !== 1 || !Array.isArray(data.channels) || !data.videos || typeof data.videos !== 'object') throw Error('Thư viện Reels không hợp lệ.')
    for (const ch of data.channels) {
      if (this.source(ch).key !== ch.key || !isAbsolute(ch.outputDir) || !Array.isArray(ch.ids) ||
        ch.ids.some(id => !videoId.test(id)) || typeof ch.lastUpdated !== 'string') throw Error('Dữ liệu kênh Reels không hợp lệ.')
    }
    for (const [id, video] of Object.entries(data.videos)) {
      if (!videoId.test(id) || !video || typeof video.file !== 'string' || typeof video.root !== 'string' ||
        !isAbsolute(video.file) || !isAbsolute(video.root)) throw Error('Lịch sử Reels không hợp lệ.')
      if (video.copies && (!Array.isArray(video.copies) || video.copies.length > 20 || video.copies.some(copy =>
        !copy || typeof copy.file !== 'string' || typeof copy.root !== 'string' || !isAbsolute(copy.file) || !isAbsolute(copy.root)))) throw Error('Bản sao Reels không hợp lệ.')
    }
    return data
  }
  private async save(data: LibraryState): Promise<void> {
    const target = join(this.root, 'library.json'), temp = join(this.root, `${randomUUID()}.tmp`)
    const raw = JSON.stringify(data, null, 2)
    if (Buffer.byteLength(raw) > 16 * 1024 * 1024) throw Error('Thư viện Reels quá lớn để lưu an toàn.')
    await assertContainedParentDirectory(target, this.root, 'Thư viện Reels')
    try { await writeFile(temp, raw, { flag: 'wx' }); await rename(temp, target) }
    finally { await rm(temp, { force: true }) }
  }
  private async usable(record?: VideoRecord): Promise<boolean> {
    if (!record) return false
    try {
      const file = await assertContainedRegularFile(record.file, record.root, 'Video Reels')
      return mediaExtension.test(file) && (await lstat(file)).size > 0
    } catch { return false }
  }
  private async channels(data: LibraryState): Promise<FacebookReelsChannel[]> {
    return Promise.all(data.channels.map(async ch => {
      const ids = await Promise.all(ch.ids.map(async id => await this.findVideo(data.videos[id]) ? id : null))
      const downloadedIds = ids.filter((id): id is string => id !== null)
      return { ...ch, downloaded: downloadedIds.length, downloadedIds }
    }))
  }
  private async findVideo(video?: StoredVideo): Promise<VideoRecord | null> {
    if (!video) return null
    for (const record of [video, ...(video.copies ?? [])]) if (await this.usable(record)) return { file: record.file, root: record.root }
    return null
  }
  private remember(data: LibraryState, id: string, record: VideoRecord): void {
    const old = data.videos[id]
    const copies = old ? [old, ...(old.copies ?? [])].filter((v, i, list) => v.file !== record.file && list.findIndex(c => c.file === v.file) === i)
      .slice(0, 20).map(v => ({ file: v.file, root: v.root })) : []
    data.videos[id] = { ...record, ...(copies.length ? { copies } : {}) }
  }
  private upsert(data: LibraryState, source: FacebookReelsChannelSource, folder: string, explicit = false): ChannelRecord {
    const normalized = this.source(source)
    let channel = data.channels.find(ch => ch.key === normalized.key)
    if (!channel) { channel = { ...normalized, outputDir: folder, ids: [], lastUpdated: new Date().toISOString() }; data.channels.unshift(channel) }
    else if (explicit) { channel.name = normalized.name; channel.outputDir = folder }
    return channel
  }
  private async importFolder(data: LibraryState, channel: ChannelRecord): Promise<void> {
    let visited = 0
    const scan = async (folder: string, depth: number): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (++visited > 20000) throw Error('Thư mục quá lớn; hãy chọn thư mục video của kênh.')
        if (entry.isSymbolicLink()) continue
        const file = join(folder, entry.name)
        if (entry.isDirectory() && depth < 2) {
          await assertContainedParentDirectory(join(file, '.reels-check'), channel.outputDir, 'Quét thư mục Reels')
          await scan(file, depth + 1)
        } else if (entry.isFile() && mediaExtension.test(entry.name)) {
          const id = /\[(\d{5,30})\]/.exec(entry.name)?.[1] ??
            /^(?:\d{1,4}_)?(\d{5,30})$/.exec(entry.name.replace(mediaExtension, ''))?.[1]
          if (!id) continue
          const safe = await assertContainedRegularFile(file, channel.outputDir, 'Nhập video Reels')
          if ((await lstat(safe)).size === 0) continue
          this.remember(data, id, { file: safe, root: channel.outputDir })
          if (!channel.ids.includes(id)) channel.ids.push(id)
        }
      }
    }
    await scan(channel.outputDir, 0)
  }
  list(): Promise<FacebookReelsChannel[]> {
    return this.serialize(async () => this.channels(await this.load()))
  }
  /** Daily monitoring compares against all successful IDs, even if a file was later deleted. */
  historyIds(): Promise<string[]> {
    return this.serialize(async () => Object.keys((await this.load()).videos))
  }
  track(source: FacebookReelsChannelSource, folder: string): Promise<FacebookReelsChannel[]> {
    return this.serialize(async () => {
      this.source(source); await this.folder(folder)
      const data = await this.load(), channel = this.upsert(data, source, folder, true)
      await this.importFolder(data, channel); await this.save(data)
      return this.channels(data)
    })
  }
  updateFolder(url: string, folder: string): Promise<FacebookReelsChannel[]> {
    return this.serialize(async () => {
      const key = this.source({ url, name: '' }).key; await this.folder(folder)
      const data = await this.load(), ch = data.channels.find(c => c.key === key)
      if (!ch) throw Error('Kênh không còn trong thư viện.')
      ch.outputDir = folder; await this.importFolder(data, ch); await this.save(data)
      return this.channels(data)
    })
  }
  remove(url: string): Promise<FacebookReelsChannel[]> {
    return this.serialize(async () => {
      const key = this.source({ url, name: '' }).key, data = await this.load()
      data.channels = data.channels.filter(ch => ch.key !== key)
      await this.save(data); return this.channels(data)
    })
  }
  existing(id: string): Promise<VideoRecord | null> {
    return this.serialize(async () => {
      if (!videoId.test(id)) throw Error('Reel ID không hợp lệ.')
      const video = (await this.load()).videos[id]
      return this.findVideo(video)
    })
  }
  async recordCopy(id: string, file: string, root: string): Promise<void> {
    if (!videoId.test(id)) throw Error('Reel ID không hợp lệ.')
    await this.folder(root)
    const safe = await assertContainedRegularFile(file, root, 'Bản sao video Reels')
    if (!await this.usable({ file: safe, root })) throw Error('Bản sao video Reels không hợp lệ.')
    await this.serialize(async () => { const data = await this.load(); this.remember(data, id, { file: safe, root }); await this.save(data) })
  }
  async download(request: ReelRequest, operation: () => Promise<DownloadResult>, signal?: AbortSignal): Promise<DownloadResult> {
    if (signal?.aborted) throw Error('Đã hủy tải video.')
    const id = facebookReelId(request.url)
    if (!id || request.kind !== 'video') return operation()
    if (request.reelsSource) this.source(request.reelsSource)
    const previous = this.downloads.get(id) ?? Promise.resolve()
    const work = previous.catch(() => undefined).then(async () => {
      if (signal?.aborted) throw Error('Đã hủy tải video.')
      await this.folder(request.outputDir)
      const existing = request.forceOverwrite ? null : await this.existing(id)
      const result: DownloadResult = existing
        ? { ok: true, id, file: existing.file, skipped: true, error: null }
        : await operation()
      if (result.ok && result.file) {
        const file = existing?.file ?? await assertContainedRegularFile(result.file, request.outputDir, 'Video tải Reels')
        const root = existing?.root ?? request.outputDir
        if (!await this.usable({ file, root })) throw Error('Video Reels rỗng hoặc không hợp lệ.')
        await this.serialize(async () => {
          const data = await this.load(); this.remember(data, id, { file, root })
          // A cancelled background download can finish after the user removed
          // its channel. Retain successful ID history without re-adding it.
          if (request.reelsSource && !signal?.aborted) {
            const ch = this.upsert(data, request.reelsSource, request.outputDir)
            if (!ch.ids.includes(id)) ch.ids.push(id)
            ch.lastUpdated = new Date().toISOString()
          }
          await this.save(data)
        })
      }
      return result
    })
    this.downloads.set(id, work)
    // The lock outlives an aborted caller until its predecessor settles; a third
    // request must still wait for the original download of this same Reel.
    void work.finally(() => { if (this.downloads.get(id) === work) this.downloads.delete(id) }).catch(() => undefined)
    if (!signal) return work
    let abort!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(Error('Đã hủy tải video.'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
    try { return await Promise.race([work, cancelled]) }
    finally { signal.removeEventListener('abort', abort) }
  }
}
