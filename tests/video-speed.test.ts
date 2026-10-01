import assert from 'node:assert/strict'
import test from 'node:test'
import { join } from 'node:path'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  buildAtempoFilter,
  buildVideoSpeedFilter,
  generateSpeedOutputName
} from '../src/main/videoSpeed'

test('buildAtempoFilter formats standard and chained speeds correctly', () => {
  assert.equal(buildAtempoFilter(1.1), 'atempo=1.1')
  assert.equal(buildAtempoFilter(1.05), 'atempo=1.05')
  assert.equal(buildAtempoFilter(1.25), 'atempo=1.25')
  assert.equal(buildAtempoFilter(1.5), 'atempo=1.5')
  assert.equal(buildAtempoFilter(2.0), 'atempo=2')

  // Speeds > 2.0 chain atempo=2.0
  assert.equal(buildAtempoFilter(2.2), 'atempo=2.0,atempo=1.1')
  assert.equal(buildAtempoFilter(4.0), 'atempo=2.0,atempo=2')

  // Speeds < 0.5 chain atempo=0.5
  assert.equal(buildAtempoFilter(0.4), 'atempo=0.5,atempo=0.8')

  assert.throws(() => buildAtempoFilter(0))
  assert.throws(() => buildAtempoFilter(-1))
})

test('buildVideoSpeedFilter creates correct filter graph without audio', () => {
  const result = buildVideoSpeedFilter({ speed: 1.1, hasAudio: false })
  assert.deepEqual(result.filterArgs, ['-filter_complex', '[0:v]setpts=(1/1.100000)*PTS[v]'])
  assert.deepEqual(result.mapArgs, ['-map', '[v]', '-an'])
})

test('buildVideoSpeedFilter creates correct filter graph with pitch preservation', () => {
  const result = buildVideoSpeedFilter({ speed: 1.15, preservePitch: true, hasAudio: true })
  assert.deepEqual(result.filterArgs, [
    '-filter_complex',
    '[0:v]setpts=(1/1.150000)*PTS[v];[0:a]atempo=1.15[a]'
  ])
  assert.deepEqual(result.mapArgs, ['-map', '[v]', '-map', '[a]'])
})

test('buildVideoSpeedFilter creates correct filter graph without pitch preservation', () => {
  const result = buildVideoSpeedFilter({ speed: 1.1, preservePitch: false, hasAudio: true })
  assert.deepEqual(result.filterArgs, [
    '-filter_complex',
    '[0:v]setpts=(1/1.100000)*PTS[v];[0:a]asetrate=44100*1.100000,aresample=44100[a]'
  ])
  assert.deepEqual(result.mapArgs, ['-map', '[v]', '-map', '[a]'])
})

test('generateSpeedOutputName handles non-existent and collision names', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'speed-test-'))
  try {
    const name1 = await generateSpeedOutputName('my_video.mp4', 1.1, tempDir)
    assert.equal(name1, 'my_video_1.1x.mp4')

    // Create candidate 1
    await writeFile(join(tempDir, 'my_video_1.1x.mp4'), 'dummy')
    const name2 = await generateSpeedOutputName('my_video.mp4', 1.1, tempDir)
    assert.equal(name2, 'my_video_1.1x (1).mp4')

    // Create candidate 2
    await writeFile(join(tempDir, 'my_video_1.1x (1).mp4'), 'dummy')
    const name3 = await generateSpeedOutputName('my_video.mp4', 1.1, tempDir)
    assert.equal(name3, 'my_video_1.1x (2).mp4')
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})
