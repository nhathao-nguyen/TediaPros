import { normalizeVideoEffects, type VideoEffect } from '../shared/videoEffects'

/** Final canvas treatment, before image/text branding. All branches inherit source PTS/EOF. */
export function appendVideoEffects(lines: string[], width: number, height: number, raw?: VideoEffect[]): void {
  const effects = normalizeVideoEffects(raw)
  if (!effects) return
  const last = lines.length - 1
  if (!lines[last]?.endsWith('[out]')) throw new Error('Thiếu đầu ra video để thêm hiệu ứng.')
  lines[last] = lines[last].slice(0, -5) + '[effects_input]'
  let input = 'effects_input'
  effects.forEach((effect, index) => {
    const label = `effect_${index}`
    const strength = effect.intensity / 100
    const output = index === effects.length - 1 ? 'out' : `${label}_out`
    if (effect.kind === 'dust') {
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
      lines.push(`[${input}]format=yuv444p,noise=c0s=${Math.max(1, Math.round(strength * 30))}:c0f=t+u:all_seed=731[${output}]`)
    } else {
      const shift = Math.max(1, Math.round(width / 540 * strength))
      const spacing = Math.max(3, Math.round(height / 180))
      lines.push(`[${input}]format=yuv444p,noise=c0s=${Math.max(1, Math.round(strength * 22))}:c1s=${Math.round(strength * 10)}:c2s=${Math.round(strength * 10)}:allf=t+u:all_seed=947,chromashift=cbh=${shift}:crh=${-shift},drawgrid=w=iw:h=${spacing}:t=1:c=black@${(strength * 0.18).toFixed(4)}[${output}]`)
    }
    input = output
  })
}
