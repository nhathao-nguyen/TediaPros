import React, { useEffect, useRef, useState } from 'react'
import type { AutoShortOverlayMaskType, AutoShortOverlays } from '../../../shared/autoShortOverlays'
import { localMediaSource } from '../lib/localMedia'
import './AutoShortOverlayControl.css'

interface NumberSliderProps {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  chips?: Array<{ label: string; val: number }>
  onChange: (val: number) => void
  onReset?: () => void
}

function NumberSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '%',
  chips,
  onChange,
  onReset
}: NumberSliderProps) {
  const displayVal = Math.round(value)
  return (
    <div className="autoshort-overlay-slider-row">
      <div className="autoshort-overlay-slider-head">
        <span>{label}</span>
        <div className="autoshort-overlay-val-box">
          <input
            type="number"
            className="autoshort-overlay-num-input"
            min={min}
            max={max}
            step={step}
            value={displayVal}
            onChange={(e) => {
              const num = Number(e.target.value)
              if (!Number.isNaN(num)) onChange(Math.max(min, Math.min(max, num)))
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--muted, #796e62)' }}>{unit}</span>
          {onReset && (
            <button
              type="button"
              className="autoshort-overlay-reset-btn"
              onClick={onReset}
              title="Đặt lại mặc định"
            >
              ↺
            </button>
          )}
        </div>
      </div>
      <div className="autoshort-overlay-slider-bar">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={displayVal}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
      {chips && chips.length > 0 && (
        <div className="autoshort-overlay-chips">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              className="autoshort-overlay-chip"
              onClick={() => onChange(c.val)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface AutoShortOverlayControlProps {
  value: AutoShortOverlays
  onChange: (value: AutoShortOverlays) => void
  disabled: boolean
  configError?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function AutoShortOverlayControl({
  value,
  onChange,
  disabled,
  configError,
  open: controlledOpen,
  onOpenChange
}: AutoShortOverlayControlProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next)
    else setInternalOpen(next)
  }

  const [error, setError] = useState('')
  const [choosing, setChoosing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const live = useRef({ value, disabled })
  live.current = { value, disabled }
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent) => {
      // Don't close if clicking canvas gizmo or inside panel
      const target = event.target as HTMLElement
      if (root.current?.contains(target) || target.closest('.autoshort-overlay-preview') || target.closest('.autoshort-overlay-gizmo')) {
        return
      }
      setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  async function chooseImage() {
    setChoosing(true)
    setError('')
    try {
      const result = await window.api.autoShortChooseOverlayImage()
      if (!mounted.current || live.current.disabled) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.asset) {
        onChange({
          ...live.current.value,
          image: {
            x: 0.5,
            y: 0.5,
            width: 0.25,
            opacity: 1,
            rotation: 0,
            feather: 0,
            cornerRadius: 0,
            maskType: 'none',
            ...live.current.value.image,
            ...result.asset
          }
        })
      }
    } catch {
      if (mounted.current) setError('Không thể mở ảnh. Hãy thử chọn lại.')
    } finally {
      if (mounted.current) setChoosing(false)
    }
  }

  const image = value.image
  const text = value.text

  const setMaskType = (maskType: AutoShortOverlayMaskType) => {
    if (!image) return
    onChange({
      ...value,
      image: {
        ...image,
        maskType
      }
    })
  }

  const quickAlign = (x: number, y: number) => {
    if (!image) return
    onChange({
      ...value,
      image: {
        ...image,
        x,
        y
      }
    })
  }

  return (
    <div ref={root} className="autoshort-overlay-control">
      <button
        ref={trigger}
        className={`btn sm ${image || text ? 'primary' : 'ghost'}`}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(!open)}
        title="Chỉnh sửa ảnh logo và chữ xuyên suốt video"
      >
        Ảnh / Chữ{image || text ? ' ✓' : ''}
      </button>

      {open && (
        <div className="autoshort-overlay-panel" role="dialog" aria-label="Chỉnh sửa ảnh và chữ xuyên suốt">
          {/* Header */}
          <div className="autoshort-overlay-heading">
            <strong>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              Chỉnh Sửa Ảnh / Logo
            </strong>
            <button
              className="btn sm ghost"
              type="button"
              aria-label="Đóng bảng"
              onClick={() => {
                setOpen(false)
                trigger.current?.focus()
              }}
            >
              ✕
            </button>
          </div>

          <div className="autoshort-overlay-subtitle">
            Kéo thả, xoay và làm mờ viền trực tiếp trên màn hình xem trước giống CapCut.
          </div>

          {(error || configError) && (
            <p role="alert" style={{ color: '#ef4444', fontSize: 12, margin: '8px 0' }}>
              {error || configError}
            </p>
          )}

          {/* Section 1: Image / Logo */}
          <div className="autoshort-overlay-section">
            <div className="autoshort-overlay-section-head">
              <span className="autoshort-overlay-section-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Tệp Ảnh / Logo
              </span>
            </div>

            {!image ? (
              <div className="autoshort-overlay-empty-drop" onClick={() => void chooseImage()}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <div>
                  <button className="btn sm primary" type="button" disabled={disabled || choosing}>
                    {choosing ? 'Đang mở…' : 'Chọn ảnh PNG / JPG'}
                  </button>
                  <p className="small" style={{ color: 'var(--muted, #796e62)', marginTop: 6 }}>
                    Hỗ trợ PNG trong suốt, JPG dung lượng tối đa 20MB
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Image Info Card */}
                <div className="autoshort-overlay-card">
                  <div className="autoshort-overlay-thumb-box">
                    <img src={localMediaSource(image.path)} alt="Thumbnail" />
                  </div>
                  <div className="autoshort-overlay-card-meta">
                    <div className="autoshort-overlay-card-name" title={image.path}>
                      {image.path.split(/[\\/]/).at(-1)}
                    </div>
                    <div className="autoshort-overlay-card-actions">
                      <button
                        className="btn xs ghost"
                        type="button"
                        onClick={() => void chooseImage()}
                        disabled={disabled || choosing}
                      >
                        Đổi ảnh
                      </button>
                      <button
                        className="btn xs ghost"
                        type="button"
                        style={{ color: 'var(--fail, #d14444)' }}
                        onClick={() => onChange({ ...value, image: undefined })}
                        disabled={disabled}
                      >
                        Bỏ ảnh
                      </button>
                    </div>
                  </div>
                </div>

                {/* Mask & Feather Section */}
                <div style={{ marginTop: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text, #2c251e)', marginBottom: 6 }}>
                    KIỂU MẶT NẠ & MỜ VIỀN (FEATHER)
                  </div>
                  <div className="autoshort-overlay-mask-selector">
                    <button
                      type="button"
                      className={`autoshort-overlay-mask-btn${image.maskType === 'none' && !image.feather ? ' active' : ''}`}
                      onClick={() => {
                        setMaskType('none')
                        onChange({ ...value, image: { ...image, maskType: 'none', feather: 0 } })
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Không mờ
                    </button>

                    <button
                      type="button"
                      className={`autoshort-overlay-mask-btn${image.maskType === 'rect' || (image.feather && image.maskType !== 'circle') ? ' active' : ''}`}
                      onClick={() => setMaskType('rect')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                      </svg>
                      Chữ nhật
                    </button>

                    <button
                      type="button"
                      className={`autoshort-overlay-mask-btn${image.maskType === 'circle' ? ' active' : ''}`}
                      onClick={() => setMaskType('circle')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="8" />
                      </svg>
                      Hình tròn
                    </button>
                  </div>

                  {/* Feather Slider */}
                  <NumberSlider
                    label="Làm mờ viền (Vũ hóa)"
                    value={(image.feather || 0) * 100}
                    min={0}
                    max={50}
                    step={1}
                    unit="%"
                    chips={[
                      { label: '0%', val: 0 },
                      { label: '10%', val: 10 },
                      { label: '25%', val: 25 },
                      { label: '40%', val: 40 }
                    ]}
                    onChange={(pct) =>
                      onChange({
                        ...value,
                        image: {
                          ...image,
                          feather: pct / 100,
                          maskType: image.maskType === 'circle' ? 'circle' : 'rect'
                        }
                      })
                    }
                    onReset={() => onChange({ ...value, image: { ...image, feather: 0 } })}
                  />

                  {/* Corner Radius Slider (for Rect) */}
                  {image.maskType !== 'circle' && (
                    <NumberSlider
                      label="Bo tròn góc"
                      value={(image.cornerRadius || 0) * 100}
                      min={0}
                      max={50}
                      step={1}
                      unit="%"
                      chips={[
                        { label: '0%', val: 0 },
                        { label: '15%', val: 15 },
                        { label: '30%', val: 30 }
                      ]}
                      onChange={(pct) =>
                        onChange({
                          ...value,
                          image: {
                            ...image,
                            cornerRadius: pct / 100
                          }
                        })
                      }
                      onReset={() => onChange({ ...value, image: { ...image, cornerRadius: 0 } })}
                    />
                  )}
                </div>

                {/* Transform & Alignment Section */}
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border, #e0d7c7)' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text, #2c251e)', marginBottom: 6 }}>
                    CĂN CHỈNH NHANH VÀ VỊ TRÍ
                  </div>

                  {/* Quick align grid */}
                  <div className="autoshort-overlay-align-grid">
                    <button
                      type="button"
                      className="autoshort-overlay-align-btn"
                      onClick={() => quickAlign(0.05, 0.05)}
                      title="Góc trên - trái"
                    >
                      ↖
                    </button>
                    <button
                      type="button"
                      className="autoshort-overlay-align-btn"
                      onClick={() => quickAlign(0.5, 0.05)}
                      title="Phía trên - giữa"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="autoshort-overlay-align-btn"
                      onClick={() => quickAlign(0.95, 0.05)}
                      title="Góc trên - phải"
                    >
                      ↗
                    </button>
                    <button
                      type="button"
                      className="autoshort-overlay-align-btn"
                      onClick={() => quickAlign(0.5, 0.5)}
                      title="Chính giữa video"
                    >
                      ⌖
                    </button>
                    <button
                      type="button"
                      className="autoshort-overlay-align-btn"
                      onClick={() => quickAlign(0.95, 0.95)}
                      title="Góc dưới - phải"
                    >
                      ↘
                    </button>
                  </div>

                  <NumberSlider
                    label="Vị trí Ngang (X)"
                    value={image.x * 100}
                    min={0}
                    max={100}
                    unit="%"
                    chips={[
                      { label: 'Trái (5%)', val: 5 },
                      { label: 'Giữa (50%)', val: 50 },
                      { label: 'Phải (95%)', val: 95 }
                    ]}
                    onChange={(x) => onChange({ ...value, image: { ...image, x: x / 100 } })}
                    onReset={() => onChange({ ...value, image: { ...image, x: 0.5 } })}
                  />

                  <NumberSlider
                    label="Vị trí Dọc (Y)"
                    value={image.y * 100}
                    min={0}
                    max={100}
                    unit="%"
                    chips={[
                      { label: 'Trên (5%)', val: 5 },
                      { label: 'Giữa (50%)', val: 50 },
                      { label: 'Dưới (95%)', val: 95 }
                    ]}
                    onChange={(y) => onChange({ ...value, image: { ...image, y: y / 100 } })}
                    onReset={() => onChange({ ...value, image: { ...image, y: 0.5 } })}
                  />

                  <NumberSlider
                    label="Kích thước (Rộng)"
                    value={image.width * 100}
                    min={2}
                    max={100}
                    unit="%"
                    chips={[
                      { label: '15%', val: 15 },
                      { label: '25%', val: 25 },
                      { label: '50%', val: 50 },
                      { label: '80%', val: 80 }
                    ]}
                    onChange={(width) => onChange({ ...value, image: { ...image, width: width / 100 } })}
                    onReset={() => onChange({ ...value, image: { ...image, width: 0.25 } })}
                  />

                  <NumberSlider
                    label="Góc xoay"
                    value={image.rotation || 0}
                    min={-180}
                    max={180}
                    step={1}
                    unit="°"
                    chips={[
                      { label: '-90°', val: -90 },
                      { label: '0°', val: 0 },
                      { label: '45°', val: 45 },
                      { label: '90°', val: 90 }
                    ]}
                    onChange={(rotation) => onChange({ ...value, image: { ...image, rotation } })}
                    onReset={() => onChange({ ...value, image: { ...image, rotation: 0 } })}
                  />

                  <NumberSlider
                    label="Độ đậm (Độ mờ)"
                    value={image.opacity * 100}
                    min={5}
                    max={100}
                    unit="%"
                    chips={[
                      { label: '30%', val: 30 },
                      { label: '60%', val: 60 },
                      { label: '100%', val: 100 }
                    ]}
                    onChange={(opacity) => onChange({ ...value, image: { ...image, opacity: opacity / 100 } })}
                    onReset={() => onChange({ ...value, image: { ...image, opacity: 1 } })}
                  />
                </div>

                <div className="autoshort-overlay-hint">
                  💡 <strong>Kéo thả trên màn hình:</strong> Bấm và rê chuột trên ảnh xem trước để đặt vị trí chính xác, kéo 4 góc để đổi kích thước, núm tròn trên đầu để xoay và nút tròn tím bên cạnh để làm mờ viền.
                </div>
              </>
            )}
          </div>

          {/* Section 2: Fixed Text Overlay */}
          <div className="autoshort-overlay-section">
            <div className="autoshort-overlay-section-head">
              <span className="autoshort-overlay-section-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="4 7 4 4 20 4 20 7" />
                  <line x1="9" y1="20" x2="15" y2="20" />
                  <line x1="12" y1="4" x2="12" y2="20" />
                </svg>
                Chữ Cố Định Xuyên Suốt
              </span>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={Boolean(text)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    text: e.target.checked
                      ? { value: 'Tên kênh', x: 0.5, y: 0.05, size: 0.035, color: '#ffffff', opacity: 1 }
                      : undefined
                  })
                }
              />
              Bật chữ cố định (Tên kênh, watermark)
            </label>

            {text && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, color: 'var(--muted, #796e62)' }}>
                  Nội dung chữ
                  <input
                    type="text"
                    maxLength={120}
                    className="autoshort-overlay-text-input"
                    value={text.value}
                    placeholder="Nhập tên kênh hoặc dòng chữ…"
                    onChange={(e) => onChange({ ...value, text: { ...text, value: e.target.value } })}
                  />
                </label>
                {!text.value.trim() && (
                  <p role="alert" style={{ color: 'var(--fail, #d14444)', fontSize: 11, marginTop: 4 }}>
                    Nhập nội dung hoặc tắt chữ trước khi chạy.
                  </p>
                )}

                <div style={{ marginTop: 10 }}>
                  <NumberSlider
                    label="Vị trí Ngang (X)"
                    value={text.x * 100}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={(x) => onChange({ ...value, text: { ...text, x: x / 100 } })}
                  />
                  <NumberSlider
                    label="Vị trí Dọc (Y)"
                    value={text.y * 100}
                    min={0}
                    max={100}
                    unit="%"
                    onChange={(y) => onChange({ ...value, text: { ...text, y: y / 100 } })}
                  />
                  <NumberSlider
                    label="Cỡ chữ"
                    value={text.size * 100}
                    min={1}
                    max={12}
                    unit="%"
                    onChange={(size) => onChange({ ...value, text: { ...text, size: size / 100 } })}
                  />
                  <NumberSlider
                    label="Độ đậm"
                    value={text.opacity * 100}
                    min={5}
                    max={100}
                    unit="%"
                    onChange={(opacity) => onChange({ ...value, text: { ...text, opacity: opacity / 100 } })}
                  />

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <span style={{ fontSize: 11.5, color: 'var(--text, #2c251e)', fontWeight: 600 }}>Màu chữ</span>
                    <input
                      type="color"
                      value={text.color}
                      style={{ width: 36, height: 24, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
                      onChange={(e) => onChange({ ...value, text: { ...text, color: e.target.value } })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <button
              type="button"
              className="btn sm ghost"
              disabled={disabled}
              onClick={() => {
                onChange({})
                setError('')
              }}
            >
              Bỏ toàn bộ ảnh/chữ
            </button>
            <button
              type="button"
              className="btn sm primary"
              onClick={() => setOpen(false)}
            >
              Hoàn tất
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
