import type { JSX } from 'react'
import React, { useState, useEffect } from 'react'
import type {
  AutoShortNormalizedRegion,
  AutoShortThumbnailMode,
  AutoShortThumbnailProgress,
  AutoShortThumbnailResult,
  VideoAdjustments
} from '../../../shared/types'
import { localMediaSource } from '../lib/localMedia'

interface AutoShortThumbnailModalProps {
  isOpen: boolean
  onClose: () => void
  videoPath: string | null
  currentTime: number
  outputDir: string
  portraitBlur: boolean
  videoAdjustments?: VideoAdjustments
  ocrRegion?: AutoShortNormalizedRegion | null
  batchAutoThumbnail: boolean
  onChangeBatchAutoThumbnail: (enabled: boolean) => void
  batchThumbnailMode: AutoShortThumbnailMode
  onChangeBatchThumbnailMode: (mode: AutoShortThumbnailMode) => void
  sttnReady?: boolean
}

function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`
}

export function AutoShortThumbnailModal({
  isOpen,
  onClose,
  videoPath,
  currentTime,
  outputDir,
  portraitBlur,
  videoAdjustments,
  batchAutoThumbnail,
  onChangeBatchAutoThumbnail,
  batchThumbnailMode,
  onChangeBatchThumbnailMode,
  sttnReady = true
}: AutoShortThumbnailModalProps): JSX.Element | null {
  const [mode, setMode] = useState<AutoShortThumbnailMode>('current_frame')
  const [capturedTime, setCapturedTime] = useState<number>(currentTime)
  const [cleanSubtitles, setCleanSubtitles] = useState(true)
  const [applyPortraitBlur, setApplyPortraitBlur] = useState(portraitBlur)
  const [isGenerating, setIsGenerating] = useState(false)
  const [progress, setProgress] = useState<AutoShortThumbnailProgress | null>(null)
  const [result, setResult] = useState<AutoShortThumbnailResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setCapturedTime(currentTime)
      setApplyPortraitBlur(portraitBlur)
      setError(null)
    }
  }, [isOpen, currentTime, portraitBlur])

  useEffect(() => {
    return window.api.onAutoShortThumbnailProgress?.((p) => {
      setProgress(p)
    })
  }, [])

  if (!isOpen) return null

  const handleCreateThumbnail = async (): Promise<void> => {
    if (!videoPath) {
      setError('Chưa chọn video để tạo thumbnail.')
      return
    }
    if (!outputDir) {
      setError('Chưa chọn thư mục lưu (ở thanh dưới cùng). Hãy chọn thư mục trước.')
      return
    }

    setIsGenerating(true)
    setError(null)
    setResult(null)
    setProgress({ percent: 5, message: 'Khởi tạo tiến trình tạo thumbnail…' })

    try {
      const res = await window.api.autoShortCreateThumbnail({
        videoPath,
        mode,
        timestampSeconds: mode === 'current_frame' ? capturedTime : 0,
        cleanSubtitles,
        portraitBlur: applyPortraitBlur,
        videoAdjustments,
        ocrRegion: { x0: 0, y0: 0, x1: 1, y1: 1 },
        outputDir
      })

      if (!res.ok) {
        setError(res.error || 'Tạo thumbnail thất bại.')
      } else {
        setResult(res)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra khi tạo thumbnail.')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !isGenerating && onClose()}>
      <div
        className="modal"
        style={{ maxWidth: 580, borderRadius: 12, padding: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-head" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🖼️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Tạo Thumbnail Video Short</h3>
              <small className="muted">Trích xuất frame chất lượng cao và làm sạch phụ đề bằng AI STTN</small>
            </div>
          </div>
          {!isGenerating && (
            <button className="btn ghost sm" type="button" onClick={onClose} style={{ fontSize: 16 }}>
              ✕
            </button>
          )}
        </div>

        {/* Form Body */}
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Chế độ chọn Frame */}
          <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              1. Chế độ chọn khung hình làm Thumbnail
            </label>

            <div style={{ display: 'grid', gap: 10 }}>
              {/* Option 1: Frame hiện tại khi pause */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: mode === 'current_frame' ? 'rgba(var(--primary-rgb, 67, 231, 213), 0.08)' : 'transparent',
                  border: mode === 'current_frame' ? '1px solid var(--primary)' : '1px solid transparent'
                }}
              >
                <input
                  type="radio"
                  name="thumb-mode"
                  value="current_frame"
                  checked={mode === 'current_frame'}
                  onChange={() => setMode('current_frame')}
                  disabled={isGenerating}
                  style={{ marginTop: 3 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <strong>Khung hình hiện tại khi xem trước</strong>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        color: 'var(--primary)',
                        background: 'rgba(0,0,0,0.25)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12
                      }}
                    >
                      ⏱ {formatTimecode(capturedTime)}
                    </span>
                  </div>
                  <small className="muted" style={{ display: 'block', marginTop: 2 }}>
                    Lấy chính xác frame video tại thời điểm bạn vừa tạm dừng ở trình phát.
                  </small>
                  {mode === 'current_frame' && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setCapturedTime(currentTime)}
                      disabled={isGenerating}
                      style={{ marginTop: 6, fontSize: 11, padding: '2px 8px' }}
                      title="Lấy vị trí hiện tại của video player"
                    >
                      🔄 Cập nhật theo vị trí player ({formatTimecode(currentTime)})
                    </button>
                  )}
                </div>
              </label>

              {/* Option 2: Frame đầu tiên */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: mode === 'first_frame' ? 'rgba(var(--primary-rgb, 67, 231, 213), 0.08)' : 'transparent',
                  border: mode === 'first_frame' ? '1px solid var(--primary)' : '1px solid transparent'
                }}
              >
                <input
                  type="radio"
                  name="thumb-mode"
                  value="first_frame"
                  checked={mode === 'first_frame'}
                  onChange={() => setMode('first_frame')}
                  disabled={isGenerating}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong>Khung hình đầu tiên của video</strong>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        color: 'var(--text)',
                        background: 'rgba(0,0,0,0.25)',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 12
                      }}
                    >
                      ⏱ 00:00.0
                    </span>
                  </div>
                  <small className="muted" style={{ display: 'block', marginTop: 2 }}>
                    Tự động lấy frame bắt đầu (frame 0) của video short làm ảnh bìa.
                  </small>
                </div>
              </label>
            </div>
          </div>

          {/* Tùy chọn làm sạch & căn chỉnh */}
          <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
              2. Xử lý & Làm sạch ảnh bìa
            </label>

            <div style={{ display: 'grid', gap: 10 }}>
              {/* STTN Clean Subtitles */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={cleanSubtitles}
                  onChange={(e) => setCleanSubtitles(e.target.checked)}
                  disabled={isGenerating}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <strong>✨ Làm sạch chữ / xóa phụ đề bằng AI (STTN)</strong>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: sttnReady ? 'rgba(74, 222, 128, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: sttnReady ? '#4ade80' : '#ef4444',
                        fontWeight: 600
                      }}
                    >
                      {sttnReady ? 'AI Sẵn sàng' : 'Chưa cài STTN'}
                    </span>
                  </div>
                  <small className="muted" style={{ display: 'block', marginTop: 2 }}>
                    Tự động quét toàn bộ khung hình và dùng AI STTN để xóa sạch tiêu đề, chữ hoặc phụ đề gốc.
                  </small>
                </div>
              </label>

              {/* Portrait blur 9:16 */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={applyPortraitBlur}
                  onChange={(e) => setApplyPortraitBlur(e.target.checked)}
                  disabled={isGenerating}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <strong>📐 Định dạng dọc 9:16 (Nền mờ hai bên)</strong>
                  <small className="muted" style={{ display: 'block', marginTop: 2 }}>
                    Căn giữa video và lấp đầy khoảng trống bằng nền mờ chuẩn 1080×1920 (đồng bộ với video xuất).
                  </small>
                </div>
              </label>

              {/* Batch Queue setting */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={batchAutoThumbnail}
                    onChange={(e) => onChangeBatchAutoThumbnail(e.target.checked)}
                    disabled={isGenerating}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <strong>📦 Tự động tạo thumbnail cho tất cả video khi chạy hàng loạt</strong>
                    <small className="muted" style={{ display: 'block', marginTop: 2 }}>
                      Mỗi video khi render xong sẽ tự động xuất thêm tệp ảnh bìa <code>Thumbnail.jpg</code> theo cấu hình trên.
                    </small>
                    {batchAutoThumbnail && (
                      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="small muted">Chế độ hàng loạt:</span>
                        <select
                          value={batchThumbnailMode}
                          onChange={(e) => onChangeBatchThumbnailMode(e.target.value as AutoShortThumbnailMode)}
                          disabled={isGenerating}
                          style={{
                            padding: '2px 8px',
                            fontSize: 12,
                            background: 'var(--panel)',
                            color: 'var(--text)',
                            border: '1px solid var(--control-border)',
                            borderRadius: 6
                          }}
                        >
                          <option value="first_frame">Frame đầu tiên (00:00)</option>
                          <option value="current_frame">Frame theo bản xem trước</option>
                        </select>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid #ef4444',
                color: '#f87171',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 13
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {/* Progress bar */}
          {isGenerating && progress && (
            <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{progress.message}</span>
                <span>{Math.round(progress.percent)}%</span>
              </div>
              <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 999, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress.percent}%`,
                    background: 'var(--progress-gradient)',
                    transition: 'width 0.2s ease'
                  }}
                />
              </div>
            </div>
          )}

          {/* Result Card */}
          {result && result.ok && (
            <div
              style={{
                background: 'rgba(var(--primary-rgb, 67, 231, 213), 0.06)',
                border: '1px solid var(--primary)',
                borderRadius: 10,
                padding: 14,
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                gap: 14,
                alignItems: 'center'
              }}
            >
              <div
                style={{
                  width: 120,
                  height: 160,
                  borderRadius: 6,
                  overflow: 'hidden',
                  background: '#000',
                  border: '1px solid rgba(255,255,255,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <img
                  src={localMediaSource(result.thumbnailPath)}
                  alt="Thumbnail đã tạo"
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>

              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 14 }}>
                    ✓ Tạo Thumbnail thành công!
                  </span>
                  {result.cleaned ? (
                    <span
                      style={{
                        background: 'rgba(74, 222, 128, 0.15)',
                        color: '#4ade80',
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontWeight: 600
                      }}
                    >
                      ✨ Đã xóa sạch chữ STTN {result.provider ? `(${result.provider.toUpperCase()})` : ''}
                    </span>
                  ) : (
                    <span
                      style={{
                        background: 'rgba(234, 179, 8, 0.15)',
                        color: '#eab308',
                        fontSize: 11,
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontWeight: 600
                      }}
                    >
                      ℹ️ Giữ ảnh gốc (không phát hiện chữ trong vùng quét)
                    </span>
                  )}
                </div>

                <div
                  className="muted small"
                  style={{
                    wordBreak: 'break-all',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    background: 'rgba(0,0,0,0.2)',
                    padding: '4px 8px',
                    borderRadius: 4
                  }}
                >
                  {result.thumbnailPath}
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    className="btn primary sm"
                    type="button"
                    onClick={() => void window.api.openPath(result.thumbnailPath)}
                  >
                    👁️ Mở ảnh
                  </button>
                  <button
                    className="btn ghost sm"
                    type="button"
                    onClick={() => void window.api.showItem(result.thumbnailPath)}
                  >
                    📁 Mở thư mục
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="modal-foot" style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button className="btn ghost" type="button" onClick={onClose} disabled={isGenerating}>
            Đóng
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={() => void handleCreateThumbnail()}
            disabled={isGenerating || !videoPath}
            style={{ fontWeight: 700, padding: '8px 20px' }}
          >
            {isGenerating ? 'Đang tạo thumbnail…' : '⚡ Tạo Thumbnail'}
          </button>
        </div>
      </div>
    </div>
  )
}
