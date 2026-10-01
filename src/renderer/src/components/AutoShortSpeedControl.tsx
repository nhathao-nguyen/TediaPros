import type { JSX } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface AutoShortSpeedControlProps {
  speed: number
  preservePitch: boolean
  onChange: (speed: number, preservePitch: boolean) => void
  disabled?: boolean
}

const PRESETS = [
  { value: 1.0, label: '1.0x', hint: 'Gốc' },
  { value: 1.05, label: '1.05x', hint: 'Nhẹ' },
  { value: 1.10, label: '1.10x', hint: 'Khuyên dùng Reels/Shorts ⭐' },
  { value: 1.15, label: '1.15x', hint: 'Nhanh' },
  { value: 1.20, label: '1.20x', hint: 'Rất nhanh' }
]

export default function AutoShortSpeedControl({
  speed,
  preservePitch,
  onChange,
  disabled = false
}: AutoShortSpeedControlProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const isCustomSpeed = Math.abs(speed - 1.0) >= 0.01

  useLayoutEffect(() => {
    if (!open) return
    const placePanel = (): void => {
      const root = rootRef.current
      if (!root) return
      const trigger = root.getBoundingClientRect()
      const width = Math.max(280, Math.min(360, window.innerWidth - 32))
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
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const timeReduction = isCustomSpeed ? Math.round((1 - 1 / speed) * 100) : 0

  return (
    <div className="autoshort-speed-control" ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={`btn sm ${isCustomSpeed ? 'primary' : 'ghost'}`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '4px 10px',
          fontWeight: isCustomSpeed ? 700 : 500
        }}
        title="Tự động tua nhanh video hàng loạt khi xuất"
      >
        <span>⚡</span>
        <span>{isCustomSpeed ? `Tua ${speed.toFixed(2)}x` : 'Tốc độ: 1.0x'}</span>
      </button>

      {open && panelPosition && (
        <div
          style={{
            position: 'fixed',
            top: panelPosition.top,
            left: panelPosition.left,
            width: panelPosition.width,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: '0 12px 36px rgba(44, 37, 30, 0.22)',
            padding: '16px 18px',
            zIndex: 120,
            display: 'grid',
            gap: 14
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
                ⚡ Tốc độ xuất video hàng loạt
              </div>
              <div className="muted small" style={{ fontSize: 11, marginTop: 2 }}>
                Tự động tua nhanh tất cả video trong hàng đợi
              </div>
            </div>
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => setOpen(false)}
              style={{ fontSize: 13, padding: '2px 6px', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          {/* Preset Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {PRESETS.map((p) => {
              const active = Math.abs(speed - p.value) < 0.01
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => onChange(p.value, preservePitch)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: 8,
                    border: active ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                    background: active ? 'color-mix(in srgb, var(--primary) 14%, var(--panel))' : 'var(--panel-2)',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, color: active ? 'var(--primary)' : 'var(--text)' }}>
                    {p.label}
                  </div>
                  <div className="muted small" style={{ fontSize: 9, marginTop: 1 }}>
                    {p.hint}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Fine Tuning Slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span className="muted small">Tùy chỉnh:</span>
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{speed.toFixed(2)}x</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>0.5x</span>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={speed}
                onChange={(e) => onChange(Number(e.target.value), preservePitch)}
                style={{ flex: 1, accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>2.0x</span>
            </div>
          </div>

          {/* Pitch Checkbox */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              cursor: 'pointer',
              userSelect: 'none',
              color: 'var(--text)'
            }}
          >
            <input
              type="checkbox"
              checked={preservePitch}
              onChange={(e) => onChange(speed, e.target.checked)}
              style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
            />
            <span>Giữ nguyên tông giọng (không bị biến thành sóc chuột)</span>
          </label>

          {/* Information Tip */}
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--primary) 8%, var(--panel-2))',
              border: '1px solid color-mix(in srgb, var(--primary) 22%, var(--border))',
              fontSize: 11,
              lineHeight: 1.4
            }}
          >
            {isCustomSpeed ? (
              <span>
                💡 <b>Tua {speed.toFixed(2)}x:</b> Giảm ~{timeReduction}% thời lượng, nhịp thoại dồn dập hơn và hạn chế thuật toán quét trùng lặp của Facebook Reels / YouTube Shorts.
              </span>
            ) : (
              <span className="muted">
                💡 Chọn <b>1.10x</b> để xuất video ngắn nhanh hơn, hấp dẫn người xem hơn và tránh bị quét trùng lặp nội dung.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
