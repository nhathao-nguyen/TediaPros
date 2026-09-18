export interface QualityFinding {
  kind: 'structural' | 'semantic' | 'style'
  evidence: 'verified' | 'suspect' | 'advisory'
  code: string
  sourceCueIds: string[]
  sourceSpans: string[]
}

export interface SemanticEvidenceInput {
  origin: 'provider' | 'deterministic'
  evidence: QualityFinding['evidence']
  code: string
  sourceCueIds?: readonly string[]
  sourceSpans?: readonly string[]
}

function uniqueNonempty(values: readonly string[] | undefined): string[] {
  if (!values) return []
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}

/**
 * Provider claims are useful review evidence but are not independently verified.
 */
export function normalizeSemanticEvidence(input: SemanticEvidenceInput): QualityFinding {
  return {
    kind: 'semantic',
    evidence: input.origin === 'provider' && input.evidence === 'verified' ? 'suspect' : input.evidence,
    code: input.code,
    sourceCueIds: uniqueNonempty(input.sourceCueIds),
    sourceSpans: uniqueNonempty(input.sourceSpans)
  }
}
