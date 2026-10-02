import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { DEFAULT_REELS_MONITOR_SETTINGS, validateReelsMonitorTime, validateReelsWatch,
  type ReelsMonitorSettings, type ReelsWatch, type ReelsNotice } from '../shared/facebookReelsMonitor'

interface StoredMonitor { version: 1; settings: ReelsMonitorSettings; watches: ReelsWatch[]; notices: ReelsNotice[] }
export class ReelsMonitorStore {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly root: string) {}
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const work = this.pending.then(action); this.pending = work.catch(() => undefined); return work
  }
  private async load(): Promise<StoredMonitor> {
    await mkdir(this.root, { recursive: true })
    const path = join(this.root, 'monitor.json')
    try { await lstat(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1,
        settings: { ...DEFAULT_REELS_MONITOR_SETTINGS }, watches: [], notices: [] }
      throw error
    }
    await assertContainedRegularFile(path, this.root, 'Theo dõi Reels')
    if ((await lstat(path)).size > 8 * 1024 * 1024) throw Error('Dữ liệu theo dõi Reels quá lớn.')
    const data = JSON.parse(await readFile(path, 'utf8')) as StoredMonitor
    if (data.version !== 1 || data.settings?.timezone !== 'Asia/Ho_Chi_Minh' || !Array.isArray(data.watches) ||
      data.watches.length > 500 || !Array.isArray(data.notices) || data.notices.length > 100) throw Error('Dữ liệu theo dõi Reels không hợp lệ.')
    validateReelsMonitorTime(data.settings.time)
    data.watches.forEach(validateReelsWatch)
    if (new Set(data.watches.map(w => w.key)).size !== data.watches.length) throw Error('Kênh theo dõi bị trùng.')
    for (const n of data.notices) {
      if (!n || typeof n.id !== 'string' || typeof n.channelKey !== 'string' || typeof n.channelName !== 'string' ||
        typeof n.createdAt !== 'string' || !Number.isFinite(Date.parse(n.createdAt)) || typeof n.read !== 'boolean' ||
        !['running','success','partial','error','cancelled'].includes(n.status) || typeof n.message !== 'string' ||
        n.message.length > 2000 || typeof n.outputDir !== 'string' || !isAbsolute(n.outputDir) ||
        [n.found,n.downloaded,n.skipped,n.failed].some(count => !Number.isInteger(count) || count < 0 || count > 10000) ||
        !Array.isArray(n.videos) || n.videos.length > 100 || n.videos.some(v => !v || !/^\d{5,30}$/.test(v.id) ||
          typeof v.title !== 'string' || typeof v.file !== 'string' || !isAbsolute(v.file))) throw Error('Thông báo Reels không hợp lệ.')
    }
    return data
  }
  private async save(data: StoredMonitor): Promise<void> {
    const path = join(this.root, 'monitor.json'), temp = join(this.root, `${randomUUID()}.tmp`), raw = JSON.stringify(data, null, 2)
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw Error('Dữ liệu theo dõi Reels quá lớn.')
    await assertContainedParentDirectory(path, this.root, 'Lưu theo dõi Reels')
    try { await writeFile(temp, raw, { flag: 'wx' }); await rename(temp, path) }
    finally { await rm(temp, { force: true }) }
  }
  read(): Promise<StoredMonitor> { return this.serialize(() => this.load()) }
  setTime(time: string): Promise<void> {
    validateReelsMonitorTime(time)
    return this.serialize(async () => { const data = await this.load(); data.settings.time = time; await this.save(data) })
  }
  setWatch(watch: ReelsWatch): Promise<void> {
    validateReelsWatch(watch)
    return this.serialize(async () => {
      const data = await this.load(), existing = data.watches.find(w => w.key === watch.key)
      if (existing) Object.assign(existing, watch, { lastDay: existing.lastDay, lastChecked: existing.lastChecked })
      else { if (data.watches.length >= 500) throw Error('Tối đa 500 kênh theo dõi.'); data.watches.push(watch) }
      await this.save(data)
    })
  }
  reserve(key: string, day: string, createdAt: string, outputDir: string, manual = false): Promise<ReelsNotice | null> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(createdAt)) || !isAbsolute(outputDir)) throw Error('Lượt theo dõi không hợp lệ.')
    return this.serialize(async () => {
      const data = await this.load(), watch = data.watches.find(w => w.key === key)
      if (!watch?.enabled || (!manual && watch.lastDay && watch.lastDay >= day) || data.notices.some(n => n.status === 'running')) return null
      watch.lastDay = day; watch.lastChecked = createdAt
      const notice: ReelsNotice = { id: randomUUID(), channelKey: key, channelName: watch.name, createdAt, read: false,
        status: 'running', found: 0, downloaded: 0, skipped: 0, failed: 0, message: 'Đang kiểm tra video mới…', outputDir, videos: [] }
      data.notices.unshift(notice); data.notices = data.notices.slice(0, 100); await this.save(data); return notice
    })
  }
  updateNotice(notice: ReelsNotice): Promise<void> {
    return this.serialize(async () => {
      const data = await this.load(), index = data.notices.findIndex(n => n.id === notice.id)
      if (index === -1) throw Error('Thông báo lượt tải không còn tồn tại.')
      const previous = data.notices[index]
      data.notices[index] = { ...notice, read: previous.status === 'running' && notice.status !== 'running' ? false : previous.read }; await this.save(data)
    })
  }
  markRead(ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')) throw Error('Danh sách thông báo không hợp lệ.')
    return this.serialize(async () => {
      const data = await this.load(), selected = new Set(ids)
      for (const notice of data.notices) if (selected.has(notice.id)) notice.read = true
      await this.save(data)
    })
  }
  deleteNotices(ids: string[]): Promise<void> {
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string' || id.length > 100)) throw Error('Danh sách thông báo không hợp lệ.')
    return this.serialize(async () => {
      const data = await this.load(), selected = new Set(ids)
      if (data.notices.some(n => selected.has(n.id) && n.status === 'running')) throw Error('Hãy chờ lượt kiểm tra kết thúc trước khi xóa thông báo của lượt đó.')
      // Remove only the IDs shown to the user; concurrent new notices and the
      // durable daily claim remain intact. Video history lives in another store.
      data.notices = data.notices.filter(n => !selected.has(n.id))
      await this.save(data)
    })
  }
  recover(): Promise<void> {
    return this.serialize(async () => {
      const data = await this.load()
      for (const notice of data.notices) if (notice.status === 'running') {
        notice.status = 'error'; notice.read = false
        notice.message = 'Lượt kiểm tra bị gián đoạn khi ứng dụng đóng. Video đã tải vẫn được giữ; kiểm tra lại ở lượt kế tiếp hoặc bấm Kiểm tra ngay.'
      }
      await this.save(data)
    })
  }
}
