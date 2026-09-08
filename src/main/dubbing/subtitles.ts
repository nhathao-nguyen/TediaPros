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

/** Keep grouped speech readable without dropping or paraphrasing its words. */
export function buildDubbingSubtitleSegments(input: DubbingSubtitleInput, maxChars = 64): DubbingSubtitleCue[] {
  const base = buildDubbingSubtitle(input)
  const chunks: string[] = []
  for (const word of base.text.split(/\s+/u)) {
    const previous = chunks.at(-1)
    if (previous && previous.length + word.length + 1 <= maxChars) chunks[chunks.length - 1] += ` ${word}`
    else chunks.push(word)
  }
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
