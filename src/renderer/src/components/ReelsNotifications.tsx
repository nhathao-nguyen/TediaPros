import { useEffect, useRef, useState, type JSX } from 'react'
import { useReelsMonitor } from './useReelsMonitor'
import '../styles/reelsNotifications.css'

const labels = { running: 'Đang chạy', success: 'Hoàn tất', partial: 'Chưa hoàn tất', error: 'Lỗi', cancelled: 'Đã dừng' }
export function ReelsNotifications(): JSX.Element {
  const { state, error, act } = useReelsMonitor(), [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null)
  const unread = state?.notices.filter(n => !n.read).length ?? 0
  const deletable = state?.notices.filter(n => n.status !== 'running') ?? []
  const [deleting, setDeleting] = useState(false)
  const remove = async (ids: string[]): Promise<void> => {
    setDeleting(true)
    try { await act(window.api.deleteFacebookReelsNotices(ids)) }
    finally { setDeleting(false) }
  }
  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [open])
  return <div className="reels-notifications">
    <button ref={button} className="btn small-btn" aria-expanded={open} aria-controls="reels-notices-panel"
      onClick={() => setOpen(!open)}>🔔 Thông báo{unread > 0 && <span className="reels-unread">{unread}</span>}</button>
    {open && <section ref={panel} tabIndex={-1} id="reels-notices-panel" className="card reels-notices-panel" aria-label="Thông báo tải Reels">
      <div className="reels-notice-head"><strong>Thông báo Reels</strong><button className="ibtn" aria-label="Đóng thông báo" onClick={() => { setOpen(false); button.current?.focus() }}>✕</button></div>
      <p className="muted small">Kiểm tra hằng ngày lúc {state?.settings.time ?? '09:00'} giờ Việt Nam.</p>
      {error && <p className="reels-error" role="alert">{error}</p>}
      {state?.active && <div className="reels-monitor-active" role="status"><strong>{state.active.name}</strong><p>{state.active.message}</p>
        <button className="btn small-btn" onClick={() => void act(window.api.cancelFacebookReelsMonitor())}>Dừng lượt hiện tại</button></div>}
      <div className="reels-notice-actions">
        {unread > 0 && <button className="link-btn" onClick={() => void act(window.api.readFacebookReelsNotices(state!.notices.filter(n => !n.read).map(n => n.id)))}>Đánh dấu tất cả đã đọc</button>}
        {deletable.length > 0 && <button className="link-btn" disabled={deleting} onClick={() => void remove(deletable.map(n => n.id))}>Xóa tất cả</button>}
      </div>
      {state && state.notices.length > 0 && <p className="muted small">Chỉ xóa thông báo; giữ video và lịch sử tải. Lượt đang chạy được giữ lại.</p>}
      {!state?.notices.length && <p className="muted">Chưa có thông báo. Bật “Theo dõi hằng ngày” trong thư viện kênh Reels.</p>}
      <div className="reels-notice-list">{state?.notices.map(n => <article className={`reels-notice ${n.read ? '' : 'unread'}`} key={n.id}>
        <div className="reels-notice-head"><strong>{n.channelName}</strong><span className={`small ${n.status === 'error' ? 'reels-error' : 'muted'}`}>{labels[n.status]}</span></div>
        <time className="small muted">{new Date(n.createdAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</time>
        <p>{n.message}</p>
        {n.videos.length > 0 && <details><summary className="small">Video đã tải ({n.downloaded})</summary><ul>{n.videos.map(v => <li key={v.id}>{v.title || v.id}</li>)}</ul></details>}
        <div className="reels-notice-actions"><button className="btn small-btn" onClick={() => void window.api.openPath(n.outputDir)}>📂 Mở thư mục</button>
          {!n.read && <button className="link-btn" onClick={() => void act(window.api.readFacebookReelsNotices([n.id]))}>Đã đọc</button>}
          <button className="link-btn" disabled={deleting || n.status === 'running'} aria-label={`Xóa thông báo ${n.channelName}`}
            onClick={() => void remove([n.id])}>Xóa</button></div>
      </article>)}</div>
    </section>}
  </div>
}
