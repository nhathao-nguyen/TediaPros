import type { AutoShortBlurMode, AutoShortOcrBlurProfile } from '../shared/types'
import type { OcrProviderReport, OcrVisualTransport } from '../shared/ocrVisualTimeline'
import type { SubtitlePlacementDecision } from '../shared/autoShortSubtitlePlacement'

const REDACTED_PATH = '[đường dẫn đã ẩn]'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface OcrBlurAuditMetadata {
  blurMode: AutoShortBlurMode
  ocrEngineVersion?: string
  ocrSampleFps: 8
  ocrScanProfile?: AutoShortOcrBlurProfile
  ocrVisualSegmentCount?: number
  ocrBoxSegmentCount?: number
  ocrMaskedDurationSeconds?: number
  ocrTransport?: OcrVisualTransport
  ocrImplementationFingerprint?: string
  ocrProvider?: OcrProviderReport
}

export function createOcrBlurAuditMetadata(summary: {
  blurMode: AutoShortBlurMode
  engineVersion?: string
  scanProfile?: AutoShortOcrBlurProfile
  visualSegmentCount?: number
  boxSegmentCount?: number
  maskedDurationSeconds?: number
  transport?: OcrVisualTransport
  implementationFingerprint?: string
  ocrProvider?: OcrProviderReport
}): OcrBlurAuditMetadata {
  if (summary.blurMode !== 'ocr-auto') {
    return {
      blurMode: summary.blurMode,
      ocrSampleFps: 8
    }
  }
  return {
    blurMode: summary.blurMode,
    ocrEngineVersion: summary.engineVersion,
    ocrSampleFps: 8,
    ocrScanProfile: summary.scanProfile,
    ocrVisualSegmentCount: summary.visualSegmentCount,
    ocrBoxSegmentCount: summary.boxSegmentCount,
    ocrMaskedDurationSeconds: summary.maskedDurationSeconds,
    ...(summary.transport ? { ocrTransport: summary.transport } : {}),
    ...(summary.implementationFingerprint ? { ocrImplementationFingerprint: summary.implementationFingerprint } : {}),
    ...(summary.ocrProvider ? { ocrProvider: summary.ocrProvider } : {})
  }
}

export function createSubtitlePlacementAuditMetadata(
  decision: SubtitlePlacementDecision
): SubtitlePlacementDecision {
  return {
    version: 1,
    mode: decision.mode,
    reason: decision.reason,
    region: decision.region ? { ...decision.region } : null,
    candidateCount: decision.candidateCount,
    ...(decision.coverage != null ? { coverage: Math.round(decision.coverage * 10_000) / 10_000 } : {}),
    ...(decision.typicalLineHeight != null
      ? { typicalLineHeight: Math.round(decision.typicalLineHeight * 10_000) / 10_000 }
      : {})
  }
}

/**
 * Keep failure diagnostics useful without writing user-selected absolute paths
 * to the Auto Short log or audit manifest.
 */
export function sanitizeAutoShortAuditError(
  error: unknown,
  sensitivePaths: readonly (string | null | undefined)[]
): string {
  let text = error instanceof Error ? error.stack || error.message : String(error)
  const candidates = new Set<string>()
  for (const path of sensitivePaths) {
    if (!path) continue
    candidates.add(path)
    candidates.add(path.replaceAll('\\', '/'))
    candidates.add(path.replaceAll('/', '\\'))
  }
  for (const path of [...candidates].sort((a, b) => b.length - a.length)) {
    if (!path) continue
    text = text.replace(new RegExp(escapeRegExp(path), 'giu'), REDACTED_PATH)
  }
  return text
}
