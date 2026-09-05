import type { AutoShortBlurMode, AutoShortOcrBlurProfile } from '../shared/types'

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
}

export function createOcrBlurAuditMetadata(summary: {
  blurMode: AutoShortBlurMode
  engineVersion?: string
  scanProfile?: AutoShortOcrBlurProfile
  visualSegmentCount?: number
  boxSegmentCount?: number
  maskedDurationSeconds?: number
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
    ocrMaskedDurationSeconds: summary.maskedDurationSeconds
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
