import assert from 'node:assert/strict'
import test from 'node:test'
import { buildVideoTitleInputDigest } from '../src/main/videoTitle'
import { completeBurnVideoTitle } from '../src/main/burn'
import type { BurnReq, BurnResult, SubtitleCue, VideoTitleConfig } from '../src/shared/types'

const cues: SubtitleCue[] = [
  { id: 'c1', sourceIndex: 1, start: 0, end: 1, text: 'A faithful exported cue.' },
  { id: 'c2', sourceIndex: 2, start: 1, end: 2, text: 'The tail remains inside the render.' }
]

const config: VideoTitleConfig = { provider: 'local', language: 'en', serverUrl: 'http://127.0.0.1:48191' }
const result: BurnResult = { ok: true, output: 'C:\\output\\rendered.mp4' }
const req: BurnReq = {
  video: 'C:\\input\\source.mp4',
  srt: 'C:\\work\\timed.srt',
  outputDir: 'C:\\output',
  mode: 'burn',
  videoTitle: config
}

function deps(captured: { generated: number; writes: number }) {
  return {
    probe: async () => ({ w: 320, h: 180, giay: 2, hasAudio: false, videoDurationSeconds: 2 }),
    readSubtitle: () => 'ignored by the fixture reader',
    generate: async () => {
      captured.generated++
      return 'Regenerated title'
    },
    write: async () => {
      captured.writes++
      return 'C:\\output\\tieude.txt'
    }
  }
}

test('prepared title is committed after render without a second provider call', async () => {
  const captured = { generated: 0, writes: 0 }
  const prepared = {
    inputDigest: buildVideoTitleInputDigest(cues, config),
    text: 'Prepared title'
  }
  const completed = await completeBurnVideoTitle(
    result,
    req,
    () => {},
    new AbortController().signal,
    { ...deps(captured), readSubtitle: () => '1\n00:00:00,000 --> 00:00:01,000\nA faithful exported cue.\n\n2\n00:00:01,000 --> 00:00:02,000\nThe tail remains inside the render.\n' , prepared }
  )
  assert.equal(completed.title, 'Prepared title')
  assert.equal(captured.generated, 0)
  assert.equal(captured.writes, 1)
})

test('a post-probe duration/input change regenerates a title at most once', async () => {
  const captured = { generated: 0, writes: 0 }
  const prepared = {
    inputDigest: '0'.repeat(64),
    text: 'Stale prepared title'
  }
  const completed = await completeBurnVideoTitle(
    result,
    req,
    () => {},
    new AbortController().signal,
    { ...deps(captured), readSubtitle: () => '1\n00:00:00,000 --> 00:00:01,000\nA faithful exported cue.\n\n2\n00:00:01,000 --> 00:00:02,000\nThe tail remains inside the render.\n', prepared: Promise.resolve(prepared) }
  )
  assert.equal(completed.title, 'Regenerated title')
  assert.equal(captured.generated, 1)
  assert.equal(captured.writes, 1)
})

test('prepared title failure keeps a valid render and never writes a placeholder', async () => {
  const captured = { generated: 0, writes: 0 }
  const prepared = {
    inputDigest: buildVideoTitleInputDigest(cues, config),
    error: 'AI chưa tạo được tiêu đề.'
  }
  const completed = await completeBurnVideoTitle(
    result,
    req,
    () => {},
    new AbortController().signal,
    { ...deps(captured), readSubtitle: () => '1\n00:00:00,000 --> 00:00:01,000\nA faithful exported cue.\n\n2\n00:00:01,000 --> 00:00:02,000\nThe tail remains inside the render.\n', prepared }
  )
  assert.equal(completed.ok, true)
  assert.equal(completed.output, result.output)
  assert.equal(completed.title, undefined)
  assert.equal(completed.titlePath, undefined)
  assert.equal(completed.titleError, 'AI chưa tạo được tiêu đề.')
  assert.equal(captured.generated, 0)
  assert.equal(captured.writes, 0)
})
