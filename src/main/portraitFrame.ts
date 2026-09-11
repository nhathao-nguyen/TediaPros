import { portraitFrame, PORTRAIT_BLUR_SIGMA } from '../shared/portraitFrame'

/** Runs after source-space masking, with new subtitles only on the sharp foreground. */
export function appendPortraitFrame(
  lines: string[], input: string, width: number, height: number, assFilter?: string
): void {
  const frame = portraitFrame(width, height)
  const foreground = `${assFilter ? `${assFilter},` : ''}scale=${frame.contentWidth}:${frame.contentHeight}:flags=lanczos,setsar=1`
  if (frame.contentWidth === frame.width && frame.contentHeight === frame.height) {
    lines.push(`[${input}]${foreground}[out]`)
    return
  }
  lines.push(`[${input}]split=2[portrait_bg_source][portrait_fg_source]`)
  lines.push(`[portrait_bg_source]scale=${frame.width}:${frame.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${frame.width}:${frame.height},setsar=1,gblur=sigma=${PORTRAIT_BLUR_SIGMA}:steps=3[portrait_bg]`)
  lines.push(`[portrait_fg_source]${foreground}[portrait_fg]`)
  lines.push(`[portrait_bg][portrait_fg]overlay=x=${frame.x}:y=${frame.y}:format=auto,setsar=1[out]`)
}
