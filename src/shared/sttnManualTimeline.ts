import { validateStabilizedOcrVisualTimeline, type OcrVisualTimeline, type ExpectedOcrTimelineGeometry } from './ocrVisualTimeline'

/** Explicit user-selected mask. Never project this placeholder into subtitles. */
export function createManualSttnTimeline(expected: ExpectedOcrTimelineGeometry): OcrVisualTimeline {
  const frames = Math.ceil(expected.durationSeconds * 8)
  return validateStabilizedOcrVisualTimeline({
    schemaVersion: 1, protocol: 'ocr-visual-cues/1', profile: 'accurate',
    video: { width: expected.width, height: expected.height, durationSeconds: expected.durationSeconds,
      sampleFps: 8, frameCount: frames, geometryFingerprint: expected.geometryFingerprint },
    scanRegion: expected.scanRegion,
    segments: [{ id: 'accurate-0', startFrame: 0, endFrameExclusive: frames,
      start: 0, end: expected.durationSeconds, text: 'manual-mask', confidence: 1,
      boxes: [{ ...expected.scanRegion, text: 'manual-mask', confidence: 1 }] }]
  }, expected)
}
