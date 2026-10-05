import type { PlaylistEntry } from '../../../shared/types'
import { mergeFacebookReel, type FacebookReelsExportRow } from '../../../shared/facebookReels'

export async function loadMissingReelsCaptions(entries: PlaylistEntry[],
  load: (ids: string[]) => Promise<PlaylistEntry[]>, stopped: () => boolean,
  onUpdate?: (entries: PlaylistEntry[]) => void): Promise<PlaylistEntry[]> {
  let rows = [...entries]
  const ids = rows.filter(e => e.facebook && e.facebook.status !== 'verified').map(e => e.id)
  for (let offset = 0; offset < ids.length && !stopped(); offset += 1000) {
    const selected = ids.slice(offset, offset + 1000)
    const incoming = await load(selected)
    if (incoming.some(e => !selected.includes(e.id))) throw new Error('Caption trả về không thuộc các Reel đang lấy.')
    const updates = new Map(incoming.map(e => [e.id, e]))
    rows = rows.map(old => {
      const next = updates.get(old.id)
      if (!next) return old
      const merged = mergeFacebookReel(old, next)
      return next.facebook?.status === 'error' && old.facebook?.status !== 'verified' ? { ...merged, facebook: next.facebook } : merged
    })
    onUpdate?.(rows)
  }
  return rows
}

export type ReelsExportFilter = 'all' | 'issues' | 'article' | 'video' | 'no-link'
export function reelsPage<T>(entries: T[], requestedPage: number): { page: number; pages: number; rows: { e: T; i: number }[] } {
  const pages = Math.max(1, Math.ceil(entries.length / 50))
  const page = Math.max(1, Math.min(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1, pages))
  const start = (page - 1) * 50
  return { page, pages, rows: entries.slice(start, start + 50).map((e, i) => ({ e, i: start + i })) }
}
export function filterReelsEntries<T extends PlaylistEntry>(entries: T[], query: string): { e: T; i: number }[] {
  const needle = query.trim().toLocaleLowerCase()
  return entries.map((e, i) => ({ e, i })).filter(({ e }) => !needle ||
    [e.id, e.title, e.facebook?.caption, e.uploader].join('\n').toLocaleLowerCase().includes(needle))
}
export function reelsExportNeedsAttention(row: FacebookReelsExportRow): boolean {
  return row.errors.length > 0 || [row.captionStatus, row.articleStatus, row.videoStatus]
    .some(s => ['missing', 'no-link', 'no-article', 'error', 'cancelled'].includes(s))
}
export function filterReelsExportRows(rows: FacebookReelsExportRow[], query: string, filter: ReelsExportFilter): FacebookReelsExportRow[] {
  const needle = query.trim().toLocaleLowerCase()
  return rows.filter(r => (filter === 'all' ||
    (filter === 'issues' && reelsExportNeedsAttention(r)) ||
    (filter === 'article' && r.articleStatus === 'success') ||
    (filter === 'video' && r.videoStatus === 'success') ||
    (filter === 'no-link' && r.articleStatus === 'no-link')) &&
    (!needle || [r.id, r.title, r.caption, r.targetUrl, r.articleTitle, r.content, ...r.errors]
      .join('\n').toLocaleLowerCase().includes(needle)))
}

export type ReelsSelectionEntry = PlaylistEntry & { checked: boolean; playlistTitle: string }
export function reelsSelectionCounts(entries: ReelsSelectionEntry[]): { checked: number; reels: number; other: number } {
  const chosen = entries.filter(e => e.checked)
  const reels = chosen.filter(e => !!e.facebook).length
  return { checked: chosen.length, reels, other: chosen.length - reels }
}
export function reelsSelectionWindow<T>(entries: T[], requestedFrom: number, requestedTo: number): {
  from: number; to: number; rows: { e: T; i: number }[]; hidden: number
} {
  if (!entries.length) return { from: 0, to: 0, rows: [], hidden: 0 }
  const from = Math.max(1, Math.min(requestedFrom || 1, entries.length))
  const to = Math.max(from, Math.min(requestedTo || entries.length, entries.length))
  const rows = entries.slice(from - 1, Math.min(to, from - 1 + 500)).map((e, index) => ({ e, i: from - 1 + index }))
  return { from, to, rows, hidden: to - from + 1 - rows.length }
}
export function mergeReelsSelection(rows: ReelsSelectionEntry[], incoming: PlaylistEntry[], playlistTitle: string): ReelsSelectionEntry[] {
  const map = new Map(rows.map(e => [e.id, e]))
  for (const entry of incoming) {
    const old = map.get(entry.id)
    if (!old) map.set(entry.id, { ...entry, checked: true, playlistTitle })
    else {
      const merged = mergeFacebookReel(old, entry)
      map.set(entry.id, { ...merged, checked: old.checked, playlistTitle: old.playlistTitle,
        facebook: entry.facebook?.status === 'error' && old.facebook?.status !== 'verified' ? entry.facebook : merged.facebook })
    }
  }
  return [...map.values()]
}
