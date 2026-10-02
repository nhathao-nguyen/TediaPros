import { detectSite } from './sites'
import type { PlaylistEntry, PlaylistProbe } from './types'

export interface FacebookReelsSource {
  key: string
  url: string
  kind: 'profile' | 'feed'
  profileId: string | null
  slug: string | null
}

export interface FacebookReelsChannelSource { url: string; name: string }
export interface FacebookReelsChannel extends FacebookReelsChannelSource {
  key: string
  outputDir: string
  downloaded: number
  downloadedIds: string[]
  lastUpdated: string
}
export interface FacebookReelsLibraryResult {
  ok: boolean
  channels?: FacebookReelsChannel[]
  error?: string
}

/** Reel IDs keep equal titles from resolving to the same output file. */
export function reelsOutputTemplate(template: string, id: string): string {
  const value = template.trim() || '%(title)s [%(id)s].%(ext)s'
  if (value.includes('%(id)') || value.includes(id)) return value
  return value.includes('.%(ext)s') ? value.replace('.%(ext)s', ' [%(id)s].%(ext)s') : value + ' [%(id)s].%(ext)s'
}

const reserved = new Set(['groups', 'watch', 'reel', 'share', 'login', 'checkpoint', 'photo',
  'photo.php', 'photos', 'video.php', 'videos', 'stories', 'story.php', 'posts', 'events',
  'marketplace', 'gaming', 'search', 'settings', 'help', 'business', 'recover', 'friends'])

/** Only recognized profile routes become a Reels source; never append to arbitrary paths. */
export function facebookReelsSource(raw: string): FacebookReelsSource | null {
  try {
    const u = new URL(raw)
    if (detectSite(raw) !== 'facebook' || u.username || u.password) return null
    const host = u.hostname.toLowerCase().replace(/\.+$/, '')
    if (host === 'fb.watch' || host.endsWith('.fb.watch')) return null
    const parts = u.pathname.split('/').filter(Boolean)
    const lower = parts.map(p => p.toLowerCase())
    if (lower.length === 1 && lower[0] === 'reels') {
      return { key: 'feed', url: 'https://www.facebook.com/reels/', kind: 'feed', profileId: null, slug: null }
    }
    let id: string | null = null
    let slug: string | null = null
    if (lower[0] === 'profile.php' && parts.length === 1) {
      id = u.searchParams.get('id')
      if (!id || !/^\d{5,30}$/.test(id)) return null
    } else if ((lower[0] === 'pages' || lower[0] === 'people') &&
      (parts.length === 3 || (parts.length === 4 && lower[3] === 'reels'))) {
      id = parts[2]
      if (!/^\d{5,30}$/.test(id)) return null
    } else if ((parts.length === 1 || (parts.length === 2 && ['reels', 'reel_tab'].includes(lower[1]))) &&
      !reserved.has(lower[0]) && /^[a-zA-Z0-9._-]+$/.test(parts[0] ?? '')) {
      if (/^\d{5,30}$/.test(parts[0])) id = parts[0]
      else slug = parts[0]
    } else return null
    return {
      key: id ? `profile:${id}` : `slug:${slug!.toLowerCase()}`,
      url: id ? `https://www.facebook.com/profile.php?id=${id}&sk=reels_tab` : `https://www.facebook.com/${slug}/reels/`,
      kind: 'profile', profileId: id, slug
    }
  } catch { return null }
}

export type FacebookReelsStopReason = 'end-of-list' | 'limit' | 'resource-limit' | 'deadline' |
  'stalled' | 'cancelled' | 'login-required' | 'checkpoint' | 'rate-limited' | 'network-error'
export interface FacebookReelsSummary {
  sourceUrl: string
  completion: 'complete' | 'partial' | 'cancelled'
  stopReason: FacebookReelsStopReason
  discoveredCount: number
  resumeKey?: string
  warnings: string[]
  pageTitle?: string
  profileId?: string | null
}
export interface FacebookReelsRequest {
  url: string
  useCookies?: boolean
  proxy?: string | null
  /** null means scan until the source ends, subject to resource/deadline protection. */
  maxEntries?: number | null
  resumeKey?: string
}
export interface FacebookReelsProgress {
  jobId: string
  phase: 'opening' | 'scanning' | 'metadata' | 'exporting' | 'done'
  discoveredCount: number
  message: string
  exportRow?: FacebookReelsExportRow
}
export interface FacebookReelsStartResult { ok: boolean; jobId?: string; error?: string }
export interface FacebookReelsResult { ok: boolean; playlist?: PlaylistProbe; error?: string }
export interface FacebookReelsMetadataResult { ok: boolean; entries?: PlaylistEntry[]; error?: string }
export interface FacebookReelsExportRequest {
  ids: string[]
  outputRoot: string
  downloadVideos: boolean
  folderName?: string
}
export type FacebookReelsExportStage = 'pending' | 'success' | 'missing' | 'no-link' | 'no-article' | 'error' | 'cancelled' | 'disabled'
export interface FacebookReelsExportRow {
  index: number; id: string; reelUrl: string; title: string; caption: string;
  targetUrl: string | null; foundIn: 'caption' | 'comment' | null;
  articleTitle: string; content: string; captionPath: string | null; articlePath: string | null; videoPath: string | null;
  captionStatus: FacebookReelsExportStage; articleStatus: FacebookReelsExportStage; videoStatus: FacebookReelsExportStage;
  errors: string[]
}
export interface FacebookReelsExportResult {
  rows: FacebookReelsExportRow[]; directory: string; excelPath: string; manifestPath: string; cancelled: boolean
}
export interface FacebookReelsExportResponse { ok: boolean; result?: FacebookReelsExportResult; error?: string }
export interface FacebookReelMetadata {
  ownerId?: string
  links?: { url: string; foundIn: 'caption' | 'comment' }[]
  caption: string | null
  titleSource: 'graphql' | 'ytdlp' | 'dom' | 'missing'
  status: 'verified' | 'unverified' | 'missing' | 'error'
  /** Membership was established by this profile's owner-checked collection, independently of caption. */
  sourceVerified?: boolean
}

export function facebookReelId(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (detectSite(raw) !== 'facebook' || u.username || u.password) return null
    return /^\/reel\/(\d{5,30})\/?$/.exec(u.pathname)?.[1] ?? null
  } catch { return null }
}

export function facebookReelEntry(id: string, caption: string | null = null,
  titleSource: FacebookReelMetadata['titleSource'] = 'missing', uploader: string | null = null): PlaylistEntry {
  const text = caption?.trim() || null
  return { id, url: `https://www.facebook.com/reel/${id}/`,
    title: text?.split(/\r?\n/).find(line => line.trim())?.trim() || `Facebook Reel ${id}`,
    uploader, duration: null, durationString: null, isPlaylist: false,
    facebook: { caption: text, titleSource: text ? titleSource : 'missing',
      status: text ? (titleSource === 'dom' ? 'unverified' : 'verified') : 'missing' } }
}

/** Merge only the same ID. Verified metadata wins over a provisional DOM label. */
export function mergeFacebookReel(old: PlaylistEntry, next: PlaylistEntry): PlaylistEntry {
  if (old.id !== next.id) return old
  if(next.facebook?.ownerId&&!old.facebook?.ownerId)old={...old,facebook:{...old.facebook!,ownerId:next.facebook.ownerId}}
  const links=[...(old.facebook?.links??[])]
  for(const link of next.facebook?.links??[]) if(!links.some(l=>l.url===link.url&&l.foundIn===link.foundIn)) links.push(link)
  if(links.length && links.length!==(old.facebook?.links?.length??0)) old={...old,facebook:{...old.facebook!,links}}
  if (next.facebook?.sourceVerified && !old.facebook?.sourceVerified) old = { ...old,
    uploader: next.uploader ?? old.uploader, facebook: { ...old.facebook!, sourceVerified: true } }
  const rank = (entry: PlaylistEntry): number => entry.facebook?.status === 'verified' ? 3 :
    entry.facebook?.status === 'unverified' ? 1 : 0
  if (rank(next) < rank(old) || !next.facebook?.caption) return old
  if (rank(next) === rank(old) && (old.facebook?.caption?.length ?? 0) >= next.facebook.caption.length) return old
  return { ...old, ...next, uploader: next.uploader ?? old.uploader,
    facebook: { ...next.facebook!, ownerId:next.facebook?.ownerId??old.facebook?.ownerId, ...(links.length?{links}:{}), sourceVerified: !!(old.facebook?.sourceVerified || next.facebook?.sourceVerified) } }
}

export function facebookReelsStopMessage(reason: FacebookReelsStopReason): string {
  return ({ 'end-of-list': 'Đã xác nhận hết danh sách Reels.', limit: 'Đã đạt số Reel bạn chọn.',
    'resource-limit': 'Đã đạt ngưỡng tài nguyên của lượt quét.',
    deadline: 'Đã hết thời gian của lượt quét. Có thể tiếp tục.',
    stalled: 'Trang không tải thêm dữ liệu; chưa xác nhận hết danh sách.',
    cancelled: 'Đã dừng quét và giữ các Reel đã tìm thấy.',
    'login-required': 'Facebook yêu cầu đăng nhập để xem thêm Reels.',
    checkpoint: 'Facebook yêu cầu kiểm tra tài khoản.',
    'rate-limited': 'Facebook đang giới hạn truy cập. Hãy thử lại sau.',
    'network-error': 'Kết nối bị gián đoạn; đã giữ phần danh sách tìm thấy.' })[reason]
}

export function sanitizeFolderName(name: string | null | undefined): string {
  if (!name || typeof name !== 'string') return ''
  let cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  if (!cleaned) return ''
  const baseUpper = cleaned.toUpperCase().split('.')[0]
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/
  if (reserved.test(baseUpper)) {
    cleaned = `${cleaned}_folder`
  }
  return cleaned.slice(0, 150).trim().replace(/[. ]+$/, '')
}

export function buildFacebookReelsFolderName(options: {
  pageTitle?: string | null
  profileId?: string | null
  uploader?: string | null
  ownerId?: string | null
  sourceUrl?: string | null
}): string {
  const page = (options.pageTitle?.trim() && options.pageTitle.trim() !== 'Facebook' ? options.pageTitle.trim() : null) ||
    options.uploader?.trim() || null
  let id = options.profileId?.trim() || options.ownerId?.trim() || null
  if (!id && options.sourceUrl) {
    const src = facebookReelsSource(options.sourceUrl)
    id = src?.profileId || src?.slug || null
  }
  let raw = ''
  if (page && id) raw = `${page} - ${id}`
  else if (page) raw = page
  else if (id) raw = `Facebook - ${id}`
  return sanitizeFolderName(raw)
}
