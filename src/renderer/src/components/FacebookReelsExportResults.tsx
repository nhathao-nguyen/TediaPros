import { useMemo, useState } from 'react'
import type { FacebookReelsExportRow, FacebookReelsExportResult, FacebookReelsExportStage } from '../../../shared/facebookReels'
import { filterReelsExportRows, reelsExportNeedsAttention, reelsPage, type ReelsExportFilter } from '../lib/facebookReels'
import { FacebookReelReader, ReelsPagination } from './FacebookReelReader'

export function reelsExportStatus(status: FacebookReelsExportStage): string {
  return { pending: 'Đang chờ', success: 'Đã lưu', missing: 'Thiếu caption', 'no-link': 'Không có link',
    'no-article': 'Chưa lấy được bài', error: 'Lỗi', cancelled: 'Đã dừng', disabled: 'Không tải' }[status]
}
export function FacebookReelsExportResults({ rows, results, busy = false, message = '', error = '', expected = 0, onStop, onChoose }: {
  rows: FacebookReelsExportRow[]; results: FacebookReelsExportResult[]; busy?: boolean; message?: string; error?: string;
  expected?: number; onStop?: () => void; onChoose?: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ReelsExportFilter>('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const filtered = useMemo(() => filterReelsExportRows(rows, query, filter), [rows, query, filter])
  const pagination = reelsPage(filtered, page)
  const selected = pagination.rows.find(({ e }) => e.id === selectedId)?.e ?? pagination.rows[0]?.e
  const issues = rows.filter(reelsExportNeedsAttention).length
  return <section className="reels-export-results" aria-label="Kết quả Facebook Reels">
    <div className="reels-section-heading"><div><h2>Kết quả Facebook Reels</h2><p className="muted">Chọn một Reel để đọc caption, bài viết website và mở các file đã lưu.</p></div>
      {onChoose && <button className="btn" disabled={busy} onClick={onChoose}>Chọn Reels để xuất</button>}
    </div>
    <div className="reels-stats" aria-label="Thống kê kết quả">
      {[['Reels có kết quả', rows.length], ['Link website', rows.filter(r => r.targetUrl).length], ['Bài viết đã lưu', rows.filter(r => r.articleStatus === 'success').length], ['MP4 đã tải', rows.filter(r => r.videoStatus === 'success').length]].map(([label, value]) =>
        <div key={label} className="reels-stat"><strong>{value}</strong><span>{label}</span></div>)}
    </div>
    {(busy || error) && <div className={`reels-progress ${error ? 'has-error' : ''}`} role="status">
      <div><strong>{error || message || 'Đang xuất Reels…'}</strong>{busy && <small>{rows.length} / {expected} Reel đã có kết quả · có thể đọc nội dung trong lúc chờ</small>}</div>
      {busy && <button className="btn small-btn" onClick={onStop}>Dừng xuất</button>}
    </div>}
    {results.length === 1 && <div className="reels-output reels-single-output">
      <div className="reels-output-row"><span>{results[0].cancelled ? 'Đã dừng · giữ kết quả' : 'Đã xuất'} · {results[0].rows.length} Reel<small>{results[0].directory}</small></span>
        <button className="btn small-btn" onClick={() => void window.api.openPath(results[0].directory)}>Mở thư mục</button><button className="btn small-btn" onClick={() => void window.api.openPath(results[0].excelPath)}>Mở Excel</button></div>
    </div>}
    {results.length > 1 && <details className="reels-output">
      <summary>{results.some(r => r.cancelled) ? 'Đã dừng · kết quả được giữ lại' : 'Các file đã xuất'} · {results.length} thư mục</summary>
      <div className="reels-output-list">{results.map((result, i) => <div className="reels-output-row" key={result.directory}>
        <span title={result.directory}>{results.length > 1 ? `Lượt ${i + 1} · ` : ''}{result.rows.length} Reel <small>{result.directory}</small></span>
        <button className="btn small-btn" onClick={() => void window.api.openPath(result.directory)}>Mở thư mục</button>
        <button className="btn small-btn" onClick={() => void window.api.openPath(result.excelPath)}>Mở Excel</button>
      </div>)}</div>
    </details>}
    <div className="reels-results-toolbar">
      <input className="reels-search" type="search" aria-label="Tìm trong kết quả Reels" placeholder="Tìm tiêu đề, caption, nội dung web hoặc ID…" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }}/>
      <select aria-label="Lọc kết quả Reels" value={filter} onChange={e => { setFilter(e.target.value as ReelsExportFilter); setPage(1) }}>
        <option value="all">Tất cả ({rows.length})</option><option value="issues">Cần kiểm tra ({issues})</option><option value="article">Có bài viết</option><option value="video">Có MP4</option><option value="no-link">Không có link web</option>
      </select>
    </div>
    <div className="reels-browser">
      <div className="reels-list-pane">
        <div className="reels-result-list" aria-label="Danh sách kết quả Reels">
          {pagination.rows.map(({ e: r }) => <button key={r.id} className={`reels-result-card ${selected?.id === r.id ? 'active' : ''}`} aria-pressed={selected?.id === r.id} onClick={() => setSelectedId(r.id)}>
            <div className="reels-row-meta"><span>REEL {r.index}</span><span className={reelsExportNeedsAttention(r) ? 'reels-attention' : 'reels-saved'}>{reelsExportNeedsAttention(r) ? 'Cần kiểm tra' : r.articleStatus === 'pending' || r.videoStatus === 'pending' ? 'Đang xử lý' : 'Đã xử lý'}</span></div>
            <strong>{r.title}</strong>
            <div className="reels-result-stages"><span className={`reels-stage ${r.captionStatus}`}>Caption · {reelsExportStatus(r.captionStatus)}</span><span className={`reels-stage ${r.articleStatus}`}>Web · {reelsExportStatus(r.articleStatus)}</span><span className={`reels-stage ${r.videoStatus}`}>MP4 · {reelsExportStatus(r.videoStatus)}</span></div>
          </button>)}
          {!filtered.length && <div className="reels-empty"><strong>{rows.length ? 'Không có Reel phù hợp' : busy ? 'Đang xử lý Reel đầu tiên…' : 'Chưa có kết quả xuất'}</strong><p>{rows.length ? 'Thử từ khóa khác hoặc chọn “Tất cả”.' : 'Quét profile/fanpage, chọn Reels rồi xuất caption, bài viết website và MP4.'}</p></div>}
        </div>
        <ReelsPagination page={pagination.page} pages={pagination.pages} total={filtered.length} onPage={setPage}/>
      </div>
      {selected ? <FacebookReelReader reel={selected}/> : <div className="reels-reader-placeholder"><strong>Nội dung Reel</strong><p>Caption và bài viết sẽ xuất hiện ở đây khi bạn chọn một mục trong danh sách.</p></div>}
    </div>
  </section>
}
