import React, { useEffect, useMemo, useRef, useState } from 'react'
import { overlayImageGeometry, overlayTextGeometry, type AutoShortOverlays } from '../../../shared/autoShortOverlays'
import { localMediaSource } from '../lib/localMedia'
import { automaticSubtitleFontId } from '../../../shared/subtitles'

export interface AutoShortOverlayPreviewProps {
  value: AutoShortOverlays
  onChange?: (value: AutoShortOverlays) => void
  active?: boolean
  onSelect?: () => void
  width: number
  height: number
  fontFamily: string
  fontId: string
  disabled?: boolean
}

type DragMode = 'move' | 'nw' | 'ne' | 'se' | 'sw' | 'n' | 's' | 'e' | 'w' | 'rotate' | 'feather'

interface DragState {
  mode: DragMode
  startX: number
  startY: number
  initialImage: NonNullable<AutoShortOverlays['image']>
  centerX: number
  centerY: number
  initialCenterX: number
  initialCenterY: number
  startRotation: number
  startFeather: number
  startWidth: number
}

export default function AutoShortOverlayPreview({
  value,
  onChange,
  active = false,
  onSelect,
  width,
  height,
  fontFamily,
  fontId,
  disabled = false
}: AutoShortOverlayPreviewProps) {
  const [loaded, setLoaded] = useState<{ path: string; width: number; height: number } | null>(null)
  const [failedPath, setFailedPath] = useState('')
  const [autoFamily, setAutoFamily] = useState('')
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [badgeText, setBadgeText] = useState('')
  const [snapX, setSnapX] = useState(false)
  const [snapY, setSnapY] = useState(false)

  const automaticId = value.text && fontId === 'auto' ? automaticSubtitleFontId(value.text.value) || 'noto-sans' : null

  useEffect(() => {
    setAutoFamily('')
    if (!automaticId) return
    let cancelled = false
    let face: FontFace | undefined
    void window.api.loadBurnFontData(automaticId).then(async data => {
      if (!data || cancelled) return
      face = new FontFace(`overlay-${automaticId}`, data.data, { weight: '100 900' })
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

  const imageGeometry = useMemo(() => {
    return image && loaded?.path === image.path && width > 0 && height > 0
      ? overlayImageGeometry(width, height, loaded.width, loaded.height, image)
      : null
  }, [image, loaded, width, height])

  // Mask & Feather styling
  const feather = image?.feather || 0
  const cornerRadius = image?.cornerRadius || 0
  const maskType = image?.maskType || (feather > 0 || cornerRadius > 0 ? 'rect' : 'none')
  const rotation = image?.rotation || 0

  const maskStyles = useMemo<React.CSSProperties>(() => {
    if (!image || !imageGeometry) return {}
    const styles: React.CSSProperties = {}
    if (maskType === 'circle') {
      styles.borderRadius = '50%'
      if (feather > 0) {
        const stop = Math.max(0, Math.round((1 - feather * 2) * 100))
        styles.WebkitMaskImage = `radial-gradient(ellipse at center, rgba(0,0,0,1) ${stop}%, rgba(0,0,0,0) 100%)`
        styles.maskImage = `radial-gradient(ellipse at center, rgba(0,0,0,1) ${stop}%, rgba(0,0,0,0) 100%)`
      }
    } else if (maskType === 'rect' || feather > 0 || cornerRadius > 0) {
      if (cornerRadius > 0) {
        const crPx = Math.round(Math.min(imageGeometry.width, imageGeometry.height) * cornerRadius)
        styles.borderRadius = `${crPx}px`
      }
      if (feather > 0) {
        const fPxX = Math.max(1, Math.round(imageGeometry.width * feather))
        const fPxY = Math.max(1, Math.round(imageGeometry.height * feather))
        const gx = `linear-gradient(to right, transparent 0, black ${fPxX}px, black calc(100% - ${fPxX}px), transparent 100%)`
        const gy = `linear-gradient(to bottom, transparent 0, black ${fPxY}px, black calc(100% - ${fPxY}px), transparent 100%)`
        styles.WebkitMaskImage = `${gx}, ${gy}`
        styles.WebkitMaskComposite = 'source-in'
        styles.maskImage = `${gx}, ${gy}`
        styles.maskComposite = 'intersect'
      }
    }
    return styles
  }, [image, imageGeometry, maskType, feather, cornerRadius])

  // Dragging / Resizing / Rotating / Feathering logic
  const liveRef = useRef({ value, onChange, image, imageGeometry, width, height, loaded })
  liveRef.current = { value, onChange, image, imageGeometry, width, height, loaded }

  const startDrag = (mode: DragMode) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const currentImage = liveRef.current.image
    const geom = liveRef.current.imageGeometry
    if (!currentImage || !geom || disabled) return

    const targetRect = (e.currentTarget as HTMLElement).closest('.autoshort-overlay-gizmo')?.getBoundingClientRect()
    const centerX = targetRect ? targetRect.left + targetRect.width / 2 : e.clientX
    const centerY = targetRect ? targetRect.top + targetRect.height / 2 : e.clientY

    setDragState({
      mode,
      startX: e.clientX,
      startY: e.clientY,
      initialImage: { ...currentImage },
      centerX,
      centerY,
      initialCenterX: geom.centerX,
      initialCenterY: geom.centerY,
      startRotation: currentImage.rotation || 0,
      startFeather: currentImage.feather || 0,
      startWidth: currentImage.width
    })
  }

  useEffect(() => {
    if (!dragState) return

    const onMouseMove = (e: MouseEvent) => {
      const { onChange, value, width, height, loaded } = liveRef.current
      if (!onChange) return

      const { mode, startX, startY, initialImage, centerX, centerY, initialCenterX, initialCenterY, startRotation, startFeather, startWidth } = dragState
      const imgNaturalW = loaded?.width || 100
      const imgNaturalH = loaded?.height || 100
      const currentGeom = overlayImageGeometry(width, height, imgNaturalW, imgNaturalH, initialImage)

      if (mode === 'move') {
        const dx = e.clientX - startX
        const dy = e.clientY - startY

        const rotW = currentGeom.rotW || currentGeom.width
        const rotH = currentGeom.rotH || currentGeom.height

        const minCenterX = rotW / 2
        const maxCenterX = Math.max(minCenterX, width - rotW / 2)
        const minCenterY = rotH / 2
        const maxCenterY = Math.max(minCenterY, height - rotH / 2)

        const targetCenterX = initialCenterX + dx
        const targetCenterY = initialCenterY + dy

        const clampedCenterX = Math.max(minCenterX, Math.min(maxCenterX, targetCenterX))
        const clampedCenterY = Math.max(minCenterY, Math.min(maxCenterY, targetCenterY))

        let newX = maxCenterX > minCenterX ? (clampedCenterX - minCenterX) / (maxCenterX - minCenterX) : 0.5
        let newY = maxCenterY > minCenterY ? (clampedCenterY - minCenterY) / (maxCenterY - minCenterY) : 0.5

        newX = Math.max(0, Math.min(1, newX))
        newY = Math.max(0, Math.min(1, newY))

        // Snap to center
        let isSnapX = false
        let isSnapY = false
        if (Math.abs(newX - 0.5) < 0.025) {
          newX = 0.5
          isSnapX = true
        } else if (newX < 0.015) {
          newX = 0
        } else if (newX > 0.985) {
          newX = 1
        }

        if (Math.abs(newY - 0.5) < 0.025) {
          newY = 0.5
          isSnapY = true
        } else if (newY < 0.015) {
          newY = 0
        } else if (newY > 0.985) {
          newY = 1
        }

        setSnapX(isSnapX)
        setSnapY(isSnapY)
        setBadgeText(`X: ${Math.round(newX * 100)}% · Y: ${Math.round(newY * 100)}%`)

        onChange({
          ...value,
          image: {
            ...initialImage,
            x: Math.round(newX * 1000) / 1000,
            y: Math.round(newY * 1000) / 1000
          }
        })
      } else if (mode === 'rotate') {
        const currentAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI)
        const startAngle = Math.atan2(startY - centerY, startX - centerX) * (180 / Math.PI)
        let angleDiff = currentAngle - startAngle
        let newRotation = Math.round(startRotation + angleDiff)

        while (newRotation > 180) newRotation -= 360
        while (newRotation < -180) newRotation += 360

        // Snap near cardinal angles
        if (Math.abs(newRotation) < 4) newRotation = 0
        else if (Math.abs(newRotation - 45) < 3.5) newRotation = 45
        else if (Math.abs(newRotation + 45) < 3.5) newRotation = -45
        else if (Math.abs(newRotation - 90) < 3.5) newRotation = 90
        else if (Math.abs(newRotation + 90) < 3.5) newRotation = -90
        else if (Math.abs(newRotation - 180) < 3.5 || Math.abs(newRotation + 180) < 3.5) newRotation = 180

        setBadgeText(`Xoay: ${newRotation}°`)
        onChange({
          ...value,
          image: {
            ...initialImage,
            rotation: newRotation
          }
        })
      } else if (mode === 'feather') {
        const dx = (e.clientX - startX) / Math.max(1, currentGeom.width)
        const newFeather = Math.max(0, Math.min(0.5, startFeather + dx))
        const roundedFeather = Math.round(newFeather * 100) / 100
        setBadgeText(`Mờ viền: ${Math.round(roundedFeather * 100)}%`)
        onChange({
          ...value,
          image: {
            ...initialImage,
            feather: roundedFeather,
            maskType: initialImage.maskType === 'circle' ? 'circle' : 'rect'
          }
        })
      } else {
        // Resizing corner/edge handles
        let delta = 0
        if (mode === 'se' || mode === 'e') delta = e.clientX - startX
        else if (mode === 'nw' || mode === 'w') delta = startX - e.clientX
        else if (mode === 's') delta = e.clientY - startY
        else if (mode === 'n') delta = startY - e.clientY
        else if (mode === 'ne') delta = e.clientX - startX
        else if (mode === 'sw') delta = startX - e.clientX

        const newWidthPx = Math.max(width * 0.02, Math.min(width, width * startWidth + delta * 2))
        const newWidthRatio = Math.max(0.02, Math.min(1, newWidthPx / width))

        setBadgeText(`Kích thước: ${Math.round(newWidthRatio * 100)}%`)
        onChange({
          ...value,
          image: {
            ...initialImage,
            width: Math.round(newWidthRatio * 1000) / 1000
          }
        })
      }
    }

    const onMouseUp = () => {
      setDragState(null)
      setBadgeText('')
      setSnapX(false)
      setSnapY(false)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragState])

  return (
    <div className="autoshort-overlay-preview">
      {/* 1. Image Layer */}
      {image && (
        <img
          key={image.path + image.sha256}
          src={localMediaSource(image.path)}
          alt="Ảnh chèn xuyên suốt"
          onLoad={event => {
            setFailedPath('')
            setLoaded({ path: image.path, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
          }}
          onError={() => {
            setLoaded(null)
            setFailedPath(image.path)
          }}
          className="autoshort-overlay-rendered-image"
          style={imageGeometry ? {
            left: imageGeometry.x,
            top: imageGeometry.y,
            width: imageGeometry.width,
            height: imageGeometry.height,
            opacity: image.opacity,
            transform: `rotate(${rotation}deg)`,
            ...maskStyles
          } : { visibility: 'hidden' }}
        />
      )}

      {/* 2. Error warning */}
      {image && failedPath === image.path && (
        <span role="alert" style={{ top: 8, left: 8, background: '#600', color: '#fff', padding: 6, position: 'absolute' }}>
          Không đọc được ảnh. Hãy chọn lại.
        </span>
      )}

      {/* 3. Text Overlay */}
      {text && textGeometry && (
        <span
          className="autoshort-overlay-rendered-text"
          style={{
            left: textGeometry.x,
            top: textGeometry.y,
            fontSize: textGeometry.size,
            fontFamily: effectiveFamily,
            color: text.color,
            opacity: text.opacity,
            WebkitTextStroke: `${textGeometry.padding}px #000`,
            paintOrder: 'stroke fill'
          }}
        >
          {text.value}
        </span>
      )}

      {/* 4. Canvas Interactive Gizmo (CapCut-inspired Bounding Box) */}
      {active && image && imageGeometry && !disabled && (
        <>
          {snapX && <div className="autoshort-overlay-snap-x" style={{ left: '50%' }} />}
          {snapY && <div className="autoshort-overlay-snap-y" style={{ top: '50%' }} />}

          <div
            className={`autoshort-overlay-gizmo${dragState ? ' dragging' : ''}`}
            style={{
              left: imageGeometry.x,
              top: imageGeometry.y,
              width: imageGeometry.width,
              height: imageGeometry.height,
              transform: `rotate(${rotation}deg)`,
              borderRadius: maskType === 'circle' ? '50%' : cornerRadius > 0 ? `${Math.round(Math.min(imageGeometry.width, imageGeometry.height) * cornerRadius)}px` : undefined
            }}
            onMouseDown={startDrag('move')}
          >
            {/* Outline Border */}
            <div
              className="autoshort-overlay-gizmo-border"
              style={{
                borderRadius: maskType === 'circle' ? '50%' : cornerRadius > 0 ? `${Math.round(Math.min(imageGeometry.width, imageGeometry.height) * cornerRadius)}px` : undefined
              }}
            />

            {/* Feather Outer Boundary Guide (Like CapCut in Image 2) */}
            {(feather > 0 || dragState?.mode === 'feather') && (
              <div
                className="autoshort-overlay-feather-boundary"
                style={{
                  inset: `-${Math.max(2, Math.round(Math.min(imageGeometry.width, imageGeometry.height) * feather))}px`,
                  borderRadius: maskType === 'circle' ? '50%' : cornerRadius > 0 ? `${Math.round(Math.min(imageGeometry.width, imageGeometry.height) * cornerRadius) + Math.round(Math.min(imageGeometry.width, imageGeometry.height) * feather)}px` : undefined
                }}
              />
            )}

            {/* Corner Resize Handles */}
            <div className="autoshort-overlay-handle autoshort-overlay-handle-nw" onMouseDown={startDrag('nw')} />
            <div className="autoshort-overlay-handle autoshort-overlay-handle-ne" onMouseDown={startDrag('ne')} />
            <div className="autoshort-overlay-handle autoshort-overlay-handle-se" onMouseDown={startDrag('se')} />
            <div className="autoshort-overlay-handle autoshort-overlay-handle-sw" onMouseDown={startDrag('sw')} />

            {/* Edge Resize Handles */}
            <div className="autoshort-overlay-handle autoshort-overlay-handle-n" onMouseDown={startDrag('n')} />
            <div className="autoshort-overlay-handle autoshort-overlay-handle-s" onMouseDown={startDrag('s')} />
            <div className="autoshort-overlay-handle autoshort-overlay-handle-e" onMouseDown={startDrag('e')} />
            <div className="autoshort-overlay-handle autoshort-overlay-handle-w" onMouseDown={startDrag('w')} />

            {/* Rotation Stem & Knob */}
            <div className="autoshort-overlay-rotate-stem" />
            <div
              className="autoshort-overlay-rotate-handle"
              onMouseDown={startDrag('rotate')}
              title="Kéo để xoay góc ảnh"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85.99 6.57 2.57L21 8" />
                <path d="M21 3v5h-5" />
              </svg>
            </div>

            {/* Feather Handle (CapCut Vũ Hóa Handle) */}
            <div
              className="autoshort-overlay-feather-handle"
              onMouseDown={startDrag('feather')}
              title="Kéo để điều chỉnh làm mờ viền (vũ hóa giống CapCut)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
              </svg>
            </div>

            {/* Live Floating Tooltip Badge */}
            {badgeText && (
              <div className="autoshort-overlay-badge">{badgeText}</div>
            )}
          </div>
        </>
      )}

      {/* 5. Inactive Clickable Hitbox (click to activate overlay editor) */}
      {!active && image && imageGeometry && !disabled && (
        <div
          style={{
            position: 'absolute',
            left: imageGeometry.x,
            top: imageGeometry.y,
            width: imageGeometry.width,
            height: imageGeometry.height,
            transform: `rotate(${rotation}deg)`,
            cursor: 'pointer',
            pointerEvents: 'auto'
          }}
          onClick={(e) => {
            e.stopPropagation()
            onSelect?.()
          }}
          title="Bấm để chỉnh sửa ảnh này"
        />
      )}
    </div>
  )
}
