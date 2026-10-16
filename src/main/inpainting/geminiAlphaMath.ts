import profile from './geminiAlphaProfile.json'
import type { PixelRegion } from '../../shared/types'

export const GEMINI_ALPHA_REVISION = profile.revision
export function alphaProfile(width: number, height: number, region: PixelRegion) {
  if (width !== 720 || height !== 1280) throw new Error('Mẫu Alpha hiện hỗ trợ video 720×1280. Video khác cần hiệu chỉnh mẫu; hãy dùng STTN vùng thủ công.')
  if (![region.x0, region.y0, region.x1, region.y1].every(Number.isFinite) || region.x0 < 0 || region.y0 < 0 || region.x1 > width || region.y1 > height || region.x0 >= region.x1 || region.y0 >= region.y1) throw new Error('Vùng Alpha không hợp lệ.')
  // The visible logo footprint, not the larger calibration context.
  if (region.x0 > footprint.x0 || region.y0 > footprint.y0 || region.x1 < footprint.x1 || region.y1 < footprint.y1) {
    throw new Error('Vùng khoanh chưa bao phủ logo của mẫu Alpha. Chọn vùng quanh logo góc dưới phải.')
  }
  return { x: 555, y: 1115, size: 90, alpha: profile.alpha }
}

function highPass(values: ArrayLike<number>): number[] {
  const out = new Array<number>(8100)
  for (let y = 0; y < 90; y++) for (let x = 0; x < 90; x++) {
    let sum = 0, count = 0
    for (let yy = Math.max(0, y - 4); yy <= Math.min(89, y + 4); yy++) {
      for (let xx = Math.max(0, x - 4); xx <= Math.min(89, x + 4); xx++) { sum += values[yy * 90 + xx]; count++ }
    }
    out[y * 90 + x] = values[y * 90 + x] - sum / count
  }
  return out
}

const template = highPass(profile.alpha)
export function alphaEvidence(gray: ArrayLike<number>): { score: number; opacityRatio: number } {
  if (gray.length !== 8100) throw new Error('Mẫu kiểm tra Alpha thiếu pixel.')
  const signal = highPass(gray)
  let xy = 0, xx = 0, yy = 0
  for (let i = 0; i < 8100; i++) { if (Math.abs(template[i]) < .004) continue; xy += template[i] * signal[i]; xx += template[i] ** 2; yy += signal[i] ** 2 }
  let background = 0, count = 0
  for (let i = 0; i < 8100; i++) if (!profile.alpha[i]) { background += gray[i]; count++ }
  const contrast = 255 - background / Math.max(count, 1)
  return { score: xx && yy ? xy / Math.sqrt(xx * yy) : 0,
    opacityRatio: xx && contrast > 20 ? xy / xx / contrast : 0 }
}

export function alphaMatch(gray: ArrayLike<number>): number { return alphaEvidence(gray).score }

// Narrow boundary only. A fixed mask avoids frame-dependent correction/flicker.
const ring: number[] = []
for (let y = 1; y < 89; y++) for (let x = 1; x < 89; x++) {
  let inside = false, outside = false
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (profile.alpha[(y + dy) * 90 + x + dx] > .06) inside = true
    else outside = true
  }
  if (inside && outside) ring.push(y * 90 + x)
}
const ringSet = new Set(ring)
const footprint = { x0: 645, y0: 1205, x1: 555, y1: 1115 }
for (let i = 0; i < 8100; i++) if (profile.alpha[i] || ringSet.has(i)) {
  const x = 555 + i % 90, y = 1115 + Math.floor(i / 90)
  footprint.x0 = Math.min(footprint.x0, x); footprint.y0 = Math.min(footprint.y0, y)
  footprint.x1 = Math.max(footprint.x1, x + 1); footprint.y1 = Math.max(footprint.y1, y + 1)
}

/** Inverse blend, then local harmonic inpainting of the thin boundary. */
export function applyGeminiAlpha(rgb: Uint8Array, width: number, cleanEdges = true): void {
  if (width !== 720 || rgb.length !== 720 * 1280 * 3) throw new Error('Frame Alpha sai kích thước.')
  const patch = new Float64Array(8100 * 3)
  for (let y = 0; y < 90; y++) for (let x = 0; x < 90; x++) {
    const i = y * 90 + x, offset = ((1115 + y) * width + 555 + x) * 3, a = profile.alpha[i]
    for (let c = 0; c < 3; c++) patch[i * 3 + c] = Math.max(0, Math.min(255, (rgb[offset + c] - 255 * a) / (1 - a)))
  }
  if (cleanEdges) {
    // Initialize from unmasked nearest neighbors; solve Laplace over the band.
    for (const i of ring) for (let c = 0; c < 3; c++) {
      let sum = 0, count = 0
      for (const d of [-180, -90, -2, -1, 1, 2, 90, 180]) {
        if (i + d >= 0 && i + d < 8100 && !ringSet.has(i + d)) { sum += patch[(i + d) * 3 + c]; count++ }
      }
      if (count) patch[i * 3 + c] = sum / count
    }
    for (let iteration = 0; iteration < 16; iteration++) for (const i of ring) for (let c = 0; c < 3; c++) {
      patch[i * 3 + c] = (patch[(i - 90) * 3 + c] + patch[(i + 90) * 3 + c] + patch[(i - 1) * 3 + c] + patch[(i + 1) * 3 + c]) / 4
    }
  }
  for (let y = 0; y < 90; y++) for (let x = 0; x < 90; x++) {
    const i = y * 90 + x
    if (!profile.alpha[i] && !(cleanEdges && ringSet.has(i))) continue
    const offset = ((1115 + y) * width + 555 + x) * 3
    for (let c = 0; c < 3; c++) rgb[offset + c] = Math.round(patch[i * 3 + c])
  }
}
