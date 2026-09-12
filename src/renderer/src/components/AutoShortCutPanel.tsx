import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { parseCutSeconds } from '../../../shared/autoShortCutEditor'
import type { AutoShortTemporalEdit } from '../../../shared/autoShortTemporalEdit'
import { compileAutoShortCutPlan, MICROSECONDS_PER_SECOND, normalizeAutoShortTemporalEdit } from '../../../shared/autoShortTemporalEdit'

interface Props {
  edit?: AutoShortTemporalEdit
  durationSeconds: number
  currentTimeSeconds: number
  disabled?: boolean
  onSeek(seconds: number): void
  onChange(edit: AutoShortTemporalEdit | undefined): void
}

const formatInput = (seconds: number): string => Math.max(0, seconds).toFixed(3)
const formatClock = (seconds: number): string => {
  const value = Math.max(0, seconds)
  const minutes = Math.floor(value / 60)
  return `${minutes}:${(value - minutes * 60).toFixed(3).padStart(6, '0')}`
}

export default function AutoShortCutPanel({ edit, durationSeconds, currentTimeSeconds, disabled, onSeek, onChange }: Props): ReactElement {
  const [start, setStart] = useState(() => formatInput(currentTimeSeconds))
  const [end, setEnd] = useState(() => formatInput(currentTimeSeconds))
  const [error, setError] = useState<string | null>(null)
  const [previewCuts, setPreviewCuts] = useState(true)
  const [past, setPast] = useState<Array<AutoShortTemporalEdit | undefined>>([])
  const [future, setFuture] = useState<Array<AutoShortTemporalEdit | undefined>>([])

  useEffect(() => {
    setStart(formatInput(currentTimeSeconds))
    setEnd(formatInput(currentTimeSeconds))
    setError(null)
  }, [edit?.revision])

  const plan = useMemo(() => {
    if (!edit || durationSeconds <= 0) return null
    try {
      return compileAutoShortCutPlan(edit, Math.round(durationSeconds * MICROSECONDS_PER_SECOND))
    } catch {
      return null
    }
  }, [durationSeconds, edit])

  useEffect(() => {
    if (!previewCuts || disabled || !edit) return
    const currentUs = Math.round(currentTimeSeconds * MICROSECONDS_PER_SECOND)
    const removed = edit.removedRanges.find((range) => currentUs >= range.startUs && currentUs < range.endUs)
    if (removed) onSeek(removed.endUs / MICROSECONDS_PER_SECOND)
  }, [currentTimeSeconds, disabled, edit, onSeek, previewCuts])

  const commit = (next: AutoShortTemporalEdit | undefined): void => {
    setPast((items) => [...items, edit].slice(-200))
    setFuture([])
    onChange(next)
  }

  const applyRange = (startSeconds: number, endSeconds: number): void => {
    try {
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
        throw new Error('Điểm cuối phải lớn hơn điểm đầu.')
      }
      if (!(durationSeconds > 0) || endSeconds > durationSeconds + 0.000001) throw new Error('Khoảng cắt vượt quá thời lượng video.')
      const next = normalizeAutoShortTemporalEdit({
        schemaVersion: 1,
        revision: (edit?.revision || 0) + 1,
        mode: 'ripple-delete',
        removedRanges: [
          ...(edit?.removedRanges || []),
          { id: crypto.randomUUID(), startUs: Math.round(startSeconds * MICROSECONDS_PER_SECOND), endUs: Math.round(endSeconds * MICROSECONDS_PER_SECOND) }
        ]
      })
      compileAutoShortCutPlan(next, Math.round(durationSeconds * MICROSECONDS_PER_SECOND))
      commit(next)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Khoảng cắt không hợp lệ.')
    }
  }

  const applyDraftRange = (): void => {
    const parsedStart = parseCutSeconds(start)
    const parsedEnd = parseCutSeconds(end)
    if (!parsedStart.ok || !parsedEnd.ok) {
      setError('Nhập thời gian bằng số giây, ví dụ 1.250.')
      return
    }
    applyRange(parsedStart.seconds, parsedEnd.seconds)
  }

  const undo = (): void => {
    if (past.length === 0) return
    const previous = past.at(-1)
    setPast((items) => items.slice(0, -1))
    setFuture((items) => [edit, ...items].slice(0, 200))
    onChange(previous)
  }

  const redo = (): void => {
    if (future.length === 0) return
    const next = future[0]
    setPast((items) => [...items, edit].slice(-200))
    setFuture((items) => items.slice(1))
    onChange(next)
  }

  const removedSeconds = plan ? (plan.sourceDurationUs - plan.editedDurationUs) / MICROSECONDS_PER_SECOND : 0
  const remainingSeconds = plan ? plan.editedDurationUs / MICROSECONDS_PER_SECOND : durationSeconds
  const playheadPercent = durationSeconds > 0 ? Math.max(0, Math.min(100, currentTimeSeconds / durationSeconds * 100)) : 0

  return (
    <section className="autoshort-cut-panel" aria-label="Cắt đoạn video">
      <header className="autoshort-cut-summary">
        <div>
          <strong>Cắt theo thời gian</strong>
          <span className="autoshort-cut-hint">Vùng đỏ sẽ bị bỏ; mốc được căn tới frame hợp lệ khi bắt đầu xử lý.</span>
        </div>
        <div className="autoshort-cut-stats" aria-label="Tóm tắt bản cắt">
          <span><b>{edit?.removedRanges.length || 0}</b> đoạn</span>
          <span>Bỏ <b>{formatClock(removedSeconds)}</b></span>
          <span>Còn <b>{formatClock(remainingSeconds)}</b></span>
        </div>
      </header>

      <div className="autoshort-cut-timeline" aria-label="Dòng thời gian cắt">
        <div className="autoshort-cut-track">
          {edit?.removedRanges.map((range) => (
            <button
              type="button"
              key={range.id}
              className="autoshort-cut-block"
              aria-label={`Đoạn bỏ từ ${formatClock(range.startUs / MICROSECONDS_PER_SECOND)} đến ${formatClock(range.endUs / MICROSECONDS_PER_SECOND)}`}
              style={{
                left: `${durationSeconds > 0 ? range.startUs / MICROSECONDS_PER_SECOND / durationSeconds * 100 : 0}%`,
                width: `${durationSeconds > 0 ? (range.endUs - range.startUs) / MICROSECONDS_PER_SECOND / durationSeconds * 100 : 0}%`
              }}
              onClick={() => onSeek(range.startUs / MICROSECONDS_PER_SECOND)}
            />
          ))}
          <span className="autoshort-cut-playhead" style={{ left: `${playheadPercent}%` }} />
        </div>
        <div className="autoshort-cut-scale"><span>0:00.000</span><span>{formatClock(currentTimeSeconds)}</span><span>{formatClock(durationSeconds)}</span></div>
      </div>

      <div className="autoshort-cut-editor-row">
        <div className="autoshort-cut-field">
          <label htmlFor="autoshort-cut-start">Bắt đầu</label>
          <div className="autoshort-cut-input-wrap">
            <input id="autoshort-cut-start" aria-label="Thời điểm bắt đầu cắt" value={start} disabled={disabled} inputMode="decimal" onChange={(event) => setStart(event.target.value)} />
            <button type="button" disabled={disabled} onClick={() => setStart(formatInput(currentTimeSeconds))}>Lấy vị trí</button>
          </div>
        </div>
        <div className="autoshort-cut-field">
          <label htmlFor="autoshort-cut-end">Kết thúc</label>
          <div className="autoshort-cut-input-wrap">
            <input id="autoshort-cut-end" aria-label="Thời điểm kết thúc cắt" value={end} disabled={disabled} inputMode="decimal" onChange={(event) => setEnd(event.target.value)} />
            <button type="button" disabled={disabled} onClick={() => setEnd(formatInput(currentTimeSeconds))}>Lấy vị trí</button>
          </div>
        </div>
        <button type="button" className="btn sm primary autoshort-cut-primary" disabled={disabled} onClick={applyDraftRange}>Bỏ đoạn</button>
      </div>

      <div className="autoshort-cut-toolbar">
        <button type="button" className="btn sm ghost" disabled={disabled || currentTimeSeconds <= 0} onClick={() => applyRange(0, currentTimeSeconds)}>Bỏ phần trước</button>
        <button type="button" className="btn sm ghost" disabled={disabled || currentTimeSeconds >= durationSeconds} onClick={() => applyRange(currentTimeSeconds, durationSeconds)}>Bỏ phần sau</button>
        <button type="button" className="btn sm ghost" disabled={disabled || past.length === 0} onClick={undo}>Hoàn tác</button>
        <button type="button" className="btn sm ghost" disabled={disabled || future.length === 0} onClick={redo}>Làm lại</button>
        <label className="autoshort-cut-preview-toggle">
          <input type="checkbox" checked={previewCuts} disabled={disabled} onChange={(event) => setPreviewCuts(event.target.checked)} />
          Xem nhanh, bỏ qua vùng cắt
        </label>
      </div>

      {error && <div className="autoshort-cut-error" role="alert">{error}</div>}
      {edit && edit.removedRanges.length > 0 && (
        <div className="autoshort-cut-ranges" aria-label="Danh sách đoạn đã cắt">
          {edit.removedRanges.map((range, index) => (
            <div key={range.id}>
              <button type="button" className="autoshort-cut-range" onClick={() => onSeek(range.startUs / MICROSECONDS_PER_SECOND)}>
                <span className="autoshort-cut-range-index">{index + 1}</span>
                <span>{formatClock(range.startUs / MICROSECONDS_PER_SECOND)} → {formatClock(range.endUs / MICROSECONDS_PER_SECOND)}</span>
                <span className="muted">−{formatClock((range.endUs - range.startUs) / MICROSECONDS_PER_SECOND)}</span>
              </button>
              <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => {
                const remaining = edit.removedRanges.filter((item) => item.id !== range.id)
                commit(remaining.length ? { ...edit, revision: edit.revision + 1, removedRanges: remaining } : undefined)
              }}>Khôi phục</button>
            </div>
          ))}
          <button type="button" className="btn sm ghost autoshort-cut-restore-all" disabled={disabled} onClick={() => commit(undefined)}>Khôi phục tất cả</button>
        </div>
      )}
    </section>
  )
}
