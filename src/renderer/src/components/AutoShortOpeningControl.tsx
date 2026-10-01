import type { JSX } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface AutoShortOpeningControlProps {
  zoom: boolean
  flash: boolean
  onChange: (zoom: boolean, flash: boolean) => void
  disabled?: boolean
}

export default function AutoShortOpeningControl({
  zoom,
  flash,
  onChange,
  disabled = false
}: AutoShortOpeningControlProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const isBoth = zoom && flash
  const isAny = zoom || flash

  const label = isBoth
    ? '🎬 Zoom + Chớp'
    : zoom
      ? '🎬 Zoom 1.5s'
      : flash
        ? '🎬 Chớp sáng'
        : '🎬 Mở màn'

  useLayoutEffect(() => {
    if (!open) return
    const placePanel = (): void => {
      const root = rootRef.current
      if (!root) return
      const trigger = root.getBoundingClientRect()
      const width = Math.max(300, Math.min(380, window.innerWidth - 32))
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

  return (
    <div className="autoshort-opening-control" ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={`btn sm ${isAny ? 'primary' : 'ghost'}`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          padding: '4px 10px',
          fontWeight: isAny ? 700 : 500
        }}
        title="Tùy chọn hiệu ứng mở màn (Flash White / Punch-in Zoom) phá vỡ quét trùng lặp 3s đầu"
      >
        <span>{label}</span>
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
            gap: 12
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
                🎬 Hiệu ứng Mở màn (Anti-Bot Hook)
              </div>
              <div className="muted small" style={{ fontSize: 11, marginTop: 2 }}>
                Phá vỡ quét 3s đầu của Meta / YouTube mà không làm đứt mạch truyện
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

          {/* Quick Preset Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
            <button
              type="button"
              className={`btn sm ${isBoth ? 'primary' : 'ghost'}`}
              onClick={() => onChange(true, true)}
              style={{ fontSize: 11, padding: '4px 2px', cursor: 'pointer' }}
            >
              Combo ⭐
            </button>
            <button
              type="button"
              className={`btn sm ${zoom && !flash ? 'primary' : 'ghost'}`}
              onClick={() => onChange(true, false)}
              style={{ fontSize: 11, padding: '4px 2px', cursor: 'pointer' }}
            >
              Chỉ Zoom
            </button>
            <button
              type="button"
              className={`btn sm ${!zoom && flash ? 'primary' : 'ghost'}`}
              onClick={() => onChange(false, true)}
              style={{ fontSize: 11, padding: '4px 2px', cursor: 'pointer' }}
            >
              Chỉ Chớp
            </button>
            <button
              type="button"
              className={`btn sm ${!isAny ? 'primary' : 'ghost'}`}
              onClick={() => onChange(false, false)}
              style={{ fontSize: 11, padding: '4px 2px', cursor: 'pointer' }}
            >
              Tắt
            </button>
          </div>

          {/* Option 1: Punch-in Zoom */}
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 8,
              border: zoom ? '1.5px solid var(--primary)' : '1px solid var(--border)',
              background: zoom ? 'color-mix(in srgb, var(--primary) 10%, var(--panel))' : 'var(--panel-2)',
              cursor: 'pointer',
              userSelect: 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <input
              type="checkbox"
              checked={zoom}
              onChange={(e) => onChange(e.target.checked, flash)}
              style={{ accentColor: 'var(--primary)', marginTop: 2, cursor: 'pointer', width: 16, height: 16 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                🔍 Punch-in Zoom (Phóng to 115% rồi nhả về gốc)
              </div>
              <div className="muted small" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>
                Phóng to 115% ở 0s rồi lùi mượt về 100% trong 1.5s đầu. Giữ nguyên câu chữ 100%, tạo chuyển động camera kịch tính và phá vỡ góc quay gốc.
              </div>
            </div>
          </label>

          {/* Option 2: Flash White */}
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 8,
              border: flash ? '1.5px solid var(--primary)' : '1px solid var(--border)',
              background: flash ? 'color-mix(in srgb, var(--primary) 10%, var(--panel))' : 'var(--panel-2)',
              cursor: 'pointer',
              userSelect: 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <input
              type="checkbox"
              checked={flash}
              onChange={(e) => onChange(zoom, e.target.checked)}
              style={{ accentColor: 'var(--primary)', marginTop: 2, cursor: 'pointer', width: 16, height: 16 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                ⚡ Chớp sáng điện ảnh (Flash White 0.35s)
              </div>
              <div className="muted small" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>
                Chớp sáng trắng camera ở giây 0 rồi mờ dần về video trong 0.35s. Lời kể vẫn nghe rõ 100%, biến đổi toàn bộ ma trận điểm ảnh ban đầu.
              </div>
            </div>
          </label>

          {/* Recommendation Note */}
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
            💡 <b>Khuyên dùng:</b> Bật cả 2 hiệu ứng để tạo thành <i>Combo Mở màn triệu view</i>: vừa chớp mắt giữ chân người xem vừa đánh lừa bot quét toàn diện.
          </div>
        </div>
      )}
    </div>
  )
}
