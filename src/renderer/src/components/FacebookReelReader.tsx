import { useEffect, useState } from 'react'
import type { FacebookReelsExportRow } from '../../../shared/facebookReels'

export function FacebookReelReader({ reel, beforeExport = false, isFacebook = true }: {
  reel: Pick<FacebookReelsExportRow, 'id' | 'title' | 'caption' | 'reelUrl'> & Partial<FacebookReelsExportRow>
  beforeExport?: boolean
  isFacebook?: boolean
}): React.JSX.Element {
  const [tab, setTab] = useState<'caption' | 'article'>('caption')
  const [copyMessage, setCopyMessage] = useState('')
  const article = tab === 'article' && !beforeExport
  const text = article ? reel.content ?? '' : reel.caption
  const articlePreview = article && text.length > 32700
  useEffect(() => { setCopyMessage('') }, [reel.id, tab])
  let website = reel.targetUrl ?? ''
  try { if (reel.targetUrl) website = new URL(reel.targetUrl).hostname } catch { /* Keep malformed saved text readable. */ }
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(text); setCopyMessage('Đã sao chép.') }
    catch { setCopyMessage('Chưa sao chép được. Bạn có thể chọn văn bản bên dưới.') }
  }
  return <aside className="reels-reader" aria-label="Chi tiết Reel">
    <header className="reels-reader-head">
      <span className="reels-eyebrow">{isFacebook ? 'Chi tiết Reel' : 'Video playlist'} · {reel.id}</span>
      <button className="reels-text-button" onClick={() => void window.api.openExternal(reel.reelUrl)}>{isFacebook ? 'Mở Reel trên Facebook' : 'Mở video nguồn'}</button>
    </header>
    <div className="reels-reader-tabs" aria-label="Nội dung Reel">
      <button className={article ? '' : 'active'} aria-pressed={!article} onClick={() => { setTab('caption'); setCopyMessage('') }}>{isFacebook ? 'Caption Facebook' : 'Thông tin video'}</button>
      {!beforeExport && <button className={article ? 'active' : ''} aria-pressed={article} onClick={() => { setTab('article'); setCopyMessage('') }}>Bài viết website</button>}
    </div>
    <div className="reels-reader-scroll" role="region" aria-label={article ? 'Nội dung bài viết website' : 'Nội dung caption'} tabIndex={0} key={reel.id + tab}>
      {!reel.caption && <details className="reels-reader-title"><summary>Tiêu đề Reel</summary><p>{reel.title}</p></details>}
      {article && <div className="reels-article-source">
        <strong>{reel.articleTitle || 'Nội dung website'}</strong>
        {reel.targetUrl && <button className="reels-text-button" title={reel.targetUrl} onClick={() => void window.api.openExternal(reel.targetUrl!)}>Mở website · {website}</button>}
        <small className="muted">{reel.foundIn === 'comment' ? 'Link từ bình luận' : reel.foundIn === 'caption' ? 'Link từ caption' : 'Chưa tìm thấy link website'}</small>
      </div>}
      {articlePreview && <p className="reels-notice">Đang xem bản rút gọn của bài viết dài. Mở TXT để đọc toàn bộ nội dung đã lưu.</p>}
      {!isFacebook && <p className="reels-notice">Video playlist được thêm qua “Thêm vào hàng đợi”. Chức năng xuất Reels chỉ áp dụng cho Facebook.</p>}
      {text ? <div className="reels-readable-text">{text}</div> : <div className="reels-reader-empty">
        <strong>{article ? 'Chưa có nội dung website' : 'Chưa lấy được caption'}</strong>
        <p>{article ? reel.targetUrl ? 'Xem thông báo bên dưới hoặc mở link nguồn để kiểm tra bài viết.' : 'Reel này chưa tìm thấy link website trong caption hoặc bình luận.' : 'Dùng “Lấy caption còn thiếu” hoặc xuất dữ liệu để lấy thêm thông tin.'}</p>
      </div>}
      {!!reel.errors?.length && <div className="reels-problems" role="note"><strong>Cần kiểm tra</strong>{reel.errors.map((e, i) => <p key={i}>{e}</p>)}</div>}
    </div>
    <footer className="reels-reader-foot">
      <div className="reels-actions">
        <button className="btn small-btn" disabled={!text} onClick={() => void copy()}>Sao chép {articlePreview ? 'bản xem trước' : article ? 'bài viết' : isFacebook ? 'caption' : 'thông tin'}</button>
        {(article ? reel.articlePath : reel.captionPath) && <button className="btn small-btn" onClick={() => void window.api.openPath((article ? reel.articlePath : reel.captionPath)!)}>Mở TXT</button>}
        {reel.videoPath && <button className="btn small-btn" onClick={() => void window.api.openPath(reel.videoPath!)}>Mở MP4</button>}
      </div>
      {(copyMessage || beforeExport) && <small role="status" className="muted">{copyMessage || 'Caption có thể được bổ sung khi xuất dữ liệu.'}</small>}
    </footer>
  </aside>
}

export function ReelsPagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (page: number) => void }): React.JSX.Element {
  return <nav className="reels-pagination" aria-label="Phân trang Reels">
    <small className="muted">{total ? `${(page - 1) * 50 + 1}–${Math.min(page * 50, total)} / ${total} mục` : '0 mục'}</small>
    <div className="reels-actions">
      <button className="btn small-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Trước</button>
      <span className="small">{page} / {pages}</span>
      <button className="btn small-btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>Sau</button>
    </div>
  </nav>
}
