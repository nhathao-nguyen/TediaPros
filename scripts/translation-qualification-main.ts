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
  schemaVersion: 1
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
  semanticReview: 'pending' | 'pass' | 'fail'
  naturalness: number | null
}

export interface TranslationQualificationReport {
  schemaVersion: 1
  generatedAt: string
  mode: 'offline'
  variant: 'baseline' | 'candidate'
  runs: number
  caseCount: number
  providerCalls: 0
  semanticReview: 'pending'
  records: TranslationQualificationRecord[]
}

// Keep the executable implementation in one place. This re-export is also
// useful to esbuild based contract tests without introducing a runtime loader.
export { parseQualificationArgs, buildOfflineQualificationReport, runOfflineQualification, main } from './translation-qualification-main.mjs'
