import { useEffect, useRef, type RefObject } from 'react'
import type { VideoEffect } from '../../../shared/videoEffects'

/** Lightweight illustrative preview. Export uses FFmpeg at full output resolution. */
export default function VideoEffectsPreview({ effects, videoRef, source, width, height }: {
  effects: VideoEffect[]; videoRef?: RefObject<HTMLVideoElement | null>; source?: string | null
  width: number; height: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !effects.length) return
    const video = videoRef?.current
    const noiseCanvas = document.createElement('canvas')
    noiseCanvas.width = canvas.width; noiseCanvas.height = canvas.height
    const noiseContext = noiseCanvas.getContext('2d')
    let callbackId = 0
    let disposed = false
    const paint = () => {
      const w = canvas.width; const h = canvas.height
      const frame = Math.floor((video?.currentTime || 0) * 24)
      let seed = (frame + 1) * 731
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296 }
      context.clearRect(0, 0, w, h)
      for (const effect of effects) {
        const strength = effect.intensity / 100
        if (effect.kind === 'dust') {
          context.fillStyle = `rgba(255,250,235,${strength * 0.85})`
          for (let i = 0; i < Math.max(5, w * h / 3000); i++) {
            const x = random() * w; const y = random() * h
            context.beginPath(); context.ellipse(x, y, 0.6 + random(), 0.6 + random() * 1.8, random() * 3, 0, Math.PI * 2); context.fill()
          }
        } else {
          if (!noiseContext) continue
          const pixels = noiseContext.createImageData(w, h)
          for (let p = 0; p < pixels.data.length; p += 4) {
            const v = random() > 0.5 ? 255 : 0
            pixels.data[p] = v
            pixels.data[p + 1] = effect.kind === 'analog' ? Math.floor(random() * 256) : v
            pixels.data[p + 2] = v
            pixels.data[p + 3] = Math.floor(random() * strength * 42)
          }
          noiseContext.putImageData(pixels, 0, 0)
          context.drawImage(noiseCanvas, 0, 0)
          if (effect.kind === 'analog') {
            context.fillStyle = `rgba(0,0,0,${strength * 0.18})`
            for (let y = 0; y < h; y += 4) context.fillRect(0, y, w, 1)
          }
        }
      }
    }
    const onFrame = () => {
      if (disposed) return
      paint()
      if (video) callbackId = video.requestVideoFrameCallback(onFrame)
    }
    paint()
    const events = ['loadeddata', 'seeked', 'pause', 'ended'] as const
    if (video) {
      callbackId = video.requestVideoFrameCallback(onFrame)
      for (const name of events) video.addEventListener(name, paint)
    }
    return () => {
      disposed = true
      if (video) {
        video.cancelVideoFrameCallback(callbackId)
        for (const name of events) video.removeEventListener(name, paint)
      }
    }
  }, [effects, videoRef, source, width, height])
  if (!effects.length) return null
  const scale = Math.min(1, 640 / Math.max(1, width, height))
  return <canvas ref={ref} className="video-effects-preview" aria-hidden="true"
    width={Math.max(1, Math.round(width * scale))} height={Math.max(1, Math.round(height * scale))} />
}
