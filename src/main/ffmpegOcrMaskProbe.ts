import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { writeTimedOcrBlurMask } from './ocrMask'
import { planBurnInputs } from './burnInputPlanner'
import { taoFilterComplexAutomatic } from './burn'
import type { OcrVisualTimeline } from '../shared/ocrVisualTimeline'
import type { CanonicalDisplayGeometry } from './canonicalDisplayGeometry'
import { terminateProcessTree } from './processTree'

export interface FfmpegOcrMaskProbeResult {
  healthy: boolean
  features: string[]
  ffmpegSha256?: string
  probeSchemaVersion: 1
  cases?: Array<{ id: string; passed: boolean }>
  message?: string
}

export interface FfmpegInstallOptions {
  forceCapabilityReinstall?: 'ocr-mask-v1'
}

const probeSuccessCache = new Map<string, FfmpegOcrMaskProbeResult>()

export function clearFfmpegOcrMaskProbeCache(): void {
  probeSuccessCache.clear()
}

export function getFfmpegOcrMaskProbeCacheSize(): number {
  return probeSuccessCache.size
}

/**
 * Proves that FFmpeg and sibling FFprobe support the exact lossless FFV1
 * maskedmerge pipeline, Gray format, PTS rebasing, and audio muxing required
 * for Auto Short OCR-timed text blur.
 */
export async function probeFfmpegOcrMaskCapability(
  ffmpegPath: string,
  options?: { signal?: AbortSignal }
): Promise<FfmpegOcrMaskProbeResult> {
  if (options?.signal?.aborted) {
    return {
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: 'Đã huỷ kiểm tra FFmpeg.'
    }
  }

  if (!ffmpegPath || typeof ffmpegPath !== 'string' || !isAbsolute(ffmpegPath)) {
    return {
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: 'Đường dẫn FFmpeg phải là đường dẫn tuyệt đối.'
    }
  }

  let exeLstat
  let exeStat
  try {
    exeLstat = await lstat(ffmpegPath)
    exeStat = await stat(ffmpegPath)
  } catch (err: any) {
    return {
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: `Không tìm thấy FFmpeg: ${err.message}`
    }
  }

  if (exeLstat.isSymbolicLink()) {
    return {
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: 'FFmpeg không được là symbolic link hoặc reparse point.'
    }
  }

  if (!exeStat.isFile() || exeStat.size <= 0) {
    return {
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: 'FFmpeg không phải file thực thi hợp lệ.'
    }
  }

  const ffprobeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const ffprobePath = join(dirname(ffmpegPath), ffprobeName)
  try {
    const probeLstat = await lstat(ffprobePath)
    const probeStat = await stat(ffprobePath)
    if (probeLstat.isSymbolicLink() || !probeStat.isFile() || probeStat.size <= 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: 'FFprobe cùng thư mục không hợp lệ.'
      }
    }
  } catch (err: any) {
    return {
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: `Không tìm thấy FFprobe cùng thư mục với FFmpeg: ${err.message}`
    }
  }

  let realExe: string
  try {
    realExe = await realpath(ffmpegPath)
  } catch {
    realExe = ffmpegPath
  }

  const cacheKey = `${realExe}:${exeStat.size}:${exeStat.mtimeMs}`
  const cached = probeSuccessCache.get(cacheKey)
  if (cached) {
    return cached
  }

  let ffmpegSha256: string
  try {
    const bytes = await readFile(ffmpegPath)
    ffmpegSha256 = createHash('sha256').update(bytes).digest('hex')
  } catch (err: any) {
    return {
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: `Không thể đọc hash FFmpeg: ${err.message}`
    }
  }

  let tempDir = ''
  try {
    tempDir = await mkdtemp(join(tmpdir(), 'tedia-ffmpeg-ocr-mask-probe-'))

    const runProcess = async (
      binary: string,
      args: string[]
    ): Promise<{ code: number; stdout: string; stderr: string }> => {
      return new Promise((resolve) => {
        if (options?.signal?.aborted) {
          return resolve({ code: -1, stdout: '', stderr: 'Aborted' })
        }
        const p = spawn(binary, args, { cwd: tempDir, windowsHide: true, shell: false })
        let stdout = ''
        let stderr = ''
        const onAbort = () => {
          terminateProcessTree(p)
          resolve({ code: -1, stdout, stderr: 'Aborted' })
        }
        if (options?.signal) {
          options.signal.addEventListener('abort', onAbort, { once: true })
        }
        p.stdout.on('data', (d: Buffer) => {
          stdout = (stdout + d.toString()).slice(-2000)
        })
        p.stderr.on('data', (d: Buffer) => {
          stderr = (stderr + d.toString()).slice(-2000)
        })
        p.on('error', (err) => {
          if (options?.signal) options.signal.removeEventListener('abort', onAbort)
          resolve({ code: -1, stdout, stderr: err.message })
        })
        p.on('close', (code) => {
          if (options?.signal) options.signal.removeEventListener('abort', onAbort)
          resolve({ code: code ?? -1, stdout, stderr })
        })
      })
    }

    const geometry: CanonicalDisplayGeometry = {
      codedWidth: 64,
      codedHeight: 64,
      rotation: 0,
      sampleAspectRatio: { numerator: 1, denominator: 1 },
      videoStart: 0,
      displayWidth: 64,
      displayHeight: 64,
      fingerprint: '0'.repeat(64)
    }

    // Generate base synthetic 64x64 video @ 8fps (1.0s)
    const src1Path = join(tempDir, 'src1.mp4')
    const genSrc1 = await runProcess(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=8',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src1Path
    ])
    if (genSrc1.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Tạo video testsrc thất bại: ${genSrc1.stderr}`
      }
    }

    // --- Case 1: appear-disappear ---
    const tl1: OcrVisualTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: {
        width: 64,
        height: 64,
        durationSeconds: 1.0,
        sampleFps: 8,
        frameCount: 8,
        geometryFingerprint: geometry.fingerprint
      },
      profile: 'fast',
      scanRegion: { x0: 0, y0: 0, x1: 64, y1: 64 },
      segments: [
        {
          id: 'seg1',
          startFrame: 2,
          endFrameExclusive: 6,
          start: 0.25,
          end: 0.75,
          text: 'Case1',
          confidence: 0.9,
          boxes: [{ x0: 8, y0: 8, x1: 24, y1: 24, text: 'Case1', confidence: 0.9 }]
        }
      ]
    }
    const mask1Path = join(tempDir, 'mask1.mkv')
    const mask1 = await writeTimedOcrBlurMask(tl1, {
      ffmpegPath,
      ffprobePath,
      outputPath: mask1Path,
      itemWorkDir: tempDir,
      durationSeconds: 1.0,
      signal: options?.signal || new AbortController().signal
    })
    const plan1 = planBurnInputs({ sourceVideo: src1Path, timedMask: mask1.path })
    const filter1 = taoFilterComplexAutomatic({ w: 64, h: 64, giay: 1.0, hasAudio: false }, plan1, false, '')
    const filterStr1 = filter1.join(' ')
    if (/repeatlast|eof_action|shortest/.test(filterStr1)) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: 'Filter graph chứa cờ cấm repeatlast/eof_action/shortest.'
      }
    }
    const out1Path = join(tempDir, 'out1.mp4')
    const res1 = await runProcess(ffmpegPath, [
      '-y', ...plan1.inputArgs, ...filter1, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out1Path
    ])
    if (res1.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Render case 1 (appear-disappear) thất bại: ${res1.stderr}`
      }
    }
    const decode1 = await runProcess(ffmpegPath, ['-v', 'error', '-i', out1Path, '-map', '0:v:0', '-f', 'null', '-'])
    if (decode1.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Giải mã output case 1 thất bại: ${decode1.stderr}`
      }
    }

    // --- Case 2: terminal-black-frame ---
    const tl2: OcrVisualTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: {
        width: 64,
        height: 64,
        durationSeconds: 1.0,
        sampleFps: 8,
        frameCount: 8,
        geometryFingerprint: geometry.fingerprint
      },
      profile: 'fast',
      scanRegion: { x0: 0, y0: 0, x1: 64, y1: 64 },
      segments: [
        {
          id: 'seg2',
          startFrame: 0,
          endFrameExclusive: 4,
          start: 0.0,
          end: 0.5,
          text: 'Case2',
          confidence: 0.9,
          boxes: [{ x0: 16, y0: 16, x1: 48, y1: 48, text: 'Case2', confidence: 0.9 }]
        }
      ]
    }
    const mask2Path = join(tempDir, 'mask2.mkv')
    const mask2 = await writeTimedOcrBlurMask(tl2, {
      ffmpegPath,
      ffprobePath,
      outputPath: mask2Path,
      itemWorkDir: tempDir,
      durationSeconds: 1.0,
      signal: options?.signal || new AbortController().signal
    })
    const plan2 = planBurnInputs({ sourceVideo: src1Path, timedMask: mask2.path })
    const filter2 = taoFilterComplexAutomatic({ w: 64, h: 64, giay: 1.0, hasAudio: false }, plan2, false, '')
    const out2Path = join(tempDir, 'out2.mp4')
    const res2 = await runProcess(ffmpegPath, [
      '-y', ...plan2.inputArgs, ...filter2, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out2Path
    ])
    if (res2.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Render case 2 (terminal-black-frame) thất bại: ${res2.stderr}`
      }
    }
    const decode2 = await runProcess(ffmpegPath, ['-v', 'error', '-i', out2Path, '-map', '0:v:0', '-f', 'null', '-'])
    if (decode2.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Giải mã output case 2 thất bại: ${decode2.stderr}`
      }
    }

    // --- Case 3: moving-resize ---
    const tl3: OcrVisualTimeline = {
      schemaVersion: 1,
      protocol: 'ocr-visual-cues/1',
      video: {
        width: 64,
        height: 64,
        durationSeconds: 1.0,
        sampleFps: 8,
        frameCount: 8,
        geometryFingerprint: geometry.fingerprint
      },
      profile: 'fast',
      scanRegion: { x0: 0, y0: 0, x1: 64, y1: 64 },
      segments: [
        {
          id: 'seg3a',
          startFrame: 0,
          endFrameExclusive: 4,
          start: 0.0,
          end: 0.5,
          text: 'Case3A',
          confidence: 0.9,
          boxes: [{ x0: 4, y0: 4, x1: 20, y1: 20, text: 'Case3A', confidence: 0.9 }]
        },
        {
          id: 'seg3b',
          startFrame: 4,
          endFrameExclusive: 8,
          start: 0.5,
          end: 1.0,
          text: 'Case3B',
          confidence: 0.9,
          boxes: [{ x0: 8, y0: 8, x1: 32, y1: 32, text: 'Case3B', confidence: 0.9 }]
        }
      ]
    }
    const mask3Path = join(tempDir, 'mask3.mkv')
    const mask3 = await writeTimedOcrBlurMask(tl3, {
      ffmpegPath,
      ffprobePath,
      outputPath: mask3Path,
      itemWorkDir: tempDir,
      durationSeconds: 1.0,
      signal: options?.signal || new AbortController().signal
    })
    const plan3 = planBurnInputs({ sourceVideo: src1Path, timedMask: mask3.path })
    const filter3 = taoFilterComplexAutomatic({ w: 64, h: 64, giay: 1.0, hasAudio: false }, plan3, false, '')
    const out3Path = join(tempDir, 'out3.mp4')
    const res3 = await runProcess(ffmpegPath, [
      '-y', ...plan3.inputArgs, ...filter3, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out3Path
    ])
    if (res3.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Render case 3 (moving-resize) thất bại: ${res3.stderr}`
      }
    }
    const decode3 = await runProcess(ffmpegPath, ['-v', 'error', '-i', out3Path, '-map', '0:v:0', '-f', 'null', '-'])
    if (decode3.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Giải mã output case 3 thất bại: ${decode3.stderr}`
      }
    }

    // --- Case 4: moving-resize-with-narration ---
    const tone4Path = join(tempDir, 'tone4.wav')
    const genTone = await runProcess(ffmpegPath, [
      '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1', '-c:a', 'pcm_s16le', tone4Path
    ])
    if (genTone.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Tạo audio tone thất bại: ${genTone.stderr}`
      }
    }
    const plan4 = planBurnInputs({ sourceVideo: src1Path, narrationAudio: tone4Path, timedMask: mask3.path })
    const filter4 = taoFilterComplexAutomatic({ w: 64, h: 64, giay: 1.0, hasAudio: false }, plan4, false, '', true, 0)
    const out4Path = join(tempDir, 'out4.mp4')
    const res4 = await runProcess(ffmpegPath, [
      '-y', ...plan4.inputArgs, ...filter4, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out4Path
    ])
    if (res4.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Render case 4 (moving-resize-with-narration) thất bại: ${res4.stderr}`
      }
    }
    const probe4 = await runProcess(ffprobePath, [
      '-v', 'error', '-show_entries', 'stream=index,codec_type', '-of', 'json', out4Path
    ])
    if (probe4.code !== 0) {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: `Probe output case 4 thất bại: ${probe4.stderr}`
      }
    }
    try {
      const parsed = JSON.parse(probe4.stdout)
      const vStreams = parsed.streams?.filter((s: any) => s.codec_type === 'video') || []
      const aStreams = parsed.streams?.filter((s: any) => s.codec_type === 'audio') || []
      if (vStreams.length !== 1 || aStreams.length !== 1) {
        return {
          healthy: false,
          features: [],
          probeSchemaVersion: 1,
          message: `Luồng output case 4 không hợp lệ: video=${vStreams.length}, audio=${aStreams.length}`
        }
      }
    } catch {
      return {
        healthy: false,
        features: [],
        probeSchemaVersion: 1,
        message: 'Không thể phân tích dữ liệu ffprobe output case 4.'
      }
    }

    const result: FfmpegOcrMaskProbeResult = {
      healthy: true,
      features: ['ocr-mask-v1'],
      ffmpegSha256,
      probeSchemaVersion: 1,
      cases: [
        { id: 'appear-disappear', passed: true },
        { id: 'terminal-black-frame', passed: true },
        { id: 'moving-resize', passed: true },
        { id: 'moving-resize-with-narration', passed: true }
      ]
    }
    probeSuccessCache.set(cacheKey, result)
    return result
  } catch (err: any) {
    return {
      healthy: false,
      features: [],
      probeSchemaVersion: 1,
      message: err.message || 'Lỗi không xác định khi probe FFmpeg OCR mask capability.'
    }
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}
