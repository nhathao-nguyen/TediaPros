import { useEffect, useRef, useState } from 'react'
import {
  VIDEO_EFFECT_PRESETS,
  type VideoEffect,
  type VideoEffectKind,
  type CapCutScannedEffect,
  type SavedOverlayEffect,
  type OverlayBlendMode
} from '../../../shared/videoEffects'
import VideoEffectsPreview from './VideoEffectsPreview'
import './VideoEffectsControl.css'

export default function VideoEffectsControl({ value, onChange, disabled, configError }: {
  value: VideoEffect[]; onChange: (value: VideoEffect[]) => void; disabled: boolean; configError?: string
}) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'presets' | 'capcut' | 'vault'>('presets')
  const [capcutList, setCapcutList] = useState<CapCutScannedEffect[]>([])
  const [savedList, setSavedList] = useState<SavedOverlayEffect[]>([])
  const [scanning, setScanning] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape) }
  }, [open])

  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  // Load saved vault effects on open
  useEffect(() => {
    if (open) {
      window.api?.getSavedOverlayEffects?.().then(list => {
        if (Array.isArray(list)) setSavedList(list)
      }).catch(() => {})
    }
  }, [open])

  const handleScanCapCut = async () => {
    try {
      setScanning(true)
      const scanned = await window.api?.scanCapCutEffects?.()
      if (Array.isArray(scanned)) {
        setCapcutList(scanned)
      }
    } catch (err) {
      console.error('Lỗi quét CapCut:', err)
    } finally {
      setScanning(false)
    }
  }

  const handleSaveToVault = async (effect: CapCutScannedEffect, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      setSavingId(effect.id)
      const res = await window.api?.saveOverlayToVault?.(effect)
      if (res?.ok && res.saved) {
        setSavedList(prev => [res.saved!, ...prev.filter(s => s.id !== effect.id)])
        setCapcutList(prev => prev.map(c => c.id === effect.id ? { ...c, isSaved: true } : c))
      }
    } catch (err) {
      console.error('Lỗi lưu hiệu ứng:', err)
    } finally {
      setSavingId(null)
    }
  }

  const handleDeleteFromVault = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const ok = await window.api?.deleteOverlayFromVault?.(id)
      if (ok) {
        setSavedList(prev => prev.filter(s => s.id !== id))
        setCapcutList(prev => prev.map(c => c.id === id ? { ...c, isSaved: false } : c))
        onChange(value.filter(item => !(item.kind === 'custom_overlay' && item.assetPath?.includes(id))))
      }
    } catch (err) {
      console.error('Lỗi xoá hiệu ứng:', err)
    }
  }

  const togglePreset = (kind: VideoEffectKind, intensity: number) => {
    onChange(value.some(effect => effect.kind === kind) ? value.filter(effect => effect.kind !== kind) : [...value, { kind, intensity }])
  }

  const toggleCustomOverlay = (
    name: string,
    videoPath: string,
    mattePath?: string,
    blendMode: OverlayBlendMode = 'screen',
    sourceType: 'capcut' | 'saved' = 'capcut',
    chromaKey?: VideoEffect['chromaKey']
  ) => {
    const isSelected = value.some(e => e.kind === 'custom_overlay' && e.assetPath === videoPath)
    if (isSelected) {
      onChange(value.filter(e => !(e.kind === 'custom_overlay' && e.assetPath === videoPath)))
    } else {
      if (value.length >= 4) {
        alert('Chỉ hỗ trợ tối đa 4 lớp hiệu ứng cùng lúc.')
        return
      }
      onChange([
        ...value,
        {
          kind: 'custom_overlay',
          intensity: 75,
          assetPath: videoPath,
          mattePath,
          blendMode,
          chromaKey,
          name,
          sourceType
        }
      ])
    }
  }

  const getLayerLabel = (effect: VideoEffect) => {
    if (effect.kind === 'custom_overlay') {
      return effect.name || 'Hiệu ứng video overlay'
    }
    return VIDEO_EFFECT_PRESETS.find(preset => preset.kind === effect.kind)?.label || effect.kind
  }

  return <div ref={root} className="video-effects-control">
    <button ref={trigger} type="button" className={`btn sm ${value.length ? 'primary' : 'ghost'}`} disabled={disabled}
      aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      Hiệu ứng{value.length ? ` · ${value.length}` : ''}
    </button>
    {open && <div className="video-effects-panel" role="dialog" aria-label="Hiệu ứng video">
      <div className="video-effects-heading"><strong>Hiệu ứng video</strong>
        <button type="button" className="btn sm ghost" aria-label="Đóng hiệu ứng" onClick={() => { setOpen(false); trigger.current?.focus() }}>×</button>
      </div>
      <p className="muted small">Tối ưu video với hiệu ứng đồ họa hoặc video overlay CapCut Pro.</p>
      {configError && <p role="alert">{configError}</p>}

      {/* Tabs */}
      <div className="video-effects-tabs">
        <button type="button" className={`video-effects-tab ${activeTab === 'presets' ? 'active' : ''}`}
          onClick={() => setActiveTab('presets')}>
          ✨ Mặc định
        </button>
        <button type="button" className={`video-effects-tab ${activeTab === 'capcut' ? 'active' : ''}`}
          onClick={() => { setActiveTab('capcut'); if (!capcutList.length && !scanning) handleScanCapCut() }}>
          🎬 Từ CapCut {capcutList.length ? `(${capcutList.length})` : ''}
        </button>
        <button type="button" className={`video-effects-tab ${activeTab === 'vault' ? 'active' : ''}`}
          onClick={() => setActiveTab('vault')}>
          💾 Kho đã lưu {savedList.length ? `(${savedList.length})` : ''}
        </button>
      </div>

      {/* Tab: Presets */}
      {activeTab === 'presets' && (
        <div className="video-effects-presets">
          {VIDEO_EFFECT_PRESETS.map(preset => <button type="button" key={preset.kind} className="video-effect-card"
            aria-pressed={value.some(effect => effect.kind === preset.kind)} disabled={disabled || Boolean(configError)}
            title={preset.description} onClick={() => togglePreset(preset.kind, preset.intensity)}>
            <span className={`video-effect-sample video-effect-sample-${preset.kind}`}>
              <span className="video-effect-landscape" />
              <VideoEffectsPreview effects={[{ kind: preset.kind, intensity: 80 }]} width={110} height={80} />
            </span><span>{preset.label}</span>
          </button>)}
        </div>
      )}

      {/* Tab: CapCut Sync */}
      {activeTab === 'capcut' && (
        <div className="video-effects-capcut-section">
          <div className="video-effects-sync-bar">
            <span>{scanning ? '⏳ Đang quét bộ nhớ đệm CapCut…' : `🎬 Tìm thấy ${capcutList.length} hiệu ứng`}</span>
            <button type="button" className="btn sm" disabled={scanning || disabled} onClick={handleScanCapCut}>
              {scanning ? 'Đang quét…' : '🔄 Quét lại'}
            </button>
          </div>

          <div className="video-effects-guide">
            <div className="video-effects-guide-title">📥 Cách thêm hiệu ứng mới từ CapCut</div>
            <ol>
              <li>Mở <strong>CapCut</strong> trên máy tính → vào tab <strong>Hiệu ứng</strong></li>
              <li>Duyệt và <strong>tải về</strong> (⬇) hiệu ứng video bạn muốn (Free hoặc Pro)</li>
              <li>Quay lại đây bấm <strong>🔄 Quét lại</strong> để TediaPros tự nhận diện</li>
              <li>Bấm <strong>💾 Lưu kho</strong> để ghim vĩnh viễn — không sợ CapCut xoá cache</li>
            </ol>
            <div className="video-effects-guide-note">💡 Hiệu ứng Pro cần tài khoản CapCut Pro đã đăng nhập trên máy.</div>
          </div>

          {capcutList.length === 0 && !scanning && (
            <p className="muted small" style={{ textAlign: 'center', padding: '12px 0' }}>
              Chưa tìm thấy hiệu ứng video trong Cache CapCut.<br />
              Làm theo hướng dẫn phía trên để bắt đầu!
            </p>
          )}

          <div className="video-effects-presets">
            {capcutList.map(eff => {
              const isSelected = value.some(item => item.kind === 'custom_overlay' && item.assetPath === eff.videoPath)
              return (
                <div key={eff.id} className="video-effect-card" aria-pressed={isSelected}
                  onClick={() => toggleCustomOverlay(eff.name, eff.videoPath, eff.mattePath, eff.blendMode, 'capcut', eff.chromaKey)}>
                  {eff.isPro && <span className="video-effects-badge-pro">PRO</span>}
                  {eff.aspectRatio === 'portrait' && <span className="video-effects-badge-ratio">9:16 Dọc</span>}
                  <span className="video-effect-sample">
                    <VideoEffectsPreview effects={[{ kind: 'custom_overlay', intensity: 80, assetPath: eff.videoPath, blendMode: eff.blendMode, chromaKey: eff.chromaKey }]} width={110} height={80} />
                  </span>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={eff.name}>
                    {eff.name}
                  </div>
                  <div className="video-effects-card-footer">
                    <span className="muted" style={{ fontSize: '10px' }}>{eff.blendMode === 'chromakey' ? 'Tách nền màu' : (eff.blendMode === 'alphamerge' ? 'Alpha mask' : (eff.blendMode === 'multiply' ? 'Multiply (Tối)' : 'Screen blend'))}</span>
                    <button type="button" className="btn sm ghost video-effects-save-btn" disabled={eff.isSaved || savingId === eff.id}
                      title={eff.isSaved ? 'Đã lưu vĩnh viễn' : 'Lưu vào kho TediaPros'}
                      onClick={(e) => handleSaveToVault(eff, e)}>
                      {eff.isSaved ? '✓ Đã lưu' : (savingId === eff.id ? '…' : '💾 Lưu kho')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tab: Permanent Vault */}
      {activeTab === 'vault' && (
        <div className="video-effects-vault-section">
          {savedList.length === 0 ? (
            <p className="muted small" style={{ textAlign: 'center', padding: '16px 0' }}>
              Kho lưu trữ vĩnh viễn đang trống.<br />
              Chuyển sang tab <strong>Từ CapCut</strong> và bấm <strong>💾 Lưu kho</strong> để ghim hiệu ứng xài mãi mãi!
            </p>
          ) : (
            <div className="video-effects-presets">
              {savedList.map(item => {
                const isSelected = value.some(e => e.kind === 'custom_overlay' && e.assetPath === item.videoPath)
                return (
                  <div key={item.id} className="video-effect-card" aria-pressed={isSelected}
                    onClick={() => toggleCustomOverlay(item.name, item.videoPath, item.mattePath, item.blendMode, 'saved', item.chromaKey)}>
                    {item.isPro && <span className="video-effects-badge-pro">PRO</span>}
                    <span className="video-effect-sample">
                      <VideoEffectsPreview effects={[{ kind: 'custom_overlay', intensity: 80, assetPath: item.videoPath, blendMode: item.blendMode, chromaKey: item.chromaKey }]} width={110} height={80} />
                    </span>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                      {item.name}
                    </div>
                    <div className="video-effects-card-footer">
                      <span className="muted" style={{ fontSize: '10px' }}>Vĩnh viễn</span>
                      <button type="button" className="btn sm ghost video-effects-save-btn" title="Xoá khỏi kho"
                        onClick={(e) => handleDeleteFromVault(item.id, e)}>
                        🗑️
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Active Layer Customization */}
      {value.map((effect, index) => <fieldset key={`${effect.kind}-${effect.assetPath || index}`} disabled={disabled} className="video-effect-layer">
        <legend>{index + 1}. {getLayerLabel(effect)}</legend>
        <label>Cường độ <input type="range" min={1} max={100} step={1} value={effect.intensity}
          aria-label={`Cường độ ${getLayerLabel(effect)}`} onChange={event => onChange(value.map((item, i) => i === index ? { ...item, intensity: Number(event.target.value) } : item))} />
          <output>{effect.intensity}%</output></label>
        <div className="video-effect-actions">
          <button type="button" className="btn sm ghost" disabled={index === 0} onClick={() => {
            const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next)
          }}>Áp dụng trước</button>
          <button type="button" className="btn sm ghost" onClick={() => onChange(value.filter((_, i) => i !== index))}>Bỏ lớp</button>
        </div>
      </fieldset>)}

      <p className="muted small">Xem trước mô phỏng gần đúng; mở video đã xuất để xem kết quả đầy đủ. Hiệu ứng phủ cả khung và phụ đề, ảnh/logo và chữ cố định nằm trên cùng.</p>
      <button type="button" className="btn sm ghost" disabled={disabled || !value.length} onClick={() => onChange([])}>Tắt toàn bộ hiệu ứng</button>
    </div>}
  </div>
}

