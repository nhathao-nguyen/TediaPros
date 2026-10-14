import type { OverlayTextureLayer } from './videoEffects'

/** Byte RGB model used to verify both Canvas and FFmpeg compositing. */
export function blendRgbChannel(base: number, texture: number, mode: OverlayTextureLayer['blendMode'] | 'add'): number {
  if (mode === 'multiply') return base * texture / 255
  if (mode === 'add') return Math.min(255, base + texture)
  return 255 - (255 - base) * (255 - texture) / 255
}

/**
 * Compile any Screen/Multiply stack into Multiply then Screen. The resulting
 * transparent DOM layers act on the existing preview (including subtitles),
 * without copying or replacing the source video. F(A)=A*K+C per RGB channel.
 */
export function compileRgbTextureOverlay(textures: ReadonlyArray<{ pixels: Uint8ClampedArray; blendMode: OverlayTextureLayer['blendMode'] }>, intensity: number,
  multiply: Uint8ClampedArray, screen: Uint8ClampedArray): void {
  if (multiply.length !== screen.length || textures.some(t => t.pixels.length !== screen.length)) throw new Error('Kích thước texture không khớp.')
  const strength = Math.max(0, Math.min(100, intensity)) / 100
  for (let p = 0; p < screen.length; p += 4) {
    for (let channel = 0; channel < 3; channel++) {
      let k = 1, c = 0
      for (const texture of textures) {
        const t = texture.pixels[p + channel] / 255
        if (texture.blendMode === 'multiply') { k *= t; c *= t } else { k *= 1 - t; c += (1 - c) * t }
      }
      c *= strength
      k = 1 - strength + strength * k
      screen[p + channel] = c * 255
      multiply[p + channel] = c >= 1 ? 255 : k / (1 - c) * 255
    }
    screen[p + 3] = 255
    multiply[p + 3] = 255
  }
}

export function compositeRgbTextures(base: Uint8ClampedArray, textures: ReadonlyArray<{ pixels: Uint8ClampedArray; blendMode: OverlayTextureLayer['blendMode'] }>, intensity: number): void {
  for (const texture of textures) if (texture.pixels.length !== base.length) throw new Error('Kích thước texture không khớp.')
  const strength = Math.max(0, Math.min(100, intensity)) / 100
  for (let p = 0; p < base.length; p += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const original = base[p + channel]
      let result = original
      for (const texture of textures) result = blendRgbChannel(result, texture.pixels[p + channel], texture.blendMode)
      base[p + channel] = original + (result - original) * strength
    }
  }
}
