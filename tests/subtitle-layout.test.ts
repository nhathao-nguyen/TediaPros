import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planSubtitleLayout, subtitleLayoutRules } from '../src/shared/subtitleLayout'
import type { SubtitleCue } from '../src/shared/types'

test('subtitleLayoutRules assigns 1 maxLine for social and 2 for readable/vertical', () => {
  assert.equal(subtitleLayoutRules('social').maxLines, 1)
  assert.equal(subtitleLayoutRules('readable').maxLines, 2)
  assert.equal(subtitleLayoutRules('vertical').maxLines, 2)
})

test('planSubtitleLayout splits multiline cues into 1-line segments for social profile', () => {
  const cues: SubtitleCue[] = [
    {
      id: 'cue-1',
      start: 0,
      end: 4,
      text: 'Đây là dòng phụ đề thứ nhất rất dài cần phải ngắt dòng để hiển thị rõ ràng trên màn hình'
    }
  ]

  // Mock measure function: 1 char = 10px
  const measure = (text: string) => text.length * 10

  const plan = planSubtitleLayout(
    cues,
    {
      profile: 'social',
      autoOptimize: true,
      videoWidth: 1080,
      videoHeight: 1920,
      boxWidth: 400, // Small box width forces wrapping into multiple lines
      boxHeight: 200,
      fontSize: 32,
      boxPadding: 16
    },
    measure
  )

  // Verify that all segments have exactly 1 line
  assert.ok(plan.segments.length > 1)
  for (const seg of plan.segments) {
    assert.equal(seg.lines.length, 1)
  }
})

test('ngatDongTheoPx respects sentence terminal and does not pack orphan words from the next sentence', () => {
  const { ngatDongTheoPx } = require('../src/shared/subWrap')
  const text = 'Stay behind the line. It keeps failing at the same point.'
  // Mock measure: 1 char = 10px. Width 260px fits "Stay behind the line. It" (24 chars = 240px)
  // but sentence protection should break after "line."
  const measure = (s: string) => s.length * 10
  const wrapped = ngatDongTheoPx(text, 260, measure, false)
  const lines = wrapped.split('\\N')
  assert.equal(lines[0], 'Stay behind the line.')
  assert.equal(lines[1], 'It keeps failing at the')
})

test('splitLongAlignedCues splits multi-sentence whisper cues into independent timed cues using word timestamps', () => {
  const { splitLongAlignedCues } = require('../src/shared/autoShortAlignment')
  const cue = {
    id: 'cue-1',
    start: 0.0,
    end: 12.98,
    text: 'Stay behind the line. It keeps failing at the same point. We have the best engineers here.',
    source: 'whisper' as const,
    timingQuality: 'word' as const,
    words: [
      { text: 'Stay', start: 0.0, end: 0.4 },
      { text: 'behind', start: 0.45, end: 0.9 },
      { text: 'the', start: 0.95, end: 1.1 },
      { text: 'line.', start: 1.15, end: 1.8 },
      { text: 'It', start: 5.48, end: 5.6 },
      { text: 'keeps', start: 5.65, end: 5.9 },
      { text: 'failing', start: 5.95, end: 6.2 },
      { text: 'at', start: 6.25, end: 6.35 },
      { text: 'the', start: 6.4, end: 6.5 },
      { text: 'same', start: 6.55, end: 6.7 },
      { text: 'point.', start: 6.75, end: 7.1 },
      { text: 'We', start: 7.4, end: 7.6 },
      { text: 'have', start: 7.65, end: 7.8 },
      { text: 'the', start: 7.85, end: 7.95 },
      { text: 'best', start: 8.0, end: 8.3 },
      { text: 'engineers', start: 8.35, end: 8.9 },
      { text: 'here.', start: 8.95, end: 9.3 }
    ]
  }

  const split = splitLongAlignedCues([cue])
  assert.equal(split.length, 3)

  // Sentence 1
  assert.equal(split[0].text, 'Stay behind the line.')
  assert.equal(split[0].start, 0.0)
  assert.equal(split[0].end, 1.8)
  assert.equal(split[0].words?.length, 4)

  // Sentence 2 (after 3.68s pause)
  assert.equal(split[1].text, 'It keeps failing at the same point.')
  assert.equal(split[1].start, 5.48)
  assert.equal(split[1].end, 7.1)
  assert.equal(split[1].words?.length, 7)

  // Sentence 3
  assert.equal(split[2].text, 'We have the best engineers here.')
  assert.equal(split[2].start, 7.4)
  assert.equal(split[2].end, 9.3)
  assert.equal(split[2].words?.length, 6)
})

test('allocateSegmentTimingsDP inserts dead-air silence gap between sentences when total duration is large', () => {
  const { allocateSegmentTimingsDP, subtitleLayoutRules } = require('../src/shared/subtitleLayout')
  const rules = subtitleLayoutRules('readable')

  // Cue from Video 923923593724102: 12.98 to 22.18 (9.2s total)
  // Sentence 1: "Nothing without asking." (23 chars)
  // Sentence 2: "That's impossible" (17 chars)
  const groups = [
    ['Nothing without asking.'],
    ["That's impossible"]
  ]

  const timings = allocateSegmentTimingsDP(12.98, 22.18, groups, rules)
  assert.equal(timings.length, 2)

  // Segment 1 starts at cue start (12.98s) and ends in ~2.8s (not 18s!)
  assert.equal(timings[0].startSec, 12.98)
  assert.ok(timings[0].endSec <= 16.5, `Segment 1 ended too late: ${timings[0].endSec}`)

  // Segment 2 ends at cue end (22.18s) and starts near ~20s (not 18s!)
  assert.equal(timings[1].endSec, 22.18)
  assert.ok(timings[1].startSec >= 19.5, `Segment 2 started too early: ${timings[1].startSec}`)

  // Verified silence gap: screen is clear of subtitles between segment 1 end and segment 2 start
  const silenceGap = timings[1].startSec - timings[0].endSec
  assert.ok(silenceGap >= 3.0, `Expected silence gap >= 3.0s, got ${silenceGap}s`)
})

test('splitLongAlignedCues detects dead-air silence gaps without word timestamps (Video 923923593724102 case)', () => {
  const { splitLongAlignedCues } = require('../src/shared/autoShortAlignment')
  const cue = {
    id: 'cue-2',
    start: 12.98,
    end: 22.18,
    text: "Nothing without asking. That's impossible",
    source: 'whisper' as const,
    timingQuality: 'cue' as const
  }

  const split = splitLongAlignedCues([cue])
  assert.equal(split.length, 2)

  // Sentence 1 starts at 12.98s and ends around ~16s
  assert.equal(split[0].text, 'Nothing without asking.')
  assert.equal(split[0].start, 12.98)
  assert.ok(split[0].end <= 16.5, `Sentence 1 ended too late: ${split[0].end}`)

  // Sentence 2 ends at 22.18s and starts around ~19.5s
  assert.equal(split[1].text, "That's impossible")
  assert.equal(split[1].end, 22.18)
  assert.ok(split[1].start >= 19.5, `Sentence 2 started too early: ${split[1].start}`)

  // Silence gap preserved
  assert.ok(split[1].start - split[0].end >= 3.0)
})

test('alignWordsDtw matches contractions and token variations between subtitle text and speech words', () => {
  const { alignWordsDtw } = require('../src/shared/autoShortAlignment')

  const cueWords = ['Nothing', 'without', 'asking.', "That's", 'impossible']

  // Whisper speech words with contraction split ("That" + "'s") and punctuation
  const candidateWords = [
    { text: 'Nothing', start: 12.98, end: 13.4 },
    { text: 'without', start: 13.45, end: 13.8 },
    { text: 'asking,', start: 13.85, end: 14.15 },
    { text: 'That', start: 21.6, end: 21.75 },
    { text: "'s", start: 21.75, end: 21.85 },
    { text: 'impossible.', start: 21.9, end: 22.18 }
  ]

  const aligned = alignWordsDtw(cueWords, candidateWords)
  assert.ok(aligned)
  assert.equal(aligned.length, cueWords.length)

  // Word 0: Nothing
  assert.equal(aligned[0].text, 'Nothing')
  assert.equal(aligned[0].start, 12.98)
  assert.equal(aligned[0].end, 13.4)

  // Word 2: asking. (matched with asking,)
  assert.equal(aligned[2].text, 'asking.')
  assert.equal(aligned[2].start, 13.85)
  assert.equal(aligned[2].end, 14.15)

  // Word 3: That's (merged from "That" + "'s")
  assert.equal(aligned[3].text, "That's")
  assert.equal(aligned[3].start, 21.6)
  assert.equal(aligned[3].end, 21.85)

  // Word 4: impossible
  assert.equal(aligned[4].text, 'impossible')
  assert.equal(aligned[4].start, 21.9)
  assert.equal(aligned[4].end, 22.18)
})

test("splitLongAlignedCues repairs pre-silence drift (That's vs impossible with 7s gap)", () => {
  const { splitLongAlignedCues } = require('../src/shared/autoShortAlignment')

  // Exact cue from Whisper on Video 923923593724102
  const cue = {
    id: 'cue-1-12980-s2',
    start: 14.46,
    end: 22.18,
    text: "That's impossible",
    source: 'whisper' as const,
    timingQuality: 'word' as const,
    words: [
      { text: "That's", start: 14.46, end: 14.8, probability: 0.977 },
      { text: 'impossible', start: 21.84, end: 22.18, probability: 0.991 }
    ]
  }

  const result = splitLongAlignedCues([cue])
  // Should NOT produce a phantom "That's" at 14.46s!
  // Instead, "That's" is repaired and united with "impossible" around 21.46s
  assert.equal(result.length, 1, "Expected 'That's' and 'impossible' to be unified at speech timestamp")
  assert.equal(result[0].text, "That's impossible")
  assert.ok(result[0].start >= 21.4 && result[0].start <= 21.5, `Expected start ~21.46, got ${result[0].start}`)
  assert.equal(result[0].end, 22.18)
})

test("splitLongAlignedCues splits legitimate clauses across significant pause >= 0.6s", () => {
  const { splitLongAlignedCues } = require('../src/shared/autoShortAlignment')

  const cue = {
    id: 'cue-multi',
    start: 10.0,
    end: 18.0,
    text: "We waited for three hours and nobody came.",
    source: 'whisper' as const,
    timingQuality: 'word' as const,
    words: [
      { text: "We", start: 10.0, end: 10.2 },
      { text: "waited", start: 10.2, end: 10.6 },
      { text: "for", start: 10.6, end: 10.8 },
      { text: "three", start: 10.8, end: 11.1 },
      { text: "hours", start: 11.1, end: 11.5 },
      // 3.5s pause between clauses
      { text: "and", start: 15.0, end: 15.2 },
      { text: "nobody", start: 15.2, end: 15.6 },
      { text: "came.", start: 15.6, end: 16.0 }
    ]
  }

  const result = splitLongAlignedCues([cue])
  assert.equal(result.length, 2, "Expected clause split due to 3.5s pause between full clauses")
  assert.equal(result[0].text, "We waited for three hours")
  assert.equal(result[0].start, 10.0)
  assert.equal(result[0].end, 11.5)
  assert.equal(result[1].text, "and nobody came.")
  assert.equal(result[1].start, 15.0)
  assert.equal(result[1].end, 16.0)
})

test('taoAss single-word display caps word duration and does not stretch across silence gaps', () => {
  const { taoAss } = require('../src/main/burn')

  const cues = [
    {
      id: 'cue-1',
      start: 14.46,
      end: 22.18,
      text: "That's impossible",
      sourceIndex: 0
    }
  ]

  const wordTimings = [
    {
      start: 14.46,
      end: 22.18,
      words: [
        { text: "That's", start: 14.46, end: 14.8 },
        { text: 'impossible', start: 21.84, end: 22.18 }
      ]
    }
  ]

  const ass = taoAss(
    cues,
    { w: 1080, h: 1920 },
    { x: 100, y: 1500, bw: 880, bh: 200, fontSize: 48, vien: 4, marginV: 150 },
    null,
    null,
    null,
    {
      displayStyle: 'single-word',
      wordTimings
    }
  )

  // Find dialogue lines
  const dialogues = ass.split('\n').filter((l: string) => l.startsWith('Dialogue:'))
  assert.ok(dialogues.length >= 2, 'Expected at least 2 dialogue lines for 2 words')

  // Find the dialogue for "That's"
  const thatsLine = dialogues.find((l: string) => l.includes("That's"))
  assert.ok(thatsLine, "Should have a dialogue line for That's")

  // The end timestamp of That's MUST NOT be 21 or 22 seconds! It should end around 14.9s
  const match = thatsLine.match(/Dialogue:\s*\d+,([^,]+),([^,]+),/)
  assert.ok(match, 'Should match timestamps')
  const startTime = match[1].trim()
  const endTime = match[2].trim()

  assert.equal(startTime, '0:00:14.46')
  // Verify endTime is around 14.95, NOT 21.84!
  assert.ok(endTime.startsWith('0:00:14.'), `That's ended too late: ${endTime}, should end before 15.00s!`)
})

function assTextEvents(ass: string): Array<{ start: string; end: string; text: string }> {
  return ass.split('\n').flatMap((line) => {
    const match = line.match(/^Dialogue: \d+,([^,]+),([^,]+),D,,0,0,0,,(.*)$/)
    return match ? [{ start: match[1], end: match[2], text: match[3].replace(/\{[^}]*\}/g, '') }] : []
  })
}

test('single-word ASS preserves Give me 30 minutes timing even when full-sentence layout splits', () => {
  const { taoAss } = require('../src/main/burn')
  const cue = { id: 'give-me-30', start: 9.98, end: 11.18, text: 'Give me 30 minutes.' }
  const words = [
    { text: 'Give', start: 9.98, end: 10.58 },
    { text: 'me', start: 10.58, end: 10.68 },
    { text: '30', start: 10.68, end: 10.88 },
    { text: 'minutes.', start: 10.88, end: 11.18 }
  ]
  // A narrow, one-line box forces full-sentence rendering to split this cue.
  const bc = { x: 40, y: 750, bw: 460, bh: 80, tamY: 790, fontSize: 72, vien: 4, marginV: 130 }
  const expected = [
    { start: '0:00:09.98', end: '0:00:10.58', text: 'Give' },
    { start: '0:00:10.58', end: '0:00:10.68', text: 'me' },
    { start: '0:00:10.68', end: '0:00:10.88', text: '30' },
    { start: '0:00:10.88', end: '0:00:11.18', text: 'minutes.' }
  ]
  for (const profile of ['social', 'vertical', 'readable']) {
    const options = { layoutProfile: profile, autoOptimize: true, wordTimings: [{ ...cue, words }] }
    const standard = assTextEvents(taoAss([cue], { w: 540, h: 960 }, bc, 'Arial', null, null, options))
    assert.ok(standard.length > 1, `${profile}: fixture must exercise layout splitting`)
    const actual = assTextEvents(taoAss([cue], { w: 540, h: 960 }, bc, 'Arial', null, null, {
      ...options, displayStyle: 'single-word', requireWordTimings: true
    }))
    assert.deepEqual(actual, expected, `${profile}: show each word once at its original start, without overlap`)
  }
})

test('single-word ASS never extends a short word over the next word or past the cue boundary', () => {
  const { taoAss } = require('../src/main/burn')
  const cue = { id: 'short-words', start: 1, end: 1.24, text: 'I see it.' }
  const words = [
    { text: 'I', start: 1, end: 1.02 },
    { text: 'see', start: 1.02, end: 1.22 },
    { text: 'it.', start: 1.22, end: 1.24 }
  ]
  const ass = taoAss([cue], { w: 540, h: 960 },
    { x: 40, y: 750, bw: 460, bh: 100, tamY: 800, fontSize: 35, vien: 2, marginV: 110 },
    'Arial', { bgEnabled: true, bgColor: '#000000', bgOpacity: 60, outlinePx: 2 }, null,
    { displayStyle: 'single-word', wordTimings: [{ ...cue, words }], highlightPop: false })
  assert.deepEqual(assTextEvents(ass), [
    { start: '0:00:01.00', end: '0:00:01.02', text: 'I' },
    { start: '0:00:01.02', end: '0:00:01.22', text: 'see' },
    { start: '0:00:01.22', end: '0:00:01.24', text: 'it.' }
  ])
  // Background boxes must expire with their own word, too.
  const boxes = ass.split('\n').filter((line: string) => /^Dialogue:.*?,Box,/.test(line))
  assert.equal(boxes.length, 3)
  assert.ok(boxes[0].includes(',0:00:01.00,0:00:01.02,'))
  assert.ok(boxes[2].includes(',0:00:01.22,0:00:01.24,'))
})

test('repairWhisperWordGaps pulls pre-silence drifted contraction forward to destination speech timestamp', () => {
  const { repairWhisperWordGaps } = require('../src/shared/autoShortAlignment')
  const words = [
    { text: "That's", start: 14.46, end: 14.8 },
    { text: 'impossible', start: 21.84, end: 22.18 }
  ]

  const repaired = repairWhisperWordGaps(words)
  assert.equal(repaired.length, 2)

  // "That's" should now start directly before "impossible" (~21.46s), NOT 14.46s!
  assert.ok(repaired[0].start >= 21.4 && repaired[0].start <= 21.5, `That's start was ${repaired[0].start}, expected ~21.46`)
  assert.ok(repaired[0].end <= 21.82, `That's end was ${repaired[0].end}, expected <= 21.82`)

  // "impossible" remains at 21.84 - 22.18
  assert.equal(repaired[1].start, 21.84)
  assert.equal(repaired[1].end, 22.18)

  // Gap between words is now <= 0.05s, not 7 seconds!
  const gap = repaired[1].start - repaired[0].end
  assert.ok(gap >= 0 && gap <= 0.05, `Expected natural inter-word gap, got ${gap}s`)
})

test('healOrphanDriftCues merges dangling orphan cue into destination cue across dead air', () => {
  const { healOrphanDriftCues } = require('../src/shared/autoShortAlignment')
  const cues = [
    {
      id: 'cue-6',
      start: 14.46,
      end: 14.8,
      text: "That's",
      source: 'whisper' as const,
      timingQuality: 'word' as const,
      words: [{ text: "That's", start: 14.46, end: 14.8 }]
    },
    {
      id: 'cue-7',
      start: 21.84,
      end: 22.18,
      text: 'impossible',
      source: 'whisper' as const,
      timingQuality: 'word' as const,
      words: [{ text: 'impossible', start: 21.84, end: 22.18 }]
    }
  ]

  const healed = healOrphanDriftCues(cues)
  // Should merge into 1 cue, removing the false 14s cue!
  assert.equal(healed.length, 1)
  assert.equal(healed[0].text, "That's impossible")
  assert.ok(healed[0].start >= 21.4 && healed[0].start <= 21.5, `Merged cue start was ${healed[0].start}`)
  assert.equal(healed[0].end, 22.18)
  assert.equal(healed[0].words?.length, 2)
  assert.ok(healed[0].words![0].start >= 21.4)
})



