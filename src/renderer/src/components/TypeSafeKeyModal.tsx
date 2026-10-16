import { useEffect, useState, type JSX } from 'react'

export function TypeSafeKeyModal({
  open,
  onClose
}: {
  open: boolean
  onClose: () => void
}): JSX.Element | null {
  const [key, setKey] = useState('')
  const [info, setInfo] = useState<{ hasKey: boolean; masked: string }>({ hasKey: false, masked: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const refreshInfo = async (): Promise<void> => {
    try {
      const res = await window.api.typesafeGetInfo()
      setInfo(res)
    } catch {
      // fallback
    }
  }

  useEffect(() => {
    if (open) {
      setKey('')
      setMessage('')
      setError('')
      void refreshInfo()
    }
  }, [open])

  if (!open) return null

  const handleCheck = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const target = key.trim()
      if (!target && !info.hasKey) {
        setError('Vui lòng nhập khóa API để kiểm tra.')
        return
      }
      const res = await window.api.typesafeCheckKey(target || 'saved')
      if (res.ok) {
        setMessage(res.message)
      } else {
        setError(res.message)
      }
    } catch (err: any) {
      setError(`Lỗi kiểm tra: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const target = key.trim()
      if (!target) {
        setError('Khóa API không được để trống.')
        return
      }
      const res = await window.api.typesafeSaveKey(target)
      if (res.ok) {
        setMessage(res.message)
        setKey('')
        await refreshInfo()
      } else {
        setError(res.message)
      }
    } catch (err: any) {
      setError(`Lỗi lưu khóa: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async (): Promise<void> => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await window.api.typesafeClearKey()
      setMessage('Đã xóa khóa TypeSafe Jev API.')
      setKey('')
      await refreshInfo()
    } catch (err: any) {
      setError(`Lỗi: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🧠</span>
            <h3 style={{ margin: 0 }}>Cấu hình TypeSafe Jev AI</h3>
          </div>
          <button className="btn small-btn ghost" disabled={busy} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted, #64748b)' }}>
            <strong>TypeSafe Jev</strong> (Mô hình System One siêu tốc &lt; 50ms) giúp tự động phân xử và chọn chính xác liên kết chương tiếp theo (Next Chapter) khi cào bài từ website truyện/blog có cấu trúc nút bấm phức tạp, nhiều quảng cáo hoặc link mơ hồ.
          </p>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 8,
              background: info.hasKey ? 'rgba(34, 197, 94, 0.08)' : 'rgba(148, 163, 184, 0.08)',
              border: `1px solid ${info.hasKey ? 'rgba(34, 197, 94, 0.3)' : 'rgba(148, 163, 184, 0.2)'}`
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: info.hasKey ? '#22c55e' : '#94a3b8'
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {info.hasKey ? `Đã lưu khóa: ${info.masked}` : 'Chưa cấu hình khóa API (dùng phân tích cục bộ)'}
              </span>
            </div>

            {info.hasKey && (
              <button
                type="button"
                className="btn small-btn danger"
                disabled={busy}
                onClick={() => void handleClear()}
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                Xóa khóa
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="typesafe-api-key-input" style={{ fontSize: 13, fontWeight: 600 }}>
              {info.hasKey ? 'Thay đổi khóa API mới' : 'Nhập khóa TypeSafe API'}
            </label>
            <input
              id="typesafe-api-key-input"
              type="password"
              className="text-input"
              placeholder="apikey_..."
              value={key}
              disabled={busy}
              onChange={(e) => setKey(e.target.value)}
              style={{ padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' }}
            />
            <small style={{ color: 'var(--text-muted, #64748b)', fontSize: 11 }}>
              Khóa hợp lệ luôn bắt đầu bằng tiền tố <code>apikey_</code>.
            </small>
          </div>

          {message && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                color: '#15803d',
                fontSize: 13
              }}
            >
              ✓ {message}
            </div>
          )}

          {error && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#b91c1c',
                fontSize: 13
              }}
            >
              ⚠ {error}
            </div>
          )}
        </div>

        <div
          className="modal-actions"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            borderTop: '1px solid var(--border, #e2e8f0)'
          }}
        >
          <button
            type="button"
            className="btn small-btn"
            disabled={busy || (!key.trim() && !info.hasKey)}
            onClick={() => void handleCheck()}
          >
            {busy ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
          </button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn small-btn" disabled={busy} onClick={onClose}>
              Đóng
            </button>
            <button
              type="button"
              className="btn small-btn primary"
              disabled={busy || !key.trim()}
              onClick={() => void handleSave()}
            >
              Lưu khóa
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
