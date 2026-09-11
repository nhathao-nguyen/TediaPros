import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { VideoAdjustments } from '../../../shared/types'
import { DEFAULT_VIDEO_ADJUSTMENTS, hasVideoAdjustments } from '../../../shared/videoAdjustments'
import './VideoAdjustmentsControl.css'

const CONTROLS: Array<{
  key: keyof VideoAdjustments
  label: string
  min: number
  max: number
  suffix: string
}> = [
  { key: 'zoom', label: 'Zoom', min: 100, max: 120, suffix: '%' },
  { key: 'brightness', label: 'Độ sáng', min: -20, max: 20, suffix: '' },
  { key: 'saturation', label: 'Độ bão hòa', min: 0, max: 200, suffix: '%' },
  { key: 'contrast', label: 'Tương phản', min: 50, max: 150, suffix: '%' }
]

function draftValues(value: VideoAdjustments): Record<keyof VideoAdjustments, string> {
  return {
    zoom: String(value.zoom),
    brightness: String(value.brightness),
    saturation: String(value.saturation),
    contrast: String(value.contrast)
  }
}

export default function VideoAdjustmentsControl({ value, onChange, disabled = false }: {
  value: VideoAdjustments
  onChange: (value: VideoAdjustments) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [drafts, setDrafts] = useState(() => draftValues(value))
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = hasVideoAdjustments(value)

  useEffect(() => setDrafts(draftValues(value)), [value])

  useLayoutEffect(() => {
    if (!open) return
    const placePanel = (): void => {
      const root = rootRef.current
      if (!root) return
      const trigger = root.getBoundingClientRect()
      const width = Math.max(240, Math.min(360, window.innerWidth - 32))
      setPanelPosition({
        top: trigger.bottom + 8,
        left: Math.max(16, Math.min(trigger.left, window.innerWidth - width - 16)),
        width
      })
    }
    placePanel()
    window.addEventListener('resize', placePanel)
    window.addEventListener('scroll', placePanel, true)
    return () => {
      window.removeEventListener('resize', placePanel)
      window.removeEventListener('scroll', placePanel, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const updateFromRange = (key: keyof VideoAdjustments, raw: string, min: number, max: number): void => {
    if (raw.trim() === '') return
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return
    onChange({ ...value, [key]: Math.max(min, Math.min(max, Math.round(parsed))) })
  }

  const updateDraft = (key: keyof VideoAdjustments, raw: string, min: number, max: number): void => {
    setDrafts((current) => ({ ...current, [key]: raw }))
    if (!/^-?\d+$/.test(raw)) return
    const parsed = Number(raw)
    if (Number.isInteger(parsed) && parsed >= min && parsed <= max) {
      onChange({ ...value, [key]: parsed })
    }
  }

  const commitDraft = (key: keyof VideoAdjustments, min: number, max: number): void => {
    const parsed = Number(drafts[key])
    const next = Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, Math.round(parsed)))
      : value[key]
    setDrafts((current) => ({ ...current, [key]: String(next) }))
    if (next !== value[key]) onChange({ ...value, [key]: next })
  }

  return (
    <div className="video-adjustments-control" ref={rootRef}>
      <button
        type="button"
        className={`btn sm${active ? ' primary' : ' ghost'}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        Chỉnh hình ảnh{active ? ' ✓' : ''}
      </button>
      {open && (
        <div
          className="video-adjustments-panel"
          role="dialog"
          aria-label="Chỉnh hình ảnh khi xuất"
          style={panelPosition || undefined}
        >
          <div className="video-adjustments-title">
            <strong>Chỉnh hình ảnh khi xuất</strong>
            <button type="button" className="btn sm ghost" onClick={() => setOpen(false)} aria-label="Đóng">×</button>
          </div>
          {CONTROLS.map((control) => (
            <label className="video-adjustments-row" key={control.key}>
              <span>{control.label}</span>
              <input
                type="range"
                min={control.min}
                max={control.max}
                step={1}
                value={value[control.key]}
                disabled={disabled}
                onChange={(event) => updateFromRange(control.key, event.target.value, control.min, control.max)}
              />
              <span className="video-adjustments-number">
                <input
                  type="text"
                  inputMode="numeric"
                  value={drafts[control.key]}
                  disabled={disabled}
                  onChange={(event) => updateDraft(control.key, event.target.value, control.min, control.max)}
                  onBlur={() => commitDraft(control.key, control.min, control.max)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') {
                      setDrafts((current) => ({ ...current, [control.key]: String(value[control.key]) }))
                      event.currentTarget.blur()
                    }
                  }}
                />
                {control.suffix}
              </span>
            </label>
          ))}
          <button type="button" className="btn sm ghost" disabled={disabled || !active}
            onClick={() => onChange({ ...DEFAULT_VIDEO_ADJUSTMENTS })}>
            Đặt lại
          </button>
          <div className="muted small">Màu xem trước có thể chênh nhẹ so với video xuất.</div>
        </div>
      )}
    </div>
  )
}
