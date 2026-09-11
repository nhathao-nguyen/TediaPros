import assert from 'node:assert/strict'
import test from 'node:test'
import { assessContentQuality, validateAutoShortContentQuality, validateRephraseSemanticPreservation } from '../src/main/autoShortContentQuality'
import type { SubtitleCue } from '../src/shared/types'

const cue = (id: string, text: string, sourceIndex: number): SubtitleCue => ({
  id, text, sourceIndex, start: sourceIndex, end: sourceIndex + 1
})

test('rephrase gate rejects candidates that lose protected meaning', () => {
  for (const candidate of [
    'Remove the safety valve before use.',
    'Do not remove before use.',
    'Do not remove the safety valve.',
    'Do not remove the safety valve before 3 uses.',
    'Do not remove the valve before Alice uses it.'
  ]) {
    assert.equal(validateRephraseSemanticPreservation(
      'Do not remove the safety valve before Alice uses it 2 times.', candidate, 'en'
    ).ok, false, candidate)
  }
})

test('rephrase gate accepts a shorter candidate that keeps anchors and conditions', () => {
  const result = validateRephraseSemanticPreservation(
    'Do not remove the safety valve before Alice uses it 2 times.',
    'Before Alice uses it 2 times, do not remove the safety valve.',
    'en'
  )
  assert.equal(result.ok, true)
})

test('rephrase gate rejects a dropped object and swapped people', () => {
  assert.equal(validateRephraseSemanticPreservation(
    'Turn off the pump before opening the valve.', 'Turn off before opening the valve.', 'en'
  ).ok, false)
  assert.equal(validateRephraseSemanticPreservation(
    'Alice gave Bob the red safety key.', 'Bob gave Alice the red safety key.', 'en'
  ).ok, false)
  assert.equal(validateRephraseSemanticPreservation(
    'Please give Alice the key.', 'Please give Bob the key.', 'en'
  ).ok, false)
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

test('interrogative question particles across languages do not trigger false negation mismatch warnings', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [
      cue('q1', '你明天去学校吗？', 0),
      cue('q2', '你吃饭了吗？', 1),
      cue('q3', '我们可以走吗？', 2)
    ],
    targetCues: [
      cue('q1', 'Ngày mai bạn có đi học không?', 0),
      cue('q2', 'Bạn đã ăn cơm chưa?', 1),
      cue('q3', 'Chúng ta có thể đi được không?', 2)
    ]
  })
  assert.equal(result.ok, true)
  assert.equal(result.findings.filter((f) => f.code === 'protected-token-mismatch').length, 0)
})

test('Chinese A-not-A questions do not look like dropped negation after translation', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [cue('q1', '不同的螃蟹能不能吃？', 0)],
    targetCues: [cue('q1', 'Which crabs are edible?', 0)]
  })
  assert.equal(result.ok, true)
  assert.equal(result.findings.filter((finding) => finding.code === 'protected-token-mismatch').length, 0)
})

for (const [source, target, warning] of [
  ['你为什么不去学校？', 'Tại sao bạn đi học?', true],
  ['不要看星星。', 'Hãy nhìn các vì sao.', true],
  ['你明天去学校吗？', 'Ngày mai bạn có đi học không?', false],
  ['你吃饭了吗？', 'Bạn đã ăn cơm chưa?', false],
  ['我们可以走吗？', 'Chúng ta có thể đi được không?', false],
  ['不要摸这只狗。', 'Đừng chạm vào con chó này.', false],
  ['你为什么不去学校？', 'Tại sao bạn không đi học?', false],
  ['可以走了。', 'Không được đi.', true],
  ['你吃饭了吗？不要喝酒。', 'Bạn đã ăn cơm chưa? Hãy uống rượu.', true]
] as const) {
  test(`polarity evidence: ${source} -> ${target}`, () => {
    const result = assessContentQuality([cue('a', source, 0)], [cue('a', target, 0)])
    assert.equal(result.issues.some((issue) => issue.code === 'protected-token-suspect'), warning)
    assert.ok(result.issues.every((issue) => issue.severity === 'warning'))
  })
}

test('CJK numerals match corresponding Arabic digits without warnings', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [
      cue('n1', '桌子上有三个苹果。', 0),
      cue('n2', '我有两本书。', 1)
    ],
    targetCues: [
      cue('n1', 'Trên bàn có 3 quả táo.', 0),
      cue('n2', 'Tôi có 2 quyển sách.', 1)
    ]
  })
  assert.equal(result.ok, true)
  assert.equal(result.findings.filter((f) => f.code === 'protected-token-mismatch').length, 0)
})

test('French number words and negation expressions preserve Chinese protected meaning', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [
      cue('cue-0-0', '海南最美的十四个地方', 0),
      cue('cue-1-1860', '去过一半此生无憾', 1)
    ],
    targetCues: [
      cue('cue-0-0', "Les quatorze plus beaux endroits d'Hainan", 0),
      cue('cue-1-1860', 'Si vous en avez visité la moitié, votre vie sera sans regret', 1)
    ]
  })
  assert.equal(result.ok, true)
  assert.equal(result.findings.filter((finding) => finding.code === 'protected-token-mismatch').length, 0)
})

test('Chinese sentence labels are treated as cue markers rather than protected quantities', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [
      cue('a', '第一句。', 0),
      cue('b', '第二句。', 1)
    ],
    targetCues: [
      cue('a', 'translated a', 0),
      cue('b', 'translated b', 1)
    ]
  })
  assert.equal(result.ok, true)
  assert.equal(result.findings.filter((f) => f.code === 'protected-token-mismatch').length, 0)
})

test('embedded cue markers in translated text are structural protocol errors', () => {
  const result = validateAutoShortContentQuality({
    sourceCues: [cue('cue-19-33420', '这是花。', 0)],
    targetCues: [cue('cue-19-33420', 'This is a flower [cue-20-34200] also called Manjusaka.', 0)]
  })
  assert.equal(result.ok, false)
  assert.ok(result.findings.some((finding) => finding.code === 'embedded-cue-marker' && finding.severity === 'error'))
})

for (const [source, target, warning] of [
  ['十二个苹果。', 'Có 12 quả táo.', false],
  ['十二个苹果。', 'Có 13 quả táo.', true],
  ['我们一起走吧。', 'Chúng ta cùng đi.', false],
  ['这是第三次。', 'Đây là lần thứ ba.', false],
  ['这是第三次。', 'Đây là lần thứ tư.', true],
  ['这是第3次。', 'This is the third time.', false]
] as const) {
  test(`contextual number evidence: ${source} -> ${target}`, () => {
    const result = assessContentQuality([cue('a', source, 0)], [cue('a', target, 0)])
    assert.equal(result.issues.some((issue) => issue.code === 'protected-token-suspect'), warning)
  })
}
