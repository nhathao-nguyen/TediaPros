import { useEffect, useRef, useState, type JSX } from 'react'
import type { GeminiKeyInfo, GeminiKeysResult } from '../../../shared/types'

const CHANGED_EVENT = 'tediapros:gemini-keys-changed'

/** Saved credentials never leave main; only masked labels and opaque IDs are read. */
export default function GeminiKeys({ disabled = false, onChanged }: {
  disabled?: boolean
  onChanged: (hasKey: boolean) => void
}): JSX.Element {
  const [keys, setKeys] = useState<GeminiKeyInfo[]>([])
  const [drafts, setDrafts] = useState([''])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [unreadable, setUnreadable] = useState(false)
  const mounted = useRef(true)

  const apply = (result: GeminiKeysResult): boolean => {
    if (!mounted.current) return false
    if (!result.ok) { setError(result.error); return false }
    setKeys(result.keys); onChanged(result.keys.length > 0); setError(''); setUnreadable(false)
    return true
  }

  useEffect(() => {
    mounted.current = true
    let cancelled = false
    const refresh = (): void => {
      void window.api.geminiListKeys().then(result => {
        if (cancelled) return
        if (result.ok) { setKeys(result.keys); onChanged(result.keys.length > 0); setUnreadable(false); setError('') }
        else { setError(result.error); setUnreadable(result.code === 'storage-unreadable') }
      }, () => { if (!cancelled) setError('Không thể đọc danh sách khóa Gemini.') })
    }
    refresh()
    window.addEventListener(CHANGED_EVENT, refresh)
    return () => { cancelled = true; mounted.current = false; window.removeEventListener(CHANGED_EVENT, refresh) }
  }, [onChanged])

  const mutate = async (operation: () => Promise<GeminiKeysResult>, added = false, replaced = false): Promise<void> => {
    setBusy(true); setError(''); setMessage('')
    try {
      if (apply(await operation())) {
        if (added) setDrafts([''])
        setMessage(replaced ? 'Đã thay danh sách lỗi bằng khóa mới.' : added ? 'Đã thêm khóa vào danh sách.' : 'Đã xóa khóa.')
        window.dispatchEvent(new Event(CHANGED_EVENT))
      }
    } catch { if (mounted.current) setError('Không thể cập nhật khóa Gemini.') }
    finally { if (mounted.current) setBusy(false) }
  }

  const check = async (): Promise<void> => {
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await window.api.geminiCheckKey('')
      if (mounted.current) { if (result.ok) setMessage(result.message); else setError(result.message) }
    } catch { if (mounted.current) setError('Không thể kiểm tra kết nối Gemini.') }
    finally { if (mounted.current) setBusy(false) }
  }

  return <div style={{ display: 'grid', gap: 8 }}>
    <strong className="small">Gemini · {keys.length} khóa đã lưu</strong>
    {keys.map(key => <div key={key.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <span className="small">{key.masked}</span>
      <button type="button" className="btn ghost sm" disabled={disabled || busy}
        aria-label={`Xóa ${key.masked}`} onClick={() => void mutate(() => window.api.geminiRemoveKey(key.id))}>Xóa</button>
    </div>)}
    {drafts.map((draft, index) => <div key={index} className="gk-row">
      <input type="password" value={draft} aria-label={`Khóa Gemini mới ${index + 1}`} placeholder="Dán khóa Gemini mới"
        autoComplete="off" spellCheck={false} disabled={disabled || busy} style={{ minWidth: 0, flex: 1 }}
        onChange={event => setDrafts(values => values.map((value, i) => i === index ? event.target.value : value))}
        onPaste={event => {
          const lines = event.clipboardData.getData('text').split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
          if (lines.length > 1) {
            event.preventDefault()
            if (drafts.length - 1 + lines.length > 20) { setError('Tối đa 20 ô nhập khóa.'); return }
            setDrafts(values => [...values.slice(0, index), ...lines, ...values.slice(index + 1)])
          }
        }} />
      {drafts.length > 1 && <button type="button" className="btn ghost sm" disabled={disabled || busy}
        aria-label={`Bỏ ô nhập khóa ${index + 1}`} onClick={() => setDrafts(values => values.filter((_, i) => i !== index))}>×</button>}
    </div>)}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" className="btn" disabled={disabled || busy || unreadable || !drafts.some(value => value.trim())}
        onClick={() => void mutate(() => window.api.geminiAddKeys(drafts.join('\n')), true)}>{busy ? 'Đang xử lý…' : 'Lưu thêm khóa'}</button>
      <button type="button" className="btn ghost sm" disabled={disabled || busy || drafts.length >= 20}
        onClick={() => setDrafts(values => [...values, ''])}>Thêm ô nhập</button>
      <button type="button" className="btn ghost sm" disabled={disabled || busy || !keys.length} onClick={() => void check()}>Kiểm tra kết nối</button>
    </div>
    {unreadable && <div role="alert" className="small">
      <p>Không đọc được danh sách cũ. Nhập lại khóa rồi bấm nút dưới để ghi đè danh sách lỗi.</p>
      <button type="button" className="btn" disabled={disabled || busy || !drafts.some(value => value.trim())}
        onClick={() => void mutate(() => window.api.geminiReplaceKeys(drafts.join('\n')), true, true)}>Thay danh sách lỗi bằng khóa mới</button>
    </div>}
    <p className="muted small" style={{ margin: 0 }}>Tự chuyển sang khóa kế tiếp khi hết quota. Có thể dán nhiều khóa, mỗi dòng một khóa. Danh sách dùng chung cho dịch và tạo tiêu đề.</p>
    <p className="muted small" style={{ margin: 0 }}>Các khóa thuộc cùng Google project dùng chung hạn mức.</p>
    {message && <p className="small" role="status" style={{ margin: 0 }}>{message}</p>}
    {error && <p className="dy-err small" role="alert" style={{ margin: 0 }}>{error}</p>}
  </div>
}
