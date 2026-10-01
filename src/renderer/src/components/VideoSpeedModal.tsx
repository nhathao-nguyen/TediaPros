import type { JSX, DragEvent } from 'react'
import { useState, useEffect } from 'react'
import type { VideoSpeedProgress, VideoSpeedResult } from '../../../shared/types'

export interface VideoSpeedModalProps {
  initialVideoPath?: string | null
  onClose: () => void
  onSuccess?: (outputPath: string) => void
}

const SPEED_PRESETS = [
  { value: 1.05, label: '1.05x', hint: 'Nhẹ nhàng' },
  { value: 1.10, label: '1.10x', hint: 'Khuyên dùng cho Reels/Shorts', popular: true },
  { value: 1.15, label: '1.15x', hint: 'Nhanh hơn' },
  { value: 1.20, label: '1.20x', hint: 'Rất nhanh' },
  { value: 1.25, label: '1.25x', hint: 'Cô đọng' },
  { value: 1.50, label: '1.50x', hint: 'Tua gấp' }
]

const baseName = (path: string): string => path.split(/[\\/]/).pop() || path

export default function VideoSpeedModal({
  initialVideoPath,
  onClose,
  onSuccess
}: VideoSpeedModalProps): JSX.Element {
  const [videoPath, setVideoPath] = useState<string>(initialVideoPath || '')
  const [speed, setSpeed] = useState<number>(1.10)
  const [preservePitch, setPreservePitch] = useState<boolean>(true)
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [progress, setProgress] = useState<number>(0)
  const [progressMsg, setProgressMsg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState<boolean>(false)

  useEffect(() => {
    if (initialVideoPath) {
      setVideoPath(initialVideoPath)
    }
  }, [initialVideoPath])

  useEffect(() => {
    const unsub = window.api.onVideoSpeedProgress((p: VideoSpeedProgress) => {
      setProgress(p.percent)
      if (p.message) setProgressMsg(p.message)
    })
    return () => unsub()
  }, [])

  const handleChooseFile = async (): Promise<void> => {
    try {
      const selected = await window.api.chooseVideo()
      if (selected) {
        setVideoPath(selected)
        setError(null)
        setResultPath(null)
      }
    } catch {
      // ignore
    }
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0]
      if (file.path) {
        setVideoPath(file.path)
        setError(null)
        setResultPath(null)
      }
    }
  }

  const handleStart = async (): Promise<void> => {
    if (!videoPath) {
      setError('Vui lòng chọn video cần tua nhanh.')
      return
    }
    setIsProcessing(true)
    setProgress(0)
    setProgressMsg('Đang khởi động FFmpeg…')
    setError(null)
    setResultPath(null)

    try {
      const res: VideoSpeedResult = await window.api.videoSpeed({
        videoPath,
        speed,
        preservePitch
      })
      if (res.ok && res.outputPath) {
        setResultPath(res.outputPath)
        onSuccess?.(res.outputPath)
      } else {
        setError(res.error || 'Quá trình tua nhanh thất bại.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCancel = async (): Promise<void> => {
    try {
      await window.api.videoSpeedCancel()
    } catch {
      // ignore
    }
    setIsProcessing(false)
    setProgress(0)
  }

  const handleOpenOutput = async (): Promise<void> => {
    if (resultPath) {
      await window.api.openPath(resultPath)
    }
  }

  const handleShowFolder = async (): Promise<void> => {
    if (resultPath) {
      await window.api.showItem(resultPath)
    }
  }

  const timeReductionPercent = Math.round((1 - 1 / speed) * 100)

  return (
    <div className="modal-overlay" onClick={() => !isProcessing && onClose()}>
      <div
        className="modal"
        style={{
          maxWidth: 560,
          width: 'min(560px, 94vw)',
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(44, 37, 30, 0.25)',
          overflow: 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Fixed */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--panel)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>⚡</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                Tua nhanh Video đã xuất
              </h3>
              <div className="muted small" style={{ fontSize: 12, marginTop: 2 }}>
                Tăng tốc độ video (1.1x, 1.15x...) — Giữ nguyên giọng nói & đồng bộ
              </div>
            </div>
          </div>
          {!isProcessing && (
            <button
              className="btn ghost sm"
              type="button"
              onClick={onClose}
              style={{
                fontSize: 14,
                cursor: 'pointer',
                padding: '4px 8px',
                borderRadius: 6,
                lineHeight: 1
              }}
              title="Đóng"
            >
              ✕
            </button>
          )}
        </div>

        {/* Scrollable Body */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '18px 20px',
            display: 'grid',
            gap: 16
          }}
        >
          {/* File Picker / Preview */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 6, color: 'var(--text)' }}>
              1. Video nguồn
            </label>
            {videoPath ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>🎬</span>
                  <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: 'var(--text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                      title={baseName(videoPath)}
                    >
                      {baseName(videoPath)}
                    </div>
                    <div
                      className="muted small"
                      style={{
                        fontSize: 11,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 2
                      }}
                      title={videoPath}
                    >
                      {videoPath}
                    </div>
                  </div>
                </div>
                {!isProcessing && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={handleChooseFile}
                    style={{ flexShrink: 0, whiteSpace: 'nowrap', fontSize: 12, padding: '5px 12px' }}
                  >
                    Đổi video
                  </button>
                )}
              </div>
            ) : (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleChooseFile}
                style={{
                  padding: '22px 16px',
                  textAlign: 'center',
                  border: `2px dashed ${isDragging ? 'var(--primary)' : 'var(--control-border)'}`,
                  background: isDragging ? 'color-mix(in srgb, var(--primary) 8%, var(--panel-2))' : 'var(--panel-2)',
                  borderRadius: 10,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <div style={{ fontSize: 26, marginBottom: 4 }}>📂</div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 3 }}>
                  Kéo thả file video vào đây hoặc bấm để chọn
                </div>
                <small className="muted" style={{ fontSize: 11 }}>Hỗ trợ MP4, MKV, MOV, WEBM,...</small>
              </div>
            )}
          </div>

          {/* Speed Preset Pills */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                2. Chọn tốc độ tua nhanh
              </label>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--primary)',
                  background: 'color-mix(in srgb, var(--primary) 12%, var(--panel-2))',
                  border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
                  padding: '2px 8px',
                  borderRadius: 6
                }}
              >
                {speed.toFixed(2)}x
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              {SPEED_PRESETS.map((p) => {
                const isActive = Math.abs(speed - p.value) < 0.01
                return (
                  <button
                    key={p.value}
                    type="button"
                    disabled={isProcessing}
                    onClick={() => setSpeed(p.value)}
                    style={{
                      padding: '8px 6px',
                      borderRadius: 8,
                      border: isActive
                        ? '1.5px solid var(--primary)'
                        : '1px solid var(--border)',
                      background: isActive
                        ? 'color-mix(in srgb, var(--primary) 12%, var(--panel))'
                        : 'var(--panel-2)',
                      cursor: isProcessing ? 'not-allowed' : 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14, color: isActive ? 'var(--primary)' : 'var(--text)' }}>
                      {p.label}
                    </div>
                    <div className="muted small" style={{ fontSize: 10, marginTop: 2 }}>
                      {p.hint}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Fine-tuning Slider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>0.5x</span>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={speed}
                disabled={isProcessing}
                onChange={(e) => setSpeed(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>2.0x</span>
            </div>
          </div>

          {/* Retention & Pitch Notice */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: 'color-mix(in srgb, var(--primary) 8%, var(--panel-2))',
              border: '1px solid color-mix(in srgb, var(--primary) 22%, var(--border))',
              fontSize: 12,
              lineHeight: 1.5,
              wordBreak: 'break-word',
              overflowWrap: 'break-word'
            }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>
              💡 Lợi ích tua {speed.toFixed(2)}x:
            </div>
            <div className="muted small" style={{ color: 'var(--muted)', wordBreak: 'break-word', overflowWrap: 'break-word' }}>
              {timeReductionPercent > 0
                ? `Thời lượng video rút ngắn ~${timeReductionPercent}%, nhịp thoại dồn dập hấp dẫn hơn và giúp hạn chế thuật toán quét trùng lặp nội dung.`
                : 'Giữ nguyên tốc độ gốc của video.'}
            </div>
          </div>

          {/* Pitch Preservation Toggle */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: isProcessing ? 'not-allowed' : 'pointer',
              fontSize: 13,
              userSelect: 'none',
              color: 'var(--text)'
            }}
          >
            <input
              type="checkbox"
              checked={preservePitch}
              disabled={isProcessing}
              onChange={(e) => setPreservePitch(e.target.checked)}
              style={{ accentColor: 'var(--primary)', cursor: 'pointer', width: 16, height: 16 }}
            />
            <span>
              Giữ nguyên cao độ giọng nói (không bị đổi thành giọng sóc chuột)
            </span>
          </label>

          {/* Error Message */}
          {error && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'color-mix(in srgb, var(--fail) 12%, var(--panel-2))',
                border: '1px solid var(--fail)',
                color: 'var(--fail)',
                fontSize: 12
              }}
            >
              ⚠️ {error}
            </div>
          )}

          {/* Progress Bar when running */}
          {isProcessing && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span className="muted small">{progressMsg || 'Đang xử lý…'}</span>
                <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{progress}%</span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  overflow: 'hidden'
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--progress-gradient, var(--primary))',
                    borderRadius: 3,
                    transition: 'width 0.2s ease'
                  }}
                />
              </div>
            </div>
          )}

          {/* Success State */}
          {resultPath && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 8,
                background: 'color-mix(in srgb, var(--ok) 12%, var(--panel-2))',
                border: '1px solid var(--ok)',
                display: 'grid',
                gap: 8
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ok)', fontWeight: 600, fontSize: 13 }}>
                <span>✅</span>
                <span>Tua nhanh hoàn tất!</span>
              </div>
              <div
                className="muted small"
                style={{
                  fontSize: 11,
                  wordBreak: 'break-all',
                  background: 'var(--panel)',
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--border)'
                }}
              >
                {resultPath}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={handleOpenOutput}
                  style={{ flex: 1, cursor: 'pointer' }}
                >
                  ▶ Xem video
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={handleShowFolder}
                  style={{ flex: 1, cursor: 'pointer' }}
                >
                  📁 Mở thư mục
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Actions - Fixed at bottom */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            background: 'var(--panel)',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 10
          }}
        >
          {isProcessing ? (
            <button
              type="button"
              className="btn danger"
              onClick={handleCancel}
              style={{ cursor: 'pointer' }}
            >
              Hủy tác vụ
            </button>
          ) : resultPath ? (
            <button
              type="button"
              className="btn primary"
              onClick={onClose}
              style={{ cursor: 'pointer' }}
            >
              Đóng
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={onClose}
                style={{ cursor: 'pointer' }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!videoPath}
                onClick={handleStart}
                style={{
                  cursor: !videoPath ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  padding: '8px 20px'
                }}
              >
                🚀 Bắt đầu tua nhanh ({speed.toFixed(2)}x)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
