import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { terminateProcessTree, trackChildProcess } from '../processTree'

export const RESTORATION_AUDIO_MAX_SECONDS = 180
export const RESTORATION_AUDIO_MAX_BYTES = 2 * 1024 * 1024

export interface GatewayRestorationAudio {
  data: Buffer
  format: 'mp3'
  durationSeconds: number
  sampleRate: number
  channels: number
  sha256: string
}

export interface ExtractGatewayRestorationAudioInput {
  ffmpeg: string
  sourcePath: string
  workDir: string
  videoDurationSeconds: number
  signal: AbortSignal
  maxDurationSeconds?: number
  maxBytes?: number
}

function assertContained(path: string, root: string): string {
  if (!isAbsolute(root)) throw new Error('Restoration audio workDir phải là đường dẫn tuyệt đối.')
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const rel = relative(resolvedRoot, resolvedPath)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Restoration audio path vượt item scratch.')
  return resolvedPath
}

/**
 * Creates a small, disposable MP3 derived from the prepared media. The file
 * exists only while FFmpeg writes it; callers receive bytes in memory and no
 * base64 is ever logged or checkpointed.
 */
export async function extractGatewayRestorationAudio(input: ExtractGatewayRestorationAudioInput): Promise<GatewayRestorationAudio> {
  if (!Number.isFinite(input.videoDurationSeconds) || input.videoDurationSeconds <= 0) throw new Error('Video duration không hợp lệ để trích audio evidence.')
  const durationSeconds = Math.min(
    Math.max(0.1, input.videoDurationSeconds),
    Math.max(1, Math.floor(input.maxDurationSeconds ?? RESTORATION_AUDIO_MAX_SECONDS))
  )
  const maxBytes = Math.max(1, Math.floor(input.maxBytes ?? RESTORATION_AUDIO_MAX_BYTES))
  const outputPath = assertContained(resolve(input.workDir, 'gateway-restoration-audio.mp3'), input.workDir)
  await rm(outputPath, { force: true }).catch(() => {})
  let diagnostic = ''
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = trackChildProcess(spawn(input.ffmpeg, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', input.sourcePath,
        '-vn', '-t', durationSeconds.toFixed(3),
        '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '24k',
        outputPath
      ], { windowsHide: true, shell: false }))
      let aborted = false
      const abort = () => {
        aborted = true
        terminateProcessTree(child)
      }
      child.stderr?.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(-4096) })
      if (input.signal.aborted) abort()
      else input.signal.addEventListener('abort', abort, { once: true })
      child.once('error', (error) => {
        input.signal.removeEventListener('abort', abort)
        reject(aborted ? new Error('Đã hủy trích audio evidence.') : error)
      })
      child.once('close', (code) => {
        input.signal.removeEventListener('abort', abort)
        if (aborted) reject(new Error('Đã hủy trích audio evidence.'))
        else if (code === 0) resolvePromise()
        else reject(new Error(`FFmpeg không trích được audio evidence${diagnostic ? `: ${diagnostic}` : ''}`))
      })
    })
    const info = await stat(outputPath)
    if (!info.isFile() || info.size <= 0) throw new Error('FFmpeg không tạo audio evidence hợp lệ.')
    if (info.size > maxBytes) throw new Error(`Audio evidence vượt giới hạn cục bộ (${info.size} > ${maxBytes} bytes).`)
    const data = await readFile(outputPath)
    return {
      data,
      format: 'mp3',
      durationSeconds,
      sampleRate: 16_000,
      channels: 1,
      sha256: createHash('sha256').update(data).digest('hex')
    }
  } finally {
    await rm(outputPath, { force: true }).catch(() => {})
  }
}
