import type { SubtitleCue } from '../../shared/types'
import type {
  TranslationFormat,
  TranslationIssue,
  TranslationItem
} from '../../shared/translation'

export interface ParseOutcome {
  items: TranslationItem[]
  issues: TranslationIssue[]
  complete: boolean
}

function issue(
  code: TranslationIssue['code'],
  message: string,
  cueIds: readonly string[] = [],
  confidence: TranslationIssue['confidence'] = 'certain',
  severity: TranslationIssue['severity'] = 'error'
): TranslationIssue {
  return { code, severity, cueIds: [...cueIds], confidence, message }
}

function unwrapCompleteFence(raw: string): { text: string; fenced: boolean; malformed: boolean } {
  const text = raw.trim()
  if (!text.startsWith('```')) return { text, fenced: false, malformed: false }
  const match = /^```(?:json|text|txt)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/iu.exec(text)
  if (match) return { text: match[1] || '', fenced: true, malformed: false }
  return { text, fenced: true, malformed: true }
}

function normalizeItem(value: unknown): TranslationItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { id: '', text: '' }
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  const text = typeof record.t === 'string'
    ? record.t.trim()
    : typeof record.text === 'string'
      ? record.text.trim()
      : ''
  return { id, text }
}

function validateItems(
  items: readonly TranslationItem[],
  expectedIds: readonly string[],
  contextIds: readonly string[],
  issues: TranslationIssue[]
): void {
  const expected = new Set(expectedIds)
  const contexts = new Set(contextIds)
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.id) {
      issues.push(issue('missing-id', 'Phản hồi có phần tử không chứa cue ID.', []))
      continue
    }
    if (contexts.has(item.id) && !expected.has(item.id)) {
      // Context IDs are valid evidence but never output. Keep the fact visible
      // so diagnostics can explain why the provider response contained it.
      issues.push(issue(
        'unknown-id',
        `Cue ngữ cảnh ${item.id} được trả về ngoài tập cần dịch và đã bị loại khỏi kết quả.`,
        [item.id],
        'heuristic',
        'warning'
      ))
      continue
    }
    if (!expected.has(item.id)) {
      issues.push(issue('unknown-id', `Cue ID ${item.id} không thuộc nội dung cần dịch.`, [item.id]))
      continue
    }
    if (seen.has(item.id)) {
      issues.push(issue('duplicate-id', `Cue ID ${item.id} xuất hiện nhiều lần.`, [item.id]))
      continue
    }
    seen.add(item.id)
    if (!item.text.trim()) issues.push(issue('empty-text', `Cue ${item.id} không có bản dịch.`, [item.id]))
  }
  const missing = expectedIds.filter((id) => !seen.has(id))
  if (missing.length > 0) issues.push(issue('missing-id', `Thiếu bản dịch cho ${missing.length} cue.`, missing))
}

/**
 * Parse exactly one provider grammar. A line parser never discards a non-empty
 * continuation: it becomes an explicit error and cannot be published.
 */
export function parseTranslationResponse(
  raw: string,
  format: TranslationFormat,
  expectedIds: readonly string[],
  truncated: boolean,
  contextIds: readonly string[] = []
): ParseOutcome {
  const issues: TranslationIssue[] = []
  const expected = [...expectedIds].map((id) => id.trim())
  if (new Set(expected).size !== expected.length) {
    issues.push(issue('invalid-source', 'Danh sách cue cần dịch bị trùng ID.'))
  }

  const unwrapped = unwrapCompleteFence(raw)
  if (unwrapped.malformed) {
    issues.push(issue('unparsed-content', 'Phản hồi có fence không hoàn chỉnh; không thể xác nhận toàn bộ nội dung.'))
  }
  if (truncated) issues.push(issue('truncated-output', 'Phản hồi model bị cắt trước khi hoàn tất.'))

  const items: TranslationItem[] = []
  if (!unwrapped.malformed) {
    if (format === 'json-items') {
      try {
        const parsed = JSON.parse(unwrapped.text) as unknown
        const candidate = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown }).items)
            ? (parsed as { items: unknown[] }).items
            : parsed && typeof parsed === 'object' && typeof (parsed as { id?: unknown }).id === 'string'
              ? [parsed]
            : null
        if (!candidate) {
          issues.push(issue('provider-protocol', 'JSON dịch phải là mảng hoặc object có trường items.'))
        } else {
          items.push(...candidate.map(normalizeItem))
        }
      } catch {
        issues.push(issue('unparsed-content', 'Không đọc được JSON dịch theo contract đã chọn.'))
      }
    } else {
      const pattern = /^\s*\[([^\]]+)\]\s*(.*?)\s*$/u
      const lines = unwrapped.text.replace(/\r\n/g, '\n').split('\n')
      for (const line of lines) {
        if (!line.trim()) continue
        const match = pattern.exec(line)
        if (!match) {
          issues.push(issue('unparsed-content', 'Phản hồi có dòng ngoài định dạng [id] bản dịch.'))
          continue
        }
        items.push({ id: match[1].trim(), text: match[2].trim() })
      }
    }
  }

  validateItems(items, expected, contextIds, issues)
  const hasErrors = issues.some((candidate) => candidate.severity === 'error')
  const filteredItems = items.filter((item) => expected.includes(item.id) && !contextIds.includes(item.id))
  return { items: filteredItems, issues, complete: !hasErrors }
}

/** Parse the separate rephrase grammar without treating free-form prose as a candidate. */
export function parseRephraseResponse(raw: string, cueId: string): ParseOutcome {
  return parseBatchRephraseResponse(raw, [cueId])
}

/** Protocol labels must never become spoken text, even from a custom adapter. */
export function containsRephraseLabel(text: string, cueIds: readonly string[] = []): boolean {
  if (/\[[^\]\r\n]+:\d+\]|\bcue-[\w-]+:\d+\b/iu.test(text)) return true
  return cueIds.some((id) => id.trim() && new RegExp(`${escapeRegExp(id.trim())}:\\d+\\b`, 'u').test(text))
}

export function parseBatchRephraseResponse(raw: string, cueIds: readonly string[]): ParseOutcome {
  const issues: TranslationIssue[] = []
  const normalizedIds = cueIds.map((id) => id.trim())
  if (!normalizedIds.length || normalizedIds.some((id) => !id)) {
    issues.push(issue('invalid-source', 'Rephrase yêu cầu cue ID hợp lệ.'))
    return { items: [], issues, complete: false }
  }
  const unwrapped = unwrapCompleteFence(raw)
  if (unwrapped.malformed) {
    issues.push(issue('unparsed-content', 'Phản hồi rephrase có fence không hoàn chỉnh.'))
    return { items: [], issues, complete: false }
  }
  const items: TranslationItem[] = []
  const seen = new Set<string>()
  const pattern = /^\s*\[([^\]]+)\]\s*(.*?)\s*$/u
  // Models can return several labelled alternatives on one physical line.
  // Split every candidate-shaped marker, including unknown/out-of-range IDs,
  // so the normal strict validator sees them instead of speaking the suffix.
  const normalized = unwrapped.text.replace(/\r\n/g, '\n').replace(/(\[[^\]\r\n]+:\d+\])/gu, '\n$1')
  for (const line of normalized.split('\n')) {
    if (!line.trim()) continue
    const match = pattern.exec(line)
    if (!match) {
      issues.push(issue('unparsed-content', 'Phản hồi rephrase có dòng ngoài định dạng [cue-id:n] text.'))
      continue
    }
    const id = match[1].trim()
    const text = match[2].trim()
    if (!normalizedIds.some((cueId) => new RegExp(`^${escapeRegExp(cueId)}:[1-3]$`, 'u').test(id))) {
      issues.push(issue('unknown-id', 'Rephrase trả về candidate ngoài các cue yêu cầu.', [id]))
      continue
    }
    if (seen.has(id)) {
      issues.push(issue('duplicate-id', `Rephrase candidate ${id} xuất hiện nhiều lần.`, [id]))
      continue
    }
    seen.add(id)
    if (!text) {
      issues.push(issue('empty-text', `Rephrase candidate ${id} rỗng.`, [id]))
      continue
    }
    // An unnumbered inline bracket may be a foreign candidate label. Its
    // boundary is ambiguous, so keep no supplemental text from this response.
    if (/\[[^\]\r\n]+\]/u.test(text) || containsRephraseLabel(text, normalizedIds)) {
      issues.push(issue('unparsed-content', `Rephrase candidate ${id} chứa nhãn phương án trong lời đọc.`, [id]))
      continue
    }
    items.push({ id, text })
  }
  return { items, issues, complete: issues.every((candidate) => candidate.severity !== 'error') }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Salvage only unambiguous, fully parsed cues; never infer a missing identity. */
export function recoverBatchRephraseResponse(raw: string, cueIds: readonly string[]): ParseOutcome {
  const expected = cueIds.map((id) => id.trim())
  const labels = Array.from(raw.matchAll(/\[([^\]\r\n]+)\]/gu), (match) => match[1].trim())
  const mixed = expected.filter((id) => labels.includes(id) && labels.some((label) => label.startsWith(`${id}:`)))
  // Some providers return one choice as [exact-cue-id]. This is unambiguous;
  // mixed numbered/unnumbered or repeated labels become duplicates below.
  const normalized = raw.replace(/\[([^\]\r\n]+)\]/gu, (marker, id: string) =>
    expected.includes(id.trim()) ? `[${id.trim()}:1]` : marker)
  const parsed = parseBatchRephraseResponse(normalized, expected)
  for (const id of mixed) parsed.issues.push(issue('duplicate-id', 'Rephrase trộn nhãn có và không có số phương án cho cùng cue.', [id]))
  if (parsed.issues.some((entry) => entry.code === 'unparsed-content' || entry.code === 'invalid-source')) {
    return { ...parsed, items: [] }
  }
  const blocked = new Set(parsed.issues.flatMap((entry) => entry.cueIds.flatMap((label) =>
    expected.filter((id) => label === id || label.startsWith(`${id}:`)))))
  return {
    ...parsed,
    complete: parsed.complete && mixed.length === 0,
    items: parsed.items.filter((item) => !expected.some((id) => blocked.has(id) && item.id.startsWith(`${id}:`)))
  }
}

/** Map validated provider items back to source timing using IDs only. */
export function mapTranslationsStrict(
  source: readonly SubtitleCue[],
  items: readonly TranslationItem[]
): SubtitleCue[] {
  const sourceIds = source.map((cue) => cue.id.trim())
  if (source.length === 0 || sourceIds.some((id) => !id) || new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('Source cue không có identity hợp lệ.')
  }
  const expected = new Set(sourceIds)
  if (items.length !== source.length) throw new Error('Kết quả dịch thiếu hoặc thừa cue.')
  const byId = new Map<string, TranslationItem>()
  for (const item of items) {
    const id = item.id.trim()
    if (!expected.has(id)) throw new Error(`Kết quả dịch chứa cue không xác định: ${id || '(rỗng)'}.`)
    if (byId.has(id)) throw new Error(`Kết quả dịch chứa cue trùng id: ${id}.`)
    if (!item.text.trim()) throw new Error(`Kết quả dịch có cue rỗng: ${id}.`)
    byId.set(id, item)
  }
  if (byId.size !== expected.size) throw new Error('Kết quả dịch thiếu cue nguồn.')
  return source.map((cue) => ({ ...cue, text: byId.get(cue.id.trim())!.text.trim() }))
}
