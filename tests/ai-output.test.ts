import assert from 'node:assert/strict'
import test from 'node:test'
import { AiOutputParseError, assertExactKeys, containsProtocolPayload, parseAiJsonObject } from '../src/shared/aiOutput'

test('strict parser preserves escaped Unicode and rejects duplicate decoded keys', () => {
  assert.equal(parseAiJsonObject('{"title":"🙂 \\"quoted\\"\\nline"}').value.title, '🙂 "quoted"\nline')
  assert.throws(() => parseAiJsonObject('{"title":"first","\\u0074itle":"second"}'), (error) =>
    error instanceof AiOutputParseError && error.code === 'duplicate-key')
  assert.throws(() => parseAiJsonObject('{"title":"\\ud800"}'), /surrogate/iu)
  assert.equal(parseAiJsonObject('\t\r\n { "title" : "legal whitespace" } ').value.title, 'legal whitespace')
  assert.throws(() => parseAiJsonObject('{\u00a0"title":"not JSON whitespace"}'), /JSON/iu)
})

test('parser rejects screenshot-shaped malformed outer JSON instead of extracting its inner object', () => {
  const screenshotLike = '{\n  "title": "Why```json\n{\n"title":"Rescuing a shark",\n"description":"A rescue.",\n"tags":[],\n"hashtags":[]\n}\n```'
  assert.throws(() => parseAiJsonObject(screenshotLike, { allowFence: true, allowProseObject: true }), /mơ hồ|không hoàn chỉnh/iu)
})

test('compatibility parsing accepts one bounded wrapper but rejects ambiguity and broken tails', () => {
  assert.equal(parseAiJsonObject('Here:\n```json\n{"title":"Safe"}\n```\nDone', { allowProseObject: true }).value.title, 'Safe')
  assert.throws(() => parseAiJsonObject('{"title":"one"}\n{"title":"two"}', { allowProseObject: true }), /mơ hồ/iu)
  assert.throws(() => parseAiJsonObject('Here {bad} then {"title":"one"}', { allowProseObject: true }), /mơ hồ/iu)
})

test('limits and exact key validation fail closed', () => {
  assert.throws(() => parseAiJsonObject('{"a":[1,2,3]}', { limits: { maxMembers: 2 } }), /quá nhiều/iu)
  assert.throws(() => parseAiJsonObject('{"a":{"b":{"c":1}}}', { limits: { maxDepth: 2 } }), /độ sâu/iu)
  assert.throws(() => parseAiJsonObject('{"a":"xxxx"}', { limits: { maxBytes: 4 } }), /kích thước/iu)
  assert.throws(() => assertExactKeys(parseAiJsonObject('{"title":"x","ignored":1}').value, ['title']), /đúng các trường/iu)
})

test('contamination detector rejects full embedded contracts without blocking JSON tutorials', () => {
  assert.equal(containsProtocolPayload('Why```json\n{"title":"nested","description":"x"}\n```', ['title', 'description']), true)
  assert.equal(containsProtocolPayload('A tutorial about JSON {"title":"example"}', ['title', 'description']), false)
  assert.equal(containsProtocolPayload('Use braces such as {safe} in documentation', ['title', 'description']), false)
})
