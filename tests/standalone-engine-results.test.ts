import assert from 'node:assert/strict'
import test from 'node:test'
import { appendDouyinOutputChunk, MAX_DOUYIN_OUTPUT_BUFFER_CHARS, summarizeDouyinCompletion } from '../src/main/douyin'

test('Douyin stdout chunks are retained separately from stderr diagnostics', () => {
  let buffers = { stdout: '', stderr: '' }
  buffers = appendDouyinOutputChunk(buffers, 'Total │ 3\nSuccess │ 1\n', false)
  buffers = appendDouyinOutputChunk(buffers, 'warning\n', true)
  assert.equal(buffers.stdout, 'Total │ 3\nSuccess │ 1\n')
  assert.equal(buffers.stderr, 'warning\n')
})

test('Douyin completion reports partial and empty exit-zero runs as unsuccessful', () => {
  assert.deepEqual(
    summarizeDouyinCompletion(0, { total: 3, success: 1, failed: 1, skipped: 1 }),
    { ok: false, total: 3, error: 'Có 1/3 mục tải thất bại.' }
  )
  assert.equal(summarizeDouyinCompletion(0, { total: 0, success: 0, failed: 0, skipped: 0 }).ok, false)
  assert.equal(summarizeDouyinCompletion(0, { total: 2, success: 2, failed: 0, skipped: 0 }).ok, true)
})

test('Douyin output buffering keeps an incomplete diagnostic bounded', () => {
  const buffers = appendDouyinOutputChunk({ stdout: '', stderr: '' }, 'x'.repeat(MAX_DOUYIN_OUTPUT_BUFFER_CHARS + 100), true)
  assert.equal(buffers.stdout, '')
  assert.equal(buffers.stderr.length, MAX_DOUYIN_OUTPUT_BUFFER_CHARS)
  assert.equal(buffers.stderr.endsWith('x'.repeat(100)), true)
})
