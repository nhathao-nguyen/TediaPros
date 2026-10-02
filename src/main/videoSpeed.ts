import { isAbsolute, basename, dirname, extname, join } from 'node:path'
import { stat, rename, rm } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolveFfmpeg } from './deps'
import { probeBurnMedia } from './burn'
import { trackChildProcess, terminateProcessTree } from './processTree'
import type { VideoSpeedRequest, VideoSpeedProgress, VideoSpeedResult } from '../shared/types'

let activeSpeedProcess: ChildProcess | null = null
let cancelRequested = false

export function buildAtempoFilter(speed: number): string {
  if (speed <= 0) throw new Error('Tốc độ phải lớn hơn 0.')
  const filters: string[] = []
  let current = speed
  while (current > 2.0) {
    filters.push('atempo=2.0')
    current /= 2.0
  }
  while (current < 0.5) {
    filters.push('atempo=0.5')
    current /= 0.5
  }
  filters.push(`atempo=${Number(current.toFixed(4))}`)
  return filters.join(',')
}

export function buildVideoSpeedFilter(options: {
  speed: number
  preservePitch?: boolean
  hasAudio: boolean
}): { filterArgs: string[]; mapArgs: string[] } {
  const { speed, preservePitch = true, hasAudio } = options
  const vFilter = `[0:v]setpts=(1/${speed.toFixed(6)})*PTS[v]`

  if (!hasAudio) {
    return {
      filterArgs: ['-filter_complex', vFilter],
      mapArgs: ['-map', '[v]', '-an']
    }
  }

  const aFilter = preservePitch
    ? `[0:a]${buildAtempoFilter(speed)}[a]`
    : `[0:a]asetrate=44100*${speed.toFixed(6)},aresample=44100[a]`

  return {
    filterArgs: ['-filter_complex', `${vFilter};${aFilter}`],
    mapArgs: ['-map', '[v]', '-map', '[a]']
  }
}

export async function generateSpeedOutputName(
  videoPath: string,
  speed: number,
  targetDir: string
): Promise<string> {
  const ext = extname(videoPath) || '.mp4'
  const base = basename(videoPath, ext)
  const speedTag = `${Number(speed.toFixed(2))}x`
  const candidateName = `${base}_${speedTag}.mp4`
  const candidatePath = join(targetDir, candidateName)

  const exists = await stat(candidatePath).then(() => true).catch(() => false)
  if (!exists) return candidateName

  let counter = 1
  while (true) {
    const nextName = `${base}_${speedTag} (${counter}).mp4`
    const nextPath = join(targetDir, nextName)
    const nextExists = await stat(nextPath).then(() => true).catch(() => false)
    if (!nextExists) return nextName
    counter++
  }
}

export async function changeVideoSpeed(
  request: VideoSpeedRequest,
  onProgress?: (progress: VideoSpeedProgress) => void,
  signal?: AbortSignal
): Promise<VideoSpeedResult> {
  const { videoPath, speed, preservePitch = true, outputDir } = request

  if (!videoPath || typeof videoPath !== 'string' || !isAbsolute(videoPath)) {
    return { ok: false, error: 'Đường dẫn video không hợp lệ.' }
  }

  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 4.0) {
    return { ok: false, error: 'Tốc độ video phải nằm trong khoảng từ 0.25x đến 4.0x.' }
  }

  const vStat = await stat(videoPath).catch(() => null)
  if (!vStat || !vStat.isFile() || vStat.size <= 0) {
    return { ok: false, error: 'File video không tồn tại hoặc rỗng.' }
  }

  const targetDir = outputDir && isAbsolute(outputDir) ? outputDir : dirname(videoPath)
  const dirStat = await stat(targetDir).catch(() => null)
  if (!dirStat || !dirStat.isDirectory()) {
    return { ok: false, error: 'Thư mục đầu ra không tồn tại.' }
  }

  const ff = await resolveFfmpeg()
  if (!ff) {
    return { ok: false, error: 'Không tìm thấy FFmpeg trong hệ thống.' }
  }

  let meta
  try {
    meta = await probeBurnMedia(videoPath)
  } catch (err) {
    return { ok: false, error: `Không thể đọc thông tin video: ${err instanceof Error ? err.message : String(err)}` }
  }

  const sourceDuration = meta.videoDurationSeconds ?? meta.videoDuration ?? meta.giay ?? 0
  const targetDuration = sourceDuration > 0 ? sourceDuration / speed : 0

  const finalName = await generateSpeedOutputName(videoPath, speed, targetDir)
  const finalPath = join(targetDir, finalName)
  const partialName = `.${basename(finalName, '.mp4')}.${randomUUID()}.speed.partial.mp4`
  const partialPath = join(targetDir, partialName)

  const { filterArgs, mapArgs } = buildVideoSpeedFilter({
    speed,
    preservePitch,
    hasAudio: meta.hasAudio
  })

  const isDarwin = process.platform === 'darwin'
  const jitterCq = 21 + Math.floor(Math.random() * 3) // 21, 22, 23
  const gopSize = Math.random() > 0.5 ? 60 : 120
  const encoders = [
    ...(isDarwin ? [{ ten: 'h264_videotoolbox', args: ['-c:v', 'h264_videotoolbox', '-pix_fmt', 'yuv420p', '-q:v', '65'] }] : []),
    { ten: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-pix_fmt', 'yuv420p', '-preset', 'p4', '-cq', String(jitterCq), '-g', String(gopSize), '-spatial-aq', '1'] },
    { ten: 'h264_amf', args: ['-c:v', 'h264_amf', '-pix_fmt', 'yuv420p', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(jitterCq), '-qp_p', String(jitterCq)] },
    { ten: 'h264_qsv', args: ['-c:v', 'h264_qsv', '-pix_fmt', 'yuv420p', '-global_quality', String(jitterCq)] },
    { ten: 'libx264', args: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'faster', '-crf', '20'] }
  ]

  const audioArgs = meta.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []

  cancelRequested = false
  let lastError = ''

  const isMp4 = partialPath.toLowerCase().endsWith('.mp4') || partialPath.toLowerCase().endsWith('.m4v')
  const sanitizeContainerArgs = [
    '-map_metadata', '-1',
    '-map_metadata:s:v', '-1',
    '-map_metadata:s:a', '-1',
    '-fflags', '+bitexact',
    '-flags:v', '+bitexact',
    '-flags:a', '+bitexact',
    '-metadata:s:v', 'encoder=',
    '-metadata:s:a', 'encoder=',
    '-metadata', 'encoder=',
    ...(isMp4 ? [
      '-brand', 'mp42',
      '-movflags', '+faststart',
      '-metadata:s:v', 'handler_name=Core Media Video',
      '-metadata:s:a', 'handler_name=Core Media Audio'
    ] : [])
  ]

  for (const enc of encoders) {
    if (cancelRequested || signal?.aborted) {
      await rm(partialPath, { force: true }).catch(() => {})
      return { ok: false, error: 'Đã hủy tác vụ.' }
    }

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', videoPath,
      ...filterArgs,
      ...mapArgs,
      ...enc.args,
      ...audioArgs,
      ...sanitizeContainerArgs,
      partialPath
    ]

    const success = await new Promise<boolean>((resolve) => {
      const child = trackChildProcess(spawn(ff, args, { windowsHide: true, shell: false }))
      activeSpeedProcess = child

      const onAbort = (): void => {
        terminateProcessTree(child)
        resolve(false)
      }

      if (signal) signal.addEventListener('abort', onAbort, { once: true })

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        const match = /time=(\d+):(\d+):(\d+\.\d+)/.exec(text)
        if (match && targetDuration > 0 && onProgress) {
          const currentSec = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
          const percent = Math.min(99, Math.max(1, Math.round((currentSec / targetDuration) * 100)))
          onProgress({ percent, message: `Đang tua nhanh ${speed}x… (${percent}%)` })
        }
        if (text.includes('Error') || text.includes('failed')) {
          lastError = text.trim()
        }
      })

      child.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort)
        lastError = err.message
        activeSpeedProcess = null
        resolve(false)
      })

      child.on('close', (code) => {
        if (signal) signal.removeEventListener('abort', onAbort)
        activeSpeedProcess = null
        resolve(code === 0)
      })
    })

    if (cancelRequested || signal?.aborted) {
      await rm(partialPath, { force: true }).catch(() => {})
      return { ok: false, error: 'Đã hủy tác vụ.' }
    }

    if (success) {
      const pStat = await stat(partialPath).catch(() => null)
      if (pStat && pStat.size > 1024) {
        await rename(partialPath, finalPath)
        onProgress?.({ percent: 100, message: 'Hoàn tất!' })
        return { ok: true, outputPath: finalPath }
      }
    }

    await rm(partialPath, { force: true }).catch(() => {})
  }

  return { ok: false, error: lastError || 'Không thể xuất video với tốc độ mới.' }
}

export function cancelVideoSpeed(): void {
  cancelRequested = true
  if (activeSpeedProcess) {
    terminateProcessTree(activeSpeedProcess)
    activeSpeedProcess = null
  }
}
