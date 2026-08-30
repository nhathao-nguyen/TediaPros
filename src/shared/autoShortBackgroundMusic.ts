import type { AutoShortBackgroundMusicMode } from './types'

export interface AutoShortMusicAssignmentInput {
  mode: AutoShortBackgroundMusicMode
  itemIds: readonly string[]
  trackPaths: readonly string[]
  selectedTrackPath?: string
  perVideoAssignments?: Readonly<Record<string, string>>
  random?: () => number
}

export type AutoShortMusicAssignmentResult =
  | { ok: true; assignments: Record<string, string> }
  | { ok: false; error: string }

export function createAutoShortMusicAssignments(
  input: AutoShortMusicAssignmentInput
): AutoShortMusicAssignmentResult {
  if (input.itemIds.length === 0) return { ok: false, error: 'Hàng đợi chưa có video.' }
  if (input.trackPaths.length === 0) return { ok: false, error: 'Folder nhạc không có file âm thanh được hỗ trợ.' }
  const allowed = new Set(input.trackPaths)
  const assignments: Record<string, string> = {}
  if (input.mode === 'single') {
    if (!input.selectedTrackPath || !allowed.has(input.selectedTrackPath)) {
      return { ok: false, error: 'Chưa chọn bài nhạc dùng cho tất cả video.' }
    }
    for (const id of input.itemIds) assignments[id] = input.selectedTrackPath
  } else if (input.mode === 'random') {
    const random = input.random || Math.random
    for (const id of input.itemIds) {
      const index = Math.min(input.trackPaths.length - 1, Math.max(0, Math.floor(random() * input.trackPaths.length)))
      assignments[id] = input.trackPaths[index]
    }
  } else {
    for (const id of input.itemIds) {
      const path = input.perVideoAssignments?.[id]
      if (!path || !allowed.has(path)) return { ok: false, error: `Video ${id} chưa chọn nhạc background.` }
      assignments[id] = path
    }
  }
  return { ok: true, assignments }
}
