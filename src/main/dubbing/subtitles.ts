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
