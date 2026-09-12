import type { CutEditContent, CutHistory, CutHistoryAction, CutRunIntent } from './autoShortCutContract'

const STRICT_DECIMAL_SECONDS = /^\d+(?:[.,]\d*)?$/

export type CutSecondsParseResult =
  | { ok: true; seconds: number }
  | { ok: false; error: string }

export function parseCutSeconds(value: string): CutSecondsParseResult {
  const normalized = value.trim()
  if (!normalized || !STRICT_DECIMAL_SECONDS.test(normalized)) return { ok: false, error: 'Nhập mốc thời gian hợp lệ.' }
  const seconds = Number(normalized.replace(',', '.'))
  return Number.isFinite(seconds) && seconds >= 0
    ? { ok: true, seconds }
    : { ok: false, error: 'Mốc thời gian không hợp lệ.' }
}

const CUT_HISTORY_LIMIT = 200

function cloneContent(content: CutEditContent): CutEditContent {
  return {
    operations: content.operations.map((range) => ({
      id: range.id,
      start: { ...range.start, timeBase: { ...range.start.timeBase } },
      end: { ...range.end, timeBase: { ...range.end.timeBase } }
    })),
    reviewResolutions: content.reviewResolutions.map((resolution) => ({ ...resolution }))
  }
}

export function reduceCutHistory(state: CutHistory, action: CutHistoryAction): CutHistory {
  if (action.type === 'replace') {
    return {
      past: [...state.past.map(cloneContent), cloneContent(state.present)].slice(-CUT_HISTORY_LIMIT),
      present: cloneContent(action.content),
      future: []
    }
  }
  if (action.type === 'undo') {
    if (state.past.length === 0) return {
      past: [], present: cloneContent(state.present), future: state.future.map(cloneContent)
    }
    return {
      past: state.past.slice(0, -1).map(cloneContent),
      present: cloneContent(state.past[state.past.length - 1]),
      future: [cloneContent(state.present), ...state.future.map(cloneContent)].slice(0, CUT_HISTORY_LIMIT)
    }
  }
  if (state.future.length === 0) return {
    past: state.past.map(cloneContent), present: cloneContent(state.present), future: []
  }
  return {
    past: [...state.past.map(cloneContent), cloneContent(state.present)].slice(-CUT_HISTORY_LIMIT),
    present: cloneContent(state.future[0]),
    future: state.future.slice(1).map(cloneContent)
  }
}

export function chooseCutRunIntent(input: { hasDraft: boolean; snapshotChanged: boolean; hasResume: boolean }): CutRunIntent {
  if (input.hasDraft) return 'resolve-draft'
  if (input.hasResume && input.snapshotChanged) return 'new-run'
  return input.hasResume ? 'resume' : 'start'
}
