import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applySubtitleTextCase,
  applyTextCaseToCues,
  isValidSubtitleTextCase,
  toTitleCase
} from '../src/shared/subtitleTextCase'
import { taoAss } from '../src/main/burn'
import type { SubtitleCue } from '../src/shared/types'

test('isValidSubtitleTextCase validates allowed options', () => {
  assert.equal(isValidSubtitleTextCase('original'), true)
  assert.equal(isValidSubtitleTextCase('uppercase'), true)
  assert.equal(isValidSubtitleTextCase('lowercase'), true)
  assert.equal(isValidSubtitleTextCase('titlecase'), true)
  assert.equal(isValidSubtitleTextCase('invalid'), false)
  assert.equal(isValidSubtitleTextCase(null), false)
  assert.equal(isValidSubtitleTextCase(undefined), false)
  assert.equal(isValidSubtitleTextCase(123), false)
})

test('applySubtitleTextCase transforms text accurately with Vietnamese support', () => {
  const original = 'Xin Chào các bạn, đây là TediaPros và Đắk Lắk!'

  // Original
  assert.equal(applySubtitleTextCase(original, 'original'), original)
  assert.equal(applySubtitleTextCase(original, undefined), original)

  // Uppercase
  assert.equal(
    applySubtitleTextCase(original, 'uppercase'),
    'XIN CHÀO CÁC BẠN, ĐÂY LÀ TEDIAPROS VÀ ĐẮK LẮK!'
  )

  // Lowercase
  assert.equal(
    applySubtitleTextCase(original, 'lowercase'),
    'xin chào các bạn, đây là tediapros và đắk lắk!'
  )

  // Titlecase
  assert.equal(
    applySubtitleTextCase('xin chào việt nam', 'titlecase'),
    'Xin Chào Việt Nam'
  )
  assert.equal(
    toTitleCase('đường phố và xe cộ'),
    'Đường Phố Và Xe Cộ'
  )
})

test('applyTextCaseToCues transforms cue texts while preserving metadata', () => {
  const cues: SubtitleCue[] = [
    { id: '1', start: 0, end: 2, text: 'câu thoại thứ nhất', sourceIndex: 0 },
    { id: '2', start: 2, end: 4, text: 'câu thoại thứ hai', sourceIndex: 1 }
  ]

  const uppercaseCues = applyTextCaseToCues(cues, 'uppercase')
  assert.equal(uppercaseCues[0].text, 'CÂU THOẠI THỨ NHẤT')
  assert.equal(uppercaseCues[1].text, 'CÂU THOẠI THỨ HAI')
  assert.equal(uppercaseCues[0].start, 0)
  assert.equal(uppercaseCues[0].end, 2)

  // Original returns clones or copies without changes
  const originalCues = applyTextCaseToCues(cues, 'original')
  assert.equal(originalCues[0].text, 'câu thoại thứ nhất')
})

test('taoAss renders uppercase subtitles when subtitleTextCase is uppercase', () => {
  const cues: SubtitleCue[] = [
    { id: '1', start: 1, end: 3, text: 'same here', sourceIndex: 0 },
    { id: '2', start: 3.5, end: 5, text: 'hello world', sourceIndex: 1 }
  ]
  const assResult = taoAss(
    cues,
    { w: 1080, h: 1920 },
    { x: 100, y: 1500, bw: 880, bh: 200, fontSize: 48, vien: 4, marginV: 150 },
    null,
    null,
    null,
    {
      subtitleTextCase: 'uppercase',
      displayStyle: 'standard'
    }
  )

  assert.ok(assResult.includes('SAME HERE'), 'ASS output must contain uppercase text')
  assert.ok(assResult.includes('HELLO WORLD'), 'ASS output must contain uppercase text')
  assert.ok(!assResult.includes('same here'), 'ASS output should not contain lowercase text')
})

test('taoAss renders lowercase subtitles when subtitleTextCase is lowercase', () => {
  const cues: SubtitleCue[] = [
    { id: '1', start: 1, end: 3, text: 'SAME HERE', sourceIndex: 0 }
  ]
  const assResult = taoAss(
    cues,
    { w: 1080, h: 1920 },
    { x: 100, y: 1500, bw: 880, bh: 200, fontSize: 48, vien: 4, marginV: 150 },
    null,
    null,
    null,
    {
      subtitleTextCase: 'lowercase',
      displayStyle: 'standard'
    }
  )

  assert.ok(assResult.includes('same here'), 'ASS output must contain lowercase text')
  assert.ok(!assResult.includes('SAME HERE'), 'ASS output should not contain uppercase text')
})
