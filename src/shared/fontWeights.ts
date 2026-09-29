export interface FontWeightOption {
  value: number
  label: string
}

export const ALL_FONT_WEIGHT_OPTIONS: ReadonlyArray<FontWeightOption> = [
  { value: 100, label: '100 · Siêu mảnh (Thin)' },
  { value: 200, label: '200 · Rất mảnh (Extra Light)' },
  { value: 300, label: '300 · Mảnh (Light)' },
  { value: 400, label: '400 · Thường (Regular)' },
  { value: 500, label: '500 · Vừa (Medium)' },
  { value: 600, label: '600 · Bán đậm (Semi-Bold)' },
  { value: 700, label: '700 · Đậm (Bold)' },
  { value: 800, label: '800 · Rất đậm (Extra Bold)' },
  { value: 900, label: '900 · Cực đậm (Black)' }
]

export const DEFAULT_FALLBACK_WEIGHT_OPTIONS: ReadonlyArray<FontWeightOption> = ALL_FONT_WEIGHT_OPTIONS

/**
 * Trả về danh sách các mức font-weight mà font đã chọn thực sự hỗ trợ.
 * - Ví dụ Oswald (200 - 700) -> [200, 300, 400, 500, 600, 700]
 * - Ví dụ Inter (100 - 900) -> [100, 200, 300, 400, 500, 600, 700, 800, 900]
 * - Ví dụ JetBrains Mono (100 - 800) -> [100, 200, 300, 400, 500, 600, 700, 800]
 * - Ví dụ Anton / Lobster / Pacifico (cố định 400) -> [400]
 */
export function getSupportedFontWeights(
  font?: { minWeight?: number; maxWeight?: number } | null
): FontWeightOption[] {
  if (!font || font.minWeight == null || font.maxWeight == null) {
    return [...DEFAULT_FALLBACK_WEIGHT_OPTIONS]
  }

  const min = font.minWeight
  const max = font.maxWeight

  if (min === max) {
    const matched = ALL_FONT_WEIGHT_OPTIONS.find((o) => o.value === min)
    return [matched || { value: min, label: `${min} · Mặc định` }]
  }

  const filtered = ALL_FONT_WEIGHT_OPTIONS.filter((o) => o.value >= min && o.value <= max)
  return filtered.length > 0 ? filtered : [{ value: 400, label: '400 · Thường (Regular)' }]
}

/**
 * Điều chỉnh giá trị font-weight hiện tại nếu vượt ra ngoài dải hỗ trợ của font mới chọn.
 * Tìm mức gần nhất trong các mức font hỗ trợ.
 */
export function clampFontWeight(
  currentWeight: number,
  font?: { minWeight?: number; maxWeight?: number } | null
): number {
  const options = getSupportedFontWeights(font)
  if (options.some((o) => o.value === currentWeight)) {
    return currentWeight
  }

  let closest = options[0].value
  let minDiff = Math.abs(currentWeight - closest)

  for (const opt of options) {
    const diff = Math.abs(currentWeight - opt.value)
    if (diff < minDiff) {
      minDiff = diff
      closest = opt.value
    }
  }

  return closest
}
