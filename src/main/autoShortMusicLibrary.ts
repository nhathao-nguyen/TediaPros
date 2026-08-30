import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type { AutoShortMusicLibraryResult, AutoShortMusicTrack } from '../shared/types'

const SUPPORTED_AUTO_SHORT_MUSIC_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'
])

export async function validateAutoShortMusicTrack(folderPath: string, trackPath: string): Promise<string> {
  const [folder, track] = await Promise.all([realpath(folderPath), realpath(trackPath)])
  const sameParent = process.platform === 'win32'
    ? dirname(track).toLowerCase() === folder.toLowerCase()
    : dirname(track) === folder
  if (!sameParent) throw new Error('Bài nhạc không thuộc trực tiếp folder nhạc đã chọn.')
  if (!SUPPORTED_AUTO_SHORT_MUSIC_EXTENSIONS.has(extname(track).toLocaleLowerCase())) {
    throw new Error('Định dạng nhạc background không được hỗ trợ.')
  }
  const info = await stat(track)
  if (!info.isFile() || info.size <= 0) throw new Error('File nhạc background không hợp lệ.')
  return track
}

export async function listAutoShortMusicTracks(folderPath: string): Promise<AutoShortMusicLibraryResult> {
  try {
    const folder = await realpath(folderPath)
    const entries = await readdir(folder, { withFileTypes: true })
    const tracks: AutoShortMusicTrack[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const candidate = join(folder, entry.name)
      try {
        const path = await validateAutoShortMusicTrack(folder, candidate)
        tracks.push({ name: entry.name, path })
      } catch {
        // Ignore unsupported, empty, or otherwise invalid files in the catalog.
      }
    }
    tracks.sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base', numeric: true }))
    return { ok: true, folderPath: folder, tracks }
  } catch (error) {
    return { ok: false, tracks: [], error: error instanceof Error ? error.message : 'Folder nhạc không hợp lệ.' }
  }
}
