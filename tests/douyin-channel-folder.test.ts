import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractAwemeId, syncChannelDownloadedIds } from '../src/main/douyin'

test('extractAwemeId extracts standard 15-20 digit Douyin video ids', () => {
  assert.equal(
    extractAwemeId('2026-03-14_Ai_AI_7617082085400269285.mp4'),
    '7617082085400269285'
  )
  assert.equal(
    extractAwemeId('7685367828435016177'),
    '7685367828435016177'
  )
  assert.equal(extractAwemeId('random_file_without_id.mp4'), null)
})

test('syncChannelDownloadedIds aggregates ids from existing video files, manifest, and text file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dy-test-sync-'))
  try {
    // 1. Tạo file video có sẵn trong folder
    await writeFile(join(dir, '2026-01-01_test_7617082085400269285.mp4'), 'dummy-video-content')

    // 2. Tạo subfolder nhiều cấp có file video (level1/level2/level3/level4/level5/level6)
    const deepSub = join(dir, 'sub1', 'sub2', 'nested', 'level4', 'level5', 'level6')
    await mkdir(deepSub, { recursive: true })
    await writeFile(join(deepSub, '2026-01-02_deep_7685367828435016177.mp4'), 'deep-video-content')

    // 3. Tạo các file KHÔNG PHẢI VIDEO (ảnh bìa, avatar, file audio, json)
    // Những file này KHÔNG được tính vào danh sách video thực tế
    await writeFile(join(dir, '2026-01-03_cover_1111111111111111111_cover.jpg'), 'image-bytes')
    await writeFile(join(deepSub, '2026-01-04_music_2222222222222222222_music.mp3'), 'audio-bytes')
    await writeFile(join(dir, '2026-01-05_avatar_3333333333333333333_avatar.png'), 'png-bytes')

    // 4. Tạo download_manifest.jsonl
    await writeFile(
      join(dir, 'download_manifest.jsonl'),
      JSON.stringify({ aweme_id: '7542118158246645033', desc: 'test' }) + '\n'
    )

    // Chạy sync
    const ids = await syncChannelDownloadedIds(dir)

    assert.ok(ids.has('7617082085400269285'), 'Should contain id from root video file')
    assert.ok(ids.has('7685367828435016177'), 'Should contain id from deeply nested video file')
    assert.ok(ids.has('7542118158246645033'), 'Should contain id from manifest')

    // Kiểm tra các file non-video KHÔNG bị nhận diện là video
    assert.ok(!ids.has('1111111111111111111'), 'Must NOT contain id from image cover file')
    assert.ok(!ids.has('2222222222222222222'), 'Must NOT contain id from audio file')
    assert.ok(!ids.has('3333333333333333333'), 'Must NOT contain id from avatar image file')

    // Kiểm tra file downloaded_ids.txt được tạo trên đĩa
    const savedText = await readFile(join(dir, 'downloaded_ids.txt'), 'utf-8')
    assert.ok(savedText.includes('7617082085400269285'))
    assert.ok(savedText.includes('7685367828435016177'))
    assert.ok(savedText.includes('7542118158246645033'))
    assert.ok(!savedText.includes('1111111111111111111'))
    assert.ok(!savedText.includes('2222222222222222222'))
    assert.ok(!savedText.includes('3333333333333333333'))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})
