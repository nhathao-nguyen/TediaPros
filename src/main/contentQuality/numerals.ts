export interface ContextualNumberToken {
  start: number
  end: number
  token: `num:${number}` | `ordinal:${number}`
}

const DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9
}
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

export function normalizeUnicodeDecimalDigits(text: string): string {
  return Array.from(text).map((character) => {
    const codePoint = character.codePointAt(0) || 0
    if (codePoint >= 0x0660 && codePoint <= 0x0669) return String(codePoint - 0x0660)
    if (codePoint >= 0x06f0 && codePoint <= 0x06f9) return String(codePoint - 0x06f0)
    if (codePoint >= 0x0966 && codePoint <= 0x096f) return String(codePoint - 0x0966)
    if (codePoint >= 0x0e50 && codePoint <= 0x0e59) return String(codePoint - 0x0e50)
    return character
  }).join('')
}

function parseSection(raw: string): number | null {
  if (!raw) return 0
  const text = raw.replace(/兩/gu, '两')
  if ([...text].every((character) => DIGITS[character] !== undefined)) {
    const digits = [...text].map((character) => DIGITS[character]).join('')
    return Number(digits)
  }
  let total = 0
  let pending: number | null = null
  let lastUnit = 10_000
  let sawUnit = false
  for (const character of text) {
    const digit = DIGITS[character]
    if (digit !== undefined) {
      if (digit === 0) {
        if (!sawUnit || pending !== null) return null
        continue
      }
      if (pending !== null) return null
      pending = digit
      continue
    }
    const unit = UNITS[character]
    if (!unit || unit >= lastUnit) return null
    const coefficient = pending ?? (unit === 10 && total === 0 ? 1 : 0)
    if (coefficient < 1) return null
    total += coefficient * unit
    pending = null
    lastUnit = unit
    sawUnit = true
  }
  if (!sawUnit) return null
  return total + (pending ?? 0)
}

export function parseChineseInteger(raw: string): number | null {
  const text = raw.normalize('NFKC').replace(/兩/gu, '两').replace(/萬/gu, '万')
  if (!text || /[^零〇一二两三四五六七八九十百千万]/u.test(text)) return null
  const parts = text.split('万')
  if (parts.length > 2) return null
  if (parts.length === 1) return parseSection(parts[0])
  const high = parseSection(parts[0])
  const low = parts[1] ? parseSection(parts[1]) : 0
  if (high == null || low == null || high < 1 || high > 9999 || low < 0 || low > 9999) return null
  return high * 10_000 + low
}

const VI_ORDINALS: Record<string, number> = {
  nhất: 1, hai: 2, ba: 3, tư: 4, bốn: 4, năm: 5,
  sáu: 6, bảy: 7, tám: 8, chín: 9, mười: 10
}
const EN_ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10
}

export function extractContextualNumberTokens(raw: string): readonly ContextualNumberToken[] {
  const text = raw.normalize('NFKC')
  const tokens: ContextualNumberToken[] = []
  const occupied = (start: number, end: number): boolean => tokens.some((item) => start < item.end && end > item.start)
  const add = (start: number, end: number, kind: 'num' | 'ordinal', value: number | null): void => {
    if (value == null || !Number.isSafeInteger(value) || occupied(start, end)) return
    tokens.push({ start, end, token: `${kind}:${value}` })
  }

  for (const match of text.matchAll(/第([零〇一二两兩三四五六七八九十百千万萬]+|\d+)(?=次|步|章|项|項|回|名|位)/gu)) {
    const numeral = match[1]
    add(match.index, match.index + match[0].length, 'ordinal', /^\d+$/u.test(numeral) ? Number(numeral) : parseChineseInteger(numeral))
  }
  for (const match of text.matchAll(/(?:lần|bước|chương|mục)\s+thứ\s+(nhất|hai|ba|tư|bốn|năm|sáu|bảy|tám|chín|mười|\d+)/giu)) {
    const word = match[1].toLowerCase()
    add(match.index, match.index + match[0].length, 'ordinal', /^\d+$/u.test(word) ? Number(word) : VI_ORDINALS[word] ?? null)
  }
  for (const match of text.matchAll(/(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))\s+(?:time|step|chapter|item)/giu)) {
    const word = match[1].toLowerCase()
    add(match.index, match.index + match[0].length, 'ordinal', /^\d/u.test(word) ? Number.parseInt(word, 10) : EN_ORDINALS[word] ?? null)
  }

  const cjkNumeral = '[零〇一二两兩三四五六七八九十百千万萬]+'
  const quantity = new RegExp(`(${cjkNumeral})(?=个|個|只|本|颗|顆|枚|台|辆|輛|人|岁|歲|年|天|小时|小時|分钟|分鐘|秒|公斤|千克|克|米|厘米|毫米|升|毫升|元|块|塊)`, 'gu')
  for (const match of text.matchAll(quantity)) {
    add(match.index, match.index + match[1].length, 'num', parseChineseInteger(match[1]))
  }
  if (new RegExp(`^${cjkNumeral}$`, 'u').test(text)) add(0, text.length, 'num', parseChineseInteger(text))
  return tokens.sort((left, right) => left.start - right.start)
}
