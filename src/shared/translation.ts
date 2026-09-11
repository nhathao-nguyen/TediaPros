/**
 * Isomorphic contracts shared by the translation pipeline and the renderer.
 * Keep this module free of Electron, Node and browser dependencies so that a
 * response can be validated consistently at every boundary.
 */

export type TranslationMode = 'subtitle' | 'dubbing'
export type TranslationFormat = 'json-items' | 'id-lines'
export type TranslationDisposition = 'validated' | 'with-warnings' | 'needs-review'
export type TranslationSeverity = 'error' | 'warning'
export type TranslationConfidence = 'certain' | 'heuristic' | 'unknown'

export type TranslationIssueCode =
  | 'invalid-source'
  | 'missing-id'
  | 'duplicate-id'
  | 'unknown-id'
  | 'empty-text'
  | 'unparsed-content'
  | 'truncated-output'
  | 'protected-token-suspect'
  | 'language-suspect'
  | 'unsupported-capability'
  | 'budget-exhausted'
  | 'no-progress'
  | 'provider-auth'
  | 'provider-transient'
  | 'provider-protocol'
  | 'cancelled'

export interface TranslationIssue {
  code: TranslationIssueCode
  severity: TranslationSeverity
  cueIds: string[]
  confidence: TranslationConfidence
  message: string
}

export interface TranslationAssessment {
  version: 'translation-assessment-v2'
  disposition: TranslationDisposition
  issues: TranslationIssue[]
  languageEvidence: 'matched' | 'suspect' | 'unknown'
}

export interface TranslationCue {
  id: string
  sourceIndex: number
  start: number
  end: number
  text: string
  groupId: string
  /** Computed from the complete source timeline before batching or resume filtering. */
  speakingDuration?: number
}

export interface TranslationInput {
  sourceLanguage: string
  targetLocale: string
  mode: TranslationMode
  cues: TranslationCue[]
  contextBefore: TranslationCue[]
  contextAfter: TranslationCue[]
  /** Complete bounded source groups, retained as read-only context across partial retries. */
  sourceSpeechGroups?: ReadonlyArray<{ id: string; cues: readonly TranslationCue[] }>
  glossary: Array<{ source: string; target: string }>
  synopsis?: string
}

export interface TranslationGuidance {
  synopsis?: string
  glossary: Array<{ source: string; target: string }>
}

/** Validate optional, user-authored context before it crosses the IPC boundary. */
export function translationGuidanceError(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return 'Ngữ cảnh dịch không hợp lệ.'
  const raw = value as Record<string, unknown>
  if (raw.synopsis != null && (typeof raw.synopsis !== 'string' || raw.synopsis.length > 2000)) return 'Mô tả nội dung tối đa 2000 ký tự.'
  if (!Array.isArray(raw.glossary) || raw.glossary.length > 50) return 'Glossary tối đa 50 thuật ngữ.'
  const seen = new Set<string>()
  for (const item of raw.glossary) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Thuật ngữ dịch không hợp lệ.'
    const entry = item as Record<string, unknown>
    if (typeof entry.source !== 'string' || typeof entry.target !== 'string' || !entry.source.trim() || !entry.target.trim() || entry.source.length > 160 || entry.target.length > 160) return 'Mỗi thuật ngữ cần bản gốc và bản dịch, tối đa 160 ký tự mỗi phần.'
    const source = entry.source.trim().normalize('NFC')
    if (seen.has(source)) return 'Thuật ngữ nguồn bị trùng trong glossary.'
    seen.add(source)
  }
  return null
}

export interface TranslationItem {
  id: string
  text: string
}

export interface TranslationBatchResult {
  items: TranslationItem[]
  assessment: TranslationAssessment
  modelIdentity: string
}

export interface TranslationCapability {
  provider: string
  modelIdentity: string
  revisionKnown: boolean
  format: TranslationFormat
  contextTokens: number | null
  outputTokens: number | null
  countTokens?: (text: string) => number
}

/** Capability is evidence for one stage; it is independent from locale labels. */
export interface TranslationStageCapability {
  stage: 'asr' | 'ocr' | 'translation' | 'tts' | 'render'
  required: boolean
  support: 'supported' | 'unsupported' | 'unknown'
  qualified: boolean
  reason: string
}
