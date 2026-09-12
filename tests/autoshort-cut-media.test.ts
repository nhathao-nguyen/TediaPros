import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildAutoShortCutFilter, buildAutoShortCutMediaArgs, cutAutoShortSourceByFramePlan } from '../src/main/autoShortCutMedia'
import { probeAutoShortFrameIndex } from '../src/main/autoShortFrameIndex'
import { compileFrameCutPlan } from '../src/shared/autoShortCutPlan'
import { compileAutoShortCutPlan } from '../src/shared/autoShortTemporalEdit'

test('cut filter preserves source audio epoch inside each exact video segment', () => {
  const plan = compileAutoShortCutPlan({ schemaVersion: 1, revision: 1, mode: 'ripple-delete', removedRanges: [
    { id: 'middle', startUs: 2_000_000, endUs: 4_000_000 }
  ] }, 6_000_000)
  const graph = buildAutoShortCutFilter(plan, true)
  assert.match(graph, /trim=start=0\.000000:end=2\.000000,setpts=PTS-STARTPTS/)
  assert.match(graph, /atrim=start=4\.000000:end=6\.000000,asetpts=PTS-4\.000000\/TB,aresample=async=1:first_pts=0,apad,atrim=duration=2\.000000/)
  assert.match(graph, /concat=n=2:v=1:a=0\[vout\]/)
  assert.match(graph, /concat=n=2:v=0:a=1\[aout\]/)
})

test('uses a filter graph file and does not force 8-bit 4:4:4 video', () => {
  const args = buildAutoShortCutMediaArgs({ sourcePath: 'C:\\source.mp4', outputPath: 'C:\\output.mkv', filterPath: 'C:\\cut.ffgraph', hasAudio: true })
  assert.deepEqual(args.slice(0, 8), ['-y', '-hide_banner', '-nostats', '-loglevel', 'error', '-i', 'C:\\source.mp4', '-/filter_complex'])
  assert.ok(args.includes('C:\\cut.ffgraph'))
  assert.equal(args.includes('-filter_complex'), false)
  assert.equal(args.includes('-pix_fmt'), false)
  assert.ok(args.includes('ffv1'))
})

test('cut filter omits audio graph for silent source', () => {
  const plan = compileAutoShortCutPlan({ schemaVersion: 1, revision: 1, mode: 'ripple-delete', removedRanges: [
    { id: 'head', startUs: 0, endUs: 1_000_000 }
  ] }, 3_000_000)
  const graph = buildAutoShortCutFilter(plan, false)
  assert.doesNotMatch(graph, /atrim|aout/)
})

const ffmpegPath = process.env.TEDIAPROS_TEST_FFMPEG

test('real cut keeps 10-bit frames and a 0.5 second source audio lead-in', { skip: ffmpegPath ? false : 'TEDIAPROS_TEST_FFMPEG is not set' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-cut-media-'))
  const source = join(root, 'source.mkv')
  const ffprobe = join(dirname(ffmpegPath!), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  try {
    const generated = spawnSync(ffmpegPath!, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=25:duration=6,format=yuv420p10le',
      '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=5.5',
      '-map', '0:v', '-map', '1:a', '-c:v', 'ffv1', '-level', '3', '-c:a', 'pcm_s16le', source
    ], { windowsHide: true, encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    const index = await probeAutoShortFrameIndex({
      ffprobePath: ffprobe, sourcePath: source, itemId: 'fixture', signal: new AbortController().signal
    })
    assert.equal(index.frameCount, 150)
    assert.deepEqual(index.audio?.startRelativeToVideo, { num: '1', den: '2' })
    const workDir = join(root, 'work')
    await mkdir(workDir)
    const temporalEdit = {
      ...index.identity, schemaVersion: 2 as const, editId: 'fixture-edit', revision: 1, mode: 'ripple-delete' as const,
      policyVersion: 'cut-v2' as const,
      removedRanges: [{ id: 'middle', start: index.validatedBoundaries[50], end: index.validatedBoundaries[100] }],
      reviewResolutions: []
    }
    const plan = compileFrameCutPlan({
      edit: temporalEdit, index,
      identity: { sourceDigest: index.identity.sourceDigest, editDigest: 'b'.repeat(64), executorRevision: 'cut-executor-v2', runtimeDigest: 'c'.repeat(64), mediaPolicyDigest: 'd'.repeat(64) }
    })
    const cut = await cutAutoShortSourceByFramePlan({ ffmpeg: ffmpegPath!, sourcePath: source, workDir, plan, hasAudio: true, signal: new AbortController().signal })
    const probed = spawnSync(ffprobe, [
      '-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,pix_fmt,nb_read_frames,duration,sample_rate,channels', '-of', 'json', cut.path
    ], { windowsHide: true, encoding: 'utf8' })
    assert.equal(probed.status, 0, probed.stderr)
    const streams = (JSON.parse(probed.stdout) as { streams: Array<Record<string, string | number>> }).streams
    const video = streams.find((stream) => stream.codec_type === 'video')!
    const audio = streams.find((stream) => stream.codec_type === 'audio')!
    assert.equal(video.pix_fmt, 'yuv420p10le')
    assert.equal(Number(video.nb_read_frames), 100)
    assert.equal(Number(audio.sample_rate), 48_000)
    const raw = join(root, 'audio.raw')
    const decoded = spawnSync(ffmpegPath!, ['-y', '-hide_banner', '-loglevel', 'error', '-i', cut.path, '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 's16le', raw], { windowsHide: true, encoding: 'utf8' })
    assert.equal(decoded.status, 0, decoded.stderr)
    const samples = await readFile(raw)
    assert.equal(samples.length, 4 * 48_000 * 2)
    let firstSignal = -1
    for (let index = 0; index < samples.length / 2; index += 1) {
      if (Math.abs(samples.readInt16LE(index * 2)) > 16) { firstSignal = index; break }
    }
    assert.ok(firstSignal >= 23_900 && firstSignal <= 24_100, `first signal sample ${firstSignal}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
