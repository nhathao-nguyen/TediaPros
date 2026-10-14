import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
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
  layerIndex?: number
  isStatic?: boolean
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
  const sourceInputs = new Map<string, number>()
  const inputIndex = (path: string, isStatic = false): number => {
    const normalizedPath = normalize(path)
    const key = `${process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath}:${isStatic ? 'still' : 'loop'}`
    const existing = sourceInputs.get(key)
    if (existing != null) return existing
    const index = nextIndex++
    sourceInputs.set(key, index)
    inputArgs.push(...(isStatic ? [] : ['-stream_loop', '-1']), '-i', path)
    return index
  }

  const filmGrungePath = resolveFilmGrungePath()

  normalized.forEach((eff, idx) => {
    if (eff.kind === 'film_grunge') {
      if (filmGrungePath && existsSync(filmGrungePath)) {
        filmGrungeInputIndex = inputIndex(filmGrungePath)
        mappings.push({
          effectIndex: idx,
          videoInputIndex: filmGrungeInputIndex,
          videoPath: filmGrungePath,
          blendMode: 'screen'
        })
      }
    } else if (eff.kind === 'custom_overlay' && eff.layers) {
      for (const [layerIndex, layer] of eff.layers.entries()) {
        if (!existsSync(layer.assetPath)) throw new Error(`Thiếu lớp texture ${layerIndex + 1} của ${eff.name || 'hiệu ứng'}.`)
        mappings.push({ effectIndex: idx, layerIndex, videoInputIndex: inputIndex(layer.assetPath, layer.isStatic), videoPath: layer.assetPath, blendMode: layer.blendMode, isStatic: layer.isStatic })
      }
    } else if (eff.kind === 'custom_overlay' && eff.assetPath && existsSync(eff.assetPath)) {
      const videoInputIndex = inputIndex(eff.assetPath)

      let matteInputIndex: number | undefined
      if (eff.mattePath && existsSync(eff.mattePath)) {
        matteInputIndex = inputIndex(eff.mattePath)
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
  const inputMap = new Map<number, VideoEffectInputMapping[]>()
  let legacyFilmGrungeIndex: number | undefined
  if (typeof effectInputs === 'number') {
    legacyFilmGrungeIndex = effectInputs
  } else if (Array.isArray(effectInputs)) {
    for (const m of effectInputs) {
      const group = inputMap.get(m.effectIndex) || []
      group.push(m)
      inputMap.set(m.effectIndex, group)
      if (effects[m.effectIndex]?.kind === 'film_grunge') {
        legacyFilmGrungeIndex = m.videoInputIndex
      }
    }
  }

  // Decode each asset once (input planner), then share its resized RGB frame
  // across consumers. Do not move effect operations across ordered layers.
  const rgbUsers = new Map<number, string[]>()
  effects.forEach((effect, effectIndex) => {
    const mappings = inputMap.get(effectIndex) || []
    const rgb = effect.kind === 'film_grunge' || (effect.kind === 'custom_overlay' && !effect.chromaKey && !effect.mattePath && !effect.packedAlpha)
    if (!rgb) return
    for (const mapping of mappings) {
      if (mapping.matteInputIndex != null) continue
      const key = `effect_texture_${effectIndex}_${mapping.layerIndex ?? 0}`
      const users = rgbUsers.get(mapping.videoInputIndex) || []
      users.push(key); rgbUsers.set(mapping.videoInputIndex, users)
    }
  })
  const sharedRgb = new Set<number>()
  const staticInputs = new Set(Array.isArray(effectInputs) ? effectInputs.filter(m => m.isStatic).map(m => m.videoInputIndex) : [])
  const prepareRgb = (videoIndex: number): string => `scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=gbrp${staticInputs.has(videoIndex) ? ',loop=loop=-1:size=1:start=0,setpts=N/(24*TB)' : ''}`
  for (const [videoIndex, users] of rgbUsers) {
    if (users.length < 2) continue
    sharedRgb.add(videoIndex)
    lines.push(`[${videoIndex}:v]${prepareRgb(videoIndex)},split=${users.length}${users.map(user => `[${user}]`).join('')}`)
  }
  const textureLabel = (videoIndex: number, effectIndex: number, layerIndex: number, label: string): string => {
    if (sharedRgb.has(videoIndex)) return `effect_texture_${effectIndex}_${layerIndex}`
    lines.push(`[${videoIndex}:v]${prepareRgb(videoIndex)}[${label}]`)
    return label
  }

  effects.forEach((effect, index) => {
    const label = `effect_${index}`
    const strength = effect.intensity / 100
    const output = index === effects.length - 1 ? 'out' : `${label}_out`
    const mappedLayers = inputMap.get(index) || []
    const mapped = mappedLayers[0]

    if (effect.kind === 'custom_overlay') {
      if (effect.layers) {
        if (mappedLayers.length !== effect.layers.length) throw new Error('Thiếu input cho hiệu ứng nhiều lớp.')
        lines.push(`[${input}]format=gbrp${strength < 1 ? `,split=2[${label}_original][${label}_base]` : `[${label}_base]`}`)
        let layerInput = `${label}_base`
        effect.layers.forEach((layer, layerIndex) => {
          const mapping = mappedLayers.find(m => m.layerIndex === layerIndex)
          if (!mapping) throw new Error('Thứ tự input texture không hợp lệ.')
          const layerLabel = `${label}_layer_${layerIndex}`
          const lastLayer = layerIndex === effect.layers!.length - 1
          const layerOutput = lastLayer && strength === 1 ? output : `${layerLabel}_out`
          const texture = textureLabel(mapping.videoInputIndex, index, layerIndex, `${layerLabel}_texture`)
          lines.push(`[${layerInput}][${texture}]blend=all_mode=${layer.blendMode}:shortest=1[${layerOutput}]`)
          layerInput = layerOutput
        })
        if (strength < 1) lines.push(`[${label}_original][${layerInput}]blend=all_expr='A*(1-${strength.toFixed(4)})+B*${strength.toFixed(4)}':shortest=1[${output}]`)
        input = output
        return
      }
      const videoIdx = mapped?.videoInputIndex
      const matteIdx = mapped?.matteInputIndex
      if (videoIdx != null && videoIdx >= 0) {
        if (effect.packedAlpha === 'left') {
          // Unpack before geometry: left red channel is alpha, right half is RGB.
          lines.push(`[${videoIdx}:v]format=rgba,split=2[${label}_packed_color][${label}_packed_alpha]`)
          lines.push(`[${label}_packed_color]crop=w=iw/2:h=ih:x=iw/2:y=0:exact=1[${label}_color]`)
          lines.push(`[${label}_packed_alpha]crop=w=iw/2:h=ih:x=0:y=0:exact=1,extractplanes=r[${label}_alpha]`)
          lines.push(`[${label}_color][${label}_alpha]alphamerge,scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba[${label}_rgba]`)
          const mode = effect.blendMode || 'alphamerge'
          if (mode === 'alphamerge') {
            lines.push(`[${label}_rgba]colorchannelmixer=aa=${strength.toFixed(4)}[${label}_fg]`)
            lines.push(`[${input}][${label}_fg]overlay=shortest=1:format=rgb[${output}]`)
          } else {
            const neutral = mode === 'multiply' ? 255 : 0
            lines.push(`[${label}_rgba]split=2[${label}_fg][${label}_neutral]`)
            lines.push(`[${label}_neutral]lutrgb=r=${neutral}:g=${neutral}:b=${neutral}:a=255[${label}_bg]`)
            lines.push(`[${label}_bg][${label}_fg]overlay=shortest=1:format=rgb,format=gbrp[${label}_flattened]`)
            lines.push(`[${input}]format=gbrp[${label}_base]`)
            const blend = mode === 'add' ? `all_expr='min(255,A+B*${strength.toFixed(4)})'` : `all_mode=${mode}:all_opacity=${strength.toFixed(4)}`
            lines.push(`[${label}_base][${label}_flattened]blend=${blend}:shortest=1[${output}]`)
          }
        } else if (matteIdx != null && matteIdx >= 0) {
          // Alpha merge blend mode
          lines.push(`[${videoIdx}:v][${matteIdx}:v]alphamerge,scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba,colorchannelmixer=aa=${strength.toFixed(4)}[${label}_fg]`)
          lines.push(`[${input}][${label}_fg]overlay=shortest=1[${output}]`)
        } else if (effect.chromaKey) {
          const key = effect.chromaKey
          const spill = chromaKeySpillChannel(key)
          const despill = spill ? `,despill=type=${spill}:green=${spill === 'green' ? -1 : 0}:blue=${spill === 'blue' ? -1 : 0}` : ''
          lines.push(`[${videoIdx}:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba,colorkey=0x${key.color.slice(1)}:${key.similarity}:${key.blend}${despill},colorchannelmixer=aa=${strength.toFixed(4)}[${label}_fg]`)
          lines.push(`[${input}][${label}_fg]overlay=shortest=1[${output}]`)
        } else if (mapped?.blendMode === 'multiply' || mapped?.blendMode === 'add') {
          lines.push(`[${input}]format=gbrp[${label}_base]`)
          const texture = textureLabel(videoIdx, index, 0, `${label}_scaled`)
          const blend = mapped.blendMode === 'add'
            ? `all_expr='min(255,A+B*${strength.toFixed(4)})'`
            : `all_mode=multiply:all_opacity=${strength.toFixed(4)}`
          lines.push(`[${label}_base][${texture}]blend=${blend}:shortest=1[${output}]`)
        } else {
          // Match RGB Screen in the browser. Limited-range YUV black is 16,
          // so blending luma directly adds a haze even for a black texture.
          lines.push(`[${input}]format=gbrp[${label}_base]`)
          const texture = textureLabel(videoIdx, index, 0, `${label}_scaled`)
          lines.push(`[${label}_base][${texture}]blend=all_mode=screen:all_opacity=${strength.toFixed(4)}:shortest=1[${output}]`)
        }
      } else {
        // No input stream available, pass through
        lines.push(`[${input}]null[${output}]`)
      }
    } else if (effect.kind === 'film_grunge') {
      const filmGrungeInputIndex = mapped?.videoInputIndex ?? legacyFilmGrungeIndex
      if (filmGrungeInputIndex != null && filmGrungeInputIndex >= 0) {
        lines.push(`[${input}]format=gbrp[${label}_base]`)
        const texture = textureLabel(filmGrungeInputIndex, index, 0, `${label}_grunge`)
        lines.push(`[${label}_base][${texture}]blend=all_mode=screen:all_opacity=${strength.toFixed(4)}:shortest=1[${output}]`)
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

