/** RGB keying shared by the browser preview and the FFmpeg colorkey branch. */
export interface OverlayChromaKey {
  color: string
  similarity: number
  blend: number
}

export function normalizeOverlayChromaKey(value: unknown): OverlayChromaKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Chroma Key không hợp lệ.')
  const key = value as Record<string, unknown>
  if (typeof key.color !== 'string' || !/^#[\da-f]{6}$/i.test(key.color) ||
    typeof key.similarity !== 'number' || !Number.isFinite(key.similarity) || key.similarity < 0.00001 || key.similarity > 1 ||
    typeof key.blend !== 'number' || !Number.isFinite(key.blend) || key.blend < 0 || key.blend > 1) {
    throw new Error('Màu hoặc thông số Chroma Key không hợp lệ.')
  }
  return { color: key.color.toUpperCase(), similarity: key.similarity, blend: key.blend }
}

export function chromaKeySpillChannel(key: OverlayChromaKey): 'green' | 'blue' | undefined {
  if (key.color.toUpperCase() === '#00FF00') return 'green'
  if (key.color.toUpperCase() === '#0000FF') return 'blue'
  return undefined
}

/** Operates on an opaque decoded frame. Alpha is independent of the backing color. */
export function applyOverlayChromaKey(pixels: Uint8ClampedArray, key: OverlayChromaKey): void {
  const color = Number.parseInt(key.color.slice(1), 16)
  const keyR = color >>> 16
  const keyG = (color >>> 8) & 255
  const keyB = color & 255
  const spill = chromaKeySpillChannel(key)
  for (let p = 0; p < pixels.length; p += 4) {
    const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2]
    const distance = Math.hypot(r - keyR, g - keyG, b - keyB) / (255 * Math.sqrt(3))
    const alpha = key.blend > 0.0001 ? Math.max(0, Math.min(1, (distance - key.similarity) / key.blend)) : Number(distance > key.similarity)
    pixels[p + 3] = Math.floor(alpha * 255)
    // Suppress color spill without altering the computed alpha or neutral smoke.
    if (spill === 'green') pixels[p + 1] = Math.floor(Math.min(g, (r + b) / 2))
    if (spill === 'blue') pixels[p + 2] = Math.floor(Math.min(b, (r + g) / 2))
  }
}
