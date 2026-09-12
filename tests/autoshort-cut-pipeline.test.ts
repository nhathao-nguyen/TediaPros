import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAutoShortItemProcessor, type AutoShortItemCoordinatorDeps } from '../src/main/autoShortItemCoordinator'
import type { AutoShortConfig } from '../src/shared/types'
import type { Meta } from '../src/main/burn'

const ffmpegPath = process.env.TEDIAPROS_TEST_FFMPEG

test('coordinator validates and sends only prepared cut media to ASR and render', { skip: ffmpegPath ? false : 'TEDIAPROS_TEST_FFMPEG is not set' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-cut-pipeline-'))
  const sourcePath = join(root, 'source.mkv')
  const ffprobePath = join(dirname(ffmpegPath!), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  const outputDir = join(root, 'out')
  await mkdir(outputDir)
  try {
    const generated = spawnSync(ffmpegPath!, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=6',
      '-f', 'lavfi', '-i', 'sine=frequency=800:sample_rate=48000:duration=6',
      '-map', '0:v', '-map', '1:a', '-c:v', 'ffv1', '-c:a', 'pcm_s16le', sourcePath
    ], { windowsHide: true, encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    let asrFrameCount = 0
    let renderFrameCount = 0
    const probeMeta = async (path: string): Promise<Meta> => ({
      w: 64, h: 64, giay: path.includes('source-after-cut') ? 4 : 6, hasAudio: true,
      videoDurationSeconds: path.includes('source-after-cut') ? 4 : 6,
      containerDurationSeconds: path.includes('source-after-cut') ? 4 : 6,
      frameRate: 25
    })
    const deps: AutoShortItemCoordinatorDeps = {
      resolveFfmpeg: async () => ffmpegPath!,
      resolveFfprobe: async () => ffprobePath,
      probeMedia: probeMeta,
      transcribeAudio: (async (_jobId: string, request: { input: string; outputDir: string }) => {
        assert.match(request.input, /source-after-cut\.mkv$/u)
        const probe = spawnSync(ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', request.input], { windowsHide: true, encoding: 'utf8' })
        assert.equal(probe.status, 0, probe.stderr)
        asrFrameCount = Number(probe.stdout.trim())
        const srt = join(request.outputDir, 'source.srt')
        await writeFile(srt, '1\n00:00:00,000 --> 00:00:01,000\nRetained speech\n', 'utf8')
        return { ok: true, outputs: [srt], language: 'en' }
      }) as AutoShortItemCoordinatorDeps['transcribeAudio'],
      runVisualOcr: (async () => { throw new Error('visual OCR should not run') }) as AutoShortItemCoordinatorDeps['runVisualOcr'],
      writeTimedMask: (async () => { throw new Error('mask should not run') }) as AutoShortItemCoordinatorDeps['writeTimedMask'],
      burn: (async (request: { video: string }) => {
        assert.match(request.video, /source-after-cut\.mkv$/u)
        const probe = spawnSync(ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', request.video], { windowsHide: true, encoding: 'utf8' })
        assert.equal(probe.status, 0, probe.stderr)
        renderFrameCount = Number(probe.stdout.trim())
        const output = join(outputDir, 'rendered.mp4')
        await writeFile(output, 'rendered')
        return { ok: true, output }
      }) as AutoShortItemCoordinatorDeps['burn']
    }
    const config: AutoShortConfig = {
      subtitleMethod: 'whisper', whisperModel: 'base', whisperDevice: 'cpu',
      blurRegions: [], lamMo: false, blurMode: 'manual', translateTarget: 'none', translateProvider: 'local',
      ttsEnabled: false, voiceOverMode: false, audioMode: 'replace', originalAudioVolume: 20, outputDir
    }
    const item = {
      id: 'pipeline-item', filePath: sourcePath,
      temporalEdit: { schemaVersion: 1 as const, revision: 1, mode: 'ripple-delete' as const, removedRanges: [{ id: 'middle', startUs: 2_000_000, endUs: 4_000_000 }] }
    }
    const result = await createAutoShortItemProcessor(deps)({
      jobId: 'pipeline-job', request: { config, items: [item] }, item, index: 0, total: 1,
      signal: new AbortController().signal, emit: () => {},
      checkpointDir: join(root, 'checkpoint'), workDir: join(root, 'work'), artifactDir: join(root, 'audit'),
      itemOutputDir: outputDir, separationProviderState: { mode: 'auto' }
    })
    assert.equal(result.status, 'done', result.error)
    assert.equal(asrFrameCount, 100)
    assert.equal(renderFrameCount, 100)
    const manifest = JSON.parse(await readFile(join(root, 'audit', 'manifest.json'), 'utf8')) as { files: string[] }
    assert.ok(manifest.files.includes('cut-validation.json'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
