import type { AlignedCue, SubtitleCue, TimedWord } from './types'

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

const SENTENCE_END_PUNCTUATION = /[.!?。！？؟…]["'”’»›)\]})]*$/u
const ABBREVIATION_PATTERN = /^(?:mr|mrs|ms|dr|prof|sr|jr|vs|etc|st|ave|no)\.$/i
const CONTRACTION_OR_FUNCTION_WORD =
  /^(?:that|it|there|here|what|who|he|she|they|we|you|i|how)('s|'re|'m|'ve|'d|'ll)$/i
const FUNCTION_OR_PREFIX_WORD =
  /^(?:the|a|an|to|of|in|on|at|for|with|and|or|but|so|that|this|if|as|by|from|we|i|you|he|she|they|it)$/i

/**
 * Xử lý hiện tượng Whisper Cross-Attention Alignment Drift qua khoảng lặng dài:
 * Khi một câu ngắn (như "That's impossible") xảy ra sau khoảng lặng/tiếng ồn,
 * mô hình Whisper dự đoán câu nhưng thuật toán DTW gán nhầm từ đầu tiên ("That's")
 * vào tạp âm trước khoảng lặng, gây ra khoảng cách bất thường (> 1.2s) giữa các từ
 * của cùng một mệnh đề/cụm từ không hoàn chỉnh.
 * Hàm này kéo các từ tiền tố bị trôi về vị trí thực tế ngay trước từ tiếp theo.
 */
export function repairWhisperWordGaps(words: NonNullable<AlignedCue['words']>): NonNullable<AlignedCue['words']> {
  if (words.length <= 1) return words
  const repaired: Array<NonNullable<AlignedCue['words']>[number]> = words.map((w) => ({ ...w }))

  for (let i = 0; i < repaired.length - 1; i++) {
    const w1 = repaired[i]
    const w2 = repaired[i + 1]
    const gap = w2.start - w1.end
    if (gap < 1.2) continue

    const prefixWords = repaired.slice(0, i + 1)
    const w1Clean = w1.text.trim()
    const hasTerminal = SENTENCE_END_PUNCTUATION.test(w1Clean)
    if (hasTerminal) continue // Ranh giới câu hợp lệ

    const isShortPrefix = prefixWords.length <= 2
    const isContraction = CONTRACTION_OR_FUNCTION_WORD.test(w1Clean)
    const isFunction = FUNCTION_OR_PREFIX_WORD.test(w1Clean)
    const nextIsLower = /^[a-z\u00E0-\u00FC]/u.test(w2.text.trim())

    // Nếu là từ chưa dứt câu (contraction, từ nối, hoặc từ tiếp theo viết thường) bị tách qua khoảng lặng lớn
    if (isShortPrefix && (isContraction || isFunction || nextIsLower)) {
      let anchor = w2.start
      for (let j = i; j >= 0; j--) {
        const pw = repaired[j]
        const dur = Math.min(Math.max(pw.end - pw.start, 0.2), 0.45)
        pw.end = Math.max(0, anchor - 0.04)
        pw.start = Math.max(0, pw.end - dur)
        anchor = pw.start
      }
    }
  }

  return repaired
}

/**
 * Xử lý hiện tượng trôi ranh giới giữa 2 cue riêng biệt:
 * Khi cue trước là 1-2 từ dở dang (ví dụ "That's") không có dấu kết câu,
 * cách cue sau >= 1.2s và cue sau tiếp nối mệnh đề (viết thường hoặc hoàn thành cụm),
 * gộp cue dở dang vào cue sau ở mốc thời gian thực ngay trước cue sau.
 */
export function healOrphanDriftCues(cues: readonly AlignedCue[]): AlignedCue[] {
  if (cues.length <= 1) return [...cues]
  const currentList = [...cues]
  const healed: AlignedCue[] = []

  for (let i = 0; i < currentList.length; i++) {
    const cue = currentList[i]
    if (i < currentList.length - 1) {
      const nextCue = currentList[i + 1]
      const gap = nextCue.start - cue.end
      const cueClean = cue.text.trim()
      const cueTokens = cueClean.split(/\s+/)
      const hasTerminal = SENTENCE_END_PUNCTUATION.test(cueClean)

      const isShortPrefix = cueTokens.length <= 2
      const isContraction = CONTRACTION_OR_FUNCTION_WORD.test(cueClean)
      const isFunction = FUNCTION_OR_PREFIX_WORD.test(cueClean)
      const nextIsLower = /^[a-z\u00E0-\u00FC]/u.test(nextCue.text.trim())

      if (gap >= 1.2 && !hasTerminal && isShortPrefix && (isContraction || isFunction || nextIsLower)) {
        const dur = Math.min(Math.max(cue.end - cue.start, 0.2), 0.5)
        const mergedStart = Math.max(0, nextCue.start - dur - 0.04)
        const mergedText = `${cueClean} ${nextCue.text.trim()}`

        let mergedWords: AlignedCue['words'] = undefined
        if (cue.words && nextCue.words) {
          let anchor = nextCue.words[0]?.start ?? nextCue.start
          const shiftedCueWords = cue.words.map((w) => ({ ...w }))
          for (let j = shiftedCueWords.length - 1; j >= 0; j--) {
            const w = shiftedCueWords[j]
            const wDur = Math.min(Math.max(w.end - w.start, 0.2), 0.45)
            w.end = Math.max(0, anchor - 0.04)
            w.start = Math.max(0, w.end - wDur)
            anchor = w.start
          }
          mergedWords = [...shiftedCueWords, ...nextCue.words]
        }

        const mergedCue: AlignedCue = {
          ...nextCue,
          start: mergedStart,
          text: mergedText,
          words: mergedWords
        }

        currentList[i + 1] = mergedCue
        continue // Bỏ qua cue dở dang ở vị trí cũ (không hiển thị ở giây 14 nữa)
      }
    }
    healed.push(cue)
  }

  return healed
}

/**
 * Tự động tách các cue dài chứa nhiều câu thành các cue độc lập.
 * Khi có word timestamps từ Whisper, timing của từng câu mới được lấy chính xác
 * từ từ đầu tiên đến từ cuối cùng của câu đó (khớp 100% với giọng nói thực tế).
 * Khi không có word timestamps, áp dụng DP Timeline Smoothing và Dead-Air Detection
 * để không kéo dài lê thê phụ đề qua khoảng lặng.
 */
export function splitLongAlignedCues(cues: readonly AlignedCue[]): AlignedCue[] {
  const normalizedCues = healOrphanDriftCues(cues)
  const result: AlignedCue[] = []

  for (const cue of normalizedCues) {
    // 1. Nếu có word timestamps: tách câu dựa trên mốc thời gian thực của từ
    if (Array.isArray(cue.words) && cue.words.length > 1) {
      const repairedWords = repairWhisperWordGaps(cue.words)
      const sentenceGroups: Array<{
        words: NonNullable<AlignedCue['words']>
      }> = []
      let currentWords: NonNullable<AlignedCue['words']> = []

      for (let i = 0; i < repairedWords.length; i++) {
        const word = repairedWords[i]
        currentWords.push(word)

        const isLastWord = i === repairedWords.length - 1
        if (isLastWord) break

        const nextWord = repairedWords[i + 1]
        const cleanText = word.text.trim()
        const hasTerminal = SENTENCE_END_PUNCTUATION.test(cleanText)
        const isAbbr = ABBREVIATION_PATTERN.test(cleanText)
        const speechGap = Number.isFinite(word.end) && Number.isFinite(nextWord.start)
          ? nextWord.start - word.end
          : 0

        const isSentenceBoundary = hasTerminal && !isAbbr
        const isSignificantPause = speechGap >= 0.6 && currentWords.length >= 1

        if ((isSentenceBoundary || isSignificantPause) && currentWords.length >= 1) {
          sentenceGroups.push({ words: currentWords })
          currentWords = []
        }
      }

      if (currentWords.length > 0) {
        const lastGroup = sentenceGroups[sentenceGroups.length - 1]
        const lastWord = lastGroup?.words[lastGroup.words.length - 1]
        const pauseGap = lastWord && Number.isFinite(lastWord.end) && Number.isFinite(currentWords[0].start)
          ? currentWords[0].start - lastWord.end
          : 0

        if (
          sentenceGroups.length > 0 &&
          currentWords.length === 1 &&
          pauseGap < 0.6 &&
          !SENTENCE_END_PUNCTUATION.test(currentWords[0].text)
        ) {
          lastGroup.words.push(...currentWords)
        } else {
          sentenceGroups.push({ words: currentWords })
        }
      }

      if (sentenceGroups.length > 1) {
        sentenceGroups.forEach((group, groupIndex) => {
          const firstWord = group.words[0]
          const lastWord = group.words[group.words.length - 1]
          const text = group.words.map((w) => w.text).join(' ')
          result.push({
            ...cue,
            id: `${cue.id}-s${groupIndex + 1}`,
            start: firstWord.start,
            end: lastWord.end,
            text,
            words: group.words,
            timingQuality: 'word'
          })
        })
        continue
      } else if (sentenceGroups.length === 1 && sentenceGroups[0].words.length > 0) {
        const firstWord = sentenceGroups[0].words[0]
        const lastWord = sentenceGroups[0].words[sentenceGroups[0].words.length - 1]
        result.push({
          ...cue,
          start: firstWord.start,
          end: lastWord.end,
          words: sentenceGroups[0].words,
          timingQuality: 'word'
        })
        continue
      }
    }

    // 2. Nếu không có word timestamps: tách khi cue dài >= 3.8s và có nhiều câu
    const duration = cue.end - cue.start
    if (duration >= 3.8 && /[.!?。！？؟…]["'”’»›)\]})]*\s+/u.test(cue.text)) {
      const sentenceParts = cue.text
        .split(/(?<=[.!?。！？؟…]["'”’»›)\]})]*)\s+/u)
        .map((p) => p.trim())
        .filter(Boolean)

      if (sentenceParts.length > 1) {
        const charCounts = sentenceParts.map((p) => Math.max(1, p.length))
        const dMax = charCounts.map((chars) => Math.max(1.5, Math.min(chars / 7.5, 3.8)))
        const sumDMax = dMax.reduce((sum, d) => sum + d, 0)

        // Dead-Air Silence Gap: Nếu duration lớn hơn tổng thời gian đọc tối đa (có khoảng lặng giữa các câu)
        if (duration > sumDMax + 0.8 && sentenceParts.length === 2) {
          const s1Duration = Math.min(dMax[0], (duration - 0.8) / 2)
          const s1End = cue.start + s1Duration
          const s2Duration = Math.min(dMax[1], (duration - 0.8) / 2)
          const s2Start = Math.max(s1End + 0.4, cue.end - s2Duration)

          result.push({
            ...cue,
            id: `${cue.id}-s1`,
            start: cue.start,
            end: s1End,
            text: sentenceParts[0],
            words: undefined,
            timingQuality: cue.timingQuality === 'word' ? 'cue' : cue.timingQuality
          })
          result.push({
            ...cue,
            id: `${cue.id}-s2`,
            start: s2Start,
            end: cue.end,
            text: sentenceParts[1],
            words: undefined,
            timingQuality: cue.timingQuality === 'word' ? 'cue' : cue.timingQuality
          })
          continue
        }

        // Timeline Smoothing liên tục khi thời gian trong phạm vi bình thường
        const idealDurations = charCounts.map((chars) => Math.max(1.0, chars / 15.0))
        const sumIdeal = idealDurations.reduce((sum, d) => sum + d, 0)
        let currentStart = cue.start

        sentenceParts.forEach((part, partIndex) => {
          const ratio = sumIdeal > 0 ? idealDurations[partIndex] / sumIdeal : 1 / sentenceParts.length
          const partDuration = Math.max(0.8, duration * ratio)
          const partEnd = partIndex === sentenceParts.length - 1
            ? cue.end
            : Math.min(cue.end - 0.2, currentStart + partDuration)

          result.push({
            ...cue,
            id: `${cue.id}-s${partIndex + 1}`,
            start: currentStart,
            end: Math.max(currentStart + 0.1, partEnd),
            text: part,
            words: undefined,
            timingQuality: cue.timingQuality === 'word' ? 'cue' : cue.timingQuality
          })
          currentStart = partEnd
        })
        continue
      }
    }

    result.push(cue)
  }

  return result
}

/**
 * Căn chỉnh từ Karaoke / Word-Reveal bằng Dynamic Time Warping (DTW).
 * Căn chỉnh dãy từ phụ đề với dãy từ có mốc thời gian từ Whisper / TTS.
 * Hỗ trợ từ viết tắt, gộp từ (that's -> that + 's), bỏ qua filler words và dấu câu.
 */
export function alignWordsDtw(
  cueWords: readonly string[],
  candidateWords: readonly TimedWord[]
): TimedWord[] | undefined {
  if (cueWords.length === 0 || candidateWords.length === 0) return undefined

  const normalizeToken = (s: string): string => s.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
  const cleanCue = cueWords.map(normalizeToken).filter(Boolean)
  const cleanCand = candidateWords.map((w) => normalizeToken(w.text)).filter(Boolean)

  if (cleanCue.length === 0 || cleanCand.length === 0) return undefined

  // Trường hợp từ khớp chính xác hoàn toàn
  if (cueWords.length === candidateWords.length) {
    let exactAll = true
    for (let i = 0; i < cueWords.length; i++) {
      if (normalizeToken(cueWords[i]) !== normalizeToken(candidateWords[i].text)) {
        exactAll = false
        break
      }
    }
    if (exactAll) return [...candidateWords]
  }

  // Khoảng cách Levenshtein chuẩn hóa giữa 2 token
  const tokenDistance = (a: string, b: string): number => {
    if (a === b) return 0
    if (!a || !b) return 1
    if (a.startsWith(b) || b.startsWith(a)) {
      return (0.15 * Math.abs(a.length - b.length)) / Math.max(a.length, b.length)
    }
    const m = a.length
    const n = b.length
    const dp = Array.from({ length: n + 1 }, (_, j) => j)
    for (let i = 1; i <= m; i++) {
      let diag = dp[0]
      dp[0] = i
      for (let j = 1; j <= n; j++) {
        const nextDiag = dp[j]
        dp[j] = Math.min(
          dp[j] + 1,
          dp[j - 1] + 1,
          diag + (a[i - 1] === b[j - 1] ? 0 : 1)
        )
        diag = nextDiag
      }
    }
    return dp[n] / Math.max(m, n)
  }

  const N = cueWords.length
  const M = candidateWords.length

  type TraceStep = { pi: number; pj: number; kind: 'match' | 'merge' | 'skipCue' | 'skipCand' }
  const dp: number[][] = Array.from({ length: N + 1 }, () => Array(M + 1).fill(Infinity))
  const trace: Array<Array<TraceStep>> =
    Array.from({ length: N + 1 }, () => Array(M + 1))

  // Căn chỉnh cục bộ: cho phép bắt đầu ở bất kỳ vị trí j nào trong candidateWords với chi phí 0
  for (let j = 0; j <= M; j++) {
    dp[0][j] = 0
  }

  for (let i = 1; i <= N; i++) {
    const cueToken = normalizeToken(cueWords[i - 1])
    for (let j = 1; j <= M; j++) {
      const candToken = normalizeToken(candidateWords[j - 1].text)
      const costMatch = tokenDistance(cueToken, candToken)

      // 1. Khớp 1-1
      let bestCost = dp[i - 1][j - 1] + costMatch
      let bestTrace: TraceStep = { pi: i - 1, pj: j - 1, kind: 'match' }

      // 2. Ghép 2 từ candidate vào 1 từ cue (ví dụ: "that's" -> "that" + "'s")
      if (j >= 2) {
        const candMerge = normalizeToken(candidateWords[j - 2].text + candidateWords[j - 1].text)
        const costMerge = tokenDistance(cueToken, candMerge)
        if (dp[i - 1][j - 2] + costMerge < bestCost) {
          bestCost = dp[i - 1][j - 2] + costMerge
          bestTrace = { pi: i - 1, pj: j - 2, kind: 'merge' as const }
        }
      }

      // 3. Bỏ qua từ candidate (filler words, âm đệm)
      if (dp[i][j - 1] + 0.8 < bestCost) {
        bestCost = dp[i][j - 1] + 0.8
        bestTrace = { pi: i, pj: j - 1, kind: 'skipCand' as const }
      }

      // 4. Bỏ qua từ cue (từ bị phát âm quá nhanh hoặc nuốt âm)
      if (dp[i - 1][j] + 0.8 < bestCost) {
        bestCost = dp[i - 1][j] + 0.8
        bestTrace = { pi: i - 1, pj: j, kind: 'skipCue' as const }
      }

      dp[i][j] = bestCost
      trace[i][j] = bestTrace
    }
  }

  let bestJ = M
  let minFinalCost = dp[N][M]
  for (let j = 1; j <= M; j++) {
    if (dp[N][j] < minFinalCost) {
      minFinalCost = dp[N][j]
      bestJ = j
    }
  }

  if (minFinalCost / N > 0.55) return undefined

  let currI = N
  let currJ = bestJ
  const alignmentMap = new Map<number, { start: number; end: number; prob?: number | null }>()

  while (currI > 0 && currJ >= 0) {
    const step = trace[currI]?.[currJ]
    if (!step) break
    if (step.kind === 'match') {
      const cand = candidateWords[currJ - 1]
      alignmentMap.set(currI - 1, { start: cand.start, end: cand.end, prob: cand.probability })
    } else if (step.kind === 'merge') {
      const cand1 = candidateWords[currJ - 2]
      const cand2 = candidateWords[currJ - 1]
      alignmentMap.set(currI - 1, {
        start: cand1.start,
        end: cand2.end,
        prob: Math.min(cand1.probability ?? 1, cand2.probability ?? 1)
      })
    }
    currI = step.pi
    currJ = step.pj
  }

  const result: TimedWord[] = []
  for (let i = 0; i < N; i++) {
    const aligned = alignmentMap.get(i)
    if (aligned) {
      result.push({
        text: cueWords[i],
        start: aligned.start,
        end: aligned.end,
        probability: aligned.prob ?? null
      })
    } else {
      const prev = result[i - 1]
      const nextAligned = alignmentMap.get(i + 1)
      const prevEnd = prev ? prev.end : candidateWords[0].start
      const nextStart = nextAligned ? nextAligned.start : (prev ? prev.end + 0.4 : candidateWords[0].end)
      const mid = Math.max(prevEnd + 0.05, Math.min(nextStart - 0.05, (prevEnd + nextStart) / 2))
      result.push({
        text: cueWords[i],
        start: prevEnd,
        end: mid,
        probability: null
      })
    }
  }

  return result
}

