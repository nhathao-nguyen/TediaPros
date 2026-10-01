import { normalizeOverlayChromaKey, type OverlayChromaKey } from './overlayChromaKey'

/** Built-in procedural effects; order is the compositing order. */
export type VideoEffectKind = 'grain' | 'dust' | 'analog' | 'film_grunge' | 'custom_overlay'

export type OverlayBlendMode = 'screen' | 'alphamerge' | 'multiply' | 'add' | 'chromakey'

export interface VideoEffect {
  kind: VideoEffectKind
  intensity: number
  /** Đường dẫn file video overlay (.mp4/.mov) nếu là custom_overlay */
  assetPath?: string
  /** Đường dẫn file matte.mp4 (alpha mask) nếu có */
  mattePath?: string
  /** Chế độ hòa trộn: 'screen', 'alphamerge', hoặc 'multiply' */
  blendMode?: OverlayBlendMode
  chromaKey?: OverlayChromaKey
  /** Tên hiển thị */
  name?: string
  /** Nguồn hiệu ứng */
  sourceType?: 'builtin' | 'capcut' | 'saved' | 'custom'
}

export interface CapCutScannedEffect {
  id: string
  name: string
  folderPath: string
  videoPath: string
  mattePath?: string
  thumbnailPath?: string
  blendMode: OverlayBlendMode
  chromaKey?: OverlayChromaKey
  isPro: boolean
  aspectRatio: 'portrait' | 'landscape' | 'square' | 'unknown'
  isSaved?: boolean
}

export interface SavedOverlayEffect {
  id: string
  name: string
  videoPath: string
  mattePath?: string
  thumbnailPath?: string
  blendMode: OverlayBlendMode
  chromaKey?: OverlayChromaKey
  isPro: boolean
  savedAt: number
}

export const VIDEO_EFFECT_PRESETS = [
  { kind: 'grain', label: 'Nhiễu hạt', description: 'Hạt nhiễu nhỏ chuyển động, như chất phim.', intensity: 35 },
  { kind: 'dust', label: 'Bụi phim', description: 'Đốm bụi sáng xuất hiện ngẫu nhiên trên hình.', intensity: 55 },
  { kind: 'analog', label: 'Nhiễu analog', description: 'Nhiễu màu, lệch màu nhẹ và sọc quét ngang.', intensity: 35 },
  { kind: 'film_grunge', label: 'Bụi xước phim cũ', description: 'Vệt xước, hạt bụi và sợi tơ phim nhựa cổ điển.', intensity: 60 }
] as const satisfies ReadonlyArray<VideoEffect & { label: string; description: string }>

/** Reject invalid IPC/persisted input. Empty and zero-strength effects are legacy no-ops. */
export function normalizeVideoEffects(value: unknown): VideoEffect[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > 4) throw new Error('Chỉ hỗ trợ tối đa 4 lớp hiệu ứng.')
  const seen = new Set<string>()
  const result: VideoEffect[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Hiệu ứng không hợp lệ hoặc bị trùng.')
    }
    const isPreset = VIDEO_EFFECT_PRESETS.some(preset => preset.kind === item.kind)
    const isCustom = item.kind === 'custom_overlay'
    if (!isPreset && !isCustom) {
      throw new Error('Hiệu ứng không hợp lệ hoặc bị trùng.')
    }
    const dedupeKey = isCustom ? `custom:${item.assetPath || ''}` : item.kind
    if (seen.has(dedupeKey)) {
      throw new Error('Hiệu ứng không hợp lệ hoặc bị trùng.')
    }
    if (typeof item.intensity !== 'number' || !Number.isFinite(item.intensity) || item.intensity < 0 || item.intensity > 100) {
      throw new Error('Cường độ hiệu ứng phải nằm trong 0–100%.')
    }
    if (isCustom) {
      if (typeof item.assetPath !== 'string' || !item.assetPath.trim() || item.assetPath.includes('\0')) {
        throw new Error('Đường dẫn video hiệu ứng tùy chỉnh không hợp lệ.')
      }
      if (item.mattePath != null && (typeof item.mattePath !== 'string' || !item.mattePath.trim() || item.mattePath.includes('\0'))) {
        throw new Error('Đường dẫn matte không hợp lệ.')
      }
    }
    seen.add(dedupeKey)
    if (item.intensity > 0) {
      const entry: VideoEffect = { kind: item.kind, intensity: item.intensity }
      if (isCustom) {
        entry.assetPath = item.assetPath
        if (item.mattePath) entry.mattePath = item.mattePath
        if (item.blendMode === 'alphamerge' || item.blendMode === 'screen' || item.blendMode === 'add' || item.blendMode === 'multiply' || item.blendMode === 'chromakey') {
          entry.blendMode = item.blendMode
        }
        if (item.chromaKey != null) entry.chromaKey = normalizeOverlayChromaKey(item.chromaKey)
        if (entry.blendMode === 'chromakey' && !entry.chromaKey) throw new Error('Thiếu thông số Chroma Key.')
        if (typeof item.name === 'string' && item.name.trim()) entry.name = item.name.trim()
        if (item.sourceType) entry.sourceType = item.sourceType
      }
      result.push(entry)
    }
  }
  return result.length ? result : undefined
}

