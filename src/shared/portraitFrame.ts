export const PORTRAIT_WIDTH = 1080
export const PORTRAIT_HEIGHT = 1920
export const PORTRAIT_BLUR_SIGMA = 40

/** Source coordinates stay unchanged; preview and export share this final placement. */
export function portraitFrame(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Kích thước video không hợp lệ.')
  }
  const scale = Math.min(PORTRAIT_WIDTH / width, PORTRAIT_HEIGHT / height)
  const contentWidth = Math.max(2, Math.floor(width * scale / 2) * 2)
  const contentHeight = Math.max(2, Math.floor(height * scale / 2) * 2)
  return {
    width: PORTRAIT_WIDTH,
    height: PORTRAIT_HEIGHT,
    contentWidth,
    contentHeight,
    x: (PORTRAIT_WIDTH - contentWidth) / 2,
    y: (PORTRAIT_HEIGHT - contentHeight) / 2
  }
}
