import { useEffect, useMemo, useState, type ReactElement } from 'react'
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

const format = (seconds: number): string => Math.max(0, seconds).toFixed(6)

export default function AutoShortCutPanel({ edit, durationSeconds, currentTimeSeconds, disabled, onSeek, onChange }: Props): ReactElement {
  const [start, setStart] = useState(() => format(currentTimeSeconds))
  const [end, setEnd] = useState(() => format(currentTimeSeconds))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setStart(format(currentTimeSeconds))
    setEnd(format(currentTimeSeconds))
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
      onChange(next)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Khoảng cắt không hợp lệ.')
    }
  }

  return (
    <div className="autoshort-cut-panel" aria-label="Cắt đoạn video">
      <div className="autoshort-cut-summary">
        <strong>Cắt đoạn</strong>
        <span>{edit?.removedRanges.length || 0} đoạn bỏ{plan ? ` · ${format(durationSeconds)}s → ${format(plan.editedDurationUs / MICROSECONDS_PER_SECOND)}s` : ''}</span>
      </div>
      <div className="autoshort-cut-fields">
        <label>Đầu (giây)<input value={start} disabled={disabled} inputMode="decimal" onChange={(event) => setStart(event.target.value)} /></label>
        <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => setStart(format(currentTimeSeconds))}>Đặt đầu</button>
        <label>Cuối (giây)<input value={end} disabled={disabled} inputMode="decimal" onChange={(event) => setEnd(event.target.value)} /></label>
        <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => setEnd(format(currentTimeSeconds))}>Đặt cuối</button>
        <button type="button" className="btn sm primary" disabled={disabled} onClick={() => applyRange(Number(start), Number(end))}>Bỏ đoạn</button>
        <button type="button" className="btn sm ghost" disabled={disabled || currentTimeSeconds <= 0} onClick={() => applyRange(0, currentTimeSeconds)}>Bỏ trước</button>
        <button type="button" className="btn sm ghost" disabled={disabled || currentTimeSeconds >= durationSeconds} onClick={() => applyRange(currentTimeSeconds, durationSeconds)}>Bỏ sau</button>
      </div>
      {error && <div className="autoshort-cut-error" role="alert">{error}</div>}
      {edit && edit.removedRanges.length > 0 && (
        <div className="autoshort-cut-ranges">
          {edit.removedRanges.map((range) => (
            <div key={range.id}>
              <button type="button" className="autoshort-cut-range" onClick={() => onSeek(range.startUs / MICROSECONDS_PER_SECOND)}>
                {format(range.startUs / MICROSECONDS_PER_SECOND)}s – {format(range.endUs / MICROSECONDS_PER_SECOND)}s
              </button>
              <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => {
                const remaining = edit.removedRanges.filter((item) => item.id !== range.id)
                onChange(remaining.length ? { ...edit, revision: edit.revision + 1, removedRanges: remaining } : undefined)
              }}>Khôi phục</button>
            </div>
          ))}
          <button type="button" className="btn sm ghost" disabled={disabled} onClick={() => onChange(undefined)}>Khôi phục toàn bộ</button>
        </div>
      )}
    </div>
  )
}
