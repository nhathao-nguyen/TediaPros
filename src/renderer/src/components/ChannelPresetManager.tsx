import type { JSX } from 'react'
import React, { useState, useRef } from 'react'
import type { AutoShortChannelPreset } from '../../../shared/channelPreset'
import {
  createDefaultChannelPreset,
  serializeChannelPresets,
  parseChannelPresets,
  DEFAULT_CHANNEL_PRESET_ID
} from '../../../shared/channelPreset'

export interface ChannelPresetManagerProps {
  isOpen: boolean
  onClose: () => void
  presets: AutoShortChannelPreset[]
  activePresetId: string
  onSelectPreset: (presetId: string) => void
  onUpdatePresets: (presets: AutoShortChannelPreset[], newActiveId?: string) => void
  onSaveCurrentToPreset: (presetId: string) => void
  onCreatePresetFromCurrent: (name: string) => void
}

const TONE_NAMES: Record<string, { label: string; icon: string }> = {
  neutral: { label: 'Trung tính', icon: '⚖️' },
  storytelling: { label: 'Kể chuyện / Drama', icon: '🎭' },
  humorous: { label: 'Hài hước / Hóm hỉnh', icon: '😄' },
  documentary: { label: 'Tài liệu / Phóng sự', icon: '🎙️' },
  custom: { label: 'Tùy chỉnh', icon: '✨' }
}

export function ChannelPresetManager({
  isOpen,
  onClose,
  presets,
  activePresetId,
  onSelectPreset,
  onUpdatePresets,
  onSaveCurrentToPreset,
  onCreatePresetFromCurrent
}: ChannelPresetManagerProps): JSX.Element | null {
  const [newPresetName, setNewPresetName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  if (!isOpen) return null

  const showFeedback = (type: 'success' | 'error', message: string): void => {
    setFeedback({ type, message })
    setTimeout(() => setFeedback(null), 3500)
  }

  const handleCreateNew = (): void => {
    const trimmed = newPresetName.trim()
    if (!trimmed) {
      showFeedback('error', 'Vui lòng nhập tên kênh mới.')
      return
    }
    onCreatePresetFromCurrent(trimmed)
    setNewPresetName('')
    setIsCreating(false)
    showFeedback('success', `Đã tạo kênh "${trimmed}" từ cấu hình hiện tại!`)
  }

  const handleStartRename = (preset: AutoShortChannelPreset): void => {
    setEditingId(preset.id)
    setEditingName(preset.name)
  }

  const handleSaveRename = (id: string): void => {
    const trimmed = editingName.trim()
    if (!trimmed) return
    const updated = presets.map((p) => (p.id === id ? { ...p, name: trimmed, updatedAt: Date.now() } : p))
    onUpdatePresets(updated)
    setEditingId(null)
    showFeedback('success', `Đã đổi tên kênh thành "${trimmed}".`)
  }

  const handleDelete = (id: string, name: string): void => {
    if (presets.length <= 1) {
      showFeedback('error', 'Không thể xóa kênh duy nhất còn lại.')
      return
    }
    if (!window.confirm(`Bạn có chắc chắn muốn xóa preset kênh "${name}"?`)) return

    const updated = presets.filter((p) => p.id !== id)
    const newActiveId = id === activePresetId ? updated[0]?.id || DEFAULT_CHANNEL_PRESET_ID : undefined
    onUpdatePresets(updated, newActiveId)
    showFeedback('success', `Đã xóa kênh "${name}".`)
  }

  const handleExportJson = (): void => {
    try {
      const json = serializeChannelPresets(presets)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tediapros-channel-presets-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      showFeedback('success', 'Đã xuất file JSON thành công!')
    } catch {
      showFeedback('error', 'Lỗi khi xuất file JSON.')
    }
  }

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      const imported = parseChannelPresets(content)
      if (imported.length === 0) {
        showFeedback('error', 'File JSON không chứa cấu hình kênh hợp lệ.')
        return
      }

      // Merge imported with existing by ID, or append
      const existingMap = new Map(presets.map((p) => [p.id, p]))
      for (const p of imported) {
        existingMap.set(p.id, p)
      }
      const merged = Array.from(existingMap.values())
      onUpdatePresets(merged, imported[0]?.id)
      showFeedback('success', `Đã nạp ${imported.length} preset kênh từ file JSON!`)
    } catch {
      showFeedback('error', 'Lỗi đọc file JSON. Vui lòng kiểm tra định dạng.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal-card"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 20px 45px rgba(0,0,0,0.5)',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          className="modal-head"
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>📺</span>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Quản lý Preset Kênh (Channel Presets)</h3>
              <small className="muted" style={{ fontSize: 12 }}>
                Lưu trữ và chuyển đổi nhanh cấu hình giọng đọc, văn phong, phụ đề và SEO theo từng kênh
              </small>
            </div>
          </div>
          <button className="btn ghost sm" type="button" onClick={onClose} style={{ fontSize: 16, padding: '4px 8px' }}>
            ✕
          </button>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div
            style={{
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 500,
              background: feedback.type === 'success' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: feedback.type === 'success' ? '#4ade80' : '#f87171',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <span>{feedback.type === 'success' ? '✓' : '⚠️'}</span>
            <span>{feedback.message}</span>
          </div>
        )}

        {/* Body */}
        <div style={{ padding: '16px 20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Quick Create Bar */}
          <div
            style={{
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '12px 14px'
            }}
          >
            {!isCreating ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Thêm kênh mới</div>
                  <small className="muted" style={{ fontSize: 12 }}>
                    Nhân bản toàn bộ cài đặt hiện tại trên trình biên tập thành một Preset kênh mới
                  </small>
                </div>
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={() => setIsCreating(true)}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  + Thêm kênh từ cấu hình hiện tại
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 600 }}>Tên kênh / Preset mới:</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="VD: Kênh Review Phim Kịch Tính, Kênh Phóng Sự..."
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      fontSize: 13,
                      borderRadius: 6,
                      background: 'var(--bg)',
                      border: '1px solid var(--control-border)',
                      color: 'var(--text)'
                    }}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateNew()
                      if (e.key === 'Escape') setIsCreating(false)
                    }}
                  />
                  <button type="button" className="btn primary sm" onClick={handleCreateNew}>
                    Tạo Preset
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => setIsCreating(false)}>
                    Hủy
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* List of Presets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Danh sách Preset kênh ({presets.length})
            </div>

            {presets.map((preset) => {
              const isActive = preset.id === activePresetId
              const isEditing = editingId === preset.id
              const toneMeta = TONE_NAMES[preset.translationTone] || TONE_NAMES.neutral

              return (
                <div
                  key={preset.id}
                  style={{
                    background: isActive ? 'rgba(var(--primary-rgb, 59, 130, 246), 0.08)' : 'var(--panel-2)',
                    border: isActive ? '1px solid var(--primary)' : '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    transition: 'border-color 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          style={{
                            flex: 1,
                            padding: '4px 8px',
                            fontSize: 13,
                            borderRadius: 4,
                            background: 'var(--bg)',
                            border: '1px solid var(--control-border)',
                            color: 'var(--text)'
                          }}
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(preset.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                        <button
                          type="button"
                          className="btn primary sm"
                          onClick={() => handleSaveRename(preset.id)}
                        >
                          Lưu
                        </button>
                        <button type="button" className="btn ghost sm" onClick={() => setEditingId(null)}>
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{preset.name}</span>
                        {isActive && (
                          <span
                            style={{
                              fontSize: 11,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'var(--primary)',
                              color: '#fff',
                              fontWeight: 600
                            }}
                          >
                            Đang dùng
                          </span>
                        )}
                      </div>
                    )}

                    {!isEditing && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!isActive ? (
                          <button
                            type="button"
                            className="btn primary sm"
                            onClick={() => {
                              onSelectPreset(preset.id)
                              showFeedback('success', `Đã chuyển sang kênh "${preset.name}".`)
                            }}
                            title="Áp dụng cấu hình kênh này vào trình biên tập"
                          >
                            Áp dụng
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => {
                              onSaveCurrentToPreset(preset.id)
                              showFeedback('success', `Đã cập nhật kênh "${preset.name}" với cấu hình hiện tại!`)
                            }}
                            title="Ghi đè cài đặt hiện tại vào kênh này"
                          >
                            💾 Lưu hiện tại vào đây
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => handleStartRename(preset)}
                          title="Đổi tên kênh"
                        >
                          ✏️
                        </button>
                        {presets.length > 1 && (
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={() => handleDelete(preset.id, preset.name)}
                            title="Xóa kênh"
                            style={{ color: '#f87171' }}
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Summary badges */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}
                    >
                      {toneMeta.icon} Văn phong: <b>{toneMeta.label}</b>
                    </span>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}
                    >
                      🎙️ Giọng: <b>{preset.ttsProvider === 'edge-tts' ? (preset.edgeVoice || 'Hoài My') : 'Local'}</b> ({preset.ttsSpeed}x)
                    </span>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}
                    >
                      🎨 Màu chữ: <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: preset.textColor || '#fff', verticalAlign: 'middle', marginRight: 2 }} />
                      <b>{preset.textColor || '#fff'}</b>
                    </span>
                    {preset.channelName && (
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.1)'
                        }}
                      >
                        📺 Kênh SEO: <b>{preset.channelName}</b>
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          className="modal-foot"
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--panel-2)'
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="file"
              ref={fileInputRef}
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => void handleImportJson(e)}
            />
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => fileInputRef.current?.click()}
              title="Nhập danh sách preset từ file JSON"
            >
              📥 Nhập JSON
            </button>
            <button
              type="button"
              className="btn ghost sm"
              onClick={handleExportJson}
              title="Xuất tất cả preset thành file JSON dự phòng"
            >
              📤 Xuất JSON
            </button>
          </div>

          <button type="button" className="btn primary sm" onClick={onClose} style={{ minWidth: 80 }}>
            Hoàn tất
          </button>
        </div>
      </div>
    </div>
  )
}
