import { facebookReelsSource } from './facebookReels'

export interface ReelsMonitorSettings { time: string; timezone: 'Asia/Ho_Chi_Minh' }
export interface ReelsWatch {
  key: string; url: string; name: string; enabled: boolean; enabledAt: string
  useCookies: boolean; account: string; lastDay?: string; lastChecked?: string
}
export interface ReelsNoticeVideo { id: string; title: string; file: string }
export interface ReelsNotice {
  id: string; channelKey: string; channelName: string; createdAt: string; read: boolean
  status: 'running' | 'success' | 'partial' | 'error' | 'cancelled'
  found: number; downloaded: number; skipped: number; failed: number
  message: string; outputDir: string; videos: ReelsNoticeVideo[]
}
export interface ReelsMonitorState {
  settings: ReelsMonitorSettings; watches: ReelsWatch[]; notices: ReelsNotice[]
  active: { key: string; name: string; message: string } | null
}
export interface ReelsMonitorResult { ok: boolean; state?: ReelsMonitorState; error?: string }
export interface ReelsWatchRequest { url: string; enabled: boolean; useCookies: boolean }

export const DEFAULT_REELS_MONITOR_SETTINGS: ReelsMonitorSettings = { time: '09:00', timezone: 'Asia/Ho_Chi_Minh' }
export function validateReelsMonitorTime(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('Giờ kiểm tra phải có dạng HH:mm.')
}
export function reelsLocalDay(now: number): string {
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
/** Latest daily slot due in Vietnam; multiple offline days collapse to one catch-up. */
export function reelsDueDay(now: number, time: string): string {
  validateReelsMonitorTime(time)
  const local = new Date(now + 7 * 60 * 60 * 1000)
  const [hours, minutes] = time.split(':').map(Number)
  if (local.getUTCHours() * 60 + local.getUTCMinutes() < hours * 60 + minutes) local.setUTCDate(local.getUTCDate() - 1)
  return local.toISOString().slice(0, 10)
}
export function reelsWatchDue(watch: ReelsWatch, now: number, time: string): boolean {
  const day = reelsDueDay(now, time)
  return watch.enabled && reelsLocalDay(Date.parse(watch.enabledAt)) <= day && (!watch.lastDay || watch.lastDay < day)
}
export function validateReelsWatch(watch: ReelsWatch): void {
  const source = facebookReelsSource(watch?.url)
  if (!source || source.kind !== 'profile' || source.key !== watch.key || typeof watch.name !== 'string' || watch.name.length > 200 ||
    typeof watch.enabled !== 'boolean' || typeof watch.useCookies !== 'boolean' || typeof watch.account !== 'string' ||
    !/^(?:guest|[a-f0-9]{64})$/.test(watch.account) || !Number.isFinite(Date.parse(watch.enabledAt)) ||
    (watch.lastDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(watch.lastDay))) throw Error('Cấu hình theo dõi Reels không hợp lệ.')
}
