export interface OpeningHookOptions {
  flash?: boolean
  zoom?: boolean
}

/**
 * Appends opening hook transitions (Punch-in Zoom & Flash White) to an FFmpeg filter_complex graph.
 *
 * 1. Punch-in Zoom: Starts at 115% zoom at t=0s, smoothly pulling back to 100% by t=1.5s.
 *    Bilateral dynamic crop centered at (iw-ow)/2, (ih-oh)/2 with even integer rounding to preserve YUV 4:2:0 subsampling.
 * 2. Flash White: Camera shutter flash starting at pure white at t=0s and fading back to normal by t=0.35s.
 *
 * Both effects preserve 100% of audio and speech from t=0.00s without breaking story continuity.
 */
export function appendOpeningHooks(
  lines: string[],
  width: number,
  height: number,
  options?: OpeningHookOptions
): void {
  if (!options?.flash && !options?.zoom) return
  const last = lines.length - 1
  if (!lines[last]?.endsWith('[out]')) throw new Error('Thiếu đầu ra video để thêm hiệu ứng mở màn.')
  lines[last] = lines[last].slice(0, -5) + '[hook_input]'
  let input = 'hook_input'

  // 1. Opening Zoom (Punch-in Zoom: 115% -> 100% over the first 1.5s)
  if (options.zoom) {
    const nextOutput = options.flash ? 'hook_zoomed' : 'out'
    const zoomExpr = 'if(lte(t,1.5),1.15-0.15*(t/1.5),1.0)'
    const cropW = `trunc(iw/(${zoomExpr})/2)*2`
    const cropH = `trunc(ih/(${zoomExpr})/2)*2`
    lines.push(
      `[${input}]crop=w='${cropW}':h='${cropH}':x='(iw-ow)/2':y='(ih-oh)/2',scale=${width}:${height}[${nextOutput}]`
    )
    input = nextOutput
  }

  // 2. Opening Flash (Flash white: 0.35s fade-in from pure white)
  if (options.flash) {
    lines.push(`[${input}]fade=t=in:st=0:d=0.35:color=white[out]`)
  }
}
