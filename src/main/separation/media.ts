import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { trackChildProcess, terminateProcessTree } from '../processTree'

export type SourceAudioProbe =
  | { kind: 'audio'; durationSeconds: number }
  | { kind: 'no-audio'; warning: 'Video nguồn không có audio; sẽ xuất TTS-only.' }

export type PreparedSourceAudio =
  | { kind: 'audio'; wavPath: string; durationSeconds: number }
  | { kind: 'no-audio'; warning: string }

export async function probeSourceAudio(
  ffprobePath: string,
  sourcePath: string,
  signal?: AbortSignal
): Promise<SourceAudioProbe> {
  const args = [
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=index,duration:format=duration',
    '-of',
    'json',
    sourcePath
  ]

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Đã hủy tác vụ.'))

    let stdout = ''
    let stderr = ''
    const child = spawn(ffprobePath, args, { windowsHide: true, shell: false })
    trackChildProcess(child)

    let abortError: Error | null = null
    const onAbort = (): void => {
      abortError = new Error('Đã hủy tác vụ.')
      terminateProcessTree(child)
    }
    if (signal) signal.addEventListener('abort', onAbort)

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      reject(abortError || err)
    })

    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (abortError) return reject(abortError)
      if (code !== 0) {
        return reject(new Error(`ffprobe failed (${code}): ${stderr}`))
      }
      try {
        const parsed = JSON.parse(stdout) as {
          streams?: Array<{ index: number; duration?: string }>
          format?: { duration?: string }
        }
        if (!parsed.streams || parsed.streams.length === 0) {
          return resolve({ kind: 'no-audio', warning: 'Video nguồn không có audio; sẽ xuất TTS-only.' })
        }
        const durStr = parsed.streams[0]?.duration || parsed.format?.duration || '0'
        const durationSeconds = parseFloat(durStr)
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          return resolve({ kind: 'no-audio', warning: 'Video nguồn không có audio; sẽ xuất TTS-only.' })
        }
        resolve({ kind: 'audio', durationSeconds })
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe json: ${e}`))
      }
    })
  })
}

export async function prepareSourceAudio(input: {
  sourcePath: string
  outputPath: string
  ffmpegPath: string
  ffprobePath: string
  signal: AbortSignal
}): Promise<PreparedSourceAudio> {
  const probe = await probeSourceAudio(input.ffprobePath, input.sourcePath, input.signal)
  if (probe.kind === 'no-audio') {
    return probe
  }

  const args = [
    '-y',
    '-hide_banner',
    '-nostats',
    '-loglevel',
    'error',
    '-i',
    input.sourcePath,
    '-vn',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'pcm_s16le',
    input.outputPath
  ]

  await new Promise<void>((resolve, reject) => {
    if (input.signal.aborted) return reject(new Error('Đã hủy tác vụ.'))

    let stderr = ''
    const child = spawn(input.ffmpegPath, args, { windowsHide: true, shell: false })
    trackChildProcess(child)

    let abortError: Error | null = null
    const onAbort = (): void => {
      abortError = new Error('Đã hủy tác vụ.')
      terminateProcessTree(child)
    }
    input.signal.addEventListener('abort', onAbort)

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024)
    })

    child.on('error', (err) => {
      input.signal.removeEventListener('abort', onAbort)
      reject(abortError || err)
    })

    child.on('close', (code) => {
      input.signal.removeEventListener('abort', onAbort)
      if (abortError) return reject(abortError)
      if (code !== 0) {
        return reject(new Error(`Trích xuất audio thất bại (${code}): ${stderr}`))
      }
      resolve()
    })
  })

  // Validate extracted file
  const fileInfo = await stat(input.outputPath).catch(() => null)
  if (!fileInfo?.isFile() || fileInfo.size <= 44) {
    throw new Error('File audio trích xuất không hợp lệ hoặc rỗng.')
  }

  return {
    kind: 'audio',
    wavPath: input.outputPath,
    durationSeconds: probe.durationSeconds
  }
}

export async function validateSeparatorStem(input: {
  stemPath: string
  expectedDurationSeconds: number
  ffprobePath: string
  signal?: AbortSignal
}): Promise<void> {
  const fileInfo = await stat(input.stemPath).catch(() => null)
  if (!fileInfo?.isFile() || fileInfo.size <= 44) {
    throw new Error(`Stem file không tồn tại hoặc rỗng: ${input.stemPath}`)
  }

  const args = [
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=channels,sample_rate,duration,codec_name:format=duration',
    '-of',
    'json',
    input.stemPath
  ]

  await new Promise<void>((resolve, reject) => {
    if (input.signal?.aborted) return reject(new Error('Đã hủy tác vụ.'))

    let stdout = ''
    let stderr = ''
    const child = spawn(input.ffprobePath, args, { windowsHide: true, shell: false })
    trackChildProcess(child)

    let abortError: Error | null = null
    const onAbort = (): void => {
      abortError = new Error('Đã hủy tác vụ.')
      terminateProcessTree(child)
    }
    if (input.signal) input.signal.addEventListener('abort', onAbort)

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })

    child.on('error', (err) => {
      if (input.signal) input.signal.removeEventListener('abort', onAbort)
      reject(abortError || err)
    })

    child.on('close', (code) => {
      if (input.signal) input.signal.removeEventListener('abort', onAbort)
      if (abortError) return reject(abortError)
      if (code !== 0) return reject(new Error(`Probe stem thất bại (${code}): ${stderr}`))

      try {
        const parsed = JSON.parse(stdout)
        const stream = parsed.streams?.[0]
        if (!stream) return reject(new Error('Stem không chứa audio stream.'))
        if (stream.channels !== 2) return reject(new Error(`Stem phải có 2 kênh stereo, nhận được ${stream.channels}.`))
        if (parseInt(stream.sample_rate, 10) !== 44100) {
          return reject(new Error(`Stem sample rate phải là 44100, nhận được ${stream.sample_rate}.`))
        }

        const dur = parseFloat(stream.duration || parsed.format?.duration || '0')
        if (Math.abs(dur - input.expectedDurationSeconds) > 0.100) {
          return reject(new Error(`Độ dài stem (${dur.toFixed(3)}s) lệch quá 100ms so với nguồn (${input.expectedDurationSeconds.toFixed(3)}s).`))
        }

        resolve()
      } catch (e) {
        reject(new Error(`Lỗi parse metadata stem: ${e}`))
      }
    })
  })
}

export async function normalizeInstrumentalDuration(input: {
  inputPath: string
  outputPath: string
  targetDurationSeconds: number
  ffmpegPath: string
  signal: AbortSignal
}): Promise<string> {
  const dur = input.targetDurationSeconds.toFixed(3)
  const args = [
    '-y',
    '-hide_banner',
    '-nostats',
    '-loglevel',
    'error',
    '-i',
    input.inputPath,
    '-filter_complex',
    `[0:a]apad=whole_dur=${dur},atrim=duration=${dur}[out]`,
    '-map',
    '[out]',
    '-c:a',
    'pcm_s16le',
    '-ac',
    '2',
    '-ar',
    '44100',
    input.outputPath
  ]

  await new Promise<void>((resolve, reject) => {
    if (input.signal.aborted) return reject(new Error('Đã hủy tác vụ.'))

    let stderr = ''
    const child = spawn(input.ffmpegPath, args, { windowsHide: true, shell: false })
    trackChildProcess(child)

    let abortError: Error | null = null
    const onAbort = (): void => {
      abortError = new Error('Đã hủy tác vụ.')
      terminateProcessTree(child)
    }
    input.signal.addEventListener('abort', onAbort)

    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 64 * 1024) stderr = stderr.slice(-64 * 1024)
    })

    child.on('error', (err) => {
      input.signal.removeEventListener('abort', onAbort)
      reject(abortError || err)
    })

    child.on('close', (code) => {
      input.signal.removeEventListener('abort', onAbort)
      if (abortError) return reject(abortError)
      if (code !== 0) return reject(new Error(`Chuẩn hóa độ dài instrumental thất bại (${code}): ${stderr}`))
      resolve()
    })
  })

  return input.outputPath
}
