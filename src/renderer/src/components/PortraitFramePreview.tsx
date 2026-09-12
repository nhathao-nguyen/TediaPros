import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { portraitFrame, PORTRAIT_BLUR_SIGMA } from '../../../shared/portraitFrame'
import type { VideoAdjustments } from '../../../shared/types'
import { videoAdjustmentPreviewStyle } from '../../../shared/videoAdjustments'
import './PortraitFramePreview.css'

export function PortraitBlurButton({ enabled, disabled, onChange }: {
  enabled: boolean; disabled?: boolean; onChange: (enabled: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`btn sm portrait-blur-toggle${enabled ? ' primary' : ' ghost'}`}
      aria-pressed={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      title="Giữ trọn hình gốc trong khung 1080×1920, lấp phần trống bằng nền video làm mờ. Áp dụng cho xem trước và xuất video."
    >
      9:16 · Nền mờ{enabled ? ' ✓' : ''}
    </button>
  )
}

/** Paint the same decoded video frame; no second player, audio or playback clock. */
export function PortraitFramePreview({ enabled, videoRef, source, videoWidth, videoHeight, width, height, adjustments, children, overlay }: {
  enabled: boolean
  videoRef: RefObject<HTMLVideoElement | null>
  source: string | null
  videoWidth: number
  videoHeight: number
  width: number
  height: number
  adjustments?: VideoAdjustments
  children: ReactNode
  overlay?: ReactNode
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frame = videoWidth > 0 && videoHeight > 0 ? portraitFrame(videoWidth, videoHeight) : null
  const hasPadding = enabled && frame && (frame.x > 0 || frame.y > 0)
  const adjustmentStyle = videoAdjustmentPreviewStyle(adjustments)

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!hasPadding || !video || !canvas) return
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return
    let callbackId = 0
    let disposed = false
    const draw = (): void => {
      if (disposed || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
      const w = video.videoWidth * scale
      const h = video.videoHeight * scale
      context.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
    }
    const onFrame = (): void => {
      draw()
      if (!disposed) callbackId = video.requestVideoFrameCallback(onFrame)
    }
    const events = ['loadeddata', 'seeked', 'timeupdate', 'pause', 'ended'] as const
    for (const event of events) video.addEventListener(event, draw)
    draw()
    callbackId = video.requestVideoFrameCallback(onFrame)
    return () => {
      disposed = true
      video.cancelVideoFrameCallback(callbackId)
      for (const event of events) video.removeEventListener(event, draw)
    }
  }, [hasPadding, source, width, height, videoRef])

  return (
    <div
      className="ocr-video editor-stage-video portrait-frame-preview"
      data-portrait-blur={enabled}
      style={{
        aspectRatio: enabled ? '9 / 16' : `${videoWidth || 16} / ${videoHeight || 9}`,
        width: width > 0 ? width : undefined,
        height: height > 0 ? height : undefined
      }}
    >
      {hasPadding && (
        <canvas
          ref={canvasRef}
          className="portrait-frame-background"
          width={Math.max(1, Math.round(width))}
          height={Math.max(1, Math.round(height))}
          style={{
            filter: `${adjustmentStyle.filter} blur(${PORTRAIT_BLUR_SIGMA * width / 1080}px)`,
            transform: `scale(${1.1 * Number(adjustmentStyle.transform.slice(6, -1))})`
          }}
          aria-hidden="true"
        />
      )}
      <div className="portrait-frame-content" style={enabled && frame ? {
        left: `${frame.x / frame.width * 100}%`,
        top: `${frame.y / frame.height * 100}%`,
        width: `${frame.contentWidth / frame.width * 100}%`,
        height: `${frame.contentHeight / frame.height * 100}%`
      } : { inset: 0 }} data-video-adjustments>
        {children}
      </div>
      {overlay}
    </div>
  )
}
