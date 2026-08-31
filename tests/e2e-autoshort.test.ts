import test from 'node:test'
import assert from 'node:assert/strict'
import {
  planAutoShortVoiceTimeline,
  validateAutoShortTimelineSync,
  AUTO_SHORT_TTS_MAX_TEMPO,
  AUTO_SHORT_TTS_HARD_MAX_TEMPO
} from '../src/main/autoShortPolicy'
import { parseSrt, serializeSrt } from '../src/shared/subtitles'
import { audioMixGains, originalAudioGain } from '../src/shared/audioMix'
import { taoFilterComplex, taoAss, boCuc, docSrt } from '../src/main/burn'

test('E2E AutoShort Pipeline: Deterministic Timeline, Dubbing, and Audio-Subtitle Sync Verification', () => {
  // 1. Synthetic input video metadata
  const videoMeta = {
    w: 1080,
    h: 1920,
    giay: 12.0,
    hasAudio: true
  }

  // 2. Source extraction cues (simulating Whisper/OCR aligned output)
  const rawSourceSrt = `1
00:00:00,500 --> 00:00:03,000
Chào mừng các bạn đến với video phân tích ngày hôm nay.

2
00:00:03,500 --> 00:00:06,800
Chúng tôi sẽ giới thiệu các tính năng đột phá nhất.

3
00:00:07,200 --> 00:00:10,500
Hãy nhấn đăng ký kênh để không bỏ lỡ thông tin mới.
`
  const sourceParsed = parseSrt(rawSourceSrt)
  assert.equal(sourceParsed.cues.length, 3)

  // 3. Dubbing translation cues (simulating translation preserving cue identities)
  const translatedCues = [
    {
      id: sourceParsed.cues[0].id || '1',
      sourceIndex: 1,
      start: sourceParsed.cues[0].start,
      end: sourceParsed.cues[0].end,
      text: 'Welcome everyone to today analytical overview video.'
    },
    {
      id: sourceParsed.cues[1].id || '2',
      sourceIndex: 2,
      start: sourceParsed.cues[1].start,
      end: sourceParsed.cues[1].end,
      text: 'We are introducing the most groundbreaking features.'
    },
    {
      id: sourceParsed.cues[2].id || '3',
      sourceIndex: 3,
      start: sourceParsed.cues[2].start,
      end: sourceParsed.cues[2].end,
      text: 'Please subscribe to stay updated with new releases.'
    }
  ]
  assert.equal(translatedCues.length, 3)

  // 4. TTS natural durations are close to one source-adaptive pace. The
  // planner must not solve one outlier by silently changing later cue starts.
  const naturalDurations = [2.3, 2.95, 3.0]

  // 5. Plan Auto Short Voice Timeline with hard max tempo
  const plan = planAutoShortVoiceTimeline(
    translatedCues,
    naturalDurations,
    videoMeta.giay,
    AUTO_SHORT_TTS_MAX_TEMPO
  )

  // Verify plan properties
  assert.equal(plan.cues.length, 3)
  assert.ok(plan.maxTempo <= AUTO_SHORT_TTS_HARD_MAX_TEMPO, 'Tempo must never exceed hard max (1.35x)')
  assert.ok(plan.cues.every((cue) => cue.tempo >= plan.globalTempo && cue.tempo <= plan.globalTempo + 0.031))

  // Verify timestamps are strictly monotonic and within video duration
  let lastEnd = 0
  for (let i = 0; i < plan.cues.length; i++) {
    const cue = plan.cues[i]
    assert.ok(cue.start >= lastEnd, `Cue ${i} start (${cue.start}) must be >= previous end (${lastEnd})`)
    assert.ok(cue.voiceEnd > cue.start, `Cue ${i} voiceEnd must be > start`)
    assert.ok(cue.voiceEnd <= videoMeta.giay, `Cue ${i} voiceEnd must be <= video duration`)
    assert.equal(cue.subtitleStart, translatedCues[i].start, `Cue ${i} subtitle start must anchor to source`)
    assert.equal(cue.subtitleEnd, translatedCues[i].end, `Cue ${i} subtitle end must anchor to source`)
    lastEnd = cue.voiceEnd
  }

  // 6. Validate timeline sync against source anchors
  const diagnostics = plan.cues.map((c, i) => ({
    cueId: c.cueId,
    sourceStart: sourceParsed.cues[i].start,
    sourceEnd: sourceParsed.cues[i].end,
    renderSubtitleStart: c.subtitleStart,
    renderSubtitleEnd: c.subtitleEnd,
    voiceStart: c.start,
    voiceEnd: c.voiceEnd,
    semanticOverflowMs: c.semanticOverflowMs
  }))

  const syncResult = validateAutoShortTimelineSync(
    sourceParsed.cues,
    translatedCues,
    diagnostics,
    videoMeta.giay
  )
  assert.equal(syncResult.ok, true, 'Timeline sync validation must pass without overflow')

  // 7. Audio mixing filter graph verification for MIX mode
  const mixFilterArgs = taoFilterComplex(
    videoMeta,
    [],
    false,
    false,
    'sub.ass',
    true, // batAmThanh
    true, // hasAudioFile
    40    // 40% BGM volume
  )
  const filterStr = mixFilterArgs.join(' ')
  assert.match(filterStr, /sidechaincompress=threshold=0\.06:ratio=4:attack=15:release=200/u)
  assert.match(filterStr, /alimiter=limit=-1dB:attack=5:release=50/u)
  assert.match(filterStr, /apad=whole_dur=12\.000/u)

  // 8. Subtitle generation verification (ASS styles)
  const subLayout = boCuc(videoMeta, { x0: 50, y0: 1400, x1: 1030, y1: 1700 }, false)
  const assOutput = taoAss(translatedCues, videoMeta, subLayout)
  assert.match(assOutput, /Dialogue: 0,0:00:00\.50,0:00:03\.00,D/u)
  assert.match(assOutput, /Welcome everyone to today(?:\\N|\s)+analytical overview video\./u)

  // 9. Serialized SRT verification matching spoken voice text
  const serializedTimedSrt = serializeSrt(translatedCues)
  const reparsedTimedSrt = parseSrt(serializedTimedSrt)
  assert.equal(reparsedTimedSrt.cues.length, 3)
  assert.equal(reparsedTimedSrt.cues[0].text, translatedCues[0].text)
  assert.equal(reparsedTimedSrt.cues[1].text, translatedCues[1].text)
  assert.equal(reparsedTimedSrt.cues[2].text, translatedCues[2].text)
})
