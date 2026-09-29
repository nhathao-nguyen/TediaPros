/** Built-in procedural effects; order is the compositing order. */
export type VideoEffectKind = 'grain' | 'dust' | 'analog'
export interface VideoEffect { kind: VideoEffectKind; intensity: number }
export const VIDEO_EFFECT_PRESETS = [
  { kind: 'grain', label: 'Nhiễu hạt', description: 'Hạt nhiễu nhỏ chuyển động, như chất phim.', intensity: 35 },
  { kind: 'dust', label: 'Bụi phim', description: 'Đốm bụi sáng xuất hiện ngẫu nhiên trên hình.', intensity: 55 },
  { kind: 'analog', label: 'Nhiễu analog', description: 'Nhiễu màu, lệch màu nhẹ và sọc quét ngang.', intensity: 35 }
] as const satisfies ReadonlyArray<VideoEffect & { label: string; description: string }>

/** Reject invalid IPC/persisted input. Empty and zero-strength effects are legacy no-ops. */
export function normalizeVideoEffects(value: unknown): VideoEffect[] | undefined {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > 3) throw new Error('Chỉ hỗ trợ tối đa 3 lớp hiệu ứng.')
  const seen = new Set<string>()
  const result: VideoEffect[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
      !VIDEO_EFFECT_PRESETS.some(preset => preset.kind === item.kind) || seen.has(item.kind)) {
      throw new Error('Hiệu ứng không hợp lệ hoặc bị trùng.')
    }
    if (typeof item.intensity !== 'number' || !Number.isFinite(item.intensity) || item.intensity < 0 || item.intensity > 100) {
      throw new Error('Cường độ hiệu ứng phải nằm trong 0–100%.')
    }
    seen.add(item.kind)
    if (item.intensity > 0) result.push({ kind: item.kind, intensity: item.intensity })
  }
  return result.length ? result : undefined
}
