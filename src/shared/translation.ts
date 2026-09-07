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
}

export interface TranslationInput {
  sourceLanguage: string
  targetLocale: string
  mode: TranslationMode
  cues: TranslationCue[]
  contextBefore: TranslationCue[]
  contextAfter: TranslationCue[]
  glossary: Array<{ source: string; target: string }>
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
