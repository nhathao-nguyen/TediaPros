import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { CutExecutionPlan } from '../shared/autoShortCutPlan'
import { sampleAt } from '../shared/autoShortCutPlan'
import { hashFileSha256 } from './autoShortStageKeys'
import { terminateProcessTree, trackChildProcess } from './processTree'
import { assertContainedRegularFile } from './safeContainedPath'

export interface PreparedCutValidationManifest {
  schemaVersion: 1
  validationRevision: 'cut-validation-v1'
  sourceDigest: string
  artifactSha256: string
  videoFrameCount: number
  audioSampleCount?: string
  audioSampleRate?: number
  audioChannels?: number
}

export type PreparedCutValidationResult =
  | { ok: true; artifactSha256: string; manifest: PreparedCutValidationManifest }
  | { ok: false; code: 'CUT_SOURCE_CHANGED' | 'CUT_TIMELINE_MISMATCH' | 'CUT_PREPARED_MEDIA_INVALID'; details: string }

interface StreamProbe {
  codec_type?: unknown
  nb_read_frames?: unknown
  sample_rate?: unknown
  channels?: unknown
}

interface ProcessResult {
  stdout: string
  stdoutBytes: bigint
}

async function runBoundedProcess(input: {
  command: string
  args: readonly string[]
  signal: AbortSignal
  collectText?: boolean
}): Promise<ProcessResult> {
  if (input.signal.aborted) throw new Error('Đã hủy kiểm tra video sau cắt.')
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = trackChildProcess(spawn(input.command, [...input.args], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    }))
    const chunks: Buffer[] = []
    let stdoutBytes = 0n
    let collectedBytes = 0
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      input.signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve({ stdout: Buffer.concat(chunks).toString('utf8'), stdoutBytes })
    }
    const abort = (): void => {
      terminateProcessTree(child)
      finish(new Error('Đã hủy kiểm tra video sau cắt.'))
    }
    input.signal.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBytes += BigInt(chunk.length)
      if (!input.collectText) return
      collectedBytes += chunk.length
      if (collectedBytes > 1024 * 1024) {
        terminateProcessTree(child)
        finish(new Error('CUT_PREPARED_MEDIA_INVALID: ffprobe output quá lớn.'))
        return
      }
      chunks.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-8192) })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) finish(new Error(`media process ${code}: ${stderr}`))
      else finish()
    })
  })
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
  return Number.isSafeInteger(parsed) && (parsed as number) > 0 ? parsed as number : null
}

function expectedVideoFrameCount(plan: CutExecutionPlan): number {
  let count = 0
  for (const segment of plan.keepSegments) {
    const frames = segment.sourceEnd.presentationIndex - segment.sourceStart.presentationIndex
    if (!Number.isSafeInteger(frames) || frames <= 0) throw new Error('CUT_TIMELINE_MISMATCH')
    count += frames
    if (!Number.isSafeInteger(count)) throw new Error('CUT_TIMELINE_MISMATCH')
  }
  return count
}

export async function validatePreparedCut(input: {
  ffmpegPath: string
  ffprobePath: string
  sourcePath: string
  preparedPath: string
  plan: CutExecutionPlan
  signal: AbortSignal
}): Promise<PreparedCutValidationResult> {
  try {
    await assertContainedRegularFile(input.sourcePath, dirname(input.sourcePath), 'Video nguồn cắt đoạn')
    await assertContainedRegularFile(input.preparedPath, dirname(input.preparedPath), 'Video sau cắt')
    const sourceDigestBefore = await hashFileSha256(input.sourcePath, input.signal)
    if (sourceDigestBefore !== input.plan.identity.sourceDigest) {
      return { ok: false, code: 'CUT_SOURCE_CHANGED', details: 'Nội dung video nguồn đã thay đổi trước khi kiểm chứng.' }
    }
    const probe = await runBoundedProcess({
      command: input.ffprobePath,
      args: ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,nb_read_frames,sample_rate,channels', '-of', 'json', input.preparedPath],
      signal: input.signal,
      collectText: true
    })
    const parsed = JSON.parse(probe.stdout) as { streams?: StreamProbe[] }
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video')
    const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio')
    const actualFrames = positiveInteger(video?.nb_read_frames)
    const expectedFrames = expectedVideoFrameCount(input.plan)
    if (actualFrames !== expectedFrames) {
      return { ok: false, code: 'CUT_TIMELINE_MISMATCH', details: `Số frame sau cắt ${actualFrames ?? 'không rõ'}; dự kiến ${expectedFrames}.` }
    }

    await runBoundedProcess({
      command: input.ffmpegPath,
      args: ['-v', 'error', '-i', input.preparedPath, '-map', '0:v:0', '-f', 'null', '-'],
      signal: input.signal
    })

    let audioSampleCount: string | undefined
    let audioSampleRate: number | undefined
    let audioChannels: number | undefined
    if (input.plan.audio) {
      audioSampleRate = positiveInteger(audio?.sample_rate) ?? undefined
      audioChannels = positiveInteger(audio?.channels) ?? undefined
      if (audioSampleRate !== input.plan.audio.sampleRate || audioChannels !== input.plan.audio.channels) {
        return { ok: false, code: 'CUT_TIMELINE_MISMATCH', details: 'Sample rate hoặc số kênh audio sau cắt không khớp nguồn.' }
      }
      const decoded = await runBoundedProcess({
        command: input.ffmpegPath,
        args: ['-v', 'error', '-i', input.preparedPath, '-map', '0:a:0', '-c:a', 'pcm_s32le', '-f', 's32le', '-'],
        signal: input.signal
      })
      const bytesPerSampleFrame = BigInt(audioChannels * 4)
      if (decoded.stdoutBytes % bytesPerSampleFrame !== 0n) {
        return { ok: false, code: 'CUT_TIMELINE_MISMATCH', details: 'Kích thước PCM sau decode không chia hết theo số kênh.' }
      }
      const actualSamples = decoded.stdoutBytes / bytesPerSampleFrame
      const expectedSamples = sampleAt(input.plan.editedDuration, input.plan.audio.sampleRate)
      if (actualSamples !== expectedSamples) {
        return { ok: false, code: 'CUT_TIMELINE_MISMATCH', details: `Số sample sau cắt ${actualSamples}; dự kiến ${expectedSamples}.` }
      }
      audioSampleCount = actualSamples.toString()
    } else if (audio) {
      return { ok: false, code: 'CUT_TIMELINE_MISMATCH', details: 'Video sau cắt có audio ngoài kế hoạch.' }
    }

    const sourceDigestAfter = await hashFileSha256(input.sourcePath, input.signal)
    if (sourceDigestAfter !== sourceDigestBefore) {
      return { ok: false, code: 'CUT_SOURCE_CHANGED', details: 'Nội dung video nguồn thay đổi trong lúc chuẩn bị.' }
    }
    const artifactSha256 = await hashFileSha256(input.preparedPath, input.signal)
    return {
      ok: true,
      artifactSha256,
      manifest: {
        schemaVersion: 1,
        validationRevision: 'cut-validation-v1',
        sourceDigest: sourceDigestBefore,
        artifactSha256,
        videoFrameCount: actualFrames,
        ...(audioSampleCount ? { audioSampleCount, audioSampleRate, audioChannels } : {})
      }
    }
  } catch (error) {
    if (input.signal.aborted) throw error
    const details = error instanceof Error ? error.message.slice(0, 1024) : String(error).slice(0, 1024)
    if (details.includes('CUT_SOURCE_CHANGED')) return { ok: false, code: 'CUT_SOURCE_CHANGED', details }
    if (details.includes('CUT_TIMELINE_MISMATCH')) return { ok: false, code: 'CUT_TIMELINE_MISMATCH', details }
    return { ok: false, code: 'CUT_PREPARED_MEDIA_INVALID', details }
  }
}
