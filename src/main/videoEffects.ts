import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { normalizeVideoEffects, type VideoEffect, type OverlayBlendMode } from '../shared/videoEffects'
import { chromaKeySpillChannel } from '../shared/overlayChromaKey'

export function resolveFilmGrungePath(): string | null {
  const candidates = [
    ...(process.resourcesPath ? [join(process.resourcesPath, 'effects', 'film_grunge.mp4')] : []),
    join(__dirname, '..', '..', 'resources', 'effects', 'film_grunge.mp4'),
    join(app?.getAppPath?.() || process.cwd(), 'resources', 'effects', 'film_grunge.mp4'),
    join(process.cwd(), 'resources', 'effects', 'film_grunge.mp4')
  ]
  for (const candidate of candidates) {
    try {
      if (candidate && existsSync(candidate)) return candidate
    } catch {
      // ignore
    }
  }
  return null
}

export interface VideoEffectInputMapping {
  effectIndex: number
  videoInputIndex: number
  matteInputIndex?: number
  videoPath: string
  mattePath?: string
  blendMode?: OverlayBlendMode
}

export function planVideoEffectInputs(
  effects: VideoEffect[] | undefined,
  startInputIndex: number
): {
  mappings: VideoEffectInputMapping[]
  inputArgs: string[]
  filmGrungeInputIndex?: number
} {
  const normalized = normalizeVideoEffects(effects)
  if (!normalized || normalized.length === 0) {
    return { mappings: [], inputArgs: [] }
  }

  const mappings: VideoEffectInputMapping[] = []
  const inputArgs: string[] = []
  let nextIndex = startInputIndex
  let filmGrungeInputIndex: number | undefined

  const filmGrungePath = resolveFilmGrungePath()

  normalized.forEach((eff, idx) => {
    if (eff.kind === 'film_grunge') {
      if (filmGrungePath && existsSync(filmGrungePath)) {
        filmGrungeInputIndex = nextIndex
        mappings.push({
          effectIndex: idx,
          videoInputIndex: nextIndex,
          videoPath: filmGrungePath,
          blendMode: 'screen'
        })
        inputArgs.push('-stream_loop', '-1', '-i', filmGrungePath)
        nextIndex++
      }
    } else if (eff.kind === 'custom_overlay' && eff.assetPath && existsSync(eff.assetPath)) {
      const videoInputIndex = nextIndex
      inputArgs.push('-stream_loop', '-1', '-i', eff.assetPath)
      nextIndex++

      let matteInputIndex: number | undefined
      if (eff.mattePath && existsSync(eff.mattePath)) {
        matteInputIndex = nextIndex
        inputArgs.push('-stream_loop', '-1', '-i', eff.mattePath)
        nextIndex++
      }

      mappings.push({
        effectIndex: idx,
        videoInputIndex,
        matteInputIndex,
        videoPath: eff.assetPath,
        mattePath: eff.mattePath,
        blendMode: eff.blendMode || (matteInputIndex != null ? 'alphamerge' : 'screen')
      })
    }
  })

  return { mappings, inputArgs, filmGrungeInputIndex }
}

/** Final canvas treatment, before image/text branding. All branches inherit source PTS/EOF. */
export function appendVideoEffects(
  lines: string[],
  width: number,
  height: number,
  raw?: VideoEffect[],
  effectInputs?: number | VideoEffectInputMapping[]
): void {
  const effects = normalizeVideoEffects(raw)
  if (!effects) return
  const last = lines.length - 1
  if (!lines[last]?.endsWith('[out]')) throw new Error('Thiếu đầu ra video để thêm hiệu ứng.')
  lines[last] = lines[last].slice(0, -5) + '[effects_input]'
  let input = 'effects_input'

  // Normalize mappings
  const inputMap = new Map<number, VideoEffectInputMapping>()
  let legacyFilmGrungeIndex: number | undefined
  if (typeof effectInputs === 'number') {
    legacyFilmGrungeIndex = effectInputs
  } else if (Array.isArray(effectInputs)) {
    for (const m of effectInputs) {
      inputMap.set(m.effectIndex, m)
      if (effects[m.effectIndex]?.kind === 'film_grunge') {
        legacyFilmGrungeIndex = m.videoInputIndex
      }
    }
  }

  effects.forEach((effect, index) => {
    const label = `effect_${index}`
    const strength = effect.intensity / 100
    const output = index === effects.length - 1 ? 'out' : `${label}_out`
    const mapped = inputMap.get(index)

    if (effect.kind === 'custom_overlay') {
      const videoIdx = mapped?.videoInputIndex
      const matteIdx = mapped?.matteInputIndex
      if (videoIdx != null && videoIdx >= 0) {
        if (matteIdx != null && matteIdx >= 0) {
          // Alpha merge blend mode
          lines.push(`[${videoIdx}:v][${matteIdx}:v]alphamerge,scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuva444p[${label}_fg]`)
          lines.push(`[${input}][${label}_fg]overlay=shortest=1[${output}]`)
        } else if (effect.chromaKey) {
          const key = effect.chromaKey
          const spill = chromaKeySpillChannel(key)
          const despill = spill ? `,despill=type=${spill}:green=${spill === 'green' ? -1 : 0}:blue=${spill === 'blue' ? -1 : 0}` : ''
          lines.push(`[${videoIdx}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba,colorkey=0x${key.color.slice(1)}:${key.similarity}:${key.blend}${despill},colorchannelmixer=aa=${strength.toFixed(4)}[${label}_fg]`)
          lines.push(`[${input}][${label}_fg]overlay=shortest=1[${output}]`)
        } else if (mapped?.blendMode === 'multiply') {
          // Multiply blend mode (for black noise / dark scratches on light/white background)
          lines.push(`[${videoIdx}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv444p[${label}_scaled]`)
          lines.push(`[${input}][${label}_scaled]blend=all_mode=multiply:all_opacity=${strength.toFixed(4)}:shortest=1[${output}]`)
        } else {
          // Screen blend mode
          lines.push(`[${videoIdx}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv444p[${label}_scaled]`)
          lines.push(`[${input}][${label}_scaled]blend=c0_mode=screen:c0_opacity=${strength.toFixed(4)}:c1_expr=A:c2_expr=A:shortest=1[${output}]`)
        }
      } else {
        // No input stream available, pass through
        lines.push(`[${input}]null[${output}]`)
      }
    } else if (effect.kind === 'film_grunge') {
      const filmGrungeInputIndex = mapped?.videoInputIndex ?? legacyFilmGrungeIndex
      if (filmGrungeInputIndex != null && filmGrungeInputIndex >= 0) {
        lines.push(`[${filmGrungeInputIndex}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv444p[${label}_grunge]`)
        lines.push(`[${input}][${label}_grunge]blend=c0_mode=screen:c0_opacity=${strength.toFixed(4)}:c1_expr=A:c2_expr=A:shortest=1[${output}]`)
      } else {
        // Fallback procedural dust if no external video stream index was provided
        const scale = Math.min(1 / 3, 256 / Math.max(width, height))
        const smallW = Math.max(2, Math.round(width * scale))
        const smallH = Math.max(2, Math.round(height * scale))
        const hash = 'mod(abs(sin(X*12.9898+Y*78.233+N*37.719)*43758.5453),1)'
        lines.push(`[${input}]format=yuv444p,split=2[${label}_base][${label}_source]`)
        lines.push(`[${label}_source]scale=${smallW}:${smallH},geq=lum='if(gt(${hash},0.998),255,0)':cb=128:cr=128,scale=${width}:${height}:flags=bilinear[${label}_texture]`)
        lines.push(`[${label}_base][${label}_texture]blend=c0_mode=screen:c0_opacity=${strength.toFixed(4)}:c1_expr=A:c2_expr=A:shortest=1[${output}]`)
      }
    } else if (effect.kind === 'dust') {
      // Small procedural luma texture avoids full-resolution per-pixel expressions,
      // external assets, infinite sources and additional scratch videos.
      const scale = Math.min(1 / 3, 256 / Math.max(width, height))
      const smallW = Math.max(2, Math.round(width * scale))
      const smallH = Math.max(2, Math.round(height * scale))
      const hash = 'mod(abs(sin(X*12.9898+Y*78.233+N*37.719)*43758.5453),1)'
      lines.push(`[${input}]format=yuv444p,split=2[${label}_base][${label}_source]`)
      lines.push(`[${label}_source]scale=${smallW}:${smallH},geq=lum='if(gt(${hash},0.999),255,0)':cb=128:cr=128,scale=${width}:${height}:flags=bilinear[${label}_texture]`)
      lines.push(`[${label}_base][${label}_texture]blend=c0_mode=screen:c0_opacity=${strength.toFixed(4)}:c1_expr=A:c2_expr=A:shortest=1[${output}]`)
    } else if (effect.kind === 'grain') {
      const c0 = Math.max(2, Math.round(strength * 75))
      const chroma = Math.round(strength * 12)
      lines.push(`[${input}]format=yuv444p,noise=c0s=${c0}:c1s=${chroma}:c2s=${chroma}:allf=t+u:all_seed=731[${output}]`)
    } else {
      const shift = Math.max(1, Math.round(width / 540 * strength))
      const spacing = Math.max(3, Math.round(height / 180))
      const c0 = Math.max(2, Math.round(strength * 55))
      const chroma = Math.round(strength * 16)
      lines.push(`[${input}]format=yuv444p,noise=c0s=${c0}:c1s=${chroma}:c2s=${chroma}:allf=t+u:all_seed=947,chromashift=cbh=${shift}:crh=${-shift},drawgrid=w=iw:h=${spacing}:t=1:c=black@${(strength * 0.18).toFixed(4)}[${output}]`)
    }
    input = output
  })
}

