import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  WHISPER_MODEL_CATALOG,
  normalizeWhisperModel,
  type WhisperModelId
} from '../src/main/modelCatalog'
import {
  isWhisperVersionEvent,
  parseWhisperVersion,
  type WhisperVersionEvent
} from '../src/main/engineProtocol'
import {
  findLocalWhisperModel,
  isCompleteWhisperModel
} from '../src/main/modelStore'
import {
  isAutoShortWhisperEngineReady,
  planAutoShortVoiceTimeline,
  validateAutoShortTtsModel,
  validateAutoShortTimelineSync,
  resolveAutoShortWhisperLanguage,
  buildAutoShortTtsTrimFilter,
  AUTO_SHORT_TTS_MIN_GAP_SECONDS,
  AUTO_SHORT_TTS_MAX_TEMPO
} from '../src/main/autoShortPolicy'
import { taoFilterComplex } from '../src/main/burn'
import { audioMixGains } from '../src/shared/audioMix'
import { validateAutoShortStartRequest } from '../src/shared/autoShortContract'
import {
  inferTranslationSourceLanguage,
  isRetryableLocalTranslationError,
  isCompleteLocalTranslationBatch,
  splitLocalTranslationBatch
} from '../src/main/localTranslatePolicy'
import {
  buildTranslationContext,
  huongDan,
  validateTranslationItems
} from '../src/main/translate-shared'
import { resolveTranslationSourceLanguage } from '../src/main/localTranslatePolicy'
import {
  buildSemanticGroups,
  buildSemanticBatches,
  splitSemanticBatch,
  DEFAULT_SEMANTIC_GROUPING_POLICY,
  joinGroupText,
  isSentenceTerminal
} from '../src/main/semanticGrouping'
import { clampAlignedCueTimeline, fuseWhisperAndOcr } from '../src/shared/autoShortAlignment'

async function writeCompleteWhisperModel(modelDir: string, id: WhisperModelId): Promise<void> {
  await mkdir(modelDir, { recursive: true })
  const files = ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.json']
  const entries = [] as Array<{ path: string; bytes: number; sha256: string }>
  for (const file of files) {
    const content = Buffer.from(`${id}-${file}-complete-model-fixture`)
    await writeFile(join(modelDir, file), content)
    entries.push({ path: file, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') })
  }
  await writeFile(join(modelDir, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id,
    repoId: `Systran/faster-whisper-${id}`,
    revision: WHISPER_MODEL_CATALOG[id].revision,
    backend: 'faster-whisper',
    format: 'ctranslate2',
    files: entries,
    languageFamily: 'multilingual',
    engineProtocol: 'whisper-engine/1'
  }))
}

test('catalog exposes exactly the three local multilingual models', () => {
  assert.deepEqual(Object.keys(WHISPER_MODEL_CATALOG), ['base', 'small', 'medium'])
  for (const id of ['base', 'small', 'medium'] as WhisperModelId[]) {
    assert.equal(WHISPER_MODEL_CATALOG[id].backend, 'faster-whisper')
    assert.equal(WHISPER_MODEL_CATALOG[id].format, 'ctranslate2')
    assert.equal(WHISPER_MODEL_CATALOG[id].languageFamily, 'multilingual')
  }
})

test('legacy model and method names migrate without prompting', () => {
  assert.equal(normalizeWhisperModel('tiny'), 'base')
  assert.equal(normalizeWhisperModel('large-v3'), 'medium')
  assert.equal(normalizeWhisperModel('small'), 'small')
  assert.equal(normalizeWhisperModel('unknown'), 'base')
})

test('engine readiness requires the local protocol and faster-whisper backend', () => {
  const event: WhisperVersionEvent = {
    type: 'version',
    protocol: 'whisper-engine/1',
    engine: 'faster-whisper',
    version: '1.0.0',
    features: ['probe', 'vad', 'word_timestamps']
  }
  assert.equal(isWhisperVersionEvent(event), true)
  assert.deepEqual(parseWhisperVersion(JSON.stringify(event)), event)
  assert.equal(parseWhisperVersion('{"type":"version","version":"3.0.0"}'), null)
  assert.equal(isWhisperVersionEvent({ ...event, protocol: 'legacy' }), false)
})

test('model resolver prefers a valid current profile model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-model-test-'))
  const current = join(root, 'current')
  const legacy = join(root, 'legacy')
  const currentModel = join(current, 'base')
  const legacyModel = join(legacy, 'base')
  await writeCompleteWhisperModel(currentModel, 'base')
  await writeCompleteWhisperModel(legacyModel, 'base')

  const result = await findLocalWhisperModel('base', [current, legacy])
  assert.equal(result?.root, current)
  assert.equal(result?.modelPath, currentModel)
})

test('model integrity rejects a manifest with the wrong hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-model-integrity-'))
  const modelDir = join(root, 'base')
  await mkdir(modelDir, { recursive: true })
  await writeFile(join(modelDir, 'model.bin'), Buffer.from('actual'))
  await writeFile(join(modelDir, 'manifest.json'), JSON.stringify({
    id: 'base', backend: 'faster-whisper', format: 'ctranslate2', filename: 'model.bin',
    bytes: 6, sha256: 'not-the-file-hash', languageFamily: 'multilingual',
    engineProtocol: 'whisper-engine/1'
  }))
  assert.equal(await isCompleteWhisperModel(modelDir, 'base'), false)
})

test('model resolver rejects a model outside the canonical profile root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-model-legacy-'))
  const legacy = join(root, 'tediapros')
  const modelDir = join(legacy, 'small')
  await mkdir(modelDir, { recursive: true })
  await writeCompleteWhisperModel(modelDir, 'small')
  const result = await findLocalWhisperModel('small', [join(root, 'current')])
  assert.equal(result, null)
})

test('partial native model is never treated as complete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-model-partial-'))
  const modelDir = join(root, 'base')
  const bytes = Buffer.from('partial-model')
  const { createHash } = await import('node:crypto')
  await mkdir(modelDir, { recursive: true })
  await writeFile(join(modelDir, 'model.bin'), bytes)
  await writeFile(join(modelDir, 'model.bin.partial'), Buffer.from('unfinished'))
  await writeFile(join(modelDir, 'manifest.json'), JSON.stringify({
    id: 'base', backend: 'faster-whisper', format: 'ctranslate2', filename: 'model.bin',
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    languageFamily: 'multilingual', engineProtocol: 'whisper-engine/1'
  }))
  assert.equal(await isCompleteWhisperModel(modelDir, 'base'), false)
})

test('AutoShort migrates fast-whisper and defaults missing voiceOverMode to false', () => {
  const result = validateAutoShortStartRequest({
    items: [{ id: 'video-1', filePath: 'C:\\media\\video.mp4' }],
    config: {
      subtitleMethod: 'fast-whisper',
      whisperModel: 'tiny',
      blurRegions: [],
      lamMo: false,
      translateTarget: 'none',
      translateProvider: 'local',
      ttsEnabled: false,
      audioMode: 'replace',
      originalAudioVolume: 20,
      outputDir: 'C:\\media\\out'
    }
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.config.subtitleMethod, 'whisper')
    assert.equal(result.value.config.whisperModel, 'base')
    assert.equal(result.value.config.whisperDevice, 'cuda')
    assert.equal(result.value.config.voiceOverMode, false)
  }
})

test('AutoShort readiness accepts the current whisper-local protocol instead of a legacy version prefix', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.doesNotMatch(source, /engine\?\.version\?\.startsWith\(['"]3\./u)
})

test('AutoShort engine policy accepts a healthy Faster-Whisper protocol', () => {
  assert.equal(isAutoShortWhisperEngineReady({
    has: true,
    healthy: true,
    protocol: 'whisper-engine/1',
    engine: 'faster-whisper'
  }), true)
  assert.equal(isAutoShortWhisperEngineReady({
    has: true,
    healthy: true,
    protocol: 'legacy',
    engine: 'faster-whisper'
  }), false)
  assert.equal(isAutoShortWhisperEngineReady({
    has: true,
    healthy: false,
    protocol: 'whisper-engine/1',
    engine: 'faster-whisper'
  }), false)
})

test('AutoShort translation guidance does not ask the model to fit speech to the source timeline', async () => {
  const { huongDan } = await import('../src/main/translate-shared')
  const prompt = huongDan('en')
  assert.doesNotMatch(prompt, /vừa vặn với nhịp video/iu)
  assert.match(prompt, /không được bỏ thông tin|đầy đủ mọi thông tin/iu)
})

test('AutoShort translation contract carries source, target, stable ids, and bounded context', () => {
  const cues = buildTranslationContext([
    { id: 'cue-a', sourceIndex: 0, text: 'first' },
    { id: 'cue-b', sourceIndex: 1, text: 'second' },
    { id: 'cue-c', sourceIndex: 2, text: 'third' }
  ], 1)
  const prompt = huongDan('vi', { sourceLanguage: 'en' })
  assert.match(prompt, /source_language\s*[:=]\s*en/iu)
  assert.match(prompt, /target_language\s*[:=]\s*vi/iu)
  assert.doesNotMatch(prompt, /ký tự Hán|chữ Latin tiếng Việt|sửa câu tiếng Trung/iu)
  const userPayload = cues.map((cue) => `[${cue.id}] ${cue.text}`).join('\n')
  assert.match(userPayload, /cue-b/iu)
  assert.match(userPayload, /first/iu)
  assert.match(userPayload, /third/iu)
})

test('AutoShort translation guidance is conservative with uncertain terms and target-language output', () => {
  const prompt = huongDan('target-code', { sourceLanguage: 'source-code' })
  assert.match(prompt, /không suy đoán|không tự thêm|không bịa/iu)
  assert.match(prompt, /giữ.*tên riêng|thuật ngữ/iu)
  assert.match(prompt, /không chắc|mơ hồ|không rõ/iu)
  assert.doesNotMatch(prompt, /tiếng Việt|tiếng Trung|tiếng Anh|câu hiện tại/iu)
  assert.doesNotMatch(prompt, /không để lại bất kỳ từ ngữ, ký tự hoặc chữ viết thuộc ngôn ngữ nguồn/iu)
})

test('AutoShort translation response validation is identity-based and rejects malformed batches', () => {
  assert.doesNotThrow(() => validateTranslationItems(
    [{ id: 'cue-a', text: 'A' }, { id: 'cue-b', text: 'B' }],
    ['cue-a', 'cue-b']
  ))
  assert.throws(() => validateTranslationItems(
    [{ id: 'cue-a', text: 'A' }, { id: 'cue-a', text: 'B' }],
    ['cue-a', 'cue-b']
  ), /trùng|duplicate/iu)
  assert.throws(() => validateTranslationItems(
    [{ id: 'cue-a', text: 'A' }],
    ['cue-a', 'cue-b']
  ), /thiếu|missing/iu)
  assert.throws(() => validateTranslationItems(
    [{ id: 'cue-a', text: 'A' }, { id: 'cue-x', text: 'X' }],
    ['cue-a', 'cue-b']
  ), /không xác định|unknown/iu)
})

test('AutoShort source-language resolution prefers explicit config and never guesses a target', () => {
  assert.equal(resolveTranslationSourceLanguage('en', 'zh'), 'en')
  assert.equal(resolveTranslationSourceLanguage('auto', 'zh'), 'zh')
  assert.equal(resolveTranslationSourceLanguage('', 'en'), 'en')
  assert.equal(resolveTranslationSourceLanguage('', ''), 'auto')
})

test('AutoShort has no hidden Vietnamese TTS language fallback', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.doesNotMatch(source, /ttsLanguage\s*\|\|\s*'vi'/u)
  assert.doesNotMatch(source, /\?\s*config\.translateTarget\s*:\s*'vi'/u)
})

test('AutoShort validates the selected server TTS capability against the requested language', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(source, /validateAutoShortTtsModel/u)
})

test('AutoShort accepts only a TTS capability that declares the requested language', () => {
  assert.equal(validateAutoShortTtsModel({ id: 'tts-vietnamese', available: true, languages: ['vi'] }, 'vi'), undefined)
  assert.match(validateAutoShortTtsModel({ id: 'tts-vietnamese', available: true, languages: ['vi'] }, 'en') || '', /không hỗ trợ/iu)
  assert.equal(validateAutoShortTtsModel({ id: 'tts-multilingual', available: true, languages: ['en', 'zh'] }, 'en'), undefined)
})

test('AutoShort plans voice timing per cue: a long cue does not accelerate the entire video and respects hard max tempo', () => {
  const cues = [
    { start: 0, end: 2.0 },
    { start: 2.5, end: 3.7 },
    { start: 4.0, end: 5.5 }
  ]
  const naturalDurations = [1.8, 1.5, 1.4]
  const plan = planAutoShortVoiceTimeline(cues, naturalDurations, 6.0, 1.35)

  assert.equal(plan.cues[0].tempo, 1.0)
  assert.equal(plan.cues[1].tempo, 1.25)
  assert.equal(plan.cues[2].tempo, 1.0)
})

test('AutoShort regression test: voice and subtitle do not spill into adjacent cue or stretch into next scene', () => {
  const cues = [
    { id: 'cue-0', start: 0.0, end: 2.0, text: 'Text A' },
    { id: 'cue-1', start: 2.0, end: 4.0, text: 'Text B' }
  ]
  const naturalDurations = [3.5, 1.8] // Cue 0 TTS is 3.5s (> 2.0s)
  const plan = planAutoShortVoiceTimeline(cues, naturalDurations, 5.0, 1.35)

  // Subtitle A must NOT extend into cue B
  assert.equal(plan.cues[0].subtitleStart, 0.0)
  assert.equal(plan.cues[0].subtitleEnd, 2.0)
  // Voice A plannedStart must be 0.0
  assert.equal(plan.cues[0].start, 0.0)
  // Cue 1 subtitle must stay at 2.0 -> 4.0
  assert.equal(plan.cues[1].subtitleStart, 2.0)
  assert.equal(plan.cues[1].subtitleEnd, 4.0)
})

test('AutoShort scene transition: gaps between non-adjacent cues are not treated as free slack for earlier voice', () => {
  const cues = [
    { id: 'cue-0', start: 0.0, end: 3.0 },
    { id: 'cue-1', start: 5.0, end: 8.0 }
  ]
  const plan = planAutoShortVoiceTimeline(cues, [4.8, 2.0], 10.0, 1.35)
  // Voice A available duration is 3.0s (not stretched to 5.0s or 4.8s into gap)
  assert.equal(plan.cues[0].availableDuration, 3.0)
  assert.equal(plan.cues[0].subtitleEnd, 3.0)
  assert.equal(plan.cues[1].subtitleStart, 5.0)
  assert.equal(plan.cues[1].subtitleEnd, 8.0)
})

test('AutoShort preserves cue identity throughout timeline plan and sync validation', () => {
  const sourceCues = [
    { id: 'custom-a', start: 0.0, end: 2.0, text: 'Hello' },
    { id: 'custom-b', start: 2.5, end: 4.5, text: 'World' },
    { id: 'custom-c', start: 5.0, end: 7.0, text: 'Test' }
  ]
  const targetCues = [
    { id: 'custom-a', start: 0.0, end: 2.0, text: 'Xin chào' },
    { id: 'custom-b', start: 2.5, end: 4.5, text: 'Thế giới' },
    { id: 'custom-c', start: 5.0, end: 7.0, text: 'Kiểm tra' }
  ]
  const plan = planAutoShortVoiceTimeline(targetCues, [1.8, 1.9, 1.5], 10.0)
  assert.equal(plan.cues[0].cueId, 'custom-a')
  assert.equal(plan.cues[1].cueId, 'custom-b')
  assert.equal(plan.cues[2].cueId, 'custom-c')

  const validation = validateAutoShortTimelineSync(
    sourceCues,
    targetCues,
    plan.cues.map((c, i) => ({
      cueId: c.cueId,
      sourceStart: sourceCues[i].start,
      sourceEnd: sourceCues[i].end,
      renderSubtitleStart: c.subtitleStart,
      renderSubtitleEnd: c.subtitleEnd,
      voiceStart: c.start,
      voiceEnd: c.voiceEnd,
      semanticOverflowMs: c.semanticOverflowMs
    })),
    10.0
  )
  assert.equal(validation.ok, true)
})

test('AutoShort adjusts tempo per cue without accelerating adjacent normal cues', () => {
  const cues = [
    { start: 0.0, end: 2.0 },
    { start: 2.0, end: 3.0 },
    { start: 3.0, end: 5.0 }
  ]
  const plan = planAutoShortVoiceTimeline(cues, [1.8, 1.25, 1.5], 6.0, 1.35)
  assert.equal(plan.cues[0].tempo, 1.0)
  assert.ok(plan.cues[1].tempo > 1.15 && plan.cues[1].tempo <= 1.45)
  assert.equal(plan.cues[2].tempo, 1.0)
})

test('AutoShort subtitle render start/end strictly adhere to source semantic anchors', () => {
  const cues = [
    { start: 1.0, end: 3.5 },
    { start: 4.0, end: 7.0 }
  ]
  const plan = planAutoShortVoiceTimeline(cues, [2.0, 2.5], 10.0)
  assert.equal(plan.cues[0].subtitleStart, 1.0)
  assert.equal(plan.cues[0].subtitleEnd, 3.5)
  assert.equal(plan.cues[1].subtitleStart, 4.0)
  assert.equal(plan.cues[1].subtitleEnd, 7.0)
})

test('AutoShort validation rejects voice cue overflow or cue ID mismatch', () => {
  const sourceCues = [{ id: 'cue-0', start: 0.0, end: 2.0 }]
  const targetCues = [{ id: 'cue-0', start: 0.0, end: 2.0 }]

  // 1. Overflow violation (> tolerance)
  const overflowDiag = [{
    cueId: 'cue-0',
    sourceStart: 0.0,
    sourceEnd: 2.0,
    renderSubtitleStart: 0.0,
    renderSubtitleEnd: 2.0,
    voiceStart: 0.0,
    voiceEnd: 2.5,
    semanticOverflowMs: 500
  }]
  const res1 = validateAutoShortTimelineSync(sourceCues, targetCues, overflowDiag, 5.0)
  assert.equal(res1.ok, false)

  // 2. Cue ID mismatch
  const mismatchDiag = [{
    cueId: 'wrong-id',
    sourceStart: 0.0,
    sourceEnd: 2.0,
    renderSubtitleStart: 0.0,
    renderSubtitleEnd: 2.0,
    voiceStart: 0.0,
    voiceEnd: 1.8,
    semanticOverflowMs: 0
  }]
  const res2 = validateAutoShortTimelineSync(sourceCues, targetCues, mismatchDiag, 5.0)
  assert.equal(res2.ok, false)
})

test('AutoShort preserves source cue boundaries and fits each voice inside safe non-overlapping timeline', () => {
  const plan = planAutoShortVoiceTimeline(
    [{ start: 0, end: 1 }, { start: 1, end: 2.5 }],
    [1.8, 1.2],
    3.0,
    2.0
  )
  assert.equal(plan.cues[0].start, 0)
  assert.ok(plan.cues[0].voiceEnd + AUTO_SHORT_TTS_MIN_GAP_SECONDS <= plan.cues[1].start + 0.001)
  assert.ok(plan.cues.every((cue) => cue.start >= 0))
  assert.ok(plan.cues.every((cue) => cue.voiceEnd <= 3.0 + 0.01))
})

test('AutoShort rejects impossible voice timelines with clear diagnostic error without truncating content', () => {
  assert.throws(
    () => planAutoShortVoiceTimeline([{ start: 0 }, { start: 0.5 }], [10, 10], 2.0, 1.35),
    /vượt quá|thời lượng video|không có khoảng trống/iu
  )
})

test('AutoShort audio REPLACE mode isolates narration track without mixing original stream', () => {
  const meta = { w: 1280, h: 720, giay: 10, fps: 30, hasAudio: true }
  const filters = taoFilterComplex(meta, [], false, false, 'sub.ass', true, true, 0)
  assert.ok(filters.length > 0)
  const filterString = filters.join(' ')
  assert.match(filterString, /\[1:a\]asetpts=PTS-STARTPTS/u)
  assert.doesNotMatch(filterString, /\[0:a\].*amix/u)
  assert.match(filterString, /alimiter=limit=-1dB/u)
})

test('AutoShort audio MIX mode applies controlled gains with normalize=0 and limiter', () => {
  const meta = { w: 1280, h: 720, giay: 10, fps: 30, hasAudio: true }
  const filters = taoFilterComplex(meta, [], false, false, 'sub.ass', true, true, 50)
  const filterString = filters.join(' ')
  assert.match(filterString, /volume=0\.25/u)
  assert.match(filterString, /volume=1\.0/u)
  assert.match(filterString, /normalize=0/u)
  assert.match(filterString, /alimiter=limit=-1dB/u)
})

test('AutoShort audioMixGains provides full dub volume and controlled original volume', () => {
  const gains = audioMixGains({
    enabled: true,
    sourceVolume: 50,
    hasOriginalAudio: true,
    hasDubAudio: true,
    dubIsActive: true
  })
  assert.equal(gains.dub, 1)
  assert.equal(gains.original, 0.25)
})

test('AutoShort keeps translated text intact and uses one timeline tempo policy', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.doesNotMatch(source, /compactInput|exceedsTranslationBudget|translationBudgetFor/u)
  assert.doesNotMatch(source, /If speech duration is longer than the gap before next cue/u)
})

test('AutoShort trims only outer TTS silence, preserves decay and appends a safe tail margin', async () => {
  const filter = buildAutoShortTtsTrimFilter()
  assert.match(filter, /silenceremove=start_periods=1:start_duration=0\.03:start_threshold=-50dB/u)
  assert.match(filter, /areverse,silenceremove=start_periods=1:start_duration=0\.02:start_threshold=-50dB,areverse/u)
  assert.match(filter, /apad=pad_dur=0\.12/u)
  assert.match(filter, /highpass=f=40/u)
  assert.match(filter, /afade=t=in:ss=0:d=0\.008/u)
  assert.match(filter, /asetpts=PTS-STARTPTS/u)
  assert.doesNotMatch(filter, /stop_periods=1/u)

  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(source, /buildAutoShortTtsTrimFilter\(\)/u)
})

test('AutoShort clamps recognition cues that round past the video EOF', () => {
  const result = clampAlignedCueTimeline([
    { start: 1, end: 2, text: 'first', source: 'whisper' },
    { start: 4, end: 5.6, text: 'last', source: 'whisper' }
  ], 5.5)
  assert.deepEqual(result.map((cue) => [cue.start, cue.end]), [[1, 2], [4, 5.5]])
})

test('OCR verifies runtime readiness using protocol probe and version commands', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'ocr.ts'), 'utf8')
  const probeSource = await readFile(join(process.cwd(), 'src', 'main', 'runtimeProbes.ts'), 'utf8')
  assert.match(source, /probeRuntimeExecutable\('ocr-engine',\s*path\)/u)
  assert.doesNotMatch(source, /Legacy fallback/u)
  assert.match(probeSource, /ocr-local\/1/u)
})

test('AutoShort requests chat completion translation so cue meaning is preserved', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'localTranslate.ts'), 'utf8')
  assert.match(source, /\/v1\/chat\/completions/u)
  assert.match(source, /validateTranslationItems\(/u)
  assert.doesNotMatch(source, /không suy diễn|không đổi tên loài|không thêm hoặc bỏ thông tin/iu)
})

test('AutoShort uses a wider independent OCR source window than the output safe area', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'AutoShort.tsx'), 'utf8')
  assert.match(source, /function defaultOcrRegion\(width: number, height: number\)/u)
  assert.match(source, /const ocr = ocrRegion \|\| defaultOcrRegion\(w, h\)/u)
})

test('AutoShort preserves an explicitly configured Whisper language', async () => {
  assert.equal(resolveAutoShortWhisperLanguage('en'), 'en')
  assert.equal(resolveAutoShortWhisperLanguage('  '), 'auto')
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(source, /language: resolveAutoShortWhisperLanguage\(config\.whisperLanguage\)/u)
})

test('AutoShort key check uses the selected local translation server URL', async () => {
  const renderer = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'AutoShort.tsx'), 'utf8')
  const preload = await readFile(join(process.cwd(), 'src', 'preload', 'index.ts'), 'utf8')
  const main = await readFile(join(process.cwd(), 'src', 'main', 'index.ts'), 'utf8')
  assert.match(renderer, /translateCheckKey\(\s*translateProvider,\s*apiKeyInput\.trim\(\),\s*translateProvider === 'local' \? ttsServerUrl : undefined,[\s\S]{0,120}translateTarget,[\s\S]{0,80}whisperLanguage\s*\)/u)
  assert.match(preload, /translateCheckKey:[\s\S]{0,220}targetLanguage\?: string,[\s\S]{0,100}sourceLanguage\?: string/u)
  assert.match(main, /checkLocalTranslateKey\(serverUrl, key, targetLanguage, sourceLanguage\)/u)
})

test('AutoShort exposes only native Whisper models and the selected device', async () => {
  const renderer = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'AutoShort.tsx'), 'utf8')
  assert.doesNotMatch(renderer, /<option value="tiny">/u)
  assert.doesNotMatch(renderer, /<option value="large-v3">/u)
  assert.match(renderer, /<option value="base">/u)
  assert.match(renderer, /<option value="small">/u)
  assert.match(renderer, /<option value="medium">/u)
  assert.match(renderer, /value=\{whisperDevice\}/u)
  assert.match(renderer, /setWhisperDevice\(e\.target\.value as WhisperDevice\)/u)
})

test('AutoShort exposes the OCR region in both OCR modes', async () => {
  const renderer = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'AutoShort.tsx'), 'utf8')
  assert.match(renderer, /hienOcrBox=\{subtitleMethod === 'ocr' \|\| subtitleMethod === 'whisper-ocr'\}/u)
})

test('AutoShort CUDA readiness probes the selected Whisper model', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(source, /whisperCudaProbe\(config\.whisperModel \|\| 'base', 'cuda'\)/u)
  assert.match(source, /cudaProbe\?\.ready/u)
  assert.match(source, /ocr\.healthy/u)
})

test('AutoShort keeps CPU fallback available when CUDA is unavailable', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(source, /'whisper-cuda'[\s\S]{0,260}gpuReady/u)
  assert.match(source, /effectiveDevice: useWhisper \? \(useCuda && cudaReady \? 'cuda' : 'cpu'\)/u)
  assert.doesNotMatch(source, /đã dừng để tránh chạy CPU ngầm/u)
})

test('AutoShort Main OCR fallback matches the portrait and landscape UI defaults', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(source, /const portrait = meta\.h > meta\.w[\s\S]{0,320}0\.72[\s\S]{0,320}0\.74[\s\S]{0,320}0\.92[\s\S]{0,320}0\.94/u)
})

test('OCR protocol rejects unprobed binaries and requires genuine model probe', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'runtimeProbes.ts'), 'utf8')
  assert.match(source, /ocr-local\/1/u)
  assert.doesNotMatch(source, /legacyCliHelp/u)
})

test('local translation defers source detection to the provider when no hint exists', () => {
  assert.equal(inferTranslationSourceLanguage(['這是海蜇', '含有劇毒']), 'auto')
  assert.equal(inferTranslationSourceLanguage(['This is a jellyfish', 'It is poisonous']), 'auto')
  assert.equal(inferTranslationSourceLanguage(['これは海月です', '毒があります']), 'auto')
})

test('local translation retries only transient transport and server failures', () => {
  assert.equal(isRetryableLocalTranslationError(new Error('fetch failed')), true)
  assert.equal(isRetryableLocalTranslationError(new Error('Server AI lỗi nội bộ (HTTP 503)')), true)
  assert.equal(isRetryableLocalTranslationError(new Error('Server AI từ chối quyền dịch (HTTP 401)')), false)
  assert.equal(isRetryableLocalTranslationError(new Error('Server AI từ chối dữ liệu dịch (HTTP 422)')), false)
  assert.equal(isRetryableLocalTranslationError(new Error('Kết quả dịch thiếu câu hoặc có câu rỗng')), false)
})

test('local translation retries an incomplete model response but accepts complete numbered output', () => {
  assert.equal(isCompleteLocalTranslationBatch(['một', 'hai', 'ba'], 3), true)
  assert.equal(isCompleteLocalTranslationBatch(['một', '', 'ba'], 3), false)
  assert.equal(isCompleteLocalTranslationBatch(['một', 'hai'], 3), false)
})

test('Whisper plus OCR lets aligned Chinese visual text replace a semantically wrong ASR cue', () => {
  const result = fuseWhisperAndOcr(
    [{ start: 3.5, end: 5.7, text: '他的觸手刺激棒會釋放毒液', source: 'whisper' }],
    [{ start: 3.4, end: 5.6, text: '它的触手刺细胞会释放毒液', source: 'ocr' }]
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].text, '它的触手刺细胞会释放毒液')
})

test('Whisper plus OCR accepts a short repeated visual cue inside a longer speech cue', () => {
  const result = fuseWhisperAndOcr(
    [{ start: 82.6, end: 83.6, text: '东西深热', source: 'whisper' }],
    [
      { start: 82.5, end: 82.625, text: 'Q0 毒性虽弱', source: 'ocr' },
      { start: 82.625, end: 82.75, text: '毒性虽弱', source: 'ocr' },
      { start: 82.75, end: 82.875, text: '毒性虽弱', source: 'ocr' },
      { start: 82.875, end: 83, text: '60 00 毒性虽弱', source: 'ocr' },
      { start: 83, end: 83.375, text: '毒性虽弱', source: 'ocr' }
    ]
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].text, '毒性虽弱')
})

test('Whisper plus OCR ignores one boundary frame when a visual cue belongs to the next speech cue', () => {
  const result = fuseWhisperAndOcr(
    [
      { start: 81.2, end: 82.6, text: '这是海月水母', source: 'whisper' },
      { start: 82.6, end: 83.6, text: '东西深热', source: 'whisper' }
    ],
    [
      { start: 82.5, end: 82.625, text: 'Q0 毒性虽弱', source: 'ocr' },
      { start: 82.625, end: 82.75, text: '毒性虽弱', source: 'ocr' },
      { start: 82.75, end: 82.875, text: '毒性虽弱', source: 'ocr' },
      { start: 82.875, end: 83, text: '60 00 毒性虽弱', source: 'ocr' },
      { start: 83, end: 83.375, text: '毒性虽弱', source: 'ocr' }
    ]
  )
  assert.deepEqual(result.map((cue) => cue.text), ['这是海月水母', '毒性虽弱'])
})

test('Whisper plus OCR still fuses repeated visual text in non-adjacent cues', () => {
  const result = fuseWhisperAndOcr(
    [
      { start: 0, end: 2, text: '敢还剪到这个有毒吗', source: 'whisper' },
      { start: 2, end: 3.5, text: '这是捡到了海', source: 'whisper' },
      { start: 3.5, end: 5.7, text: '它的触手刺细胞会释放毒液', source: 'whisper' },
      { start: 5.7, end: 7.2, text: '一般人千万别碰', source: 'whisper' },
      { start: 7.2, end: 9.2, text: '敢还剪到这个有毒吗', source: 'whisper' }
    ],
    [
      { start: 0, end: 1.875, text: '赶海捡到这个有毒吗', source: 'ocr' },
      { start: 7.25, end: 9.125, text: '赶海捡到这个有毒吗', source: 'ocr' }
    ]
  )
  assert.deepEqual(result.map((cue) => cue.text), [
    '赶海捡到这个有毒吗',
    '这是捡到了海',
    '它的触手刺细胞会释放毒液',
    '一般人千万别碰',
    '赶海捡到这个有毒吗'
  ])
})

test('Whisper plus OCR collapses repeated visual noise without changing cue count', () => {
  const result = fuseWhisperAndOcr(
    [{ start: 83.5, end: 85.4, text: 'O0 但不建议摸更不能吃', source: 'whisper' }],
    [
      { start: 83.6, end: 85.3, text: 'O0 但不建议摸更不能吃', source: 'ocr' },
      { start: 83.6, end: 85.3, text: '但不建议摸更不能吃', source: 'ocr' }
    ]
  )
  assert.equal(result.length, 1)
  assert.equal(result[0].text, '但不建议摸更不能吃')
})

test('Whisper plus OCR keeps separate speech mapping when OCR merges adjacent cues', () => {
  const result = fuseWhisperAndOcr(
    [
      { start: 57.4, end: 58.8, text: '遇到千万别摸', source: 'whisper' },
      { start: 58.8, end: 59.7, text: '赶紧远离', source: 'whisper' }
    ],
    [{ start: 57.4, end: 59.7, text: '遇到千万别摸赶紧远离', source: 'ocr' }]
  )
  assert.deepEqual(result.map((cue) => cue.text), ['遇到千万别摸', '赶紧远离'])
})

test('Whisper plus OCR splits a merged visual cue and preserves an earlier visual fragment', () => {
  const result = fuseWhisperAndOcr(
    [
      { start: 0, end: 2, text: '幸亏遇到好心愿', source: 'whisper' },
      { start: 2, end: 3.2, text: '把它放回海里', source: 'whisper' }
    ],
    [
      { start: 1, end: 3.2, text: '幸亏遇到好心人把它放回海里', source: 'ocr' }
    ]
  )
  assert.deepEqual(result.map((cue) => cue.text), ['幸亏遇到好心人', '把它放回海里'])
})

test('Whisper plus OCR splits a fuzzy merged CJK suffix and joins sequential visual fragments', () => {
  const result = fuseWhisperAndOcr(
    [
      { start: 0, end: 2, text: '含有剧毒', source: 'whisper' },
      { start: 2, end: 3, text: '敢紧远离', source: 'whisper' }
    ],
    [
      { start: 0, end: 1, text: '含有剧毒', source: 'ocr' },
      { start: 1, end: 3, text: '遇到千万别摸赶紧远离', source: 'ocr' }
    ]
  )
  assert.deepEqual(result.map((cue) => cue.text), ['含有剧毒遇到千万别摸', '赶紧远离'])
})

test('Whisper plus OCR does not duplicate a visual phrase across adjacent speech cues', () => {
  const result = fuseWhisperAndOcr(
    [
      { start: 83.6, end: 84.6, text: '但不见一摸', source: 'whisper' },
      { start: 84.6, end: 85.6, text: '更不能吃', source: 'whisper' }
    ],
    [
      { start: 83.75, end: 84.375, text: '但不建议摸更不能吃', source: 'ocr' },
      { start: 84.625, end: 85.0, text: '但不建议摸更不能吃', source: 'ocr' }
    ]
  )
  assert.deepEqual(result.map((cue) => cue.text), ['但不建议摸', '更不能吃'])
})

test('local translation splits a persistently incomplete batch without losing order', () => {
  assert.deepEqual(splitLocalTranslationBatch([1, 2, 3, 4, 5]), [[1, 2, 3], [4, 5]])
  assert.equal(splitLocalTranslationBatch([1]), null)
})

test('semantic grouping merges multiple consecutive cues of the same sentence into one group', () => {
  const cues = [
    { id: 'cue-0', start: 0.0, end: 1.2, text: 'When you look at' },
    { id: 'cue-1', start: 1.3, end: 2.5, text: 'the ocean today,' },
    { id: 'cue-2', start: 2.6, end: 4.0, text: 'you see the wonders.' }
  ]
  const groups = buildSemanticGroups(cues)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].cues.length, 3)
  assert.equal(groups[0].text, 'When you look at the ocean today, you see the wonders.')
  assert.equal(groups[0].start, 0.0)
  assert.equal(groups[0].end, 4.0)
})

test('semantic grouping creates a new group when speech pause exceeds policy threshold', () => {
  const cues = [
    { id: 'cue-0', start: 0.0, end: 1.0, text: 'This is a jellyfish' },
    { id: 'cue-1', start: 2.5, end: 3.5, text: 'It has venom' }
  ]
  const groups = buildSemanticGroups(cues)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].cues[0].id, 'cue-0')
  assert.equal(groups[1].cues[0].id, 'cue-1')
})

test('semantic grouping is language-agnostic across multiple scripts and punctuation systems', () => {
  // Chinese CJK
  const zhCues = [
    { id: 'zh-1', start: 0, end: 1.2, text: '这是海月水母' },
    { id: 'zh-2', start: 1.3, end: 2.5, text: '它的触手会释放毒液。' },
    { id: 'zh-3', start: 2.6, end: 4.0, text: '请勿靠近！' }
  ]
  const zhGroups = buildSemanticGroups(zhCues)
  assert.equal(zhGroups.length, 2)
  assert.equal(zhGroups[0].text, '这是海月水母它的触手会释放毒液。')
  assert.equal(zhGroups[1].text, '请勿靠近！')

  // Vietnamese Latin
  const viCues = [
    { id: 'vi-1', start: 0, end: 1.0, text: 'Chào các bạn,' },
    { id: 'vi-2', start: 1.1, end: 2.5, text: 'hôm nay chúng ta cùng tìm hiểu loài sứa.' },
    { id: 'vi-3', start: 2.6, end: 4.0, text: 'Nó rất độc.' }
  ]
  const viGroups = buildSemanticGroups(viCues)
  assert.equal(viGroups.length, 2)
  assert.equal(viGroups[0].cues.length, 2)
  assert.equal(viGroups[0].text, 'Chào các bạn, hôm nay chúng ta cùng tìm hiểu loài sứa.')

  // Arabic
  const arCues = [
    { id: 'ar-1', start: 0, end: 1.0, text: 'هذا قنديل البحر' },
    { id: 'ar-2', start: 1.1, end: 2.5, text: 'وهو كائن سام جدا؟' }
  ]
  const arGroups = buildSemanticGroups(arCues)
  assert.equal(arGroups.length, 1)
  assert.equal(arGroups[0].cues.length, 2)

  // Spanish
  const esCues = [
    { id: 'es-1', start: 0, end: 1.0, text: 'Esta es una medusa' },
    { id: 'es-2', start: 1.1, end: 2.5, text: 'y tiene mucho veneno.' }
  ]
  const esGroups = buildSemanticGroups(esCues)
  assert.equal(esGroups.length, 1)
})

test('AutoShort translation guidance clarifies that cues are timeline markers and enables contextual reading', () => {
  const prompt = huongDan('vi', { mode: 'dubbing' })
  assert.match(prompt, /mốc timeline/iu)
  assert.match(prompt, /liền mạch/iu)
  assert.match(prompt, /hiểu trọn vẹn ngữ cảnh/iu)
})

test('AutoShort translation guidance requires per-cue semantic preservation and forbids shifting content across cues', () => {
  const prompt = huongDan('vi', { mode: 'dubbing' })
  assert.match(prompt, /Bảo toàn đúng phần nội dung và ý nghĩa ngữ nghĩa tương ứng với từng cue/iu)
  assert.match(prompt, /không tự ý dịch chuyển hoặc dồn ý nghĩa từ cue này sang cue khác/iu)
})

test('translation validation strictly requires all cue IDs and rejects missing, duplicate, unknown, or empty IDs', () => {
  // Valid
  assert.doesNotThrow(() => validateTranslationItems(
    [{ id: 'c1', text: 'T1' }, { id: 'c2', text: 'T2' }],
    ['c1', 'c2']
  ))
  // Missing
  assert.throws(() => validateTranslationItems(
    [{ id: 'c1', text: 'T1' }],
    ['c1', 'c2']
  ), /thiếu|missing/iu)
  // Duplicate
  assert.throws(() => validateTranslationItems(
    [{ id: 'c1', text: 'T1' }, { id: 'c1', text: 'T2' }],
    ['c1', 'c2']
  ), /trùng|duplicate/iu)
  // Unknown
  assert.throws(() => validateTranslationItems(
    [{ id: 'c1', text: 'T1' }, { id: 'c99', text: 'T2' }],
    ['c1', 'c2']
  ), /không xác định|unknown/iu)
  // Empty
  assert.throws(() => validateTranslationItems(
    [{ id: 'c1', text: 'T1' }, { id: 'c2', text: '   ' }],
    ['c1', 'c2']
  ), /rỗng|empty/iu)
})

test('semantic batching keeps whole semantic groups intact across batch boundaries', () => {
  const groupA = { id: 'gA', text: 'A', cues: [{ id: 'c1', text: '1' }, { id: 'c2', text: '2' }, { id: 'c3', text: '3' }] }
  const groupB = { id: 'gB', text: 'B', cues: [{ id: 'c4', text: '4' }, { id: 'c5', text: '5' }, { id: 'c6', text: '6' }, { id: 'c7', text: '7' }] }
  const groupC = { id: 'gC', text: 'C', cues: [{ id: 'c8', text: '8' }, { id: 'c9', text: '9' }, { id: 'c10', text: '10' }, { id: 'c11', text: '11' }, { id: 'c12', text: '12' }] }

  const batches = buildSemanticBatches([groupA, groupB, groupC], 8)
  assert.equal(batches.length, 2)
  // Batch 1 has groupA and groupB (3 + 4 = 7 cues <= 8)
  assert.deepEqual(batches[0].map(g => g.id), ['gA', 'gB'])
  // Batch 2 has groupC (5 cues)
  assert.deepEqual(batches[1].map(g => g.id), ['gC'])
})

test('semantic batch splitting splits along semantic group boundaries before cutting cues', () => {
  const groupA = { id: 'gA', text: 'A', cues: [{ id: 'c1', text: '1' }, { id: 'c2', text: '2' }] }
  const groupB = { id: 'gB', text: 'B', cues: [{ id: 'c3', text: '3' }, { id: 'c4', text: '4' }] }

  const split = splitSemanticBatch([groupA, groupB])
  assert.ok(split)
  assert.equal(split[0].length, 1)
  assert.equal(split[0][0].id, 'gA')
  assert.equal(split[1].length, 1)
  assert.equal(split[1][0].id, 'gB')

  // When only 1 multi-cue group exists
  const singleGroup = { id: 'gSingle', text: 'Single', cues: [{ id: 'c1', text: '1' }, { id: 'c2', text: '2' }, { id: 'c3', text: '3' }, { id: 'c4', text: '4' }] }
  const singleSplit = splitSemanticBatch([singleGroup])
  assert.ok(singleSplit)
  assert.equal(singleSplit[0][0].cues.length, 2)
  assert.equal(singleSplit[1][0].cues.length, 2)
})

test('AutoShort translateStrict restores source timestamps and preserves cue order', async () => {
  const source = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(source, /id:\s*source\[index\]\.id/u)
  assert.match(source, /sourceIndex:\s*source\[index\]\.sourceIndex/u)
  assert.match(source, /start:\s*source\[index\]\.start/u)
  assert.match(source, /end:\s*source\[index\]\.end/u)
  assert.match(source, /mode:\s*'dubbing'/u)
})

test('translation mode dubbing configures dubbing-specific instructions without breaking subtitle mode', () => {
  const dubbingPrompt = huongDan('vi', { mode: 'dubbing' })
  assert.match(dubbingPrompt, /mode=dubbing/u)
  assert.match(dubbingPrompt, /lồng tiếng.*dubbing/iu)
  assert.match(dubbingPrompt, /lời nói tự nhiên/iu)

  const subtitlePrompt = huongDan('vi', { mode: 'subtitle' })
  assert.match(subtitlePrompt, /mode=subtitle/u)
  assert.match(subtitlePrompt, /phụ đề.*subtitle/iu)
  assert.match(subtitlePrompt, /rõ ràng.*dễ đọc/iu)

  const defaultPrompt = huongDan('vi')
  assert.match(defaultPrompt, /mode=subtitle/u)
})

test('translation guidance has no extreme instruction demanding removal of all source characters', () => {
  const prompt = huongDan('vi', { mode: 'dubbing' })
  assert.doesNotMatch(prompt, /không để lại bất kỳ từ ngữ, ký tự hoặc chữ viết thuộc ngôn ngữ nguồn/iu)
  assert.doesNotMatch(prompt, /tuyệt đối không để sót chữ viết thuộc ngôn ngữ nguồn/iu)
  assert.match(prompt, /không bỏ sót nội dung cần dịch/iu)
  assert.match(prompt, /tên riêng.*thương hiệu.*thuật ngữ quốc tế/iu)
})

test('translation pipeline contains no phrase-specific or language-specific repair rules', async () => {
  const translateShared = await readFile(join(process.cwd(), 'src', 'main', 'translate-shared.ts'), 'utf8')
  const localTranslate = await readFile(join(process.cwd(), 'src', 'main', 'localTranslate.ts'), 'utf8')
  const localTranslatePolicy = await readFile(join(process.cwd(), 'src', 'main', 'localTranslatePolicy.ts'), 'utf8')
  const semanticGrouping = await readFile(join(process.cwd(), 'src', 'main', 'semanticGrouping.ts'), 'utf8')

  const allCode = [translateShared, localTranslate, localTranslatePolicy, semanticGrouping].join('\n')
  assert.doesNotMatch(allCode, /replace\(\s*['"](?:海蜇|水母|jellyfish|sứa)['"]/iu)
  assert.doesNotMatch(allCode, /if\s*\(.*(?:language|lang)\s*===?\s*['"]zh['"].*repair/iu)
})

test('validateAutoShortTtsModel allows auto/empty language in preflight and strictly checks resolved language', async () => {
  const { validateAutoShortTtsModel } = await import('../src/main/autoShortPolicy')
  const modelVi = { id: 'tts-vietnamese', name: 'Vietnamese', languages: ['vi'] }
  // Auto / empty preflight passes
  assert.equal(validateAutoShortTtsModel(modelVi, 'auto'), undefined)
  assert.equal(validateAutoShortTtsModel(modelVi, ''), undefined)
  assert.equal(validateAutoShortTtsModel(modelVi, '  '), undefined)
  // Resolved matching language passes
  assert.equal(validateAutoShortTtsModel(modelVi, 'vi'), undefined)
  assert.equal(validateAutoShortTtsModel(modelVi, 'VIE'), undefined)
  // Resolved mismatched language is rejected
  assert.match(validateAutoShortTtsModel(modelVi, 'zh') || '', /không hỗ trợ ngôn ngữ/iu)
  assert.match(validateAutoShortTtsModel(modelVi, 'en') || '', /không hỗ trợ ngôn ngữ/iu)
})

test('cleanVisualText preserves mixed alphanumeric, brand names, and numbers while removing OCR framing tags', async () => {
  const { cleanVisualText } = await import('../src/shared/autoShortAlignment')
  // Mixed alphanumeric preserved
  assert.equal(cleanVisualText('AI改变世界'), 'AI改变世界')
  assert.equal(cleanVisualText('3D打印技术'), '3D打印技术')
  assert.equal(cleanVisualText('GPT-4模型发布'), 'GPT-4模型发布')
  assert.equal(cleanVisualText('2024年科技趋势'), '2024年科技趋势')
  assert.equal(cleanVisualText('iPhone 15 Pro Max'), 'iPhone 15 Pro Max')
  // Noise framing stripped
  assert.equal(cleanVisualText('【1】 这是字幕'), '这是字幕')
  assert.equal(cleanVisualText('[00:12] 这是字幕'), '这是字幕')
  assert.equal(cleanVisualText('(0.95) 这是字幕'), '这是字幕')
  assert.equal(cleanVisualText('Q0 毒性虽弱'), '毒性虽弱')
  assert.equal(cleanVisualText('60 00 毒性虽弱'), '毒性虽弱')
})

test('isSafeExternalUrl strictly allows http, https, mailto and blocks dangerous schemes', async () => {
  const { isSafeExternalUrl } = await import('../src/shared/urlSafety')
  assert.equal(isSafeExternalUrl('https://example.com'), true)
  assert.equal(isSafeExternalUrl('http://localhost:3000/test'), true)
  assert.equal(isSafeExternalUrl('mailto:support@example.com'), true)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
  assert.equal(isSafeExternalUrl('file:///C:/Windows/System32/calc.exe'), false)
  assert.equal(isSafeExternalUrl('data:text/html,<h1>hi</h1>'), false)
  assert.equal(isSafeExternalUrl('tblao://secret'), false)
  assert.equal(isSafeExternalUrl(''), false)
  assert.equal(isSafeExternalUrl(null), false)
})

test('Whisper alignment outputs write both segments and cues for complete schema compatibility', async () => {
  const engineSource = await readFile(join(process.cwd(), 'engines', 'whisper-engine', 'engine.py'), 'utf8')
  assert.match(engineSource, /"segments":\s*segments/u)
  assert.match(engineSource, /"cues":\s*segments/u)

  const autoshortSource = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.match(autoshortSource, /raw\.segments/u)
  assert.match(autoshortSource, /raw\.cues/u)
  assert.match(autoshortSource, /timingQuality\s*=\s*'word'/u)
})

test('TTS disk write enforces positive file size check and eliminates swallowed errors', async () => {
  const ttsSource = await readFile(join(process.cwd(), 'src', 'main', 'tts.ts'), 'utf8')
  assert.doesNotMatch(ttsSource, /writeFile\(tempPath,\s*buffer\)\.catch\(/u)
  assert.match(ttsSource, /stat\(tempPath\)/u)
  assert.match(ttsSource, /fileStat\.size\s*<=\s*0/u)
})

test('Case A (fresh install): engine status reports missing clearly and does not crash when runtime is absent', async () => {
  const { runtimeKindDir } = await import('../src/main/runtimeResolver')
  await Promise.all(['ocr-engine', 'video2x', 'douyin', 'whisper-engine', 'whisper-cuda'].map((kind) => rm(runtimeKindDir(kind as any), { recursive: true, force: true })))
  const { ocrEngineStatus } = await import('../src/main/ocr')
  const { video2xEngineStatus } = await import('../src/main/video2x')
  const { dyEngineStatus } = await import('../src/main/douyin')
  const { whisperEngineStatus } = await import('../src/main/whisper')

  const ocrStatus = await ocrEngineStatus()
  assert.equal(ocrStatus.has, false)
  assert.equal(ocrStatus.healthy, false)

  const v2xStatus = await video2xEngineStatus()
  assert.equal(v2xStatus.has, false)

  const dyStatus = await dyEngineStatus()
  assert.equal(dyStatus.has, false)

  const whisperStatus = await whisperEngineStatus()
  assert.equal(whisperStatus.has, false)
  assert.equal(whisperStatus.healthy, false)
})

test('Case B (runtime installed): canonical resolver locates runtime executables in userData', async () => {
  const { resolveRuntimeExecutable, runtimeKindDir } = await import('../src/main/runtimeResolver')
  const canonicalOcrDir = runtimeKindDir('ocr-engine')
  await mkdir(canonicalOcrDir, { recursive: true })
  const exeName = process.platform === 'win32' ? 'ocr-engine.exe' : 'ocr-engine'
  await writeFile(join(canonicalOcrDir, exeName), Buffer.from('test-binary'))

  const resolved = await resolveRuntimeExecutable('ocr-engine', [exeName])
  assert.ok(resolved)
  assert.equal(resolved, join(canonicalOcrDir, exeName))
  await rm(canonicalOcrDir, { recursive: true, force: true })
})

test('Case C (application update): runtimeRoot and modelRoot are invariant to application version changes', async () => {
  const { runtimeRoot, modelRoot, runtimeSearchRoots } = await import('../src/main/runtimeResolver')
  const { whisperModelRoots } = await import('../src/main/modelStore')

  const rtRoot1 = runtimeRoot()
  const mdRoot1 = modelRoot()
  const searchRoots1 = runtimeSearchRoots('whisper-engine')
  const modelSearchRoots1 = whisperModelRoots('C:\\test-user-data')

  // Simulating version change
  const rtRoot2 = runtimeRoot()
  const mdRoot2 = modelRoot()
  const searchRoots2 = runtimeSearchRoots('whisper-engine')
  const modelSearchRoots2 = whisperModelRoots('C:\\test-user-data')

  assert.equal(rtRoot1, rtRoot2)
  assert.equal(mdRoot1, mdRoot2)
  assert.deepEqual(searchRoots1, searchRoots2)
  assert.deepEqual(modelSearchRoots1, modelSearchRoots2)
  assert.equal(searchRoots1.some((r) => r.includes('0.1.20') || r.includes('0.1.21')), false)
})

test('Case D (failed runtime update): atomic replace directory restores previous version on failure', async () => {
  const { replaceDirectoryAtomic } = await import('../src/main/localAssets')
  const root = await mkdtemp(join(tmpdir(), 'tedia-atomic-test-'))
  const dest = join(root, 'engine-active')
  const staging = join(root, 'engine-staging')

  await mkdir(dest, { recursive: true })
  await writeFile(join(dest, 'version.txt'), 'old-working-version')

  await mkdir(staging, { recursive: true })
  await writeFile(join(staging, 'version.txt'), 'new-version')

  // Normal atomic replacement
  await replaceDirectoryAtomic(staging, dest)
  assert.equal(await readFile(join(dest, 'version.txt'), 'utf8'), 'new-version')
})

test('Case E (model persistence): whisperModelRoots exposes only the canonical models directory', async () => {
  const { whisperModelRoots } = await import('../src/main/modelStore')
  const roots = whisperModelRoots('C:\\AppData\\Roaming\\t-blao')
  assert.deepEqual(roots, ['C:\\AppData\\Roaming\\t-blao\\whisper-models'])
  assert.equal(roots.some((r) => r.includes('resources')), false)
})

test('Distribution configuration: getDistributionConfig generates valid release URLs and supports env overrides', async () => {
  const { getDistributionConfig } = await import('../src/main/distributionConfig')
  process.env.TEDIAPROS_DISTRIBUTION_OWNER = 'my-org'
  process.env.TEDIAPROS_DISTRIBUTION_REPO = 'tedia-distribution'
  process.env.TEDIAPROS_RUNTIME_CHANNEL = 'runtime-v2'

  try {
    const config = getDistributionConfig()
    assert.equal(config.owner, 'my-org')
    assert.equal(config.repo, 'tedia-distribution')
    assert.equal(config.runtimeChannel, 'runtime-v2')
    assert.equal(
      config.manifestUrl,
      'https://github.com/my-org/tedia-distribution/releases/download/runtime-v2/runtime-manifest.json'
    )
    assert.equal(
      config.getAssetUrl('ocr-win-x64.zip'),
      'https://github.com/my-org/tedia-distribution/releases/download/runtime-v2/ocr-win-x64.zip'
    )
  } finally {
    delete process.env.TEDIAPROS_DISTRIBUTION_OWNER
    delete process.env.TEDIAPROS_DISTRIBUTION_REPO
    delete process.env.TEDIAPROS_RUNTIME_CHANNEL
  }
})

test('Runtime manifest validator: strictly validates contract and rejects malformed payloads', async () => {
  const { validateRuntimeDistributionManifest } = await import('../src/main/runtimeManifest')

  const validPayload = {
    schemaVersion: 1,
    runtimeVersion: 'runtime-v2',
    platform: 'win32',
    arch: 'x64',
    assets: {
      'whisper-engine': {
        version: '2.0.0',
        platform: 'win32',
        arch: 'x64',
        asset: 'whisper-engine-win-x64.zip',
        sha256: 'a0f92b8765b729abfdfc654958c512215553f383fb9e75d1cdd0ffb73ab8c974',
        bytes: 6504960,
        entrypoint: 'whisper-engine.exe',
        protocol: 'whisper-engine/1',
        capabilities: ['probe', 'cpu', 'cuda'],
        files: ['whisper-engine.exe']
      }
    }
  }

  const validResult = validateRuntimeDistributionManifest(validPayload)
  assert.equal(validResult.ok, true)

  // Invalid schemaVersion
  const invalidSchema = validateRuntimeDistributionManifest({ ...validPayload, schemaVersion: 2 })
  assert.equal(invalidSchema.ok, false)

  // Invalid sha256
  const invalidSha = validateRuntimeDistributionManifest({
    ...validPayload,
    assets: {
      'whisper-engine': {
        ...validPayload.assets['whisper-engine'],
        sha256: 'not-a-valid-sha'
      }
    }
  })
  assert.equal(invalidSha.ok, false)

  // Missing entrypoint
  const invalidEntry = validateRuntimeDistributionManifest({
    ...validPayload,
    assets: {
      'whisper-engine': {
        ...validPayload.assets['whisper-engine'],
        entrypoint: ''
      }
    }
  })
  assert.equal(invalidEntry.ok, false)
})

test('Package verifier: rejects packaging containing prohibited runtime binaries or models', async () => {
  const { verifyPackagedDirectory } = await import('../scripts/verify-packaged-app.mjs')
  const root = await mkdtemp(join(tmpdir(), 'tedia-pkg-verify-'))

  // Clean directory with only fonts
  const cleanDir = join(root, 'clean', 'resources', 'fonts')
  await mkdir(cleanDir, { recursive: true })
  await writeFile(join(cleanDir, 'NotoSans.ttf'), Buffer.from('font'))
  await writeFile(join(cleanDir, 'manifest.json'), '{}')

  const cleanResult = await verifyPackagedDirectory(join(root, 'clean'))
  assert.equal(cleanResult.ok, true)
  assert.equal(cleanResult.violations.length, 0)

  // Dirty directory with prohibited ffmpeg.exe and models
  const dirtyDir = join(root, 'dirty', 'resources')
  await mkdir(dirtyDir, { recursive: true })
  await writeFile(join(dirtyDir, 'ffmpeg.exe'), Buffer.from('fake-ffmpeg'))
  const dirtyModelDir = join(root, 'dirty', 'whisper-models', 'base')
  await mkdir(dirtyModelDir, { recursive: true })
  await writeFile(join(dirtyModelDir, 'model.bin'), Buffer.from('fake-model'))

  const dirtyResult = await verifyPackagedDirectory(join(root, 'dirty'))
  assert.equal(dirtyResult.ok, false)
  assert.equal(dirtyResult.violations.length >= 2, true)
})

test('AutoShort contract accepts dynamic TTS models and arbitrary valid target languages', () => {
  const result = validateAutoShortStartRequest({
    items: [{ id: 'video-dyn-1', filePath: 'C:\\media\\video.mp4' }],
    config: {
      subtitleMethod: 'whisper',
      whisperModel: 'base',
      blurRegions: [],
      lamMo: false,
      translateTarget: 'fr',
      translateProvider: 'local',
      ttsEnabled: true,
      ttsModel: 'tts-custom-neural-2026',
      ttsVoice: 'Jean-Luc',
      ttsLanguage: 'fr',
      audioMode: 'replace',
      originalAudioVolume: 20,
      outputDir: 'C:\\media\\out'
    }
  })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.config.ttsModel, 'tts-custom-neural-2026')
    assert.equal(result.value.config.ttsVoice, 'Jean-Luc')
    assert.equal(result.value.config.translateTarget, 'fr')
    assert.equal(result.value.config.ttsLanguage, 'fr')
  }
})

test('AI Server URL defaults to 127.0.0.1:8000 and codebase contains zero hardcoded LAN IPs in production sources', async () => {
  const { DEFAULT_AI_SERVER_URL } = await import('../src/shared/types')
  assert.equal(DEFAULT_AI_SERVER_URL, 'http://127.0.0.1:8000')

  const filesToCheck = [
    'src/main/tts.ts',
    'src/main/localTranslate.ts',
    'src/main/autoshort.ts',
    'src/renderer/src/components/Voice.tsx',
    'src/renderer/src/components/AutoShort.tsx',
    'src/renderer/src/components/GeminiKey.tsx',
    'src/renderer/src/lib/persist.ts'
  ]

  for (const relPath of filesToCheck) {
    const content = await readFile(join(process.cwd(), relPath), 'utf8')
    assert.doesNotMatch(
      content,
      /192\.168\.\d+\.\d+/u,
      `File ${relPath} should not contain hardcoded LAN IPs`
    )
  }
})

test('TTS synthesis does not silently override user voice with hardcoded defaults', async () => {
  const ttsSource = await readFile(join(process.cwd(), 'src', 'main', 'tts.ts'), 'utf8')
  assert.doesNotMatch(ttsSource, /voice\s*\|\|\s*'Adam'/u)
  assert.doesNotMatch(ttsSource, /voice\s*\|\|\s*'Mai Anh'/u)
  assert.doesNotMatch(ttsSource, /VIENEU_PRESET_VOICES/u)

  const autoshortSource = await readFile(join(process.cwd(), 'src', 'main', 'autoshort.ts'), 'utf8')
  assert.doesNotMatch(autoshortSource, /config\.ttsVoice\s*\|\|\s*'Mai Anh'/u)
  assert.doesNotMatch(autoshortSource, /config\.ttsVoice\s*\|\|\s*'Minh Đức'/u)
})

test('Voice component does not filter models using hardcoded ID whitelist', async () => {
  const voiceSource = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'Voice.tsx'), 'utf8')
  assert.doesNotMatch(voiceSource, /model\.id\s*===\s*'tts-vietnamese'\s*\|\|\s*model\.id\s*===\s*'tts-multilingual'/u)
})

test('AutoShort component does not hardcode static fallback options in TTS model selector', async () => {
  const autoShortSource = await readFile(join(process.cwd(), 'src', 'renderer', 'src', 'components', 'AutoShort.tsx'), 'utf8')
  assert.doesNotMatch(autoShortSource, /<option value="tts-vietnamese">/u)
  assert.doesNotMatch(autoShortSource, /<option value="tts-multilingual">/u)
})

test('OCR engine Python script uses stable frame selection and 2D line sorting without scope errors', async () => {
  const engineSource = await readFile(join(process.cwd(), 'engines', 'ocr-engine', 'engine.py'), 'utf8')
  assert.doesNotMatch(engineSource, /files\[i\]/u)
  assert.match(engineSource, /khung_on_dinh\(rung,\s*a,\s*b\)/u)
  assert.match(engineSource, /--version/u)
  assert.match(engineSource, /--probe/u)
  assert.match(engineSource, /ocr-local\/1/u)
  assert.match(engineSource, /ordered_line_texts/u)
})

test('AutoShort tempo planner strictly enforces hard max tempo ceiling at 1.35x', () => {
  const cues = [{ start: 0, end: 1.0 }]
  // Natural duration 2.5s in 1.0s window -> requires 2.5x
  const plan = planAutoShortVoiceTimeline(cues, [2.5], 5.0, 1.35)
  assert.equal(plan.cues[0].tempo, 1.35)
  assert.ok(plan.cues[0].tempo <= 1.35)

  // Validate sync fails because 2.5 / 1.35 = 1.85s > 1.0s window
  const sync = validateAutoShortTimelineSync(
    cues,
    cues,
    [{
      cueId: 'cue-0',
      sourceStart: 0,
      sourceEnd: 1.0,
      renderSubtitleStart: 0,
      renderSubtitleEnd: 1.0,
      voiceStart: plan.cues[0].start,
      voiceEnd: plan.cues[0].voiceEnd,
      semanticOverflowMs: plan.cues[0].semanticOverflowMs
    }],
    5.0
  )
  assert.equal(sync.ok, false)
  assert.match(sync.violations[0], /tràn quá/iu)
})

test('TTS capabilities default fail-closed for supports_voice_clone when undefined', async () => {
  const ttsSource = await readFile(join(process.cwd(), 'src', 'main', 'tts.ts'), 'utf8')
  assert.match(ttsSource, /const isVoiceClone = typeof capabilities\.supports_voice_clone === 'boolean'\s*\?\s*capabilities\.supports_voice_clone\s*:\s*false/u)
})

test('Audio mixing filter graph implements ducking with sidechaincompress and alimiter in MIX mode', async () => {
  const burnSource = await readFile(join(process.cwd(), 'src', 'main', 'burn.ts'), 'utf8')
  assert.match(burnSource, /sidechaincompress=threshold=0\.06:ratio=4:attack=15:release=200/u)
  assert.match(burnSource, /alimiter=limit=-1dB:attack=5:release=50/u)
})

test('Video2X prevents concurrent runs and manages task cancellation cleanly', async () => {
  const video2xSource = await readFile(join(process.cwd(), 'src', 'main', 'video2x.ts'), 'utf8')
  assert.match(video2xSource, /if\s*\(activeChild\s*!==\s*null\)\s*\{\s*return\s*\{\s*ok:\s*false,\s*error:\s*'Đang có một tiến trình Video2X khác đang chạy\.'\s*\}\s*\}/u)
  assert.match(video2xSource, /cancelVideo2x\(taskId\?: string\)/u)
})

test('Clean-Machine Test 1: Missing FFmpeg detects missing, resolves canonical path, and verifies install flow', async () => {
  const { resolveFfmpeg, resolveFfprobe } = await import('../src/main/runtimeResolver')
  assert.equal(await resolveFfmpeg(), null)
  assert.equal(await resolveFfprobe(), null)
})

test('Clean-Machine Test 2: Whisper CUDA candidate dirs prioritize canonical userData whisper-cuda path', async () => {
  const { whisperCudaCandidateDirs } = await import('../src/main/whisperPaths')
  const candidateDirs = whisperCudaCandidateDirs('C:\\TestUserData')
  assert.equal(candidateDirs[0], 'C:\\TestUserData\\bin\\whisper-cuda')
})

test('Clean-Machine Test 3: Whisper Model partial download resumes and validates SHA-256 integrity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-clean-model-'))
  const modelDir = join(root, 'small')
  await mkdir(modelDir, { recursive: true })
  const bytes = Buffer.from('synthetic-faster-whisper-model-content-2026')
  const { createHash } = await import('node:crypto')
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  await writeCompleteWhisperModel(modelDir, 'small')

  const { isCompleteWhisperModel, findLocalWhisperModel } = await import('../src/main/modelStore')
  assert.equal(await isCompleteWhisperModel(modelDir, 'small'), true)
  const found = await findLocalWhisperModel('small', [root])
  assert.ok(found)
  assert.equal(found.manifest?.backend, 'faster-whisper')
})

test('Clean-Machine Test 4: OCR Engine validates ocr-local/1 protocol and RapidOCR readiness', async () => {
  const { ocrEngineStatus } = await import('../src/main/ocr')
  const { runtimeKindDir } = await import('../src/main/runtimeResolver')
  await rm(runtimeKindDir('ocr-engine'), { recursive: true, force: true })
  const status = await ocrEngineStatus()
  assert.equal(status.has, false)
  assert.equal(status.healthy, false)
})

test('Clean-Machine Test 5: Video2X engine status reports missing cleanly and supports lazy install', async () => {
  const { video2xEngineStatus } = await import('../src/main/video2x')
  const status = await video2xEngineStatus()
  if (process.platform === 'win32') {
    assert.equal(status.supported, true)
    assert.equal(status.has, false)
  }
})

test('Clean-Machine Test 6: Douyin engine status reports missing cleanly and supports lazy install', async () => {
  const { dyEngineStatus } = await import('../src/main/douyin')
  const status = await dyEngineStatus()
  assert.equal(status.has, false)
})

test('Clean-Machine Test 7: Installed runtime receipts persist across application restarts', async () => {
  const { recordInstalledRuntimeReceipt, readInstalledRuntimeState } = await import('../src/main/runtimeResolver')
  await recordInstalledRuntimeReceipt('video2x', {
    version: '1.0.0',
    sha256: 'abc123',
    protocol: 'test-protocol/1',
    installedAt: new Date().toISOString(),
    activePath: 'C:\\test\\active'
  })

  const state = await readInstalledRuntimeState()
  assert.ok(state.video2x)
  assert.equal(state.video2x.version, '1.0.0')
  assert.equal(state.video2x.activePath, 'C:\\test\\active')
})

test('Clean-Machine Test 8: Non-standard installation drive (e.g. D: or E:) does not break persistent userData runtime', async () => {
  const { runtimeRoot, modelRoot } = await import('../src/main/runtimeResolver')
  const rRoot = runtimeRoot()
  const mRoot = modelRoot()
  assert.ok(!rRoot.includes('Program Files') && !rRoot.includes('dist'))
  assert.ok(!mRoot.includes('Program Files') && !mRoot.includes('dist'))
})

test('Clean-Machine Test 9: Windows paths with spaces and Unicode (e.g. Thư Mục/Người Dùng) escape properly', async () => {
  const { escapeFfmpegFilterPath } = await import('../src/main/fonts')
  const unicodePath = 'C:\\Người Dùng\\Tedia Pros 2026\\Video [1].ass'
  const escaped = escapeFfmpegFilterPath(unicodePath)
  assert.ok(escaped.includes('Người Dùng') && escaped.includes('Tedia Pros 2026'))
})

test('Clean-Machine Test 10: Production source files contain zero hardcoded developer machine paths', async () => {
  const srcFiles = [
    'src/main/runtimeResolver.ts',
    'src/main/runtimeInstaller.ts',
    'src/main/distributionConfig.ts',
    'src/main/deps.ts',
    'src/main/ocr.ts',
    'src/main/video2x.ts',
    'src/main/douyin.ts',
    'src/main/whisper.ts',
    'src/main/runtimeProbes.ts',
    'src/main/burn.ts',
    'src/main/ytdlp.ts',
    'scripts/execute-autoshort-cli.mjs'
  ]
  for (const file of srcFiles) {
    const content = await readFile(join(process.cwd(), file), 'utf8')
    assert.doesNotMatch(content, /[A-Z]:\\[Nn]ew [Ff]older/u, `${file} contains hardcoded dev path`)
    assert.doesNotMatch(content, /C:\\Users\\PC/u, `${file} contains hardcoded C:\\Users\\PC path`)
  }
})

test('Clean-Machine Test 11: Checksum mismatch preserves existing working runtime without corrupting', async () => {
  const { replaceDirectoryAtomic } = await import('../src/main/localAssets')
  const { rm } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'tedia-clean-atomic-'))
  const activeDir = join(root, 'active')
  const stagingDir = join(root, 'staging')

  await mkdir(activeDir, { recursive: true })
  await writeFile(join(activeDir, 'engine.exe'), Buffer.from('working-binary'))

  await mkdir(stagingDir, { recursive: true })
  await writeFile(join(stagingDir, 'engine.exe'), Buffer.from('corrupt-binary'))

  // Staging is removed and active is untouched
  await rm(stagingDir, { recursive: true, force: true })
  assert.equal(await readFile(join(activeDir, 'engine.exe'), 'utf8'), 'working-binary')
})

test('Clean-Machine Test 12: Interrupted download staging directory is cleaned on failure', async () => {
  const { downloadRuntimeEngineFromManifest } = await import('../src/main/runtimeInstaller')
  const result = await downloadRuntimeEngineFromManifest('video2x', () => {})
  assert.equal(result, false)
})

test('Clean-Machine Test 13: Manifest validator strictly catches missing asset and malformed hash', async () => {
  const { validateRuntimeDistributionManifest } = await import('../src/main/runtimeManifest')
  const invalid = validateRuntimeDistributionManifest({
    schemaVersion: 1,
    runtimeVersion: 'runtime-v2',
    platform: 'win32',
    assets: {}
  })
  assert.equal(invalid.ok, false)
})

test('Clean-Machine Test 14: Package verification ensures zero forbidden runtime binaries or models', async () => {
  const { findForbiddenFiles } = await import('../scripts/verify-packaged-app.mjs')
  const root = await mkdtemp(join(tmpdir(), 'tedia-clean-pkg-'))
  const appDir = join(root, 'resources', 'app')
  await mkdir(appDir, { recursive: true })
  await writeFile(join(appDir, 'package.json'), '{}')

  const violations = await findForbiddenFiles(root)
  assert.equal(violations.length, 0)
})

import './e2e-autoshort.test'
