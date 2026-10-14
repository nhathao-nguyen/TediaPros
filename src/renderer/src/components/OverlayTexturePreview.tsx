import { useEffect, useRef, type RefObject } from 'react'
import type { OverlayTextureLayer } from '../../../shared/videoEffects'
import { compileRgbTextureOverlay } from '../../../shared/overlayCompositing'
import { localMediaSource } from '../lib/localMedia'

/** Reused canvases; paint only when a decoded texture frame or seek changes. */
export default function OverlayTexturePreview({ layers, intensity, videoRef, width, height }: {
  layers: OverlayTextureLayer[]; intensity: number; videoRef?: RefObject<HTMLVideoElement | null>; width: number; height: number
}) {
  const videos = useRef<Array<HTMLVideoElement | null>>([])
  const presented = useRef(new WeakSet<HTMLVideoElement>())
  const frameTimes = useRef(new WeakMap<HTMLVideoElement, number>())
  const multiply = useRef<HTMLCanvasElement>(null), screen = useRef<HTMLCanvasElement>(null)
  const scale = Math.min(1, 640 / Math.max(1, width, height))
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale))
  useEffect(() => {
    const main = videoRef?.current
    const inputs = videos.current.slice(0, layers.length)
    const mc = multiply.current?.getContext('2d'), sc = screen.current?.getContext('2d')
    if (!mc || !sc || inputs.some(v => !v)) return
    const scratch = layers.map(() => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c.getContext('2d', { willReadFrequently: true })! })
    const decoded: Array<ImageData | undefined> = []
    const times = inputs.map(() => -1)
    const m = mc.createImageData(w, h), s = sc.createImageData(w, h)
    let disposed = false, frameId = 0
    const paint = () => {
      if (disposed || inputs.some(v => !v || v.readyState < 2 || v.seeking || !presented.current.has(v))) return
      let changed = false
      for (let i = 0; i < inputs.length; i++) {
        const v = inputs[i]!
        const time = frameTimes.current.get(v) ?? v.currentTime
        if (times[i] === time && decoded[i]) continue
        const factor = Math.max(w / v.videoWidth, h / v.videoHeight)
        scratch[i].drawImage(v, (w - v.videoWidth * factor) / 2, (h - v.videoHeight * factor) / 2, v.videoWidth * factor, v.videoHeight * factor)
        decoded[i] = scratch[i].getImageData(0, 0, w, h)
        times[i] = time
        changed = true
      }
      if (!changed) return
      compileRgbTextureOverlay(layers.map((layer, i) => ({ pixels: decoded[i]!.data, blendMode: layer.blendMode })), intensity, m.data, s.data)
      mc.putImageData(m, 0, 0); sc.putImageData(s, 0, 0)
    }
    const syncTime = () => {
      if (!main) return
      for (const v of inputs) if (v && Number.isFinite(v.duration) && v.duration > 0) v.currentTime = main.currentTime % v.duration
    }
    const syncPlayback = () => {
      for (const v of inputs) {
        if (!v) continue
        v.playbackRate = main?.playbackRate || 1
        if (main?.paused) v.pause(); else v.play().catch(() => {})
      }
      paint()
    }
    const onLoaded = () => { syncTime(); syncPlayback(); paint() }
    for (const v of inputs) {
      v!.addEventListener('loadedmetadata', onLoaded)
      for (const event of ['loadeddata', 'seeked', 'pause', 'ended']) v!.addEventListener(event, paint)
    }
    const textureFrameIds = inputs.map(() => 0)
    for (const [i, v] of inputs.entries()) {
      const onTextureFrame = (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (disposed) return
        presented.current.add(v!)
        frameTimes.current.set(v!, metadata.mediaTime)
        paint()
        textureFrameIds[i] = v!.requestVideoFrameCallback(onTextureFrame)
      }
      textureFrameIds[i] = v!.requestVideoFrameCallback(onTextureFrame)
    }
    const clock = main || inputs[0]!
    const onFrame = () => {
      if (disposed) return
      paint()
      frameId = clock.requestVideoFrameCallback(onFrame)
    }
    for (const event of ['play', 'pause', 'ratechange']) main?.addEventListener(event, syncPlayback)
    for (const event of ['seeking', 'seeked']) main?.addEventListener(event, syncTime)
    syncTime(); syncPlayback(); paint()
    frameId = clock.requestVideoFrameCallback(onFrame)
    return () => {
      disposed = true
      clock.cancelVideoFrameCallback(frameId)
      for (const event of ['play', 'pause', 'ratechange']) main?.removeEventListener(event, syncPlayback)
      for (const event of ['seeking', 'seeked']) main?.removeEventListener(event, syncTime)
      for (const [i, v] of inputs.entries()) {
        v!.cancelVideoFrameCallback(textureFrameIds[i])
        v!.removeEventListener('loadedmetadata', onLoaded)
        for (const event of ['loadeddata', 'seeked', 'pause', 'ended']) v!.removeEventListener(event, paint)
        v!.pause()
      }
    }
  }, [layers, intensity, videoRef, w, h])
  return <>
    {layers.map((layer, i) => <video key={layer.assetPath} ref={v => { videos.current[i] = v }}
      src={localMediaSource(layer.assetPath)} muted playsInline loop crossOrigin="anonymous" style={{ display: 'none' }} aria-hidden="true" />)}
    <canvas ref={multiply} width={w} height={h} className="video-effects-preview video-effects-texture-multiply" style={{ mixBlendMode: 'multiply' }} aria-hidden="true" />
    <canvas ref={screen} width={w} height={h} className="video-effects-preview video-effects-texture-screen" style={{ mixBlendMode: 'screen' }} aria-hidden="true" />
  </>
}
