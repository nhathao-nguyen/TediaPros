import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTO_SHORT_TRIM_PCM_CACHE_POLICY_VERSION,
  buildAutoShortTrimPcmCacheKey
} from '../src/main/autoshort'

const wavHash = 'a'.repeat(64)

test('trim PCM cache key includes source bytes, trim policy, FFmpeg and PCM format', () => {
  const base = buildAutoShortTrimPcmCacheKey({
    rawWavSha256: wavHash,
    ffmpegRevision: 'ffmpeg-7.0'
  })
  assert.equal(
    base,
    buildAutoShortTrimPcmCacheKey({
      rawWavSha256: wavHash.toUpperCase(),
      ffmpegRevision: 'ffmpeg-7.0',
      trimPolicyVersion: AUTO_SHORT_TRIM_PCM_CACHE_POLICY_VERSION,
      sampleRate: 44_100,
      channels: 2,
      sampleFormat: 's16'
    })
  )
  assert.notEqual(base, buildAutoShortTrimPcmCacheKey({ rawWavSha256: 'b'.repeat(64), ffmpegRevision: 'ffmpeg-7.0' }))
  assert.notEqual(base, buildAutoShortTrimPcmCacheKey({ rawWavSha256: wavHash, ffmpegRevision: 'ffmpeg-7.1' }))
  assert.notEqual(base, buildAutoShortTrimPcmCacheKey({ rawWavSha256: wavHash, ffmpegRevision: 'ffmpeg-7.0', trimPolicyVersion: 'changed-thresholds-v2' }))
  assert.notEqual(base, buildAutoShortTrimPcmCacheKey({ rawWavSha256: wavHash, ffmpegRevision: 'ffmpeg-7.0', sampleRate: 48_000 }))
})

test('trim PCM cache key rejects malformed source identity and audio format', () => {
  assert.throws(
    () => buildAutoShortTrimPcmCacheKey({ rawWavSha256: 'short', ffmpegRevision: 'ffmpeg-7.0' }),
    /SHA-256|hợp lệ/iu
  )
  assert.throws(
    () => buildAutoShortTrimPcmCacheKey({ rawWavSha256: wavHash, ffmpegRevision: ' ' }),
    /revision FFmpeg/iu
  )
  assert.throws(
    () => buildAutoShortTrimPcmCacheKey({ rawWavSha256: wavHash, ffmpegRevision: 'ffmpeg-7.0', channels: 0 }),
    /format audio/iu
  )
})
