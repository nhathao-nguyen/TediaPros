import assert from 'node:assert/strict'
import test from 'node:test'
import { assessContentQuality, validateAutoShortContentQuality } from '../src/main/autoShortContentQuality'
import type { SubtitleCue } from '../src/shared/types'

const cue = (id: string, text: string, sourceIndex: number): SubtitleCue => ({
  id, text, sourceIndex, start: sourceIndex, end: sourceIndex + 1
})

test('content QA rejects duplicate/missing/unexpected cue mappings and protected number changes', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [cue('a', 'Có 12 kg và 3 hộp.', 0), cue('b', 'Không bỏ qua bước này.', 1)],
    targetCues: [cue('a', 'Có 13 kg và 3 hộp.', 0), cue('a', 'Đã bỏ qua bước này.', 1)]
  })
  assert.equal(result.ok, false)
  assert.ok(result.findings.some((finding) => finding.code === 'duplicate-target-id'))
  assert.ok(result.findings.some((finding) => finding.code === 'protected-token-mismatch'))
})

test('content QA passes faithful cue mapping and reports semantic review as a separate optional finding', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [cue('a', 'Có 12 kg và 3 hộp.', 0), cue('b', 'Không bỏ qua bước này.', 1)],
    targetCues: [cue('a', 'Có 12 kg và 3 hộp.', 0), cue('b', 'Không bỏ qua bước này.', 1)]
  })
  assert.equal(result.ok, true)
  assert.equal(result.findings.length, 0)
})

test('content QA accepts translated unit spelling and equivalent negation', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [cue('a', 'Không tăng 15% trong 2 phút.', 0)],
    targetCues: [cue('a', 'Do not increase 15 percent in 2 minutes.', 0)]
  })
  assert.equal(result.ok, true)
  assert.equal(result.findings.length, 0)
})

test('content QA protects signed numeric values', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [{ id: 'c1', start: 0, end: 1, text: 'Giảm -5 độ.' }],
    targetCues: [{ id: 'c1', start: 0, end: 1, text: 'Giảm 5 độ.' }]
  })
  assert.equal(result.ok, true)
  assert.ok(result.findings.some((finding) => finding.code === 'protected-token-mismatch'))
  assert.ok(result.findings.every((finding) => finding.severity === 'warning'))
})

test('negation across scripts is review evidence, not a structural failure', () => {
  const result = assessContentQuality(
    [cue('c1', '不要摸这只狗。', 0)],
    [cue('c1', 'Do not touch this dog.', 0)]
  )
  assert.notEqual(result.disposition, 'needs-review')
  assert.ok(result.issues.every((issue) => issue.severity === 'warning'))
})

test('number words and Unicode digits are warnings until language evidence is qualified', () => {
  const numberWord = assessContentQuality(
    [cue('c1', 'Có 2 con chó.', 0)],
    [cue('c1', 'There are two dogs.', 0)]
  )
  const unicodeDigits = assessContentQuality(
    [cue('c1', 'There are 12 dogs.', 0)],
    [cue('c1', 'هناك ١٢ كلبًا.', 0)]
  )
  assert.ok(numberWord.issues.every((issue) => issue.severity === 'warning'))
  assert.ok(unicodeDigits.issues.every((issue) => issue.severity === 'warning'))
})

test('empty and missing target cues remain hard structural failures', () => {
  const result = assessContentQuality(
    [cue('a', 'Source A', 0), cue('b', 'Source B', 1)],
    [cue('a', '', 0), cue('a', 'duplicate', 1)]
  )
  assert.equal(result.disposition, 'needs-review')
  assert.ok(result.issues.some((issue) => issue.code === 'empty-text' && issue.severity === 'error'))
  assert.ok(result.issues.some((issue) => issue.code === 'duplicate-id' && issue.severity === 'error'))
  assert.ok(result.issues.some((issue) => issue.code === 'missing-id' && issue.severity === 'error'))
})
