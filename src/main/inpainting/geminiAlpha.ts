import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { lstat, mkdir, mkdtemp, rm, link, statfs } from 'node:fs/promises'
import { trackChildProcess, terminateProcessTree } from '../processTree'
import { assertContainedRegularFile } from '../safeContainedPath'
import { parseCanonicalMediaMetadata } from '../canonicalDisplayGeometry'
import type { PixelRegion } from '../../shared/types'
import { alphaEvidence, alphaProfile, applyGeminiAlpha, GEMINI_ALPHA_REVISION } from './geminiAlphaMath'

function start(exe: string, args: string[], signal: AbortSignal) {
  signal.throwIfAborted()
  const child = trackChildProcess(spawn(exe, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }))
  let diagnostics = '', failure: Error | undefined
  const abort = () => terminateProcessTree(child)
  child.stderr?.on('data', (b: Buffer) => { diagnostics = (diagnostics + b.toString()).slice(-4096) })
  const closed = new Promise<void>((resolveDone, reject) => {
    child.once('error', e => { failure = e })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(new Error('Đã hủy khử Alpha.'))
      else if (failure || code !== 0) reject(new Error(`Alpha: ${failure?.message || diagnostics.replace(/[A-Za-z]:[\\/][^\r\n"<>]+/g, '<path>') || 'FFmpeg thất bại.'}`))
      else resolveDone()
    })
  })
  // A process can fail before its consumer reaches await closed.
  void closed.catch(() => {})
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  child.stdin?.on('error', () => {})
  return { child, closed }
}

async function capture(exe: string, args: string[], signal: AbortSignal, limit = 1024 * 1024): Promise<Buffer> {
  const proc = start(exe, args, signal)
  const chunks: Buffer[] = []
  let bytes = 0
  try {
    for await (const chunk of proc.child.stdout!) {
      bytes += chunk.length
      if (bytes > limit) throw new Error('Alpha: dữ liệu tiền kiểm vượt giới hạn.')
      chunks.push(chunk)
    }
    await proc.closed
    return Buffer.concat(chunks)
  } catch (e) {
    if (proc.child.exitCode === null && proc.child.signalCode === null) terminateProcessTree(proc.child)
    await proc.closed.catch(() => {})
    throw e
  }
}

export async function runGeminiAlpha(input: {
  videoPath: string; outputPath: string; ffmpegPath: string; ffprobePath: string
  region: PixelRegion; signal: AbortSignal; onProgress?: (percent: number, message: string) => void
}): Promise<{ outputPath: string; provider: 'cpu'; elapsedMs: number; revision: string; matchScore: number; opacityRatio: number; frames: number }> {
  const began = Date.now()
  await assertContainedRegularFile(input.videoPath, dirname(input.videoPath), 'Alpha source')
  if (!isAbsolute(input.outputPath) || resolve(input.videoPath) === resolve(input.outputPath)) throw new Error('Alpha cần đường dẫn output mới và tuyệt đối.')
  if (await lstat(input.outputPath).then(() => true, () => false)) throw new Error('Alpha không ghi đè video đã có.')
  const raw = JSON.parse((await capture(input.ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input.videoPath], input.signal)).toString())
  const meta = parseCanonicalMediaMetadata(raw)
  const sourceStream = raw.streams.find((v: { codec_type: string }) => v.codec_type === 'video')
  if (!['yuv420p', 'yuvj420p', 'yuv422p', 'yuv444p', 'rgb24', 'bgr24', 'bgr0', 'gbrp'].includes(sourceStream?.pix_fmt) || ['smpte2084', 'arib-std-b67'].includes(sourceStream?.color_transfer)) throw new Error('Alpha hiện hỗ trợ video SDR 8-bit. Hãy dùng STTN cho video này.')
  const geometry = meta.geometry
  const duration = meta.videoDurationSeconds
  if (!geometry || !duration || !meta.frameRate || meta.isVariableFrameRate || geometry.rotation || geometry.sampleAspectRatio.numerator !== geometry.sampleAspectRatio.denominator || geometry.videoStart < 0) {
    throw new Error('Alpha hiện cần video CFR, pixel vuông, không xoay. Hãy dùng STTN cho video này.')
  }
  const timing = JSON.parse((await capture(input.ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', input.videoPath], input.signal, 16 * 1024 * 1024)).toString())
  const timestamps = timing.frames.map((f: { best_effort_timestamp_time: string }) => Number(f.best_effort_timestamp_time)) as number[]
  if (!timestamps.length || timestamps.some((t, i) => !Number.isFinite(t) || (i > 0 && Math.abs(t - timestamps[i - 1] - 1 / meta.frameRate!) > .001))) throw new Error('Alpha hiện chưa hỗ trợ video có nhịp frame thay đổi. Hãy dùng STTN.')
  const profile = alphaProfile(geometry.displayWidth, geometry.displayHeight, input.region)
  input.onProgress?.(0, 'Đang kiểm tra mẫu logo Gemini trên video…')
  const sample = await capture(input.ffmpegPath, ['-nostdin', '-v', 'error', '-i', input.videoPath, '-an', '-vf', `fps=${Math.min(4, 16 / duration)},format=gray,crop=${profile.size}:${profile.size}:${profile.x}:${profile.y}`, '-frames:v', '16', '-f', 'rawvideo', '-'], input.signal)
  const evidence: ReturnType<typeof alphaEvidence>[] = []
  for (let offset = 0; offset + 8100 <= sample.length; offset += 8100) evidence.push(alphaEvidence(sample.subarray(offset, offset + 8100)))
  const scores = evidence.map(e => e.score)
  const opacity = evidence.filter(e => e.score > .8).map(e => e.opacityRatio).sort((a, b) => a - b)
  const opacityRatio = opacity[Math.floor(opacity.length / 2)] || 0
  const sorted = [...scores].sort((a, b) => a - b)
  const matchScore = sorted[Math.floor(sorted.length / 2)] || 0
  if (scores.length < 4 || matchScore < .45 || scores.filter(v => v > .2).length < scores.length * .75 || opacity.length < 3 || opacityRatio < .8 || opacityRatio > 1.2) {
    throw new Error('Mẫu logo Alpha chưa khớp vị trí, hình dạng, độ trong suốt hoặc không thấy logo ổn định. Không sửa video; hãy hiệu chỉnh mẫu hoặc chọn STTN vùng thủ công.')
  }
  await mkdir(dirname(input.outputPath), { recursive: true })
  const work = await mkdtemp(join(dirname(input.outputPath), '.alpha-'))
  let decoder: ReturnType<typeof start> | undefined, encoder: ReturnType<typeof start> | undefined
  try {
    const ensureSpace = async () => {
      const free = await statfs(work)
      if (Number(free.bavail) * Number(free.bsize) < 720 * 1280 * 3 * 24 + 512 * 1024 ** 2) throw new Error('Không đủ dung lượng tạm để khử Alpha trên ổ output.')
    }
    await ensureSpace()
    const temporary = join(work, 'cleaned.mkv')
    const stream = raw.streams.find((v: { codec_type: string }) => v.codec_type === 'video')
    const rate = meta.averageFrameRate ? stream.avg_frame_rate : stream.r_frame_rate
    encoder = start(input.ffmpegPath, ['-nostdin', '-v', 'error', '-n', '-copyts', '-itsoffset', String(timestamps[0]), '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', '720x1280', '-framerate', rate, '-i', 'pipe:0', '-i', input.videoPath, '-map', '0:v:0', '-map', '1:a:0?', '-c:v', 'ffv1', '-level', '3', '-c:a', 'copy', temporary], input.signal)
    encoder.child.stdout!.resume()
    decoder = start(input.ffmpegPath, ['-nostdin', '-v', 'error', '-i', input.videoPath, '-map', '0:v:0', '-an', '-vf', 'format=rgb24', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], input.signal)
    const bytesPerFrame = 720 * 1280 * 3
    let frame = Buffer.allocUnsafe(bytesPerFrame), filled = 0, count = 0
    for await (const chunk of decoder.child.stdout!) {
      input.signal.throwIfAborted()
      let offset = 0
      while (offset < chunk.length) {
        const take = Math.min(bytesPerFrame - filled, chunk.length - offset)
        chunk.copy(frame, filled, offset, offset + take); offset += take; filled += take
        if (filled !== bytesPerFrame) continue
        if (count % 24 === 0) await ensureSpace()
        applyGeminiAlpha(frame, 720)
        if (!encoder.child.stdin!.write(frame)) await Promise.race([once(encoder.child.stdin!, 'drain'), encoder.closed.then(() => { throw new Error('Alpha: encoder dừng trước khi nhận hết frame.') })])
        // Never reuse memory still owned by the encoder pipe.
        frame = Buffer.allocUnsafe(bytesPerFrame); filled = 0; count++
        if (count % 24 === 0) input.onProgress?.(5 + Math.min(90, count / (duration * meta.frameRate) * 90), 'Đang khử Alpha và làm sạch viền logo…')
      }
    }
    if (filled || count !== timestamps.length) throw new Error('Alpha: frame bị thiếu hoặc video rỗng.')
    await decoder.closed
    encoder.child.stdin!.end()
    await encoder.closed
    await assertContainedRegularFile(temporary, work, 'Alpha output')
    const outputRaw = JSON.parse((await capture(input.ffprobePath, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', temporary], input.signal)).toString())
    const outputMeta = parseCanonicalMediaMetadata(outputRaw)
    const outputStream = outputRaw.streams.find((v: { codec_type: string }) => v.codec_type === 'video')
    if (Number(outputStream.nb_read_frames) !== count || Math.abs((outputMeta.videoStart || 0) - timestamps[0]) > .002 || (meta.hasAudio && !outputMeta.hasAudio)) throw new Error('Alpha: video đầu ra không khớp thời lượng/âm thanh.')
    input.signal.throwIfAborted()
    await link(temporary, input.outputPath)
    input.onProgress?.(100, 'Khử Alpha hoàn tất.')
    return { outputPath: input.outputPath, provider: 'cpu', elapsedMs: Date.now() - began, revision: GEMINI_ALPHA_REVISION, matchScore, opacityRatio, frames: count }
  } finally {
    for (const p of [decoder, encoder]) if (p && p.child.exitCode === null && p.child.signalCode === null) terminateProcessTree(p.child)
    await Promise.all([decoder?.closed.catch(() => {}), encoder?.closed.catch(() => {})])
    await rm(work, { recursive: true, force: true })
  }
}
