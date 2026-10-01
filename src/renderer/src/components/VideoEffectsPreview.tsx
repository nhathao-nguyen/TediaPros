import { useEffect, useRef, useState, type RefObject } from 'react'
import type { VideoEffect } from '../../../shared/videoEffects'
import { applyOverlayChromaKey, type OverlayChromaKey } from '../../../shared/overlayChromaKey'
import { localMediaSource } from '../lib/localMedia'

let cachedFilmGrungePath: string | null = null
let pendingPathPromise: Promise<string | null> | null = null

async function getFilmGrungeSrc(): Promise<string | null> {
  if (cachedFilmGrungePath) return localMediaSource(cachedFilmGrungePath)
  if (!pendingPathPromise) {
    pendingPathPromise = (async () => {
      try {
        const p = await window.api?.getVideoEffectAssetPath?.('film_grunge')
        if (p) {
          cachedFilmGrungePath = p
          return p
        }
      } catch {
        // ignore
      }
      return null
    })()
  }
  const resolved = await pendingPathPromise
  if (resolved) {
    cachedFilmGrungePath = resolved
    return localMediaSource(resolved)
  }
  pendingPathPromise = null
  return null
}

/** Lightweight illustrative preview. Export uses FFmpeg at full output resolution. */
export default function VideoEffectsPreview({ effects, videoRef, source, width, height }: {
  effects: VideoEffect[]; videoRef?: RefObject<HTMLVideoElement | null>; source?: string | null
  width: number; height: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const grungeVideoRef = useRef<HTMLVideoElement>(null)
  const keyedCanvasRef = useRef<HTMLCanvasElement>(null)
  const [legacyKey, setLegacyKey] = useState<{ path: string; key?: OverlayChromaKey }>()

  const videoOverlayEffect = effects.find(e => e.kind === 'film_grunge' || e.kind === 'custom_overlay')
  const hasProcedural = effects.some(e => e.kind !== 'film_grunge' && e.kind !== 'custom_overlay')
  const legacyPath = videoOverlayEffect?.kind === 'custom_overlay' && !videoOverlayEffect.chromaKey && !videoOverlayEffect.mattePath &&
    (videoOverlayEffect.sourceType === 'capcut' || videoOverlayEffect.sourceType === 'saved') ? videoOverlayEffect.assetPath : undefined
  const chromaKey = videoOverlayEffect?.chromaKey || (legacyKey?.path === legacyPath ? legacyKey?.key : undefined)
  const resolvingKey = Boolean(legacyPath && legacyKey?.path !== legacyPath && window.api?.resolveOverlayChromaKey)

  useEffect(() => {
    if (!legacyPath || !window.api?.resolveOverlayChromaKey) return
    let active = true
    window.api.resolveOverlayChromaKey(legacyPath).then(result => {
      if (active) setLegacyKey({ path: legacyPath, key: result.ok ? result.chromaKey : undefined })
    }).catch(() => { if (active) setLegacyKey({ path: legacyPath }) })
    return () => { active = false }
  }, [legacyPath])

  const customSrc = videoOverlayEffect?.kind === 'custom_overlay' && videoOverlayEffect.assetPath
    ? localMediaSource(videoOverlayEffect.assetPath)
    : null

  const [grungeSrc, setGrungeSrc] = useState<string | null>(
    cachedFilmGrungePath ? localMediaSource(cachedFilmGrungePath) : null
  )

  const activeVideoSrc = customSrc || grungeSrc

  useEffect(() => {
    if (videoOverlayEffect?.kind !== 'film_grunge') return
    if (grungeSrc) return
    let active = true
    getFilmGrungeSrc().then(src => {
      if (active && src) setGrungeSrc(src)
    })
    return () => { active = false }
  }, [Boolean(videoOverlayEffect?.kind === 'film_grunge'), grungeSrc])

  // Video playback synchronization with main video
  useEffect(() => {
    const mainVideo = videoRef?.current
    const grungeVideo = grungeVideoRef.current
    if (!videoOverlayEffect || !grungeVideo) return

    if (!mainVideo) {
      // Standalone preview (e.g. preset card thumbnail)
      grungeVideo.play().catch(() => {})
      return
    }

    const syncPlay = () => {
      if (mainVideo.paused) {
        grungeVideo.pause()
      } else {
        grungeVideo.play().catch(() => {})
      }
    }
    const syncTime = () => {
      if (grungeVideo.duration && Number.isFinite(grungeVideo.duration) && grungeVideo.duration > 0) {
        grungeVideo.currentTime = mainVideo.currentTime % grungeVideo.duration
      }
    }
    const syncRate = () => {
      grungeVideo.playbackRate = mainVideo.playbackRate || 1
    }

    syncPlay()
    syncRate()
    syncTime()
    grungeVideo.addEventListener('loadedmetadata', syncTime)

    mainVideo.addEventListener('play', syncPlay)
    mainVideo.addEventListener('pause', syncPlay)
    mainVideo.addEventListener('seeking', syncTime)
    mainVideo.addEventListener('seeked', syncTime)
    mainVideo.addEventListener('ratechange', syncRate)

    return () => {
      mainVideo.removeEventListener('play', syncPlay)
      mainVideo.removeEventListener('pause', syncPlay)
      mainVideo.removeEventListener('seeking', syncTime)
      mainVideo.removeEventListener('seeked', syncTime)
      mainVideo.removeEventListener('ratechange', syncRate)
      grungeVideo.removeEventListener('loadedmetadata', syncTime)
    }
  }, [Boolean(videoOverlayEffect), videoRef, activeVideoSrc])

  // Color-keyed assets use a transparent canvas, never CSS screen blending.
  useEffect(() => {
    const canvas = keyedCanvasRef.current
    const video = grungeVideoRef.current
    const context = canvas?.getContext('2d', { willReadFrequently: true })
    if (!canvas || !context || !video || !chromaKey) return
    let callbackId = 0
    let disposed = false
    context.clearRect(0, 0, canvas.width, canvas.height)
    const paint = () => {
      if (disposed || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return
      const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight)
      const w = video.videoWidth * scale, h = video.videoHeight * scale
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
      const frame = context.getImageData(0, 0, canvas.width, canvas.height)
      applyOverlayChromaKey(frame.data, chromaKey)
      context.putImageData(frame, 0, 0)
    }
    const onFrame = () => {
      if (disposed) return
      paint()
      callbackId = video.requestVideoFrameCallback(onFrame)
    }
    const events = ['loadeddata', 'seeked', 'pause', 'ended'] as const
    for (const event of events) video.addEventListener(event, paint)
    paint()
    callbackId = video.requestVideoFrameCallback(onFrame)
    return () => {
      disposed = true
      video.cancelVideoFrameCallback(callbackId)
      for (const event of events) video.removeEventListener(event, paint)
    }
  }, [chromaKey, activeVideoSrc, width, height])

  // Procedural canvas effects (grain, dust, analog)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !hasProcedural) {
      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    const video = videoRef?.current
    const noiseCanvas = document.createElement('canvas')
    noiseCanvas.width = canvas.width
    noiseCanvas.height = canvas.height
    const noiseContext = noiseCanvas.getContext('2d')
    let callbackId = 0
    let disposed = false
    const paint = () => {
      const w = canvas.width
      const h = canvas.height
      const frame = Math.floor((video?.currentTime || 0) * 24)
      let seed = (frame + 1) * 731
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0
        return (seed >>> 0) / 4294967296
      }
      context.clearRect(0, 0, w, h)
      for (const effect of effects) {
        if (effect.kind === 'film_grunge' || effect.kind === 'custom_overlay') continue
        const strength = effect.intensity / 100
        if (effect.kind === 'dust') {
          context.fillStyle = `rgba(255,250,235,${strength * 0.85})`
          for (let i = 0; i < Math.max(5, (w * h) / 3000); i++) {
            const x = random() * w
            const y = random() * h
            context.beginPath()
            context.ellipse(x, y, 0.6 + random(), 0.6 + random() * 1.8, random() * 3, 0, Math.PI * 2)
            context.fill()
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
  }, [effects, hasProcedural, videoRef, source, width, height])

  if (!effects.length) return null
  const scale = Math.min(1, 640 / Math.max(1, width, height))

  return (
    <>
      {hasProcedural && (
        <canvas
          ref={canvasRef}
          className="video-effects-preview"
          aria-hidden="true"
          width={Math.max(1, Math.round(width * scale))}
          height={Math.max(1, Math.round(height * scale))}
        />
      )}
      {videoOverlayEffect && activeVideoSrc && (
        <video
          ref={grungeVideoRef}
          src={activeVideoSrc}
          autoPlay={!videoRef}
          loop
          muted
          playsInline
          crossOrigin={chromaKey || legacyPath ? 'anonymous' : undefined}
          className="video-effects-preview video-effects-grunge-layer"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            mixBlendMode: videoOverlayEffect.blendMode === 'multiply' ? 'multiply' : 'screen',
            opacity: chromaKey || resolvingKey ? 0 : (videoOverlayEffect.blendMode === 'multiply' ? 1 : videoOverlayEffect.intensity / 100),
            filter: videoOverlayEffect.blendMode === 'multiply'
              ? `contrast(${(0.5 + (videoOverlayEffect.intensity / 100) * 0.5).toFixed(3)}) brightness(${(1.08 + (1 - videoOverlayEffect.intensity / 100) * 0.4).toFixed(3)})`
              : undefined,
            pointerEvents: 'none',
            zIndex: 4
          }}
          aria-hidden="true"
        />
      )}
      {chromaKey && activeVideoSrc && <canvas
        ref={keyedCanvasRef}
        className="video-effects-preview video-effects-keyed-layer"
        width={Math.max(1, Math.round(width * scale))}
        height={Math.max(1, Math.round(height * scale))}
        style={{ opacity: (videoOverlayEffect?.intensity || 0) / 100 }}
        aria-hidden="true"
      />}
    </>
  )
}
