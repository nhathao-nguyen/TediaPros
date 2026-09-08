/**
 * Typed entrypoint contract for the qualification harness. The package script
 * executes the dependency-free `.mjs` companion so a clean install never needs
 * a TypeScript runtime; tests and tooling can import these same functions.
 */
export interface TranslationQualificationCase {
  id: string
  sourceLocale: string
  targetLocale: string
  source: string
  reference: string
  expected: 'valid' | 'warning' | 'needs-review'
  tags: string[]
}

export interface TranslationQualificationRecord {
  schemaVersion: 2
  caseId: string
  variant: 'baseline' | 'candidate'
  run: number
  modelIdentity: string
  promptVersion: string
  mode: 'offline' | 'live'
  inputDigest: string
  elapsedMs: number
  requests: number
  recoveryRequests: number
  lostCueCount: number
  unexpectedCueCount: number
  expectedDisposition: 'validated' | 'with-warnings' | 'needs-review'
  observedDisposition: 'validated' | 'with-warnings' | 'needs-review'
  issueCodes: string[]
  promptBytes: number
  wireFormat: 'json-items' | 'id-lines'
  semanticReview: 'pending' | 'pass' | 'fail'
  naturalness: number | null
}

export interface TranslationQualificationReport {
  schemaVersion: 2
  generatedAt: string
  mode: 'offline'
  variant: 'baseline' | 'candidate'
  runs: number
  caseCount: number
  providerCalls: number
  recoveryRequests: number
  semanticReview: 'pending'
  records: TranslationQualificationRecord[]
}

// Keep the executable implementation in one place. This re-export is also
// useful to esbuild based contract tests without introducing a runtime loader.
export { parseQualificationArgs, expandDirectedLocaleMatrix, buildOfflineQualificationReport, runOfflineQualification, main } from './translation-qualification-main.mjs'
