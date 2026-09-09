import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAutomaticOcrBlur,
  autoShortNeedsOcr,
  effectiveAutoShortOcrProfile,
  normalizeAutoShortBlurMode,
  normalizeAutoShortOcrBlurProfile
} from '../src/shared/autoShortOcrBlur'
import { validateAutoShortStartRequest } from '../src/shared/autoShortContract'
import type { AutoShortConfig, AutoShortStartRequest } from '../src/shared/types'

function autoShortRequest(config: Partial<AutoShortConfig> = {}): AutoShortStartRequest {
  return {
    items: [{ id: 'video-1', filePath: 'C:\\media\\input.mp4' }],
    config: {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      whisperDevice: 'cpu',
      ocrRegion: null,
      blurRegions: [],
      lamMo: false,
      blurMode: 'manual',
      ocrBlurProfile: 'accurate',
      translateTarget: 'none',
      translateProvider: 'local',
      ttsEnabled: false,
      voiceOverMode: false,
      audioMode: 'replace',
      originalAudioVolume: 20,
      outputDir: 'C:\\media\\out',
      ...config
    }
  }
}

test('legacy config migrates to manual and accurate', () => {
  const untypedRequest = {
    items: [{ id: 'video-1', filePath: 'C:\\media\\video.mp4' }],
    config: {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      blurRegions: [],
      lamMo: false,
      translateTarget: 'none',
      translateProvider: 'local',
      ttsEnabled: false,
      audioMode: 'replace',
      originalAudioVolume: 20,
      outputDir: 'C:\\media\\out'
    }
  }
  const result = validateAutoShortStartRequest(untypedRequest)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.config.blurMode, 'manual')
    assert.equal(result.value.config.ocrBlurProfile, 'accurate')
  }
})

test('translation guidance rejects malformed and oversized input at IPC boundary', () => {
  for (const translationGuidance of [
    { synopsis: 'x'.repeat(2001), glossary: [] },
    { synopsis: '', glossary: [{ source: '', target: 'van' }] },
    { synopsis: '', glossary: [{ source: '阀门', target: 12 }] },
    { synopsis: '', glossary: [{ source: '阀门', target: 'van' }, { source: '阀门', target: 'khóa' }] }
  ]) {
    assert.equal(validateAutoShortStartRequest(autoShortRequest({ translationGuidance } as never)).ok, false)
  }
  assert.equal(validateAutoShortStartRequest(autoShortRequest({ translationGuidance: {
    synopsis: 'Video hướng dẫn thiết bị', glossary: [{ source: '阀门', target: 'van' }]
  } })).ok, true)
})

test('explicit unknown blur mode is rejected', () => {
  const invalid = autoShortRequest({ blurMode: 'band' as never })
  const result = validateAutoShortStartRequest(invalid)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /Chế độ làm mờ không hợp lệ/iu)
})

test('explicit unknown OCR profile is rejected', () => {
  const invalid = autoShortRequest({ ocrBlurProfile: 'balanced' as never })
  const result = validateAutoShortStartRequest(invalid)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /Hồ sơ quét OCR không hợp lệ/iu)
})

test('active automatic blur requires OCR region', () => {
  const missingRegion = autoShortRequest({
    lamMo: true,
    blurMode: 'ocr-auto',
    ocrBlurProfile: 'accurate',
    ocrRegion: null
  })
  const result = validateAutoShortStartRequest(missingRegion)
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.error, /Tự động OCR cần một vùng OCR hợp lệ/iu)
})

test('blur-off retains OCR-auto selection', () => {
  const req = autoShortRequest({
    lamMo: false,
    blurMode: 'ocr-auto',
    ocrBlurProfile: 'fast'
  })
  const result = validateAutoShortStartRequest(req)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.config.blurMode, 'ocr-auto')
    assert.equal(result.value.config.ocrBlurProfile, 'fast')
    assert.equal(isAutomaticOcrBlur(result.value.config), false)
    assert.equal(autoShortNeedsOcr(result.value.config), false)
    assert.equal(effectiveAutoShortOcrProfile(result.value.config), 'fast')
  }
})

test('manual mode retains rectangles', () => {
  const req = autoShortRequest({
    lamMo: true,
    blurMode: 'manual',
    blurRegions: [
      { id: 'r1', x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 },
      { id: 'r2', x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.6 }
    ]
  })
  const result = validateAutoShortStartRequest(req)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.config.blurRegions.length, 2)
    assert.equal(result.value.config.blurRegions[0].id, 'r1')
    assert.equal(result.value.config.blurRegions[1].id, 'r2')
  }
})

test('automatic mode retains but does not activate rectangles', () => {
  const req = autoShortRequest({
    lamMo: true,
    blurMode: 'ocr-auto',
    ocrRegion: { x0: 0.1, y0: 0.7, x1: 0.9, y1: 0.95 },
    blurRegions: [
      { id: 'r1', x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 },
      { id: 'r2', x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.6 }
    ]
  })
  const result = validateAutoShortStartRequest(req)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.config.blurRegions.length, 2)
    assert.equal(isAutomaticOcrBlur(result.value.config), true)
  }
})

test('OCR subtitle methods still need OCR', () => {
  const ocrMethod = autoShortRequest({
    subtitleMethod: 'ocr',
    lamMo: false,
    blurMode: 'manual'
  }).config
  const whisperOcrMethod = autoShortRequest({
    subtitleMethod: 'whisper-ocr',
    lamMo: false,
    blurMode: 'manual'
  }).config
  assert.equal(autoShortNeedsOcr(ocrMethod), true)
  assert.equal(autoShortNeedsOcr(whisperOcrMethod), true)
})

test('persisted mode normalizer rejects stale values', () => {
  assert.equal(normalizeAutoShortBlurMode(undefined), 'manual')
  assert.equal(normalizeAutoShortBlurMode(null), 'manual')
  assert.equal(normalizeAutoShortBlurMode('band'), 'manual')
  assert.equal(normalizeAutoShortBlurMode('ocr-auto'), 'ocr-auto')
  assert.equal(normalizeAutoShortBlurMode('manual'), 'manual')
})

test('persisted profile normalizer rejects stale values', () => {
  assert.equal(normalizeAutoShortOcrBlurProfile(undefined), 'accurate')
  assert.equal(normalizeAutoShortOcrBlurProfile(null), 'accurate')
  assert.equal(normalizeAutoShortOcrBlurProfile('balanced'), 'accurate')
  assert.equal(normalizeAutoShortOcrBlurProfile('fast'), 'fast')
  assert.equal(normalizeAutoShortOcrBlurProfile('accurate'), 'accurate')
})
