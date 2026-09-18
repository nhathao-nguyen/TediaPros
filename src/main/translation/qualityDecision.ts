import type { QualityFinding } from './semanticEvidence'

export type QualityDecision = 'reject' | 'review' | 'eligible'

export function decideQuality(findings: readonly QualityFinding[]): QualityDecision {
  if (findings.some((finding) => finding.kind === 'structural' ||
    (finding.kind === 'semantic' && finding.evidence === 'verified'))) return 'reject'
  if (findings.some((finding) => finding.kind === 'semantic' && finding.evidence === 'suspect')) return 'review'
  return 'eligible'
}
