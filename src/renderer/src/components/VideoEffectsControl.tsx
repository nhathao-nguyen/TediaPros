import { useEffect, useRef, useState } from 'react'
import { VIDEO_EFFECT_PRESETS, type VideoEffect, type VideoEffectKind } from '../../../shared/videoEffects'
import VideoEffectsPreview from './VideoEffectsPreview'
import './VideoEffectsControl.css'

export default function VideoEffectsControl({ value, onChange, disabled, configError }: {
  value: VideoEffect[]; onChange: (value: VideoEffect[]) => void; disabled: boolean; configError?: string
}) {
  const [open, setOpen] = useState(false)
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
  const toggle = (kind: VideoEffectKind, intensity: number) => {
    onChange(value.some(effect => effect.kind === kind) ? value.filter(effect => effect.kind !== kind) : [...value, { kind, intensity }])
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
      <p className="muted small">Chọn một hoặc nhiều lớp. Áp dụng xuyên suốt cho mọi video trong batch.</p>
      {configError && <p role="alert">{configError}</p>}
      <div className="video-effects-presets">
        {VIDEO_EFFECT_PRESETS.map(preset => <button type="button" key={preset.kind} className="video-effect-card"
          aria-pressed={value.some(effect => effect.kind === preset.kind)} disabled={disabled || Boolean(configError)}
          title={preset.description} onClick={() => toggle(preset.kind, preset.intensity)}>
          <span className={`video-effect-sample video-effect-sample-${preset.kind}`}>
            <span className="video-effect-landscape" />
            <VideoEffectsPreview effects={[{ kind: preset.kind, intensity: 80 }]} width={110} height={80} />
          </span><span>{preset.label}</span>
        </button>)}
      </div>
      {value.map((effect, index) => <fieldset key={effect.kind} disabled={disabled} className="video-effect-layer">
        <legend>{index + 1}. {VIDEO_EFFECT_PRESETS.find(preset => preset.kind === effect.kind)?.label}</legend>
        <label>Cường độ <input type="range" min={1} max={100} step={1} value={effect.intensity}
          aria-label={`Cường độ ${effect.kind}`} onChange={event => onChange(value.map(item => item.kind === effect.kind ? { ...item, intensity: Number(event.target.value) } : item))} />
          <output>{effect.intensity}%</output></label>
        <div className="video-effect-actions">
          <button type="button" className="btn sm ghost" disabled={index === 0} onClick={() => {
            const next = [...value]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next)
          }}>Áp dụng trước</button>
          <button type="button" className="btn sm ghost" onClick={() => onChange(value.filter(item => item.kind !== effect.kind))}>Bỏ lớp</button>
        </div>
      </fieldset>)}
      <p className="muted small">Xem trước mô phỏng gần đúng; mở video đã xuất để xem kết quả đầy đủ. Hiệu ứng phủ cả khung và phụ đề, ảnh/logo và chữ cố định nằm trên cùng.</p>
      <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => onChange([])}>Tắt toàn bộ hiệu ứng</button>
    </div>}
  </div>
}
