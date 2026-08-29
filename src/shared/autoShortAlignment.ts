import type { AlignedCue, SubtitleCue } from './types'

function overlapRatio(a: Pick<SubtitleCue, 'start' | 'end'>, b: Pick<SubtitleCue, 'start' | 'end'>): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
  const shortest = Math.min(a.end - a.start, b.end - b.start)
  return shortest > 0 ? overlap / shortest : 0
}

function normalizedSubtitleText(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function hasHanText(text: string): boolean {
  return /[\u3400-\u9fff]/u.test(text)
}

/** Clean OCR framing markers and confidence tags while strictly preserving alphanumeric words, mixed ASCII/CJK, and numbers. */
export function cleanVisualText(text: string): string {
  let cleaned = text.trim().replace(/\s+/gu, ' ')
  if (!cleaned) return ''
  // Strip bracketed frame indicators, timestamps, or confidence tags (e.g. [00:12], (0.95), 【1】)
  cleaned = cleaned.replace(/^\s*(?:\[\s*[\d:.]+\s*\]|\(\s*0?\.\d+\s*\)|【\s*[\d:.]+\s*】)\s*/u, '')
  cleaned = cleaned.replace(/\s*(?:\[\s*[\d:.]+\s*\]|\(\s*0?\.\d+\s*\)|【\s*[\d:.]+\s*】)\s*$/u, '')
  // Strip OCR frame header artifacts like "Q0 ", "O0 ", "60 00 " before CJK text
  cleaned = cleaned.replace(/^(?:[a-zA-Z0-9]{1,3}\s+)+(?=[\u3400-\u9fff])/u, '')
  // Strip outer framing non-word punctuation while retaining all letters, numbers, and CJK characters
  cleaned = cleaned.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  return cleaned.trim()
}

function visualPrefixBeforeNextCue(visualText: string, nextCueText: string): string | null {
  const suffix = nextCueText.trim()
  if (!suffix || !normalizedSubtitleText(visualText).endsWith(normalizedSubtitleText(suffix))) return null
  const suffixIndex = visualText.lastIndexOf(suffix)
  if (suffixIndex <= 0) return null
  const prefix = visualText.slice(0, suffixIndex).trim()
  return normalizedSubtitleText(prefix).length >= 2 ? prefix : null
}

function visualSuffixForCue(visualText: string, cueText: string): string | null {
  const visualChars = Array.from(visualText)
  const target = normalizedSubtitleText(cueText)
  if (target.length < 3) return null
  let best: { start: number; score: number } | undefined
  for (let start = 0; start < visualChars.length; start++) {
    const suffix = visualChars.slice(start).join('')
    const score = subtitleTextSimilarity(suffix, cueText)
    if (!best || score > best.score) best = { start, score }
    if (normalizedSubtitleText(suffix) === target) return suffix
  }
  if (best && best.score >= 0.72) return visualChars.slice(best.start).join('').trim()
  return null
}

export function subtitleTextSimilarity(a: string, b: string): number {
  const left = normalizedSubtitleText(a)
  const right = normalizedSubtitleText(b)
  if (!left || !right) return 0
  const row = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= right.length; j++) {
      const previous = row[j]
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1)
      )
      diagonal = previous
    }
  }
  return 1 - row[right.length] / Math.max(left.length, right.length)
}

/** Recognition engines can round the last cue a few frames past EOF. */
export function clampAlignedCueTimeline(cues: readonly AlignedCue[], duration: number): AlignedCue[] {
  if (!(duration > 0)) return [...cues]
  return cues
    .map((cue) => ({
      ...cue,
      start: Math.max(0, Math.min(duration, cue.start)),
      end: Math.max(0, Math.min(duration, cue.end))
    }))
    .filter((cue) => cue.end - cue.start > 0.01)
    .sort((a, b) => a.start - b.start || a.end - b.end)
}

/**
 * Whisper local owns spoken timing. OCR can replace text only when it describes
 * the same cue; visual-only subtitles remain available in speech-free gaps.
 */
export function fuseWhisperAndOcr(whisper: AlignedCue[], ocr: AlignedCue[]): AlignedCue[] {
  const usedOcr = new Set<number>()
  const splitFragments = new Map<number, Array<{ index: number; text: string; start: number }>>()

  // A burned subtitle can cover two adjacent spoken segments. Split it using
  // the following segment's suffix so the visual evidence is assigned to both
  // speech cues instead of being discarded as an overlap with another cue.
  for (let index = 0; index < ocr.length; index++) {
    const candidate = ocr[index]
    const text = cleanVisualText(candidate.text)
    if (!text || !hasHanText(text)) continue
    const overlappedIndexes = whisper
      .map((cue, cueIndex) => ({ cue, cueIndex }))
      .filter(({ cue }) => overlapRatio(cue, candidate) >= 0.5)
      .map(({ cueIndex }) => cueIndex)
    if (overlappedIndexes.length !== 2 || overlappedIndexes[1] !== overlappedIndexes[0] + 1) continue

    const leftIndex = overlappedIndexes[0]
    const rightIndex = overlappedIndexes[1]
    const rightText = visualSuffixForCue(text, whisper[rightIndex].text)
    if (!rightText) continue
    const prefix = text.slice(0, text.lastIndexOf(rightText)).trim()
    if (normalizedSubtitleText(prefix).length < 2) continue
    splitFragments.set(leftIndex, [
      ...(splitFragments.get(leftIndex) || []),
      { index, text: prefix, start: candidate.start }
    ])
    splitFragments.set(rightIndex, [
      ...(splitFragments.get(rightIndex) || []),
      { index, text: rightText, start: candidate.start }
    ])
  }

  const fused: AlignedCue[] = whisper.map((cue, cueIndex) => {
    const matching: Array<{
      index: number
      text: string
      overlap: number
      durationRatio: number
      start: number
      fragment: boolean
    }> = []
    for (let index = 0; index < ocr.length; index++) {
      const ratio = overlapRatio(cue, ocr[index])
      if (ratio < 0.5) continue
      const splitFragment = splitFragments.get(cueIndex)?.find((fragment) => fragment.index === index)
      if (splitFragment) {
        matching.push({
          index,
          text: splitFragment.text,
          overlap: ratio,
          durationRatio: 1,
          start: splitFragment.start,
          fragment: true
        })
        continue
      }
      const overlapsOtherSpeech = whisper.some((other, otherIndex) =>
        otherIndex !== cueIndex && overlapRatio(other, ocr[index]) >= 0.5
      )
      if (overlapsOtherSpeech) continue
      const visualDuration = Math.max(0.01, ocr[index].end - ocr[index].start)
      const cueDuration = Math.max(0.01, cue.end - cue.start)
      const durationRatio = Math.max(cueDuration / visualDuration, visualDuration / cueDuration)
      const text = cleanVisualText(ocr[index].text)
      if (!text) continue
      const textKey = normalizedSubtitleText(text)
      const sameVisualGroupCrossesBoundary = whisper.some((otherCue, otherCueIndex) => {
        if (Math.abs(otherCueIndex - cueIndex) !== 1) return false
        const boundaryEvidence = ocr.filter((candidate) =>
          normalizedSubtitleText(cleanVisualText(candidate.text)) === textKey &&
          overlapRatio(otherCue, candidate) >= 0.5
        )
        const evidenceDuration = boundaryEvidence.reduce((total, candidate) =>
          total + Math.max(0, candidate.end - candidate.start), 0
        )
        return boundaryEvidence.length >= 2 || evidenceDuration >= 0.25
      })
      if (sameVisualGroupCrossesBoundary) {
        const nextCue = whisper[cueIndex + 1]
        const prefix = nextCue ? visualPrefixBeforeNextCue(text, nextCue.text) : null
        // Split only when the OCR phrase has an unambiguous suffix matching
        // the following speech cue; otherwise retain Whisper's mapping.
        if (prefix) {
          matching.push({ index, text: prefix, overlap: ratio, durationRatio: 1, start: ocr[index].start, fragment: true })
          continue
        }
        continue
      }
      const visualHanCount = Array.from(text).filter((char) => /[\u3400-\u9fff]/u.test(char)).length
      // A subtitle renderer can expose a stable phrase for only a few OCR
      // frames while Whisper owns the longer speech interval. Repeated CJK
      // text inside the same speech cue is still useful evidence; do not
      // discard it merely because its visible interval is short.
      const shortVisualCjk = visualHanCount >= 2 && ratio >= 0.9
      if (durationRatio > 2.5 && !shortVisualCjk) continue
      matching.push({ index, text, overlap: ratio, durationRatio, start: ocr[index].start, fragment: false })
    }
    if (matching.length === 0) return cue

    const groups = new Map<string, { text: string; indexes: number[]; overlap: number; durationRatio: number }>()
    for (const candidate of matching) {
      const key = normalizedSubtitleText(candidate.text)
      const group = groups.get(key)
      if (group) {
        group.indexes.push(candidate.index)
        group.overlap = Math.max(group.overlap, candidate.overlap)
        group.durationRatio = Math.min(group.durationRatio, candidate.durationRatio)
      } else {
        groups.set(key, {
          text: candidate.text,
          indexes: [candidate.index],
          overlap: candidate.overlap,
          durationRatio: candidate.durationRatio
        })
      }
    }
    const cjkSplit = hasHanText(cue.text) && matching.some((candidate) => candidate.fragment)
    const orderedGroups = [...groups.values()].sort((left, right) => {
      const leftStart = Math.min(...matching.filter((candidate) => candidate.text === left.text).map((candidate) => candidate.start))
      const rightStart = Math.min(...matching.filter((candidate) => candidate.text === right.text).map((candidate) => candidate.start))
      return leftStart - rightStart
    })
    const best = cjkSplit && orderedGroups.length > 1
      ? {
          text: orderedGroups.map((group) => group.text).join(''),
          indexes: orderedGroups.flatMap((group) => group.indexes),
          overlap: Math.max(...orderedGroups.map((group) => group.overlap)),
          durationRatio: Math.min(...orderedGroups.map((group) => group.durationRatio))
        }
      : [...groups.values()].sort((left, right) =>
          hasHanText(cue.text)
            ? right.indexes.length - left.indexes.length ||
              right.text.length - left.text.length ||
              right.overlap - left.overlap ||
              left.durationRatio - right.durationRatio
            : subtitleTextSimilarity(cue.text, right.text) - subtitleTextSimilarity(cue.text, left.text) ||
              right.overlap - left.overlap ||
              right.indexes.length - left.indexes.length ||
              left.durationRatio - right.durationRatio
        )[0]
    if (!best) return cue
    best.indexes.forEach((index) => usedOcr.add(index))
    const visualIsCjk = hasHanText(best.text) && Array.from(best.text).filter((char) => /[\u3400-\u9fff]/u.test(char)).length >= 2
    if (!visualIsCjk && subtitleTextSimilarity(cue.text, best.text) < 0.55) return cue
    return { ...cue, text: best.text, source: 'fused', confidence: 1 }
  })
  for (let index = 0; index < ocr.length; index++) {
    if (usedOcr.has(index)) continue
    const visual = { ...ocr[index], text: cleanVisualText(ocr[index].text) }
    if (!visual.text) continue
    const overlapsSpeech = whisper.some((speech) => overlapRatio(speech, visual) >= 0.5)
    const touchesSpeech = whisper.some((speech) => Math.min(speech.end, visual.end) > Math.max(speech.start, visual.start))
    // A one-frame OCR fragment at the edge of a speech cue is evidence for
    // that cue, not a second subtitle event. Keep visual-only text only when
    // it is genuinely in a speech-free interval.
    if (!overlapsSpeech && !touchesSpeech) fused.push(visual)
  }
  return fused.sort((a, b) => a.start - b.start || a.end - b.end)
}
