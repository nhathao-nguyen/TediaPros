import { useEffect, useMemo, useState } from 'react'
import { overlayImageGeometry, overlayTextGeometry, type AutoShortOverlays } from '../../../shared/autoShortOverlays'
import { localMediaSource } from '../lib/localMedia'
import { automaticSubtitleFontId } from '../../../shared/subtitles'

export default function AutoShortOverlayPreview({ value, width, height, fontFamily, fontId }: {
  value: AutoShortOverlays; width: number; height: number; fontFamily: string; fontId: string
}) {
  const [loaded, setLoaded] = useState<{ path: string; width: number; height: number } | null>(null)
  const [failedPath, setFailedPath] = useState('')
  const [autoFamily, setAutoFamily] = useState('')
  const automaticId = value.text && fontId === 'auto' ? automaticSubtitleFontId(value.text.value) || 'noto-sans' : null
  useEffect(() => {
    setAutoFamily('')
    if (!automaticId) return
    let cancelled = false
    let face: FontFace | undefined
    void window.api.loadBurnFontData(automaticId).then(async data => {
      if (!data || cancelled) return
      face = new FontFace(`overlay-${automaticId}`, data.data)
      await face.load()
      if (cancelled) return
      document.fonts.add(face)
      setAutoFamily(`overlay-${automaticId}`)
    }).catch(() => { if (!cancelled) setAutoFamily('') })
    return () => { cancelled = true; if (face) document.fonts.delete(face) }
  }, [automaticId])
  const effectiveFamily = automaticId ? autoFamily || 'Arial' : fontFamily || 'Arial'
  const textGeometry = useMemo(() => {
    if (!value.text || !width || !height) return null
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return null
    return overlayTextGeometry(width, height, value.text, (text, size) => {
      context.font = `${size}px "${effectiveFamily}"`
      return context.measureText(text).width
    })
  }, [value.text, width, height, effectiveFamily])
  const image = value.image
  const text = value.text
  const imageGeometry = image && loaded?.path === image.path && width > 0 && height > 0
    ? overlayImageGeometry(width, height, loaded.width, loaded.height, image) : null
  return <div className="autoshort-overlay-preview">
    {image && <img key={image.path + image.sha256} src={localMediaSource(image.path)} alt="Ảnh chèn xuyên suốt"
      onLoad={event => { setFailedPath(''); setLoaded({ path: image.path, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }) }}
      onError={() => { setLoaded(null); setFailedPath(image.path) }}
      style={imageGeometry ? { left: imageGeometry.x, top: imageGeometry.y, width: imageGeometry.width,
        height: imageGeometry.height, opacity: image.opacity } : { visibility: 'hidden' }} />}
    {image && failedPath === image.path && <span role="alert" style={{ top: 8, left: 8, background: '#600', color: '#fff', padding: 6 }}>Không đọc được ảnh. Hãy chọn lại.</span>}
    {text && textGeometry && <span style={{ left: textGeometry.x, top: textGeometry.y, fontSize: textGeometry.size,
      fontFamily: effectiveFamily, color: text.color, opacity: text.opacity,
      WebkitTextStroke: `${textGeometry.padding}px #000`, paintOrder: 'stroke fill' }}>{text.value}</span>}
  </div>
}
