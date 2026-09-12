/** Static decoration uses the FINAL output canvas, including portrait padding. */
export interface AutoShortOverlayImageAsset {
  path: string
  sha256: string
}

export type AutoShortOverlayImageResult =
  | { ok: true; asset: AutoShortOverlayImageAsset | null }
  | { ok: false; error: string }

export interface AutoShortOverlays {
  image?: AutoShortOverlayImageAsset & { x: number; y: number; width: number; opacity: number }
  text?: { value: string; x: number; y: number; size: number; color: string; opacity: number }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cấu hình ảnh/chữ không hợp lệ.')
  return value as Record<string, unknown>
}

function bounded(raw: Record<string, unknown>, key: string, min: number, max: number): number {
  const value = raw[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Ảnh/chữ: ${key} phải nằm trong ${min}–${max}.`)
  }
  return value
}

export function normalizeAutoShortOverlays(value: unknown, allowEmptyText = false): AutoShortOverlays | undefined {
  if (value == null) return undefined
  const raw = record(value)
  const result: AutoShortOverlays = {}
  if (raw.image != null) {
    const image = record(raw.image)
    if (typeof image.path !== 'string' || image.path.length > 32768 || image.path.includes('\0') ||
      !/^(?:[A-Za-z]:[\\/]|\/)/.test(image.path) || image.path.split(/[\\/]/).includes('..') ||
      !/\.(png|jpe?g)$/i.test(image.path)) throw new Error('Chọn ảnh PNG hoặc JPG bằng đường dẫn tuyệt đối hợp lệ.')
    if (typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(image.sha256)) throw new Error('Ảnh thiếu checksum; hãy chọn lại ảnh.')
    result.image = {
      path: image.path, sha256: image.sha256,
      x: bounded(image, 'x', 0, 1), y: bounded(image, 'y', 0, 1),
      width: bounded(image, 'width', 0.02, 1), opacity: bounded(image, 'opacity', 0.05, 1)
    }
  }
  if (raw.text != null) {
    const text = record(raw.text)
    if (typeof text.value !== 'string' || (!allowEmptyText && !text.value.trim()) || text.value.length > 120 || /[\x00-\x1f\x7f]/.test(text.value)) {
      throw new Error('Chữ chèn phải có nội dung, tối đa 120 ký tự trên một dòng.')
    }
    if (typeof text.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(text.color)) throw new Error('Màu chữ chèn không hợp lệ.')
    result.text = {
      value: text.value, color: text.color,
      x: bounded(text, 'x', 0, 1), y: bounded(text, 'y', 0, 1),
      size: bounded(text, 'size', 0.01, 0.12), opacity: bounded(text, 'opacity', 0.05, 1)
    }
  }
  return result.image || result.text ? result : undefined
}

export function overlayImageGeometry(canvasW: number, canvasH: number, imageW: number, imageH: number,
  image: NonNullable<AutoShortOverlays['image']>) {
  const scale = Math.min(canvasW * image.width / imageW, canvasH * 0.8 / imageH)
  const width = Math.max(1, Math.floor(imageW * scale))
  const height = Math.max(1, Math.floor(imageH * scale))
  return { width, height, x: Math.round((canvasW - width) * image.x), y: Math.round((canvasH - height) * image.y) }
}

/** Width-aware single line: shrink long text instead of clipping its content. */
export function overlayTextGeometry(canvasW: number, canvasH: number, text: NonNullable<AutoShortOverlays['text']>,
  measure: (value: string, size: number) => number) {
  const desired = canvasH * text.size
  const size = Math.max(1, Math.min(desired, desired * canvasW * 0.9 / Math.max(1, measure(text.value, desired))))
  const width = Math.min(canvasW * 0.9, measure(text.value, size))
  const height = size * 1.4
  const padding = Math.max(1, size * 0.08)
  return { size, width, height, padding,
    x: padding + Math.max(0, canvasW - width - padding * 2) * text.x,
    y: padding + Math.max(0, canvasH - height - padding * 2) * text.y }
}
