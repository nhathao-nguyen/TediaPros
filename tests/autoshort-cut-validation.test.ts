import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { cutAutoShortSourceByFramePlan } from '../src/main/autoShortCutMedia'
import { probeAutoShortFrameIndex } from '../src/main/autoShortFrameIndex'
import { validatePreparedCut } from '../src/main/autoShortCutValidation'
import { compileFrameCutPlan } from '../src/shared/autoShortCutPlan'

const ffmpegPath = process.env.TEDIAPROS_TEST_FFMPEG

test('validates decoded frame and PCM sample counts before accepting a prepared cut', { skip: ffmpegPath ? false : 'TEDIAPROS_TEST_FFMPEG is not set' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-cut-validation-'))
  const sourcePath = join(root, 'source.mkv')
  const ffprobePath = join(dirname(ffmpegPath!), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  const signal = new AbortController().signal
  try {
    const generated = spawnSync(ffmpegPath!, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=6,format=yuv420p10le',
      '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=5.5',
      '-map', '0:v', '-map', '1:a', '-c:v', 'ffv1', '-level', '3', '-c:a', 'pcm_s16le', sourcePath
    ], { windowsHide: true, encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    const index = await probeAutoShortFrameIndex({ ffprobePath, sourcePath, itemId: 'validation-fixture', signal })
    const edit = {
      ...index.identity, schemaVersion: 2 as const, editId: 'validation-edit', revision: 1,
      mode: 'ripple-delete' as const, policyVersion: 'cut-v2' as const,
      removedRanges: [{ id: 'middle', start: index.validatedBoundaries[50], end: index.validatedBoundaries[100] }],
      reviewResolutions: []
    }
    const plan = compileFrameCutPlan({
      edit, index,
      identity: { sourceDigest: index.identity.sourceDigest, editDigest: 'b'.repeat(64), executorRevision: 'cut-executor-v2', runtimeDigest: 'c'.repeat(64), mediaPolicyDigest: 'd'.repeat(64) }
    })
    const workDir = join(root, 'work')
    await mkdir(workDir)
    const cut = await cutAutoShortSourceByFramePlan({ ffmpeg: ffmpegPath!, sourcePath, workDir, plan, hasAudio: true, signal })
    const valid = await validatePreparedCut({ ffmpegPath: ffmpegPath!, ffprobePath, sourcePath, preparedPath: cut.path, plan, signal })
    assert.equal(valid.ok, true)
    if (valid.ok) {
      assert.equal(valid.manifest.videoFrameCount, 100)
      assert.equal(valid.manifest.audioSampleCount, '192000')
      assert.match(valid.artifactSha256, /^[a-f0-9]{64}$/)
    }

    const wrongPlan = { ...plan, keepSegments: plan.keepSegments.slice(0, 1) }
    const invalid = await validatePreparedCut({ ffmpegPath: ffmpegPath!, ffprobePath, sourcePath, preparedPath: cut.path, plan: wrongPlan, signal })
    assert.deepEqual({ ok: invalid.ok, code: invalid.ok ? '' : invalid.code }, { ok: false, code: 'CUT_TIMELINE_MISMATCH' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
