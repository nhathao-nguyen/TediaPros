import { useEffect, useMemo, useRef, useState } from 'react'
import { facebookReelsStopMessage, type FacebookReelsRequest, type FacebookReelsSummary } from '../../../shared/facebookReels'
import { filterReelsEntries, reelsPage, reelsSelectionCounts, type ReelsSelectionEntry } from '../lib/facebookReels'
import { FacebookReelReader, ReelsPagination } from './FacebookReelReader'

export interface ReelsSelectionSource { jobId: string; request: FacebookReelsRequest; summary: FacebookReelsSummary }
export function FacebookReelsSelection({ entries, sources, busy, error = '', folder, downloadVideos, range, onRange, onApplyRange,
  onToggle, onAll, onContinue, onEnrich, onFolder, onVideo, onExport, onQueue, onClose }: {
  entries: ReelsSelectionEntry[]; sources: ReelsSelectionSource[]; busy: boolean; folder: string; downloadVideos: boolean;
  error?: string;
  range: { from: number; to: number }; onRange: (range: { from: number; to: number }) => void; onApplyRange: (from: number, to: number) => void;
  onToggle: (index: number) => void; onAll: (checked: boolean) => void; onContinue: (source: ReelsSelectionSource) => void;
  onEnrich: () => void; onFolder: () => void; onVideo: (value: boolean) => void; onExport: () => void; onQueue: () => void; onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose; busyRef.current = busy
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (busyRef.current) return
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? []).filter(e => e.offsetParent !== null)
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    if (!busy && !dialog.current?.contains(document.activeElement)) dialog.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
  }, [busy])
  const filtered = useMemo(() => filterReelsEntries(entries, query), [entries, query])
  const pagination = reelsPage(filtered, page)
  const selected = pagination.rows.find(({ e: { e } }) => e.id === selectedId)?.e.e ?? pagination.rows[0]?.e.e
  const { checked, reels: exportCount, other } = reelsSelectionCounts(entries)
  const reelCount = entries.filter(e => !!e.facebook).length
  const captionCount = entries.filter(e => e.facebook?.status === 'verified' && e.facebook.caption).length
  const selectedMissing = entries.filter(e => e.checked && e.facebook && e.facebook.status !== 'verified').length
  const applyRange = (): void => {
    if (!entries.length) return
    const from = Math.max(1, Math.min(range.from || 1, entries.length))
    const to = Math.max(from, Math.min(range.to || entries.length, entries.length))
    onRange({ from, to }); onApplyRange(from, to)
  }
  return <div className="modal-overlay reels-selection-overlay" onClick={() => !busy && onClose()}>
    <div ref={dialog} inert={busy} className="reels-selection-dialog" role="dialog" aria-modal="true" aria-labelledby="reels-selection-title" onClick={e => e.stopPropagation()}>
      <header className="reels-dialog-head"><div><span className="reels-eyebrow">Quét → Chọn → Xuất dữ liệu</span><h2 id="reels-selection-title">Chọn Facebook Reels</h2><p className="muted">{reelCount} Reel tìm thấy{entries.length > reelCount ? ` · ${entries.length - reelCount} video playlist` : ''} · <strong>{checked} đã chọn</strong></p></div>
        <button className="btn small-btn" disabled={busy} onClick={onClose}>Đóng</button></header>
      <div className="reels-source-list">{sources.map(source => <div className={`reels-source ${source.summary.completion === 'complete' ? 'complete' : ''}`} key={source.jobId}>
        <div><strong>{source.summary.discoveredCount} Reels · {source.summary.completion === 'complete' ? 'Đã xác nhận hết danh sách' : 'Chưa xác nhận hết danh sách'}</strong><p>{facebookReelsStopMessage(source.summary.stopReason)}</p>
          <small className="muted">{source.summary.warnings.join(' · ') || source.request.url}</small></div>
        {source.summary.resumeKey && source.summary.completion !== 'complete' && <button className="btn small-btn" disabled={busy} onClick={() => onContinue(source)}>Quét tiếp</button>}
      </div>)}</div>
      {error && <div className="reels-selection-error" role="alert">{error}</div>}
      <div className="reels-selection-tools">
        <div className="reels-actions"><span className={captionCount === reelCount ? 'muted small' : 'reels-attention small'}>{captionCount}/{reelCount} Reel có caption{captionCount < reelCount ? ` · ${reelCount - captionCount} cần bổ sung` : ''}</span>
          {selectedMissing > 0 && <button className="btn small-btn" disabled={busy} onClick={onEnrich}>Lấy {selectedMissing} caption còn thiếu</button>}</div>
        <div className="reels-results-toolbar"><input className="reels-search" type="search" aria-label="Tìm Reels để chọn" placeholder="Tìm trong tiêu đề, caption hoặc ID…" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }}/>
          <button className="btn small-btn" disabled={busy || !entries.length} onClick={() => onAll(true)}>Chọn tất cả ({entries.length})</button><button className="btn small-btn" disabled={busy || !checked} onClick={() => onAll(false)}>Bỏ chọn tất cả</button></div>
        <details className="reels-selection-more"><summary>Chọn theo khoảng</summary><div className="reels-actions">
          <label>Từ <input type="number" min={1} max={entries.length || 1} aria-label="Chọn Reels từ" value={range.from} onChange={e => onRange({ ...range, from: Number(e.target.value) })}/></label>
          <label>đến <input type="number" min={1} max={entries.length || 1} aria-label="Chọn Reels đến" value={range.to} onChange={e => onRange({ ...range, to: Number(e.target.value) })}/></label>
          <button className="btn small-btn" disabled={busy || !entries.length} onClick={applyRange}>Chỉ chọn khoảng này</button></div></details>
      </div>
      <div className="reels-browser reels-selection-browser">
        <div className="reels-list-pane"><div className="reels-result-list" aria-label="Danh sách Reels để chọn">
          {pagination.rows.map(({ e: { e, i } }) => <div key={e.id} className={`reels-selection-card ${selected?.id === e.id ? 'active' : ''}`}>
            <input type="checkbox" aria-label={`Chọn Reel ${i + 1}`} disabled={busy} checked={e.checked} onChange={() => onToggle(i)}/>
            <button className="reels-selection-preview" aria-pressed={selected?.id === e.id} onClick={() => setSelectedId(e.id)}>
              <div className="reels-row-meta"><span>{e.facebook ? 'REEL' : 'VIDEO PLAYLIST'} {i + 1}</span><span className={e.facebook?.status === 'verified' ? 'reels-saved' : 'reels-attention'}>{!e.facebook ? 'Chỉ thêm vào hàng đợi' : e.facebook.status === 'verified' ? 'Có caption' : e.facebook.status === 'error' ? 'Lỗi caption' : 'Cần lấy caption'}</span></div>
              <strong>{e.title}</strong></button>
          </div>)}
          {!filtered.length && <div className="reels-empty"><strong>{entries.length ? 'Không có Reel phù hợp' : 'Chưa tìm thấy Reels'}</strong><p>{entries.length ? 'Tìm kiếm không thay đổi những Reel bạn đã chọn.' : 'Xem trạng thái quét ở trên hoặc bấm “Quét tiếp”.'}</p></div>}
        </div><ReelsPagination page={pagination.page} pages={pagination.pages} total={filtered.length} onPage={setPage}/></div>
        {selected ? <FacebookReelReader beforeExport isFacebook={!!selected.facebook} reel={{ id: selected.id, title: selected.title, caption: selected.facebook?.caption ?? (selected.facebook ? '' : selected.title), reelUrl: selected.url }}/> : <div className="reels-reader-placeholder">Chọn một Reel để đọc caption.</div>}
      </div>
      <footer className="reels-selection-footer">
        <div className="reels-folder-row"><label htmlFor="reels-export-folder">Thư mục xuất</label><input id="reels-export-folder" readOnly value={folder} placeholder="Chọn thư mục kết quả" title={folder}/><button className="btn small-btn" disabled={busy} onClick={onFolder}>Chọn thư mục</button></div>
        <div className="reels-selection-finish"><div><label className="check"><input type="checkbox" checked={downloadVideos} disabled={busy} onChange={e => onVideo(e.target.checked)}/>Tải kèm MP4</label><small className="muted">Luôn xuất Excel, caption TXT và bài viết website TXT khi có dữ liệu.</small></div>
          <div className="reels-actions"><button className="btn" disabled={busy || !checked} onClick={onQueue}>Thêm vào hàng đợi</button><button className="btn primary" disabled={busy || !exportCount || !folder} onClick={onExport}>Xuất {exportCount} Reels</button></div></div>
        {other > 0 && <small className="reels-attention">{other} video playlist đã chọn chỉ được thêm vào hàng đợi; nút Xuất xử lý {exportCount} Facebook Reels.</small>}
        {!folder && <small className="reels-attention">Chọn thư mục trước khi xuất dữ liệu.</small>}
      </footer>
    </div>
  </div>
}
