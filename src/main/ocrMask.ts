import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { terminateProcessTree, trackChildProcess } from './processTree'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import {
  planOcrMaskFrames,
  boxesForMaskFrame
} from '../shared/ocrVisualTimeline'
import type {
  OcrVisualTimeline,
  PixelRegion
} from '../shared/types'

export interface TimedOcrBlurMask {
  path: string
  width: number
  height: number
  durationSeconds: number
  sampleFps: 8
  visualCueCount: number
  boxSegmentCount: number
}

/**
 * Rasterize a single grayscale mask frame (8-bit grayscale, 0x00=black/clear, 0xff=white/blur).
 */
export function rasterizeOcrMaskFrame(
  width: number,
  height: number,
  boxes: readonly PixelRegion[]
): Buffer {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error(`Kích thước khung hình không hợp lệ: ${width}x${height}`)
  }

  const frame = Buffer.alloc(width * height, 0x00)

  for (const box of boxes) {
    const x0 = Number(box.x0)
    const y0 = Number(box.y0)
    const x1 = Number(box.x1)
    const y1 = Number(box.y1)

    if (!Number.isInteger(x0) || !Number.isInteger(y0) || !Number.isInteger(x1) || !Number.isInteger(y1)) {
      throw new Error(`Tọa độ bounding box phải là số nguyên: (${x0},${y0})-(${x1},${y1})`)
    }

    if (x0 < 0 || y0 < 0 || x1 > width || y1 > height || x1 <= x0 || y1 <= y0) {
      throw new Error(`Bounding box nằm ngoài giới hạn khung hình [0,0,${width},${height}]: (${x0},${y0})-(${x1},${y1})`)
    }

    for (let y = y0; y < y1; y++) {
      frame.fill(0xff, y * width + x0, y * width + x1)
    }
  }

  return frame
}

/**
 * Compute expected MD5 hashes for all frames in the plan.
 */
export function computeExpectedMaskFrameHashes(
  timeline: OcrVisualTimeline,
  durationSeconds: number
): { expectedHashes: string[]; totalFrameCount: number; activeFrameCount: number; width: number; height: number } {
  const plan = planOcrMaskFrames(timeline, durationSeconds)
  const expectedHashes: string[] = []

  for (let k = 0; k < plan.totalFrameCount; k++) {
    const boxes = boxesForMaskFrame(plan, k)
    const buf = rasterizeOcrMaskFrame(plan.width, plan.height, boxes)
    expectedHashes.push(createHash('md5').update(buf).digest('hex'))
  }

  return {
    expectedHashes,
    totalFrameCount: plan.totalFrameCount,
    activeFrameCount: plan.activeFrameCount,
    width: plan.width,
    height: plan.height
  }
}

/**
 * Validate an encoded timed OCR blur mask file using FFprobe and FFmpeg framemd5.
 */
export async function validateTimedOcrBlurMask(
  timeline: OcrVisualTimeline,
  mask: TimedOcrBlurMask,
  options: {
    ffmpegPath: string
    ffprobePath: string
    itemWorkDir: string
    signal: AbortSignal
    spawnChild?: typeof spawn
  }
): Promise<void> {
  const { expectedHashes, totalFrameCount, width, height } = computeExpectedMaskFrameHashes(
    timeline,
    mask.durationSeconds
  )

  const blackHash = createHash('md5').update(Buffer.alloc(width * height, 0x00)).digest('hex')
  const terminalExpected = expectedHashes[totalFrameCount - 1]
  if (terminalExpected !== blackHash) {
    throw new Error('Khung hình cuối cùng (terminal frame) bắt buộc phải hoàn toàn màu đen.')
  }

  // 1. FFprobe stream & frame cadence verification
  const probeArgs = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_frames',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,time_base,start_pts,duration',
    '-show_entries', 'frame=best_effort_timestamp_time,pkt_pts_time,pkt_dts_time',
    '-show_format',
    '-of', 'json',
    mask.path
  ]

  const spawnFn = options.spawnChild || spawn
  let probeOutput = ''
  let probeErr = ''

  await new Promise<void>((resolve, reject) => {
    let p: ChildProcess
    try {
      p = trackChildProcess(spawnFn(options.ffprobePath, probeArgs, { windowsHide: true, shell: false }))
    } catch (err) {
      reject(err)
      return
    }

    const abortHandler = () => terminateProcessTree(p)
    if (options.signal.aborted) abortHandler()
    else options.signal.addEventListener('abort', abortHandler, { once: true })

    p.stdout?.on('data', (chunk: Buffer) => {
      if (probeOutput.length < 32 * 1024 * 1024) {
        probeOutput += chunk.toString('utf8')
      }
    })
    p.stderr?.on('data', (chunk: Buffer) => {
      probeErr += chunk.toString('utf8')
    })
    p.on('error', (err) => {
      options.signal.removeEventListener('abort', abortHandler)
      reject(err)
    })
    p.on('close', (code) => {
      options.signal.removeEventListener('abort', abortHandler)
      if (options.signal.aborted) {
        reject(new Error('Tiến trình probe mask đã bị huỷ.'))
        return
      }
      if (code !== 0) {
        reject(new Error(`FFprobe kiểm tra mask thất bại: ${probeErr.trim() || `mã ${code}`}`))
        return
      }
      resolve()
    })
  })

  let parsedProbe: {
    streams?: Array<Record<string, unknown>>
    frames?: Array<Record<string, unknown>>
    format?: Record<string, unknown>
  }
  try {
    parsedProbe = JSON.parse(probeOutput)
  } catch (err) {
    throw new Error(`Output FFprobe mask không phải JSON hợp lệ: ${(err as Error).message}`)
  }

  const streams = parsedProbe.streams || []
  if (streams.length !== 1 || streams[0].codec_type !== 'video' || streams[0].codec_name !== 'ffv1') {
    throw new Error('Mask bắt buộc phải có đúng 1 video stream định dạng FFV1.')
  }

  const st = streams[0]
  if (st.width !== width || st.height !== height) {
    throw new Error(`Kích thước mask không khớp: mong đợi ${width}x${height}, nhận được ${st.width}x${st.height}`)
  }

  const frames = parsedProbe.frames || []
  if (frames.length !== totalFrameCount) {
    throw new Error(`Số lượng khung hình mask không khớp: mong đợi ${totalFrameCount}, nhận được ${frames.length}`)
  }

  // Validate monotonic timestamps with tolerance of half a frame tick (1/16s = 0.0625s)
  for (let k = 0; k < frames.length; k++) {
    const f = frames[k]
    const tsVal = [f.best_effort_timestamp_time, f.pkt_pts_time, f.pkt_dts_time]
      .map((v) => (typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN))
      .find((v) => Number.isFinite(v))

    if (tsVal == null) {
      throw new Error(`Khung hình thứ ${k} không có timestamp hợp lệ.`)
    }

    const expectedTs = k / 8.0
    if (Math.abs(tsVal - expectedTs) > 0.0625) {
      throw new Error(`Timestamp khung hình thứ ${k} không đúng nhịp 8 fps: mong đợi ~${expectedTs}, nhận được ${tsVal}`)
    }
  }

  // 2. FFmpeg framemd5 frame-by-frame validation
  const md5Args = [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel', 'error',
    '-i', mask.path,
    '-map', '0:v:0',
    '-an',
    '-pix_fmt', 'gray',
    '-f', 'framemd5',
    '-hash', 'md5',
    '-'
  ]

  let md5Output = ''
  let md5Err = ''

  await new Promise<void>((resolve, reject) => {
    let p: ChildProcess
    try {
      p = trackChildProcess(spawnFn(options.ffmpegPath, md5Args, { windowsHide: true, shell: false }))
    } catch (err) {
      reject(err)
      return
    }

    const abortHandler = () => terminateProcessTree(p)
    if (options.signal.aborted) abortHandler()
    else options.signal.addEventListener('abort', abortHandler, { once: true })

    p.stdout?.on('data', (chunk: Buffer) => {
      md5Output += chunk.toString('utf8')
    })
    p.stderr?.on('data', (chunk: Buffer) => {
      md5Err += chunk.toString('utf8')
    })
    p.on('error', (err) => {
      options.signal.removeEventListener('abort', abortHandler)
      reject(err)
    })
    p.on('close', (code) => {
      options.signal.removeEventListener('abort', abortHandler)
      if (options.signal.aborted) {
        reject(new Error('Tiến trình framemd5 mask đã bị huỷ.'))
        return
      }
      if (code !== 0) {
        reject(new Error(`FFmpeg framemd5 thất bại: ${md5Err.trim() || `mã ${code}`}`))
        return
      }
      resolve()
    })
  })

  const md5Lines = md5Output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))

  if (md5Lines.length !== totalFrameCount) {
    throw new Error(`Số lượng bản ghi framemd5 không khớp: mong đợi ${totalFrameCount}, nhận được ${md5Lines.length}`)
  }

  for (let k = 0; k < md5Lines.length; k++) {
    const parts = md5Lines[k].split(',').map((p) => p.trim())
    const hash = parts[parts.length - 1]
    if (hash !== expectedHashes[k]) {
      throw new Error(`Hash khung hình ${k} không khớp dữ liệu raster mong đợi.`)
    }
  }

  const finalRecordedHash = md5Lines[md5Lines.length - 1].split(',').pop()?.trim()
  if (finalRecordedHash !== blackHash) {
    throw new Error('Khung hình cuối cùng trong file mask không phải là màu đen.')
  }
}

/**
 * Write a lossless FFV1 grayscale timed mask video.
 */
export async function writeTimedOcrBlurMask(
  timeline: OcrVisualTimeline,
  options: {
    ffmpegPath: string
    ffprobePath: string
    outputPath: string
    itemWorkDir: string
    durationSeconds: number
    signal: AbortSignal
    spawnChild?: typeof spawn
  }
): Promise<TimedOcrBlurMask> {
  if (options.signal.aborted) {
    throw new Error('Tiến trình tạo mask đã bị huỷ trước khi bắt đầu.')
  }

  if (timeline.segments.length === 0) {
    throw new Error('Timeline OCR không chứa segment nào.')
  }

  const totalBoxes = timeline.segments.reduce((acc, s) => acc + s.boxes.length, 0)
  if (totalBoxes === 0) {
    throw new Error('Timeline OCR không chứa bounding box nào.')
  }

  const plan = planOcrMaskFrames(timeline, options.durationSeconds)

  let hasNonBlackFrame = false
  for (let k = 0; k < plan.activeFrameCount; k++) {
    if (boxesForMaskFrame(plan, k).length > 0) {
      hasNonBlackFrame = true
      break
    }
  }
  if (!hasNonBlackFrame) {
    throw new Error('Mask hoàn toàn màu đen, không có vùng làm mờ hợp lệ nào.')
  }

  await assertContainedParentDirectory(options.outputPath, options.itemWorkDir, 'Thư mục mask đích')

  const partialPath = join(options.itemWorkDir, `.ocr-mask.${randomUUID()}.partial.mkv`)

  const ffmpegArgs = [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-loglevel', 'error',
    '-f', 'rawvideo',
    '-pixel_format', 'gray',
    '-video_size', `${plan.width}x${plan.height}`,
    '-framerate', '8',
    '-i', 'pipe:0',
    '-an',
    '-c:v', 'ffv1',
    '-level', '3',
    '-pix_fmt', 'gray',
    partialPath
  ]

  const spawnFn = options.spawnChild || spawn
  let ffmpegErr = ''

  try {
    await new Promise<void>((resolve, reject) => {
      let p: ChildProcess
      try {
        p = trackChildProcess(spawnFn(options.ffmpegPath, ffmpegArgs, { windowsHide: true, shell: false }))
      } catch (err) {
        reject(err)
        return
      }

      let settled = false
      const abortHandler = () => terminateProcessTree(p)

      if (options.signal.aborted) {
        abortHandler()
      } else {
        options.signal.addEventListener('abort', abortHandler, { once: true })
      }

      p.stderr?.on('data', (chunk: Buffer) => {
        ffmpegErr += chunk.toString('utf8')
      })

      p.on('error', (err) => {
        if (settled) return
        settled = true
        options.signal.removeEventListener('abort', abortHandler)
        reject(err)
      })

      p.on('close', (code) => {
        if (settled) return
        settled = true
        options.signal.removeEventListener('abort', abortHandler)
        if (options.signal.aborted) {
          reject(new Error('Tiến trình tạo mask đã bị huỷ.'))
          return
        }
        if (code !== 0) {
          reject(new Error(`FFmpeg mã hóa mask thất bại: ${ffmpegErr.trim() || `mã ${code}`}`))
          return
        }
        resolve()
      })

      // Stream frames to stdin
      ;(async () => {
        try {
          for (let k = 0; k < plan.totalFrameCount; k++) {
            if (options.signal.aborted) {
              p.stdin?.destroy()
              return
            }
            const boxes = boxesForMaskFrame(plan, k)
            const frameBuf = rasterizeOcrMaskFrame(plan.width, plan.height, boxes)
            if (!p.stdin?.write(frameBuf)) {
              await once(p.stdin!, 'drain')
            }
          }
          p.stdin?.end()
        } catch (err) {
          p.stdin?.destroy()
          if (!settled) {
            settled = true
            options.signal.removeEventListener('abort', abortHandler)
            terminateProcessTree(p)
            reject(err)
          }
        }
      })()
    })

    const candidateMask: TimedOcrBlurMask = {
      path: partialPath,
      width: plan.width,
      height: plan.height,
      durationSeconds: options.durationSeconds,
      sampleFps: 8,
      visualCueCount: timeline.segments.length,
      boxSegmentCount: totalBoxes
    }

    // Validate mask while still in partialPath
    await validateTimedOcrBlurMask(timeline, candidateMask, {
      ffmpegPath: options.ffmpegPath,
      ffprobePath: options.ffprobePath,
      itemWorkDir: options.itemWorkDir,
      signal: options.signal,
      spawnChild: options.spawnChild
    })

    // Atomic promotion
    await rename(partialPath, options.outputPath)
    await assertContainedRegularFile(options.outputPath, options.itemWorkDir, 'Promoted mask file')

    return {
      ...candidateMask,
      path: options.outputPath
    }
  } catch (err) {
    // Cleanup requested output on failure if created
    await rm(options.outputPath, { force: true }).catch(() => {})
    throw err
  } finally {
    // Always cleanup partialPath
    await rm(partialPath, { force: true }).catch(() => {})
  }
}
