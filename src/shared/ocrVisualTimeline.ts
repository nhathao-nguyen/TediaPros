import type { AutoShortOcrBlurProfile, PixelRegion } from './types'
import type { SubtitleCue } from './subtitles'

export const OCR_VISUAL_MAX_BYTES = 64 * 1024 * 1024
export const OCR_VISUAL_MAX_SEGMENTS = 100_000
export const OCR_VISUAL_MAX_BOXES_PER_SEGMENT = 64
export const OCR_VISUAL_MAX_TEXT_CODE_POINTS = 4_096
export const OCR_SAMPLE_FPS = 8 as const

export interface OcrVisualBox extends PixelRegion {
  text: string
  confidence: number
}

export interface OcrVisualSegment {
  id: string
  startFrame: number
  endFrameExclusive: number
  start: number
  end: number
  text: string
  confidence: number
  boxes: OcrVisualBox[]
}

export interface OcrVisualTimeline {
  schemaVersion: 1
  protocol: 'ocr-visual-cues/1'
  video: {
    width: number
    height: number
    durationSeconds: number
    sampleFps: 8
    frameCount: number
    geometryFingerprint: string
  }
  profile: AutoShortOcrBlurProfile
  scanRegion: PixelRegion
  segments: OcrVisualSegment[]
}

export interface ExpectedOcrTimelineGeometry {
  width: number
  height: number
  durationSeconds: number
  sampleFps: 8
  geometryFingerprint: string
  scanRegion: PixelRegion
}

export interface PaddedMaskSegment {
  startFrame: number
  endFrameExclusive: number
  boxes: PixelRegion[]
}

export interface OcrMaskFramePlan {
  sampleFps: 8
  width: number
  height: number
  activeFrameCount: number
  totalFrameCount: number
  segments: PaddedMaskSegment[]
}

export function normalizeText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function computeIoU(a: PixelRegion, b: PixelRegion): number {
  const ix0 = Math.max(a.x0, b.x0)
  const iy0 = Math.max(a.y0, b.y0)
  const ix1 = Math.min(a.x1, b.x1)
  const iy1 = Math.min(a.y1, b.y1)
  if (ix1 <= ix0 || iy1 <= iy0) return 0
  const intersectionArea = (ix1 - ix0) * (iy1 - iy0)
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0)
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0)
  const unionArea = areaA + areaB - intersectionArea
  return unionArea > 0 ? intersectionArea / unionArea : 0
}

function mergeOverlappingBoxes(boxes: PixelRegion[]): PixelRegion[] {
  if (boxes.length <= 1) return [...boxes]
  let current = [...boxes]
  let merged = true
  while (merged) {
    merged = false
    const next: PixelRegion[] = []
    const used = new Set<number>()
    for (let i = 0; i < current.length; i++) {
      if (used.has(i)) continue
      let b = { ...current[i] }
      for (let j = i + 1; j < current.length; j++) {
        if (used.has(j)) continue
        const other = current[j]
        const ix0 = Math.max(b.x0, other.x0)
        const iy0 = Math.max(b.y0, other.y0)
        const ix1 = Math.min(b.x1, other.x1)
        const iy1 = Math.min(b.y1, other.y1)
        if (ix1 > ix0 && iy1 > iy0) {
          b = {
            x0: Math.min(b.x0, other.x0),
            y0: Math.min(b.y0, other.y0),
            x1: Math.max(b.x1, other.x1),
            y1: Math.max(b.y1, other.y1)
          }
          used.add(j)
          merged = true
        }
      }
      next.push(b)
    }
    current = next
  }
  return current
}

export function validateOcrVisualTimeline(
  raw: unknown,
  expected: ExpectedOcrTimelineGeometry
): OcrVisualTimeline {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Timeline OCR không hợp lệ: không phải object.')
  }
  const r = raw as Record<string, unknown>

  if (r.schemaVersion !== 1) {
    throw new Error(`Schema version không hợp lệ: mong đợi 1, nhận được ${r.schemaVersion}.`)
  }
  if (r.protocol !== 'ocr-visual-cues/1') {
    throw new Error(`Protocol không hợp lệ: mong đợi ocr-visual-cues/1, nhận được ${r.protocol}.`)
  }
  if (r.profile !== 'accurate' && r.profile !== 'fast') {
    throw new Error(`Profile OCR không hợp lệ: ${r.profile}.`)
  }

  const v = r.video as Record<string, unknown> | undefined
  if (!v || typeof v !== 'object') {
    throw new Error('Thiếu thông tin video trong timeline OCR.')
  }
  if (v.width !== expected.width) {
    throw new Error(`Chiều rộng video (width) không khớp: mong đợi ${expected.width}, nhận được ${v.width}.`)
  }
  if (v.height !== expected.height) {
    throw new Error(`Chiều cao video (height) không khớp: mong đợi ${expected.height}, nhận được ${v.height}.`)
  }
  if (v.sampleFps !== 8) {
    throw new Error(`Tốc độ mẫu fps không hợp lệ: mong đợi 8, nhận được ${v.sampleFps}.`)
  }
  if (!Number.isFinite(v.durationSeconds) || Math.abs((v.durationSeconds as number) - expected.durationSeconds) > 1e-4) {
    throw new Error(`Thời lượng video (duration) không khớp: mong đợi ${expected.durationSeconds}, nhận được ${v.durationSeconds}.`)
  }
  if (v.geometryFingerprint !== expected.geometryFingerprint) {
    throw new Error('Geometry fingerprint không khớp.')
  }
  if (!Number.isInteger(v.frameCount) || (v.frameCount as number) <= 0) {
    throw new Error('Số khung hình frameCount không hợp lệ.')
  }

  const scan = r.scanRegion as Record<string, unknown> | undefined
  if (
    !scan ||
    scan.x0 !== expected.scanRegion.x0 ||
    scan.y0 !== expected.scanRegion.y0 ||
    scan.x1 !== expected.scanRegion.x1 ||
    scan.y1 !== expected.scanRegion.y1
  ) {
    throw new Error('Vùng scanRegion không khớp với cấu hình.')
  }

  if (!Array.isArray(r.segments)) {
    throw new Error('Danh sách segments không phải array.')
  }
  if (r.segments.length > OCR_VISUAL_MAX_SEGMENTS) {
    throw new Error(`Số lượng segments vượt quá giới hạn tối đa ${OCR_VISUAL_MAX_SEGMENTS}.`)
  }

  const seenIds = new Set<string>()
  let lastEndFrame = -1
  const validatedSegments: OcrVisualSegment[] = []

  for (let i = 0; i < r.segments.length; i++) {
    const seg = r.segments[i] as Record<string, unknown>
    if (!seg || typeof seg !== 'object') {
      throw new Error(`Segment thứ ${i + 1} không hợp lệ.`)
    }

    const id = String(seg.id || '')
    if (!id || seenIds.has(id)) {
      throw new Error(`Segment ID bị trùng hoặc rỗng: ${id}.`)
    }
    if (id.startsWith('gap-')) {
      throw new Error(`Raw segment từ engine không được chứa prefix gap-: ${id}.`)
    }
    if (!/^(accurate-\d+|fast-\d+-\d+)$/.test(id)) {
      throw new Error(`Segment ID không đúng định dạng: ${id}.`)
    }
    seenIds.add(id)

    const startFrame = seg.startFrame
    const endFrameExclusive = seg.endFrameExclusive
    if (!Number.isInteger(startFrame) || (startFrame as number) < 0) {
      throw new Error(`startFrame không hợp lệ ở segment ${id}: ${startFrame}.`)
    }
    if (!Number.isInteger(endFrameExclusive) || (endFrameExclusive as number) <= 0) {
      throw new Error(`endFrameExclusive không hợp lệ ở segment ${id}: ${endFrameExclusive}.`)
    }
    const sFrame = startFrame as number
    const eFrame = endFrameExclusive as number
    if (sFrame >= eFrame) {
      throw new Error(`Yêu cầu startFrame < endFrameExclusive ở segment ${id}.`)
    }
    if (eFrame > (v.frameCount as number) || sFrame / 8 >= expected.durationSeconds) {
      throw new Error(`Khung hình vượt quá thời lượng video (duration) ở segment ${id}.`)
    }
    if (sFrame < lastEndFrame) {
      throw new Error(`Các segments bị unordered hoặc chồng chéo tại segment ${id}.`)
    }
    lastEndFrame = eFrame

    const start = Number(seg.start)
    const end = Number(seg.end)
    if (!Number.isFinite(start) || Math.abs(start - sFrame / 8) > 1e-6) {
      throw new Error(`start time không khớp công thức startFrame/8 ở segment ${id}.`)
    }
    const expectedEnd = Math.min(eFrame / 8, expected.durationSeconds)
    if (!Number.isFinite(end) || Math.abs(end - expectedEnd) > 1e-6) {
      throw new Error(`end time không khớp công thức endFrameExclusive/8 ở segment ${id}.`)
    }
    if (start >= end) {
      throw new Error(`start >= end ở segment ${id}.`)
    }
    if (end > expected.durationSeconds + 1e-4) {
      throw new Error(`end vượt quá video duration ở segment ${id}.`)
    }

    const text = String(seg.text ?? '').trim()
    if (!text) {
      throw new Error(`Văn bản text rỗng ở segment ${id}.`)
    }
    if (Array.from(text).length > OCR_VISUAL_MAX_TEXT_CODE_POINTS) {
      throw new Error(`Độ dài văn bản vượt quá ${OCR_VISUAL_MAX_TEXT_CODE_POINTS} ký tự ở segment ${id}.`)
    }

    if (!Array.isArray(seg.boxes) || seg.boxes.length === 0 || seg.boxes.length > OCR_VISUAL_MAX_BOXES_PER_SEGMENT) {
      throw new Error(`Số lượng boxes không hợp lệ ở segment ${id}.`)
    }

    let minBoxConf = 1.0
    const validatedBoxes: OcrVisualBox[] = []
    for (let bIdx = 0; bIdx < seg.boxes.length; bIdx++) {
      const box = seg.boxes[bIdx] as Record<string, unknown>
      if (!box || typeof box !== 'object') {
        throw new Error(`Box thứ ${bIdx + 1} ở segment ${id} không hợp lệ.`)
      }
      const boxText = String(box.text ?? '').trim()
      if (!boxText) {
        throw new Error(`Box text rỗng ở segment ${id}.`)
      }
      if (Array.from(boxText).length > OCR_VISUAL_MAX_TEXT_CODE_POINTS) {
        throw new Error(`Box text vượt quá ${OCR_VISUAL_MAX_TEXT_CODE_POINTS} ở segment ${id}.`)
      }
      const conf = Number(box.confidence)
      if (!Number.isFinite(conf) || conf <= 0.5 || conf > 1.0) {
        throw new Error(`Box confidence phải > 0.5 và <= 1.0, nhận được ${conf} ở segment ${id}.`)
      }
      if (conf < minBoxConf) minBoxConf = conf

      const x0 = Number(box.x0)
      const y0 = Number(box.y0)
      const x1 = Number(box.x1)
      const y1 = Number(box.y1)
      if (!Number.isInteger(x0) || !Number.isInteger(y0) || !Number.isInteger(x1) || !Number.isInteger(y1)) {
        throw new Error(`Tọa độ box phải là số nguyên ở segment ${id}.`)
      }
      if (x1 <= x0 || y1 <= y0) {
        throw new Error(`Tọa độ box bị đảo ngược hoặc rỗng ở segment ${id}.`)
      }
      if (
        x0 < expected.scanRegion.x0 ||
        y0 < expected.scanRegion.y0 ||
        x1 > expected.scanRegion.x1 ||
        y1 > expected.scanRegion.y1
      ) {
        throw new Error(`Box nằm ngoài vùng scan region ở segment ${id}.`)
      }

      validatedBoxes.push({
        text: boxText,
        confidence: conf,
        x0,
        y0,
        x1,
        y1
      })
    }

    const segConf = Number(seg.confidence)
    if (Math.abs(segConf - minBoxConf) > 1e-6) {
      throw new Error(`Segment confidence phải bằng min box confidence ở segment ${id}.`)
    }

    validatedSegments.push({
      id,
      startFrame: sFrame,
      endFrameExclusive: eFrame,
      start,
      end,
      text,
      confidence: minBoxConf,
      boxes: validatedBoxes
    })
  }

  return {
    schemaVersion: 1,
    protocol: 'ocr-visual-cues/1',
    video: {
      width: expected.width,
      height: expected.height,
      durationSeconds: expected.durationSeconds,
      sampleFps: 8,
      frameCount: v.frameCount as number,
      geometryFingerprint: expected.geometryFingerprint
    },
    profile: r.profile as AutoShortOcrBlurProfile,
    scanRegion: { ...expected.scanRegion },
    segments: validatedSegments
  }
}

export function stabilizeSingleSampleGaps(timeline: OcrVisualTimeline): OcrVisualTimeline {
  const segments: OcrVisualSegment[] = []
  const original = timeline.segments

  for (let i = 0; i < original.length; i++) {
    const current = original[i]
    segments.push(current)

    if (i + 1 < original.length) {
      const next = original[i + 1]
      if (next.startFrame - current.endFrameExclusive === 1) {
        // Exactly 1 sample gap
        if (
          normalizeText(current.text) === normalizeText(next.text) &&
          current.boxes.length === next.boxes.length
        ) {
          // Check 1-to-1 box matching
          const usedNext = new Set<number>()
          const matches: Array<{ left: OcrVisualBox; right: OcrVisualBox }> = []
          let allMatched = true

          for (const leftBox of current.boxes) {
            let bestMatchIdx = -1
            let bestIoU = -1
            for (let j = 0; j < next.boxes.length; j++) {
              if (usedNext.has(j)) continue
              const rightBox = next.boxes[j]
              if (normalizeText(leftBox.text) !== normalizeText(rightBox.text)) continue
              const iou = computeIoU(leftBox, rightBox)
              if (iou >= 0.5 && iou > bestIoU) {
                const wLeft = leftBox.x1 - leftBox.x0
                const wRight = rightBox.x1 - rightBox.x0
                const hLeft = leftBox.y1 - leftBox.y0
                const hRight = rightBox.y1 - rightBox.y0
                const wRatio = wRight / wLeft
                const hRatio = hRight / hLeft
                if (wRatio >= 0.75 && wRatio <= 1.33 && hRatio >= 0.75 && hRatio <= 1.33) {
                  bestMatchIdx = j
                  bestIoU = iou
                }
              }
            }
            if (bestMatchIdx >= 0) {
              usedNext.add(bestMatchIdx)
              matches.push({ left: leftBox, right: next.boxes[bestMatchIdx] })
            } else {
              allMatched = false
              break
            }
          }

          if (allMatched && matches.length === current.boxes.length) {
            const missingFrame = current.endFrameExclusive
            const syntheticBoxes: OcrVisualBox[] = matches.map(({ left, right }) => ({
              text: left.text,
              confidence: Math.min(left.confidence, right.confidence),
              x0: Math.min(left.x0, right.x0),
              y0: Math.min(left.y0, right.y0),
              x1: Math.max(left.x1, right.x1),
              y1: Math.max(left.y1, right.y1)
            }))
            const minConf = Math.min(...syntheticBoxes.map((b) => b.confidence))
            const syntheticSegment: OcrVisualSegment = {
              id: `gap-${missingFrame}-${current.id}-${next.id}`,
              startFrame: missingFrame,
              endFrameExclusive: missingFrame + 1,
              start: missingFrame / 8,
              end: Math.min((missingFrame + 1) / 8, timeline.video.durationSeconds),
              text: current.text,
              confidence: minConf,
              boxes: syntheticBoxes
            }
            segments.push(syntheticSegment)
          }
        }
      }
    }
  }

  return {
    ...timeline,
    segments
  }
}

export function projectOcrTimelineToSubtitleCues(timeline: OcrVisualTimeline): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  if (timeline.segments.length === 0) return cues

  let currentGroup: OcrVisualSegment[] = [timeline.segments[0]]

  for (let i = 1; i < timeline.segments.length; i++) {
    const seg = timeline.segments[i]
    const prev = currentGroup[currentGroup.length - 1]

    const isTouching = seg.startFrame === prev.endFrameExclusive
    const isSameText = normalizeText(seg.text) === normalizeText(prev.text)

    if (isTouching && isSameText) {
      currentGroup.push(seg)
    } else {
      const first = currentGroup[0]
      const last = currentGroup[currentGroup.length - 1]
      cues.push({
        id: first.id,
        start: first.start,
        end: last.end,
        text: first.text,
        sourceIndex: cues.length
      })
      currentGroup = [seg]
    }
  }

  if (currentGroup.length > 0) {
    const first = currentGroup[0]
    const last = currentGroup[currentGroup.length - 1]
    cues.push({
      id: first.id,
      start: first.start,
      end: last.end,
      text: first.text,
      sourceIndex: cues.length
    })
  }

  return cues
}

export function planOcrMaskFrames(
  timeline: OcrVisualTimeline,
  durationSeconds: number
): OcrMaskFramePlan {
  const sampleFps = 8
  const width = timeline.video.width
  const height = timeline.video.height
  const activeFrameCount = Math.ceil(durationSeconds * sampleFps)
  const totalFrameCount = activeFrameCount + 1

  const segments: PaddedMaskSegment[] = []

  for (const seg of timeline.segments) {
    const startFrame = Math.max(0, seg.startFrame - 1)
    const endFrameExclusive = Math.min(activeFrameCount, seg.endFrameExclusive + 1)
    if (startFrame >= endFrameExclusive) continue

    const paddedBoxes: PixelRegion[] = seg.boxes.map((b) => {
      const boxH = b.y1 - b.y0
      const pad = Math.max(6, Math.min(16, Math.round(boxH * 0.20)))
      return {
        x0: Math.max(0, Math.max(timeline.scanRegion.x0, b.x0 - pad)),
        y0: Math.max(0, Math.max(timeline.scanRegion.y0, b.y0 - pad)),
        x1: Math.min(width, Math.min(timeline.scanRegion.x1, b.x1 + pad)),
        y1: Math.min(height, Math.min(timeline.scanRegion.y1, b.y1 + pad))
      }
    })

    const mergedBoxes = mergeOverlappingBoxes(paddedBoxes)
    segments.push({
      startFrame,
      endFrameExclusive,
      boxes: mergedBoxes
    })
  }

  return {
    sampleFps,
    width,
    height,
    activeFrameCount,
    totalFrameCount,
    segments
  }
}

export function boxesForMaskFrame(
  plan: OcrMaskFramePlan,
  frameIndex: number
): PixelRegion[] {
  if (frameIndex < 0 || frameIndex >= plan.activeFrameCount) {
    return []
  }
  const collected: PixelRegion[] = []
  for (const seg of plan.segments) {
    if (seg.startFrame <= frameIndex && frameIndex < seg.endFrameExclusive) {
      for (const b of seg.boxes) {
        collected.push(b)
      }
    }
  }
  return mergeOverlappingBoxes(collected)
}
