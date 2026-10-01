import test from 'node:test'
import assert from 'node:assert/strict'
import { appendOpeningHooks } from '../src/main/openingHooks'

test('appendOpeningHooks: no-op when neither flash nor zoom is enabled', () => {
  const lines = ['[0:v]null[out]']
  appendOpeningHooks(lines, 1080, 1920)
  assert.deepEqual(lines, ['[0:v]null[out]'])

  appendOpeningHooks(lines, 1080, 1920, { flash: false, zoom: false })
  assert.deepEqual(lines, ['[0:v]null[out]'])
})

test('appendOpeningHooks: appends zoom filter correctly', () => {
  const lines = ['[0:v]null[out]']
  appendOpeningHooks(lines, 1080, 1920, { zoom: true })
  assert.equal(lines.length, 2)
  assert.equal(lines[0], '[0:v]null[hook_input]')
  assert.match(lines[1], /^\[hook_input\]crop=w='trunc\(iw\/\(if\(lte\(t,1\.5\),1\.15-0\.15\*\(t\/1\.5\),1\.0\)\)\/2\)\*2'/)
  assert.match(lines[1], /scale=1080:1920\[out\]$/)
})

test('appendOpeningHooks: appends flash filter correctly', () => {
  const lines = ['[0:v]null[out]']
  appendOpeningHooks(lines, 1080, 1920, { flash: true })
  assert.equal(lines.length, 2)
  assert.equal(lines[0], '[0:v]null[hook_input]')
  assert.equal(lines[1], '[hook_input]fade=t=in:st=0:d=0.35:color=white[out]')
})

test('appendOpeningHooks: appends both zoom and flash in correct sequence', () => {
  const lines = ['[0:v]null[out]']
  appendOpeningHooks(lines, 1080, 1920, { zoom: true, flash: true })
  assert.equal(lines.length, 3)
  assert.equal(lines[0], '[0:v]null[hook_input]')
  assert.match(lines[1], /^\[hook_input\]crop=.*\[hook_zoomed\]$/)
  assert.equal(lines[2], '[hook_zoomed]fade=t=in:st=0:d=0.35:color=white[out]')
})

test('appendOpeningHooks: throws error if [out] is missing in last line', () => {
  const lines = ['[0:v]null[no_out_label]']
  assert.throws(() => {
    appendOpeningHooks(lines, 1080, 1920, { zoom: true })
  }, /Thiếu đầu ra video/)
})
