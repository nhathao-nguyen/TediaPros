import { useEffect, useRef, useState } from 'react'
import type { AutoShortOverlays } from '../../../shared/autoShortOverlays'
import './AutoShortOverlayControl.css'

function PercentControl({ label, value, min = 0, max = 100, onChange }: {
  label: string; value: number; min?: number; max?: number; onChange: (value: number) => void
}) {
  return <label className="autoshort-overlay-slider"><span>{label}</span>
    <input type="range" min={min} max={max} step={1} value={Math.round(value * 100)}
      onChange={event => onChange(Number(event.target.value) / 100)} />
    <output>{Math.round(value * 100)}%</output>
  </label>
}

export default function AutoShortOverlayControl({ value, onChange, disabled, configError }: {
  value: AutoShortOverlays; onChange: (value: AutoShortOverlays) => void; disabled: boolean; configError?: string
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [choosing, setChoosing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const live = useRef({ value, disabled })
  live.current = { value, disabled }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])

  async function chooseImage() {
    setChoosing(true)
    setError('')
    try {
      const result = await window.api.autoShortChooseOverlayImage()
      if (!mounted.current || live.current.disabled) return
      if (!result.ok) { setError(result.error); return }
      if (result.asset) onChange({ ...live.current.value, image: {
        x: 0.95, y: 0.05, width: 0.18, opacity: 1, ...live.current.value.image, ...result.asset
      } })
    } catch { if (mounted.current) setError('Không thể mở ảnh. Hãy thử chọn lại.') }
    finally { if (mounted.current) setChoosing(false) }
  }
  const image = value.image
  const text = value.text
  return <div ref={root} className="autoshort-overlay-control">
    <button ref={trigger} className={`btn sm ${image || text ? 'primary' : 'ghost'}`} type="button"
      disabled={disabled} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      Ảnh / Chữ{image || text ? ' ✓' : ''}
    </button>
    {open && <div className="autoshort-overlay-panel" role="dialog" aria-label="Ảnh và chữ xuyên suốt video">
      <div className="autoshort-overlay-heading"><strong>Ảnh / Chữ xuyên suốt</strong>
        <button className="btn sm ghost" type="button" aria-label="Đóng bảng ảnh và chữ" onClick={() => { setOpen(false); trigger.current?.focus() }}>×</button>
      </div>
      <p className="muted small">Áp dụng cùng ảnh/chữ cho tất cả video. Xem thay đổi ngay trên khung bên trái.</p>
      {(error || configError) && <p role="alert">{error || configError}</p>}
      <fieldset disabled={disabled || choosing}>
        <legend>Ảnh / Logo</legend>
        <button className="btn sm" type="button" onClick={() => void chooseImage()}>{choosing ? 'Đang chọn…' : image ? 'Đổi ảnh' : 'Chọn ảnh PNG / JPG'}</button>
        {image && <>
          <button className="btn sm ghost" type="button" onClick={() => onChange({ ...value, image: undefined })}>Bỏ ảnh</button>
          <div className="muted small autoshort-overlay-filename" title={image.path}>{image.path.split(/[\\/]/).at(-1)}</div>
          <PercentControl label="Ngang" value={image.x} onChange={x => onChange({ ...value, image: { ...image, x } })} />
          <PercentControl label="Dọc" value={image.y} onChange={y => onChange({ ...value, image: { ...image, y } })} />
          <PercentControl label="Rộng tối đa" min={2} value={image.width} onChange={width => onChange({ ...value, image: { ...image, width } })} />
          <PercentControl label="Độ đậm" min={5} value={image.opacity} onChange={opacity => onChange({ ...value, image: { ...image, opacity } })} />
        </>}
        <p className="muted small">PNG giữ nền trong suốt. Ảnh giữ tỷ lệ, cao tối đa 80% khung.</p>
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>Chữ cố định</legend>
        <label><input type="checkbox" checked={Boolean(text)} onChange={event => onChange({ ...value,
          text: event.target.checked ? { value: 'Tên kênh', x: 0.5, y: 0.05, size: 0.035, color: '#ffffff', opacity: 1 } : undefined
        })} /> Bật chữ xuyên suốt</label>
        {text && <>
          <label className="autoshort-overlay-text">Nội dung
            <input type="text" maxLength={120} value={text.value} placeholder="Nhập tên kênh hoặc dòng chữ…"
              onChange={event => onChange({ ...value, text: { ...text, value: event.target.value } })} />
          </label>
          {!text.value.trim() && <p role="alert" className="small">Nhập nội dung hoặc tắt chữ trước khi chạy.</p>}
          <PercentControl label="Ngang" value={text.x} onChange={x => onChange({ ...value, text: { ...text, x } })} />
          <PercentControl label="Dọc" value={text.y} onChange={y => onChange({ ...value, text: { ...text, y } })} />
          <PercentControl label="Cỡ chữ" min={1} max={12} value={text.size} onChange={size => onChange({ ...value, text: { ...text, size } })} />
          <PercentControl label="Độ đậm" min={5} value={text.opacity} onChange={opacity => onChange({ ...value, text: { ...text, opacity } })} />
          <label>Màu chữ <input type="color" value={text.color} onChange={event => onChange({ ...value, text: { ...text, color: event.target.value } })} /></label>
          <p className="muted small">Dùng font đang chọn ở tab Phụ đề, có viền đen. Chữ dài tự thu nhỏ để vừa một dòng; font tự động có thể khác nhẹ khi xuất.</p>
        </>}
      </fieldset>
      <p className="muted small">Ngang: trái → phải. Dọc: trên → dưới. Vị trí tính trên toàn khung xuất, kể cả nền 9:16.</p>
      <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => { onChange({}); setError('') }}>Bỏ toàn bộ ảnh/chữ</button>
    </div>}
  </div>
}
