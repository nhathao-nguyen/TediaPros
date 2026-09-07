import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAutoShortStartRequest } from '../src/shared/autoShortContract'
import { autoShortNeedsOcr, effectiveAutoShortOcrProfile, isAutomaticOcrBlur, isAutomaticOcrProcessing, isSttnRemoval, normalizeAutoShortBlurMode } from '../src/shared/autoShortOcrBlur'
import type { AutoShortConfig } from '../src/shared/types'

function request(overrides: Partial<AutoShortConfig> = {}) {
  return {
    items: [{ id: 'source', filePath: 'C:\\media\\source.mp4' }],
    config: {
      subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu',
      lamMo: true, blurMode: 'sttn', ocrBlurProfile: 'fast',
      ocrRegion: { x0: 0, y0: 0.6, x1: 1, y1: 1 },
      blurRegions: [{ id: 'old', x0: 0, y0: 0, x1: 1, y1: 1 }],
      translateTarget: 'none', translateProvider: 'local', ttsEnabled: false,
      voiceOverMode: false, audioMode: 'replace', outputDir: 'C:\\media\\output',
      ...overrides
    }
  }
}

test('STTN survives validation and persisted mode migration', () => {
  const result = validateAutoShortStartRequest(request())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.config.blurMode, 'sttn')
  assert.equal(normalizeAutoShortBlurMode('sttn'), 'sttn')
})

test('STTN requires accurate visual OCR even when subtitles come from Whisper', () => {
  const config = request().config as AutoShortConfig
  assert.equal(autoShortNeedsOcr(config), true)
  assert.equal(effectiveAutoShortOcrProfile(config), 'accurate')
  assert.equal(isAutomaticOcrBlur(config), false)
  assert.equal(isSttnRemoval(config), true)
  assert.equal(isAutomaticOcrProcessing(config), true)
})

test('STTN rejects absent, inverted and out-of-bounds scan regions', () => {
  for (const ocrRegion of [null, { x0: 0.9, y0: 0, x1: 0.2, y1: 1 }, { x0: 0, y0: 0, x1: 1.1, y1: 1 }]) {
    const result = validateAutoShortStartRequest(request({ ocrRegion }))
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, /OCR/)
  }
})

test('disabled STTN selection requires no erasure OCR and retains its saved mode', () => {
  const result = validateAutoShortStartRequest(request({ lamMo: false, ocrRegion: null }))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.config.blurMode, 'sttn')
  assert.equal(autoShortNeedsOcr(result.value.config), false)
  assert.equal(effectiveAutoShortOcrProfile(result.value.config), 'fast')
  assert.equal(isAutomaticOcrBlur(result.value.config), false)
  assert.equal(isSttnRemoval(result.value.config), false)
  assert.equal(isAutomaticOcrProcessing(result.value.config), false)
})

test('STTN contract clears manual rectangles before downstream rendering', () => {
  const result = validateAutoShortStartRequest(request())
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.value.config.blurRegions, [])
})
