import type { SubtitleCue } from '../../shared/subtitles'

export interface DubbingSubtitleCue extends SubtitleCue {
  timingQuality: 'cue'
}

export interface DubbingSubtitleInput {
  cueId: string
  sourceIndex: number
  start: number
  end: number
  finalSpokenText: string
}

/** Build one cue-level subtitle from the exact text and accepted voice window. */
export function buildDubbingSubtitle(input: DubbingSubtitleInput): DubbingSubtitleCue {
  const cueId = input.cueId.trim()
  const text = input.finalSpokenText.trim()
  if (!cueId || !text) throw new Error('Không thể tạo subtitle dubbing khi thiếu cue hoặc finalSpokenText.')
  if (!Number.isFinite(input.start) || !Number.isFinite(input.end) || input.end <= input.start) {
    throw new Error(`Cửa sổ subtitle cue ${cueId} không hợp lệ.`)
  }
  if (!Number.isInteger(input.sourceIndex) || input.sourceIndex < 0) {
    throw new Error(`sourceIndex subtitle cue ${cueId} không hợp lệ.`)
  }
  return {
    id: `${cueId}-subtitle`,
    sourceIndex: input.sourceIndex,
    start: input.start,
    end: input.end,
    text,
    timingQuality: 'cue'
  }
}

export function buildDubbingSubtitles(inputs: readonly DubbingSubtitleInput[]): DubbingSubtitleCue[] {
  return inputs.map(buildDubbingSubtitle)
}

const VI_KEEP_PAIRS = new Set([
  'bất trắc', 'bộ tộc', 'châu phi', 'độ rộng', 'độ sâu', 'không khí', 'mùi hôi',
  'nhà vệ sinh', 'ruồi muỗi', 'thiết kế', 'trơn trượt', 'tù trưởng'
])
const WEAK_LINE_ENDS = new Set([
  'bị', 'càng', 'các', 'cho', 'của', 'đã', 'đang', 'để', 'đến', 'được', 'hoặc',
  'là', 'lẫn', 'mà', 'một', 'những', 'sẽ', 'thì', 'tới', 'và', 'với'
])
const CLAUSE_STARTERS = new Set(['bởi', 'do', 'dù', 'khi', 'nhưng', 'nếu', 'nên', 'nhờ', 'song', 'tuy', 'vì'])

function wordsLength(words: readonly string[], start: number, end: number): number {
  return words.slice(start, end).join(' ').length
}

function boundaryPenalty(words: readonly string[], end: number): number {
  if (end >= words.length) return 0
  const previous = words[end - 1].toLocaleLowerCase('vi-VN').replace(/[.,!?;:…]+$/u, '')
  const next = words[end].toLocaleLowerCase('vi-VN').replace(/^["'“‘([{]+/u, '')
  if (VI_KEEP_PAIRS.has(`${previous} ${next}`)) return 1_000
  if (WEAK_LINE_ENDS.has(previous)) return 500
  if (/[.!?。！？؟…,:;]["'”’»›)\]})）】」』]*$/u.test(words[end - 1])) return -120
  if (CLAUSE_STARTERS.has(next)) return -80
  return 20
}

/** Balance the minimum number of readable chunks, preferring clause boundaries
 * and avoiding common Vietnamese compounds/function-word orphans. */
function semanticChunks(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean)
  if (words.length <= 1) return words
  const totalChars = words.join(' ').length
  let chunkCount = Math.max(1, Math.ceil(totalChars / maxChars))
  while (chunkCount < words.length) {
    const memo = new Map<string, { cost: number; ends: number[] } | null>()
    const target = totalChars / chunkCount
    const solve = (start: number, remaining: number): { cost: number; ends: number[] } | null => {
      const key = `${start}:${remaining}`
      if (memo.has(key)) return memo.get(key) || null
      if (remaining === 0) return start === words.length ? { cost: 0, ends: [] } : null
      let best: { cost: number; ends: number[] } | null = null
      const maxEnd = words.length - remaining + 1
      for (let end = start + 1; end <= maxEnd; end++) {
        const length = wordsLength(words, start, end)
        if (length > maxChars && end > start + 1) break
        const tail = solve(end, remaining - 1)
        if (!tail) continue
        const shortOrphan = end - start < 3 && words.length > 5 ? 180 : 0
        const balance = Math.pow((length - target) / Math.max(1, target), 2) * 100
        const cost = balance + shortOrphan + boundaryPenalty(words, end) + tail.cost
        if (!best || cost < best.cost) best = { cost, ends: [end, ...tail.ends] }
      }
      memo.set(key, best)
      return best
    }
    const solution = solve(0, chunkCount)
    if (solution) {
      let start = 0
      return solution.ends.map((end) => {
        const chunk = words.slice(start, end).join(' ')
        start = end
        return chunk
      })
    }
    chunkCount++
  }
  return words
}

/** Keep grouped speech readable without dropping or paraphrasing its words. */
export function buildDubbingSubtitleSegments(input: DubbingSubtitleInput, maxChars = 64): DubbingSubtitleCue[] {
  const base = buildDubbingSubtitle(input)
  const chunks = semanticChunks(base.text, maxChars)
  if (chunks.length === 1) return [base]
  const weight = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  let consumed = 0
  return chunks.map((text, index) => {
    const start = base.start + (base.end - base.start) * consumed / weight
    consumed += text.length
    const end = index === chunks.length - 1 ? base.end : base.start + (base.end - base.start) * consumed / weight
    return { ...base, id: `${base.id}-${index + 1}`, start, end, text }
  })
}
