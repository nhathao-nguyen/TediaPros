import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAutoShortStartRequest } from '../src/shared/autoShortContract'
import type { AutoShortConfig, AutoShortStartRequest } from '../src/shared/types'

function request(config: Partial<AutoShortConfig> = {}): AutoShortStartRequest {
  return {
    items: [{ id: 'video-1', filePath: 'C:\\media\\source.mp4' }],
    config: {
      subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu',
      blurRegions: [], lamMo: false, blurMode: 'manual', ocrBlurProfile: 'accurate',
      translateTarget: 'none', translateProvider: 'local', ttsEnabled: false,
      voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 20,
      outputDir: 'C:\\media\\out', ...config
    }
  }
}

test('old Auto Short requests keep title generation disabled', () => {
  const result = validateAutoShortStartRequest(request())
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.config.videoTitle, undefined)
})

test('title option survives validation for ASR, OCR and fused extraction, with or without translation', () => {
  for (const subtitleMethod of ['whisper', 'ocr', 'whisper-ocr'] as const) {
    for (const translateTarget of ['none', 'vi', 'ja']) {
      const videoTitle = { provider: 'gemini' as const, language: translateTarget === 'none' ? 'auto' : translateTarget }
      const result = validateAutoShortStartRequest(request({ subtitleMethod, translateTarget, videoTitle }))
      assert.equal(result.ok, true)
      if (result.ok) assert.deepEqual(result.value.config.videoTitle, videoTitle)
    }
  }
})

test('invalid title config is rejected before starting extraction/rendering', () => {
  for (const videoTitle of [true, {}, { provider: 'unknown', language: 'vi' },
    { provider: 'gemini', language: '' }, { provider: 'local', language: 'auto', serverUrl: 'file:///secrets' }]) {
    const result = validateAutoShortStartRequest(request({ videoTitle: videoTitle as never }))
    assert.equal(result.ok, false, JSON.stringify(videoTitle))
  }
})
