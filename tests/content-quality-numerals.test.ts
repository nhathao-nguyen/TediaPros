import assert from 'node:assert/strict'
import test from 'node:test'
import { extractContextualNumberTokens, parseChineseInteger } from '../src/main/contentQuality/numerals'

for (const [text, value] of [
  ['零', 0], ['两', 2], ['十', 10], ['十二', 12], ['二十', 20],
  ['一百零二', 102], ['一千零二十', 1020], ['一万零三', 10003],
  ['二〇二四', 2024], ['兩萬', 20000]
] as const) {
  test(`Chinese integer ${text}`, () => assert.equal(parseChineseInteger(text), value))
}

for (const invalid of ['十十', '一百百', '一亿', '一半', '十二点五', '']) {
  test(`no partial integer parse for ${invalid}`, () => assert.equal(parseChineseInteger(invalid), null))
}

for (const text of ['我们一起走吧。', '一定要来。', '一直向前。', '万一失败。', '千万不要走。']) {
  test(`lexical numeral characters: ${text}`, () => {
    assert.deepEqual(extractContextualNumberTokens(text), [])
  })
}

test('quantity and ordinal are extracted as separate semantic classes', () => {
  assert.deepEqual(extractContextualNumberTokens('十二个苹果').map((item) => item.token), ['num:12'])
  assert.deepEqual(extractContextualNumberTokens('这是第三次。').map((item) => item.token), ['ordinal:3'])
  assert.deepEqual(extractContextualNumberTokens('Đây là lần thứ tư.').map((item) => item.token), ['ordinal:4'])
})
