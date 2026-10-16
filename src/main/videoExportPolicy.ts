import type { VideoEffect } from '../shared/videoEffects'
import { randomInt } from 'node:crypto'

export interface VideoExportSource {
  width: number
  height: number
  sourceWidth?: number
  sourceHeight?: number
  frameRate?: number
  averageFrameRate?: number
  videoBitrate?: number
  videoCodec?: string
  effects?: VideoEffect[]
}
export interface BalancedVideoExportPlan {
  mode: 'balanced'
  qualityNvenc: number
  qualityX264: number
  gopFrames: number
  peakBitrate: number
  bufferBits: number
  frameRateForBudget: number
  encoderPreference: 'gpu' | 'cpu'
  variation?: 'cq-gop'
}
export interface VideoEncoderCandidate { ten: string; gpu: boolean; args: string[] }

function valid(value: number | undefined, fallback: number, lo: number, hi: number): number {
  return Number.isFinite(value) && value! >= lo && value! <= hi ? value! : fallback
}

/** A peak guard, not a forced average rate or a promise to match source file size. */
export function planBalancedVideoExport(source: VideoExportSource): BalancedVideoExportPlan {
  const width = valid(source.width, 1920, 2, 16384), height = valid(source.height, 1080, 2, 16384)
  const fps = valid(source.averageFrameRate, valid(source.frameRate, 30, 1, 240), 1, 240)
  const sourceArea = valid(source.sourceWidth, width, 2, 16384) * valid(source.sourceHeight, height, 2, 16384)
  const resizeAllowance = Math.min(4, Math.max(1, width * height / sourceArea))
  const effects = source.effects || []
  const strength = (effect: VideoEffect): number => valid(effect.intensity, 0, 0, 100) / 100
  const grainStrength = effects.reduce((maximum, effect) => Math.max(maximum,
    effect.kind === 'grain' || effect.kind === 'analog' ? strength(effect) : 0), 0)
  const detail = 1 + Math.min(.3, effects.reduce((sum, effect) => sum +
    (effect.kind === 'grain' || effect.kind === 'analog' ? .25 : .08) * strength(effect), 0))
  const codecAllowance = /^(hevc|h265|vp9|av1)$/i.test(source.videoCodec || '') ? 2.2 : 1.65
  const sourceRate = valid(source.videoBitrate, 0, 10000, 500000000)
  const pixelsPerSecond = width * height * fps
  // Procedural temporal noise has new entropy absent from source bitrate.
  // Its headroom is deliberately higher; do not erase the chosen effect to
  // make a grain-heavy file match the size of a clean source.
  const geometryFloor = pixelsPerSecond * (.10 + 4 * grainStrength) * detail
  const sourceAllowance = sourceRate > 0 ? sourceRate * codecAllowance * resizeAllowance * detail : pixelsPerSecond * .22 * detail
  const peakBitrate = Math.min(240000000, Math.max(400000, Math.ceil(Math.max(geometryFloor, sourceAllowance) / 100000) * 100000))
  const compressibleTextureStack = effects.length === 0 || effects.every(effect => effect.kind === 'custom_overlay' &&
    effect.layers?.some(layer => layer.isStatic))
  const preferCpu = grainStrength === 0 && compressibleTextureStack && fps <= 30 && width * height <= 1920 * 1080 &&
    sourceRate > 0 && sourceRate / pixelsPerSecond < .015
  return { mode: 'balanced', qualityNvenc: grainStrength > 0 ? 23 : 24, qualityX264: grainStrength > 0 ? 21 : 22, gopFrames: Math.max(12, Math.min(480, Math.round(fps * 2))),
    peakBitrate, bufferBits: peakBitrate * 2, frameRateForBudget: fps, encoderPreference: preferCpu ? 'cpu' : 'gpu' }
}

/** Draw once per export; all encoder attempts reuse the chosen values and bitrate guard. */
export function randomizeVideoExportPlan(
  plan: BalancedVideoExportPlan,
  chooseIndex: (maximumExclusive: number) => number = randomInt
): BalancedVideoExportPlan {
  const pick = (maximumExclusive: number): number => {
    const value = chooseIndex(maximumExclusive)
    if (!Number.isInteger(value) || value < 0 || value >= maximumExclusive) throw new Error('Giá trị ngẫu nhiên mã hóa không hợp lệ.')
    return value
  }
  // Restore CQ22–24 for ordinary video. Grain/analog never exceed their
  // protected CQ23 quality target; a lower CQ retains more detail.
  const qualityNvenc = 22 + pick(plan.qualityNvenc >= 24 ? 3 : 2)
  const gopFrames = pick(2) === 0 ? 60 : 120
  return { ...plan, qualityNvenc, gopFrames, variation: 'cq-gop' }
}

export function balancedVideoEncoderCandidates(plan: BalancedVideoExportPlan, platform: string): VideoEncoderCandidate[] {
  const peak = ['-maxrate', String(plan.peakBitrate), '-bufsize', String(plan.bufferBits)]
  const common = ['-pix_fmt', 'yuv420p']
  const candidates: VideoEncoderCandidate[] = [
    ...(platform === 'darwin' ? [{ ten: 'h264_videotoolbox', gpu: true, args: ['-c:v', 'h264_videotoolbox', ...common, '-q:v', '65'] }] : []),
    { ten: 'h264_nvenc', gpu: true, args: ['-c:v', 'h264_nvenc', ...common, '-preset', 'p4', '-rc', 'vbr', '-cq', String(plan.qualityNvenc),
      '-b:v', '0', ...peak, '-g', String(plan.gopFrames), '-bf', '3', '-spatial-aq', '1'] },
    // Keep vendor fallbacks on known quality modes. Their bitrate semantics differ
    // from NVENC CQ/x264 CRF and need separate hardware acceptance.
    { ten: 'h264_amf', gpu: true, args: ['-c:v', 'h264_amf', ...common, '-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(plan.qualityNvenc), '-qp_p', String(plan.qualityNvenc)] },
    { ten: 'h264_qsv', gpu: true, args: ['-c:v', 'h264_qsv', ...common, '-global_quality', String(plan.qualityNvenc)] },
    { ten: 'libx264', gpu: false, args: ['-c:v', 'libx264', ...common, '-preset', 'faster', '-crf', String(plan.qualityX264), ...peak, '-g', String(plan.gopFrames)] }
  ]
  if (plan.encoderPreference === 'cpu') candidates.unshift(candidates.pop()!)
  return candidates
}
