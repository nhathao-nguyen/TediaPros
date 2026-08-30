import { readdir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join } from 'node:path'
import type { AutoShortMusicLibraryResult, AutoShortMusicTrack } from '../shared/types'

const SUPPORTED_AUTO_SHORT_MUSIC_EXTENSIONS = new Set([
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'
])

async function resolveMusicFolder(folderPath: string): Promise<string> {
  try {
    return await realpath(folderPath)
  } catch {
    throw new Error('Folder nhạc không tồn tại hoặc không thể mở.')
  }
}

async function resolveMusicTrack(trackPath: string): Promise<string> {
  try {
    return await realpath(trackPath)
  } catch {
    throw new Error('Bài nhạc background không còn tồn tại hoặc không thể mở.')
  }
}

export async function validateAutoShortMusicTrack(folderPath: string, trackPath: string): Promise<string> {
  if (!isAbsolute(folderPath) || !isAbsolute(trackPath)) {
    throw new Error('Đường dẫn folder nhạc và bài nhạc phải là đường dẫn tuyệt đối.')
  }
  const [folder, track] = await Promise.all([resolveMusicFolder(folderPath), resolveMusicTrack(trackPath)])
  const sameParent = process.platform === 'win32'
    ? dirname(track).toLowerCase() === folder.toLowerCase()
    : dirname(track) === folder
  if (!sameParent) throw new Error('Bài nhạc không thuộc trực tiếp folder nhạc đã chọn.')
  if (!SUPPORTED_AUTO_SHORT_MUSIC_EXTENSIONS.has(extname(track).toLocaleLowerCase())) {
    throw new Error('Định dạng nhạc background không được hỗ trợ.')
  }
  const info = await stat(track).catch(() => null)
  if (!info?.isFile() || info.size <= 0) throw new Error('File nhạc background không hợp lệ.')
  return track
}

export async function listAutoShortMusicTracks(folderPath: string): Promise<AutoShortMusicLibraryResult> {
  try {
    if (!isAbsolute(folderPath)) throw new Error('Đường dẫn folder nhạc phải là đường dẫn tuyệt đối.')
    const folder = await resolveMusicFolder(folderPath)
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => {
      throw new Error('Folder nhạc không tồn tại hoặc không thể mở.')
    })
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
