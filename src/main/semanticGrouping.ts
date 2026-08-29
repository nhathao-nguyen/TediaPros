/**
 * Semantic Grouping Helper
 * Gom các cue phụ đề liên tiếp thành các nhóm ngữ nghĩa / câu lời thoại tự nhiên
 * dựa trên timeline, khoảng lặng (pause), dấu câu kết thúc và nhãn người nói.
 */

export interface SemanticCue {
  id?: string
  text: string
  start?: number
  end?: number
  time?: string
  sourceIndex?: number
}

export interface SemanticGroup<T extends SemanticCue = SemanticCue> {
  id: string
  cues: T[]
  text: string
  start?: number
  end?: number
}

export interface SemanticGroupingPolicy {
  /**
   * Khoảng lặng tối đa (giây) giữa 2 cue để coi lời nói là liên tục.
   * Nếu gap >= maxPauseSeconds, sẽ ngắt tạo group mới.
   */
  maxPauseSeconds: number
  /**
   * Số lượng cue tối đa trong một semantic group.
   */
  maxCuesPerGroup: number
  /**
   * Thời lượng tối đa (giây) của một semantic group.
   */
  maxGroupDurationSeconds: number
  /**
   * Tổng số ký tự tối đa trong một semantic group.
   */
  maxGroupChars: number
}

export const DEFAULT_SEMANTIC_GROUPING_POLICY: SemanticGroupingPolicy = {
  maxPauseSeconds: 0.6,
  maxCuesPerGroup: 6,
  maxGroupDurationSeconds: 15.0,
  maxGroupChars: 300
}

const TIMING_LINE_REGEX =
  /^\s*(\d{1,4}:\d{1,2}:\d{1,2}[,.]\d{1,3})\s*-->\s*(\d{1,4}:\d{1,2}:\d{1,2}[,.]\d{1,3})/u

function parseTimestampString(value: string): number | null {
  const match = /^(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/u.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  if (minutes > 59 || seconds > 59) return null
  const millis = Number(match[4].padEnd(3, '0'))
  return hours * 3600 + minutes * 60 + seconds + millis / 1000
}

export function parseCueTiming(cue: SemanticCue): { start?: number; end?: number } {
  if (typeof cue.start === 'number' && typeof cue.end === 'number') {
    return { start: cue.start, end: cue.end }
  }
  if (typeof cue.time === 'string') {
    const match = TIMING_LINE_REGEX.exec(cue.time)
    if (match) {
      const s = parseTimestampString(match[1])
      const e = parseTimestampString(match[2])
      if (s != null && e != null) return { start: s, end: e }
    }
  }
  return {
    start: typeof cue.start === 'number' ? cue.start : undefined,
    end: typeof cue.end === 'number' ? cue.end : undefined
  }
}

/**
 * Nhận diện dấu kết thúc câu trên nhiều hệ thống chữ viết (Latin, CJK, Arabic, Devanagari...).
 */
const SENTENCE_TERMINAL_REGEX = /[.!?。！？…۔।॥]["'”’»›)\]})）】」』]*\s*$/u

export function isSentenceTerminal(text: string): boolean {
  const clean = text.trim()
  if (!clean) return false
  return SENTENCE_TERMINAL_REGEX.test(clean)
}

/**
 * Trích xuất nhãn người nói dạng [SPEAKER_00] nếu có ở đầu cue.
 */
export function extractSpeaker(text: string): string | null {
  const match = /^\s*\[(SPEAKER_\d+)\]/iu.exec(text)
  return match ? match[1].toUpperCase() : null
}

const CJK_CHAR_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * Ghép nội dung text của các cue trong group một cách tự nhiên.
 */
export function joinGroupText(cues: readonly SemanticCue[]): string {
  if (cues.length === 0) return ''
  if (cues.length === 1) return cues[0].text.trim()

  let result = cues[0].text.trim()
  for (let i = 1; i < cues.length; i++) {
    const prev = result
    const next = cues[i].text.trim()
    if (!prev) {
      result = next
      continue
    }
    if (!next) continue

    const lastChar = prev.slice(-1)
    const firstChar = next.slice(0, 1)
    if (CJK_CHAR_REGEX.test(lastChar) && CJK_CHAR_REGEX.test(firstChar)) {
      result = prev + next
    } else {
      result = prev + ' ' + next
    }
  }
  return result
}

/**
 * Gom danh sách các cue thành các SemanticGroup.
 */
export function buildSemanticGroups<T extends SemanticCue>(
  cues: readonly T[],
  customPolicy?: Partial<SemanticGroupingPolicy>
): SemanticGroup<T>[] {
  if (cues.length === 0) return []

  const policy: SemanticGroupingPolicy = {
    ...DEFAULT_SEMANTIC_GROUPING_POLICY,
    ...customPolicy
  }

  const groups: SemanticGroup<T>[] = []
  let currentCues: T[] = [cues[0]]
  let currentChars = cues[0].text.length
  let currentGroupStart = parseCueTiming(cues[0]).start

  for (let i = 0; i < cues.length - 1; i++) {
    const cur = cues[i]
    const next = cues[i + 1]

    const curTiming = parseCueTiming(cur)
    const nextTiming = parseCueTiming(next)

    const curSpeaker = extractSpeaker(cur.text)
    const nextSpeaker = extractSpeaker(next.text)

    const speakerChanged =
      curSpeaker !== null && nextSpeaker !== null && curSpeaker !== nextSpeaker
    const terminal = isSentenceTerminal(cur.text)

    let hasLargePause = false
    if (curTiming.end != null && nextTiming.start != null) {
      const gap = nextTiming.start - curTiming.end
      if (gap >= policy.maxPauseSeconds) {
        hasLargePause = true
      }
    }

    const countLimitReached = currentCues.length >= policy.maxCuesPerGroup
    const charLimitReached = currentChars + next.text.length > policy.maxGroupChars

    let durationLimitReached = false
    if (currentGroupStart != null && nextTiming.end != null) {
      if (nextTiming.end - currentGroupStart > policy.maxGroupDurationSeconds) {
        durationLimitReached = true
      }
    }

    if (
      speakerChanged ||
      terminal ||
      hasLargePause ||
      countLimitReached ||
      charLimitReached ||
      durationLimitReached
    ) {
      const firstTiming = parseCueTiming(currentCues[0])
      const lastTiming = parseCueTiming(currentCues[currentCues.length - 1])
      groups.push({
        id: `group-${groups.length}`,
        cues: currentCues,
        text: joinGroupText(currentCues),
        start: firstTiming.start,
        end: lastTiming.end
      })

      currentCues = [next]
      currentChars = next.text.length
      currentGroupStart = nextTiming.start
    } else {
      currentCues.push(next)
      currentChars += next.text.length
    }
  }

  if (currentCues.length > 0) {
    const firstTiming = parseCueTiming(currentCues[0])
    const lastTiming = parseCueTiming(currentCues[currentCues.length - 1])
    groups.push({
      id: `group-${groups.length}`,
      cues: currentCues,
      text: joinGroupText(currentCues),
      start: firstTiming.start,
      end: lastTiming.end
    })
  }

  return groups
}

/**
 * Gom các SemanticGroup thành các batch gửi AI.
 * Đảm bảo mỗi batch bao gồm các SemanticGroup nguyên vẹn, không cắt ngang group.
 */
export function buildSemanticBatches<T extends SemanticCue>(
  groups: readonly SemanticGroup<T>[],
  maxCuesPerBatch = 10
): SemanticGroup<T>[][] {
  if (groups.length === 0) return []

  const batches: SemanticGroup<T>[][] = []
  let currentBatch: SemanticGroup<T>[] = []
  let currentCueCount = 0

  for (const group of groups) {
    if (currentBatch.length > 0 && currentCueCount + group.cues.length > maxCuesPerBatch) {
      batches.push(currentBatch)
      currentBatch = [group]
      currentCueCount = group.cues.length
    } else {
      currentBatch.push(group)
      currentCueCount += group.cues.length
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

/**
 * Chia đôi một batch semantic groups khi cần fallback / retry.
 * Ưu tiên chia theo ranh giới semantic group; nếu batch chỉ gồm 1 group đơn lẻ
 * có nhiều cue thì mới chia đôi cues của group đó.
 */
export function splitSemanticBatch<T extends SemanticCue>(
  batchGroups: readonly SemanticGroup<T>[]
): [SemanticGroup<T>[], SemanticGroup<T>[]] | null {
  if (batchGroups.length === 0) return null

  // Nếu batch có nhiều hơn 1 group -> chia theo ranh giới group
  if (batchGroups.length > 1) {
    const mid = Math.ceil(batchGroups.length / 2)
    return [batchGroups.slice(0, mid), batchGroups.slice(mid)]
  }

  // Nếu batch chỉ có 1 group duy nhất
  const single = batchGroups[0]
  if (single.cues.length < 2) return null

  const mid = Math.ceil(single.cues.length / 2)
  const leftCues = single.cues.slice(0, mid)
  const rightCues = single.cues.slice(mid)

  const leftTimingFirst = parseCueTiming(leftCues[0])
  const leftTimingLast = parseCueTiming(leftCues[leftCues.length - 1])
  const rightTimingFirst = parseCueTiming(rightCues[0])
  const rightTimingLast = parseCueTiming(rightCues[rightCues.length - 1])

  const leftGroup: SemanticGroup<T> = {
    id: `${single.id}-left`,
    cues: leftCues,
    text: joinGroupText(leftCues),
    start: leftTimingFirst.start,
    end: leftTimingLast.end
  }

  const rightGroup: SemanticGroup<T> = {
    id: `${single.id}-right`,
    cues: rightCues,
    text: joinGroupText(rightCues),
    start: rightTimingFirst.start,
    end: rightTimingLast.end
  }

  return [[leftGroup], [rightGroup]]
}
