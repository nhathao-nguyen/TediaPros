import type {
  RenderedSubtitleSegment,
  SubtitleCue,
  SubtitleCueHealth,
  SubtitleCueHealthLevel,
  SubtitleCueIssue,
  SubtitleLayoutOptions,
  SubtitleLayoutProfile,
  SubtitleRenderPlan
} from './types'
import {
  cueUsesCjkWrap,
  ngatDongTheoPx,
  wrapWidthFromBox,
  type MeasureFn
} from './subWrap'

const MIN_READABLE_SECONDS = 5 / 6

interface LayoutRules {
  maxLines: number
  hardCps: number
}

export function subtitleLayoutRules(profile: SubtitleLayoutProfile): LayoutRules {
  if (profile === 'social') return { maxLines: 1, hardCps: 28 }
  // A two-line default keeps the rendered anchor stable inside the subtitle
  // box. Longer text is split into timed render segments instead of jumping
  // the whole block upward to a third line.
  if (profile === 'vertical') return { maxLines: 2, hardCps: 26 }
  return { maxLines: 2, hardCps: 23 }
}

function graphemes(text: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    try {
      return Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text), (item) => item.segment)
    } catch {
      // Fall through to the code-point fallback below.
    }
  }
  return Array.from(text)
}

function readableCharacterCount(text: string): number {
  return graphemes(text).filter((value) => !/^\s+$/u.test(value)).length
}

function severity(level: SubtitleCueHealthLevel): number {
  return level === 'error' ? 2 : level === 'warning' ? 1 : 0
}

function highestLevel(issues: readonly SubtitleCueIssue[]): SubtitleCueHealthLevel {
  return issues.reduce<SubtitleCueHealthLevel>(
    (current, issue) => (severity(issue.level) > severity(current) ? issue.level : current),
    'good'
  )
}

export interface SegmentTiming {
  startSec: number
  endSec: number
  durationSec: number
}

const TARGET_CPS = 15.0

function allocateCentiseconds(total: number, weights: readonly number[], minimum: number): number[] {
  if (weights.length === 0) return []
  if (weights.length === 1) return [total]
  const safeMinimum = minimum * weights.length <= total ? minimum : 1
  const remaining = Math.max(0, total - safeMinimum * weights.length)
  const weightSum = weights.reduce((sum, value) => sum + Math.max(1, value), 0)
  const exact = weights.map((value) => (remaining * Math.max(1, value)) / weightSum)
  const result = exact.map((value) => safeMinimum + Math.floor(value))
  let missing = total - result.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let index = 0; index < missing; index++) result[order[index % order.length].index]++
  return result
}

/**
 * Phân bổ thời lượng các segment hiển thị bằng Quy hoạch động (Timeline Smoothing DP).
 * - Làm phẳng tốc độ đọc (CPS) giữa các segment liền kề để không có đoạn quá gấp, đoạn quá thảnh thơi.
 * - Khi tổng thời lượng lớn hơn thời gian đọc tối đa (có khoảng lặng dead air giữa 2 câu),
 *   tự động tạo silence gap giữa các segment thay vì kéo dài lê thê phụ đề trên màn hình.
 */
export function allocateSegmentTimingsDP(
  cueStartSec: number,
  cueEndSec: number,
  groups: readonly string[][],
  rules: LayoutRules
): SegmentTiming[] {
  const K = groups.length
  if (K === 0) return []
  const totalDurationSec = Math.max(0.01, cueEndSec - cueStartSec)
  if (K === 1) {
    return [{ startSec: cueStartSec, endSec: cueEndSec, durationSec: totalDurationSec }]
  }

  const totalCs = Math.max(K, Math.round(totalDurationSec * 100))
  const cueStartCs = Math.round(cueStartSec * 100)
  const minReadableCs = Math.round(MIN_READABLE_SECONDS * 100)

  // Tính số ký tự và các giới hạn thời gian (centiseconds) cho từng group
  const charCounts = groups.map((lines) => Math.max(1, readableCharacterCount(lines.join(' '))))
  const dMin = charCounts.map((chars) =>
    Math.max(minReadableCs, Math.round((chars / rules.hardCps) * 100))
  )
  const dMax = charCounts.map((chars) =>
    Math.max(minReadableCs, Math.round(Math.min(chars / 7.5, 3.8) * 100))
  )
  const sumDMax = dMax.reduce((sum, d) => sum + d, 0)
  const sumDMin = dMin.reduce((sum, d) => sum + d, 0)

  // Kiểm tra ranh giới câu giữa các group
  const hasSentenceBreak = groups.map((lines) =>
    /[.!?。！？؟…]["'”’»›)\]})]*$/u.test(lines.at(-1)?.trim() || '')
  )

  // CASE 1: Dead-Air Silence Gap Detected (Tổng thời lượng > tổng dMax + 0.8s)
  // Phụ đề chia theo cụm: cụm trước bám start, cụm sau bám end, khoảng giữa là khoảng lặng
  if (totalCs > sumDMax + 80) {
    let breakIdx = -1
    for (let i = 0; i < K - 1; i++) {
      if (hasSentenceBreak[i]) {
        breakIdx = i
        break
      }
    }
    if (breakIdx === -1) {
      breakIdx = Math.floor(K / 2) - 1
    }

    const firstCount = breakIdx + 1
    const secondCount = K - firstCount

    const firstWeights = charCounts.slice(0, firstCount)
    const firstDurationCs = Math.min(
      sumDMax,
      dMax.slice(0, firstCount).reduce((s, v) => s + v, 0)
    )
    const firstDurations = allocateCentiseconds(firstDurationCs, firstWeights, minReadableCs)

    const secondWeights = charCounts.slice(firstCount)
    const secondDurationCs = Math.min(
      sumDMax,
      dMax.slice(firstCount).reduce((s, v) => s + v, 0)
    )
    const secondDurations = allocateCentiseconds(secondDurationCs, secondWeights, minReadableCs)

    const result: SegmentTiming[] = []
    let cursorCs = cueStartCs

    for (let i = 0; i < firstCount; i++) {
      const d = firstDurations[i]
      result.push({
        startSec: cursorCs / 100,
        endSec: (cursorCs + d) / 100,
        durationSec: d / 100
      })
      cursorCs += d
    }

    const secondStartCs = Math.max(cursorCs + 40, cueStartCs + totalCs - secondDurationCs)
    let cursorSecondCs = secondStartCs

    for (let i = 0; i < secondCount; i++) {
      const d = secondDurations[i]
      const isLast = i === secondCount - 1
      const endCs = isLast ? cueStartCs + totalCs : cursorSecondCs + d
      result.push({
        startSec: cursorSecondCs / 100,
        endSec: endCs / 100,
        durationSec: (endCs - cursorSecondCs) / 100
      })
      cursorSecondCs = endCs
    }

    return result
  }

  // CASE 2: Continuous Speech Timeline Smoothing DP
  // Tối ưu hóa CPS liên tục để chênh lệch CPS giữa các segment nhỏ nhất
  let safeDMin = dMin.slice()
  if (sumDMin > totalCs) {
    const scale = totalCs / sumDMin
    safeDMin = dMin.map((d) => Math.max(1, Math.floor(d * scale)))
  }

  const STEP = 5
  const totalSteps = Math.floor(totalCs / STEP)
  const minSteps = safeDMin.map((d) => Math.max(1, Math.floor(d / STEP)))
  const maxSteps = dMax.map((d) => Math.max(minSteps[0], Math.ceil(Math.max(d * 1.5, totalCs) / STEP)))

  const dp: number[][] = Array.from({ length: K }, () => Array(totalSteps + 1).fill(Infinity))
  const pick: number[][] = Array.from({ length: K }, () => Array(totalSteps + 1).fill(0))

  for (let s = minSteps[0]; s <= Math.min(totalSteps, maxSteps[0]); s++) {
    const durSec = (s * STEP) / 100
    const cps = charCounts[0] / durSec
    dp[0][s] = Math.pow(cps - TARGET_CPS, 2)
    pick[0][s] = s
  }

  for (let k = 1; k < K; k++) {
    const chars = charCounts[k]
    const minS = minSteps[k]
    const maxS = maxSteps[k]

    for (let totalS = minS; totalS <= totalSteps; totalS++) {
      let bestCost = Infinity
      let bestChoice = minS

      for (let s = minS; s <= Math.min(totalS, maxS); s++) {
        const prevS = totalS - s
        const prevCost = dp[k - 1][prevS]
        if (!Number.isFinite(prevCost)) continue

        const durSec = (s * STEP) / 100
        const cps = chars / durSec
        const prevDurSec = (pick[k - 1][prevS] * STEP) / 100
        const prevCps = charCounts[k - 1] / prevDurSec
        const smoothCost = Math.pow(cps - prevCps, 2) * 1.5
        const targetCost = Math.pow(cps - TARGET_CPS, 2)
        const totalCandidateCost = prevCost + targetCost + smoothCost

        if (totalCandidateCost < bestCost) {
          bestCost = totalCandidateCost
          bestChoice = s
        }
      }

      dp[k][totalS] = bestCost
      pick[k][totalS] = bestChoice
    }
  }

  const chosenDurationsCs: number[] = new Array(K).fill(0)
  let remainSteps = totalSteps
  for (let k = K - 1; k >= 0; k--) {
    const s = pick[k][remainSteps] || minSteps[k]
    chosenDurationsCs[k] = s * STEP
    remainSteps -= s
  }

  let allocatedSum = chosenDurationsCs.reduce((sum, d) => sum + d, 0)
  let diffCs = totalCs - allocatedSum
  while (diffCs > 0) {
    let highestCpsIdx = 0
    let highestCps = -1
    for (let i = 0; i < K; i++) {
      const cps = charCounts[i] / (chosenDurationsCs[i] / 100)
      if (cps > highestCps) {
        highestCps = cps
        highestCpsIdx = i
      }
    }
    chosenDurationsCs[highestCpsIdx]++
    diffCs--
  }

  const result: SegmentTiming[] = []
  let cursorCs = cueStartCs
  for (let i = 0; i < K; i++) {
    const d = chosenDurationsCs[i]
    const isLast = i === K - 1
    const endCs = isLast ? cueStartCs + totalCs : cursorCs + d
    result.push({
      startSec: cursorCs / 100,
      endSec: endCs / 100,
      durationSec: (endCs - cursorCs) / 100
    })
    cursorCs = endCs
  }

  return result
}

function lineGroups(lines: readonly string[], maxLines: number, autoOptimize: boolean): string[][] {
  if (!autoOptimize || lines.length <= maxLines) return [lines.slice()]
  const groups: string[][] = []
  for (let index = 0; index < lines.length; index += maxLines) {
    groups.push(lines.slice(index, index + maxLines))
  }
  return groups
}

function balanceLineGroup(lines: readonly string[], maxWidth: number, measure: MeasureFn): string[] {
  if (lines.length < 2 || lines.some((line) => !/\s/u.test(line))) return lines.slice()
  const balanced = lines.slice()
  for (let index = 0; index < balanced.length - 1; index++) {
    let leftWords = balanced[index].trim().split(/\s+/u)
    let rightWords = balanced[index + 1].trim().split(/\s+/u)
    let currentDifference = Math.abs(measure(leftWords.join(' ')) - measure(rightWords.join(' ')))
    while (leftWords.length > 1) {
      const moved = leftWords.at(-1)!
      if (/[.!?。！？؟…]["'”’»›)\]})]*$/u.test(moved)) break
      const nextLeft = leftWords.slice(0, -1)
      const nextRight = [moved, ...rightWords]
      const leftWidth = measure(nextLeft.join(' '))
      const rightWidth = measure(nextRight.join(' '))
      const nextDifference = Math.abs(leftWidth - rightWidth)
      if (leftWidth > maxWidth || rightWidth > maxWidth || nextDifference >= currentDifference) break
      leftWords = nextLeft
      rightWords = nextRight
      currentDifference = nextDifference
    }
    balanced[index] = leftWords.join(' ')
    balanced[index + 1] = rightWords.join(' ')
  }
  return balanced
}

function segmentIssues(
  lines: readonly string[],
  widths: readonly number[],
  cps: number,
  maxWidth: number,
  rules: LayoutRules
): SubtitleCueIssue[] {
  const issues: SubtitleCueIssue[] = []
  if (widths.some((width) => width > maxWidth + 0.5)) {
    issues.push({
      code: 'overflow',
      level: 'error',
      message: 'Đoạn chữ vẫn vượt khỏi vùng phụ đề.'
    })
  }
  if (lines.length > rules.maxLines) {
    issues.push({
      code: 'too-many-lines',
      level: 'error',
      message: `Đoạn chữ có ${lines.length} dòng, vượt giới hạn ${rules.maxLines} dòng.`
    })
  }
  if (cps > rules.hardCps) {
    issues.push({
      code: 'too-fast',
      level: 'warning',
      message: 'Nhịp chữ rất nhanh; hãy nghe thử để xác nhận vẫn khớp lời nói.'
    })
  }
  return issues
}

/**
 * Lap bo cuc thuần, deterministic cho preview va ASS. Ham do chu duoc inject
 * de main co the dung dung file font da chon, con smoke test dung fixture nhe.
 */
export function planSubtitleLayout(
  cues: readonly SubtitleCue[],
  options: SubtitleLayoutOptions,
  measure: MeasureFn
): SubtitleRenderPlan {
  const profileRules = subtitleLayoutRules(options.profile)
  const verticalCapacity = Math.max(
    1,
    Math.floor(Math.max(1, options.boxHeight) / Math.max(1, options.fontSize * 1.25))
  )
  const rules: LayoutRules = {
    ...profileRules,
    maxLines: Math.min(profileRules.maxLines, verticalCapacity)
  }
  const maxWidth = wrapWidthFromBox(options.boxWidth, options.boxPadding)
  const segments: RenderedSubtitleSegment[] = []
  const cueHealth: SubtitleCueHealth[] = []

  for (const cue of cues) {
    const normalized = cue.text.replace(/\r\n|\r|\n/g, '\\N').replace(/[{}]/g, '')
    const wrapped = ngatDongTheoPx(normalized, maxWidth, measure, cueUsesCjkWrap(normalized))
    const allLines = wrapped.split('\\N').filter((line) => line.length > 0)
    const safeLines = allLines.length > 0 ? allLines : ['']
    const groups = lineGroups(safeLines, rules.maxLines, options.autoOptimize).map((lines) =>
      normalized.includes('\\N') ? lines : balanceLineGroup(lines, maxWidth, measure)
    )
    const timings = allocateSegmentTimingsDP(cue.start, cue.end, groups, rules)
    const cueSegments: RenderedSubtitleSegment[] = []

    for (let index = 0; index < groups.length; index++) {
      const lines = groups[index]
      const timing = timings[index] || {
        startSec: cue.start,
        endSec: cue.end,
        durationSec: Math.max(0.01, cue.end - cue.start)
      }
      const start = timing.startSec
      const end = timing.endSec
      const duration = timing.durationSec
      const text = lines.join('\n')
      const lineWidths = lines.map((line) => measure(line))
      const charactersPerSecond = readableCharacterCount(text) / duration
      const issues = segmentIssues(
        lines,
        lineWidths,
        charactersPerSecond,
        maxWidth,
        rules
      )
      cueSegments.push({
        ...cue,
        id: `${cue.id}:render:${index + 1}`,
        sourceCueId: cue.id,
        segmentIndex: index,
        start,
        end,
        text,
        lines,
        lineWidths,
        charactersPerSecond,
        issues
      })
    }

    const issues = cueSegments.flatMap((segment) => segment.issues)
    if (cueSegments.length > 1) {
      issues.unshift({
        code: 'split',
        level: 'good',
        message: `Đã tự chia thành ${cueSegments.length} đoạn để chữ không tràn khung.`
      })
    }
    const uniqueIssues = issues.filter(
      (issue, index, list) => list.findIndex((other) => other.code === issue.code && other.message === issue.message) === index
    )
    cueHealth.push({
      cueId: cue.id,
      level: highestLevel(uniqueIssues),
      lineCount: Math.max(...cueSegments.map((segment) => segment.lines.length)),
      charactersPerSecond: Math.max(...cueSegments.map((segment) => segment.charactersPerSecond)),
      duration: Math.max(0, cue.end - cue.start),
      segmentCount: cueSegments.length,
      issues: uniqueIssues
    })
    segments.push(...cueSegments)
  }

  return {
    segments,
    cueHealth,
    summary: {
      cueCount: cues.length,
      segmentCount: segments.length,
      splitCueCount: cueHealth.filter((health) => health.segmentCount > 1).length,
      warningCueCount: cueHealth.filter((health) => health.level === 'warning').length,
      errorCueCount: cueHealth.filter((health) => health.level === 'error').length
    },
    options
  }
}
