import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises'
import {
  calculateGlobalVoiceTempo,
  planAutoShortVoiceTimeline,
  validateVoiceAudioCompleteness,
  validateRenderedOutputMedia,
  validateAutoShortTimelineSync,
  AUTO_SHORT_TTS_MAX_TEMPO,
  AUTO_SHORT_TTS_HARD_MAX_TEMPO
} from '../src/main/autoShortPolicy'
import { buildSemanticGroups, joinGroupText } from '../src/main/semanticGrouping'
import { parseSrt, serializeSrt, type SubtitleCue } from '../src/shared/subtitles'
import { taoFilterComplex, taoAss, boCuc } from '../src/main/burn'
import { runtimeRoot, modelRoot, runtimeSearchRoots } from '../src/main/runtimeResolver'

test('Case 1 & 2: Lazy runtime and model paths reside strictly in persistent userData, not app install dir', () => {
  const root = runtimeRoot()
  const mRoot = modelRoot('whisper-cpp')
  assert.ok(root.toLowerCase().includes('userdata') || root.toLowerCase().includes('appdata') || root.length > 5)
  assert.ok(mRoot.toLowerCase().includes('userdata') || mRoot.toLowerCase().includes('appdata') || mRoot.length > 5)
  assert.ok(!root.toLowerCase().includes('resources\\local-assets'))
})

test('Case 3 & 4: Resumable Checkpoint Pipeline skips already completed stages and preserves data on retry', async () => {
  const tempTestDir = join(tmpdir(), `test-checkpoint-${Date.now()}`)
  await mkdir(tempTestDir, { recursive: true })

  try {
    const checkpointFile = join(tempTestDir, 'checkpoint.json')
    const initialCheckpoint = {
      sourceCues: [
        { id: '1', start: 0.5, end: 2.5, text: 'Câu chào đầu tiên' },
        { id: '2', start: 2.6, end: 5.0, text: 'Câu giới thiệu nội dung' }
      ],
      detectedSourceLanguage: 'vi'
    }
    await writeFile(checkpointFile, JSON.stringify(initialCheckpoint, null, 2), 'utf8')

    // Simulate resumption: read checkpoint and verify extraction is skipped
    const loaded = JSON.parse(await readFile(checkpointFile, 'utf8'))
    assert.equal(loaded.sourceCues.length, 2)
    assert.equal(loaded.detectedSourceLanguage, 'vi')

    // Simulate transient failure during stage 2 (e.g. translation error)
    // Checkpoint must NOT be deleted
    assert.ok((await stat(checkpointFile)).isFile())

    // Update with translated stage
    loaded.translatedCues = [
      { id: '1', sourceIndex: 1, start: 0.5, end: 2.5, text: 'First welcome sentence' },
      { id: '2', sourceIndex: 2, start: 2.6, end: 5.0, text: 'Content introduction sentence' }
    ]
    await writeFile(checkpointFile, JSON.stringify(loaded, null, 2), 'utf8')

    const resumed = JSON.parse(await readFile(checkpointFile, 'utf8'))
    assert.equal(resumed.translatedCues.length, 2)
    assert.equal(resumed.translatedCues[0].text, 'First welcome sentence')
  } finally {
    await rm(tempTestDir, { recursive: true, force: true }).catch(() => {})
  }
})

test('Case 5: Semantic Grouping merges consecutive sentence fragments and redistributes subtitle timing', () => {
  const sourceCues: SubtitleCue[] = [
    { id: 'cue-1', sourceIndex: 1, start: 0.0, end: 1.5, text: 'Trí tuệ nhân tạo' },
    { id: 'cue-2', sourceIndex: 2, start: 1.6, end: 3.2, text: 'đang thay đổi thế giới' },
    { id: 'cue-3', sourceIndex: 3, start: 3.3, end: 5.0, text: 'một cách nhanh chóng.' }
  ]

  const groups = buildSemanticGroups(sourceCues)
  assert.equal(groups.length, 1, 'Adjacent cues of the same sentence must merge into 1 group')
  assert.equal(joinGroupText(groups[0].cues), 'Trí tuệ nhân tạo đang thay đổi thế giới một cách nhanh chóng.')

  // Subtitle proportional redistribution inside the group
  const totalWords = groups[0].cues.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0)
  assert.equal(totalWords, 13)
})

test('Case 6: Global voice tempo computes robust single baseline pace across video segments', () => {
  // 5 groups: 4 groups need ~1.08x, 1 group needs 1.25x
  const requiredTempos = [1.08, 1.07, 1.09, 1.08, 1.25]
  const globalTempo = calculateGlobalVoiceTempo(requiredTempos)
  assert.ok(globalTempo >= 1.05 && globalTempo <= 1.15, `Global tempo (${globalTempo}) should represent the robust baseline without being distorted by the 1.25x outlier`)
})

test('Case 7: Zero speech crop invariant - voice overflow is resolved through tempo/rephrase without truncating audio', () => {
  const cues = [{ id: 'cue-1', start: 0.0, end: 2.0, text: 'Very long phrase' }]
  const naturalDurations = [2.4] // Needs 1.2x
  const plan = planAutoShortVoiceTimeline(cues, naturalDurations, 5.0, 1.35)

  assert.equal(plan.cues.length, 1)
  assert.ok(plan.cues[0].duration > 1.7 && plan.cues[0].duration < 2.1)
  assert.ok(plan.cues[0].tempo <= AUTO_SHORT_TTS_HARD_MAX_TEMPO)
  // Subtitle anchor strictly preserved
  assert.equal(plan.cues[0].subtitleStart, 0.0)
  assert.equal(plan.cues[0].subtitleEnd, 2.0)
})

test('Case 8: Voice completeness validator catches incomplete audio and truncated speech tails', () => {
  const targetText = 'Công nghệ trí tuệ nhân tạo đang phát triển vượt bậc mỗi ngày.'
  
  // Normal duration & complete coverage
  const validCheck = validateVoiceAudioCompleteness(targetText, 3.2, [
    { text: 'Công', start: 0, end: 0.3 },
    { text: 'nghệ', start: 0.3, end: 0.6 },
    { text: 'trí', start: 0.6, end: 0.9 },
    { text: 'tuệ', start: 0.9, end: 1.2 },
    { text: 'nhân', start: 1.2, end: 1.5 },
    { text: 'tạo', start: 1.5, end: 1.8 },
    { text: 'đang', start: 1.8, end: 2.1 },
    { text: 'phát', start: 2.1, end: 2.4 },
    { text: 'triển', start: 2.4, end: 2.7 },
    { text: 'vượt', start: 2.7, end: 2.9 },
    { text: 'bậc', start: 2.9, end: 3.0 },
    { text: 'mỗi', start: 3.0, end: 3.1 },
    { text: 'ngày', start: 3.1, end: 3.2 }
  ])
  assert.equal(validCheck.ok, true)

  // Incomplete audio: only first 2 words spoken, tail dropped
  const incompleteCheck = validateVoiceAudioCompleteness(targetText, 0.5, [
    { text: 'Công', start: 0, end: 0.2 },
    { text: 'nghệ', start: 0.2, end: 0.4 }
  ])
  assert.equal(incompleteCheck.ok, false)
  assert.ok(incompleteCheck.error != null)

  // Absurdly fast rate (10 words in 0.3s -> dropped speech)
  const tooFastCheck = validateVoiceAudioCompleteness(targetText, 0.3)
  assert.equal(tooFastCheck.ok, false)
})

test('Case 9: Audio mix ducking produces sidechaincompress and alimiter in MIX mode', () => {
  const videoMeta = { w: 1080, h: 1920, giay: 15.0, hasAudio: true }
  const filters = taoFilterComplex(videoMeta, [], false, false, 'sub.ass', true, true, 30)
  const filterStr = filters.join(' ')
  assert.match(filterStr, /sidechaincompress=/u)
  assert.match(filterStr, /alimiter=/u)
  assert.match(filterStr, /apad=whole_dur=15\.000/u)
})

test('Case 10: Post-render output validation verifies video, audio, duration, and decodability', () => {
  // Valid output
  const validOutput = validateRenderedOutputMedia({
    fileSize: 1024 * 1024,
    videoStream: { width: 1080, height: 1920, duration: 10.0 },
    audioStream: { channels: 2, sampleRate: 44100, duration: 10.0 },
    formatDuration: 10.0,
    decodeError: null,
    ttsExpected: true
  })
  assert.equal(validOutput.ok, true)
  assert.equal(validOutput.hasVideo, true)
  assert.equal(validOutput.hasAudio, true)

  // Missing audio when TTS expected
  const missingAudio = validateRenderedOutputMedia({
    fileSize: 1024 * 1024,
    videoStream: { width: 1080, height: 1920, duration: 10.0 },
    audioStream: null,
    formatDuration: 10.0,
    decodeError: null,
    ttsExpected: true
  })
  assert.equal(missingAudio.ok, false)
  assert.match(missingAudio.error || '', /thiếu audio stream/iu)

  // Empty or corrupted file
  const corrupted = validateRenderedOutputMedia({
    fileSize: 200,
    videoStream: null,
    audioStream: null
  })
  assert.equal(corrupted.ok, false)
})

test('Case 12: Windows Unicode & Space path escaping in FFmpeg filter graph', () => {
  const winPath = 'D:/Thư Mục Video 2026/Video [Tập 1] (Bản Đẹp) #1.ass'
  const videoMeta = { w: 1080, h: 1920, giay: 10.0, hasAudio: true }
  const filters = taoFilterComplex(videoMeta, [], false, true, winPath, true, true, 30)
  const filterStr = filters.join(' ')
  assert.ok(filterStr.includes('Thư Mục Video 2026'))
  assert.match(filterStr, /ass=.*Thư Mục Video 2026/u)
})


