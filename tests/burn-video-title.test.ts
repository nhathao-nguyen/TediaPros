import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { burnAutoShort, burnSubtitle, cancelBurn, completeBurnVideoTitle, runBurnSubtitleLower } from '../src/main/burn'
import { planBurnInputs } from '../src/main/burnInputPlanner'
import type { BurnProgress, BurnReq, BurnResult, VideoSeoMetadata } from '../src/shared/types'

const seo = (title: string): VideoSeoMetadata => ({
  title,
  description: 'Video mô tả chính xác nội dung trong phụ đề.',
  tags: ['nội dung video', 'phụ đề'],
  hashtags: ['#noidungvideo', '#phude']
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tedia-burn-title-'))
  const video = join(root, 'export.mp4')
  const srt = join(root, 'translated.srt')
  await writeFile(video, Buffer.from('completed video sentinel'))
  const content = [
    '1', '00:00:00,000 --> 00:00:01,500', 'Cách cây trao đổi chất.', '',
    '2', '00:00:01,500 --> 00:00:05,000', 'Rễ cây hút nước từ đất.', '',
    '3', '00:00:06,000 --> 00:00:09,000', 'OUTSIDE_EXPORT_SENTINEL', ''
  ].join('\r\n')
  // Exercise the same BOM-aware SRT reader used by render, including OCR exports.
  await writeFile(srt, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(content, 'utf16le')]))
  const req: BurnReq = {
    video, srt, outputDir: root, outputName: 'export.mp4', mode: 'soft',
    videoTitle: { provider: 'gemini', language: 'vi' }
  }
  const result: BurnResult = { ok: true, output: video }
  return { root, video, srt, req, result, cleanup: () => rm(root, { recursive: true, force: true }) }
}

const probe = async () => ({ w: 320, h: 180, giay: 9, hasAudio: true, videoDurationSeconds: 2 })

test('burn title uses the exported SRT language and video stream duration, then writes UTF-8 beside the video', async () => {
  const f = await fixture()
  try {
    const progress: BurnProgress[] = []
    const signal = new AbortController().signal
    const title = 'Rễ cây hút nước như thế nào?'
    const completed = await completeBurnVideoTitle(f.result, f.req, (p) => progress.push(p), signal, {
      probe: async (path) => { assert.equal(path, f.video); return probe() },
      generate: async (cues, config, receivedSignal) => {
        assert.equal(config.language, 'vi')
        assert.equal(receivedSignal, signal)
        assert.deepEqual(cues.map((cue) => [cue.start, cue.end, cue.text]), [
          [0, 1.5, 'Cách cây trao đổi chất.'],
          [1.5, 2, 'Rễ cây hút nước từ đất.']
        ])
        return seo(title)
      }
    })
    assert.equal(completed.ok, true)
    assert.equal(completed.output, f.video)
    assert.equal(completed.title, title)
    assert.deepEqual(completed.seoMetadata, seo(title))
    // Windows may expose the same temp directory through an 8.3 alias on
    // the test side and its canonical long path from the title writer.
    assert.equal(await realpath(completed.titlePath!), await realpath(join(f.root, 'tieude.txt')))
    assert.equal(await readFile(completed.titlePath!, 'utf8'),
      `${title}\n\nDescription:\nVideo mô tả chính xác nội dung trong phụ đề.\n\nTags:\nnội dung video, phụ đề\n\nHashtags:\n#noidungvideo #phude\n`)
    assert.equal(await readFile(f.video, 'utf8'), 'completed video sentinel')
    assert.match(progress[0].message!, /AI.*tiêu đề/u)
  } finally { await f.cleanup() }
})

test('burn title does no work after failed render or when the option is absent', async () => {
  const f = await fixture()
  try {
    const fail = async (): Promise<never> => { throw new Error('Must not be called') }
    const io = { probe: fail, generate: fail, write: fail }
    const signal = new AbortController().signal
    const failed = { ok: false, error: 'Render failed' }
    assert.equal(await completeBurnVideoTitle(failed, f.req, () => {}, signal, io), failed)
    assert.equal(await completeBurnVideoTitle(f.result, { ...f.req, videoTitle: undefined }, () => {}, signal, io), f.result)
  } finally { await f.cleanup() }
})

test('cancelling title generation aborts the provider and preserves the completed video', async () => {
  const f = await fixture()
  try {
    const controller = new AbortController()
    let notifyStarted!: () => void
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    let writeCount = 0
    const completion = completeBurnVideoTitle(f.result, f.req, () => {}, controller.signal, {
      probe,
      generate: async (_cues, _config, signal) => new Promise<VideoSeoMetadata>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new Error('provider stopped')), { once: true })
        notifyStarted()
      }),
      write: async () => { writeCount++; return '' }
    })
    await started
    controller.abort()
    const completed = await completion
    assert.equal(completed.ok, true)
    assert.equal(completed.output, f.video)
    assert.match(completed.titleError!, /Đã dừng tạo tiêu đề/u)
    assert.equal(completed.titlePath, undefined)
    assert.equal(writeCount, 0)
    assert.equal(await readFile(f.video, 'utf8'), 'completed video sentinel')
  } finally { await f.cleanup() }
})

test('cancellation after provider completion still prevents a title write', async () => {
  const f = await fixture()
  try {
    const controller = new AbortController()
    let writeCount = 0
    const completed = await completeBurnVideoTitle(f.result, f.req, () => {}, controller.signal, {
      probe,
      generate: async () => { controller.abort(); return seo('Tiêu đề đã tạo') },
      write: async () => { writeCount++; return '' }
    })
    assert.equal(completed.ok, true)
    assert.match(completed.titleError!, /Đã dừng/u)
    assert.equal(writeCount, 0)
  } finally { await f.cleanup() }
})

test('provider failure and empty title preserve video without exposing provider details or writing a placeholder', async () => {
  const f = await fixture()
  try {
    let writeCount = 0
    for (const generate of [
      async () => { throw new Error('secret-key-sentinel https://private-server.example/api C:\\private\\token.json') },
      async () => ({ title: '', description: '', tags: [], hashtags: [] }) as VideoSeoMetadata
    ]) {
      const completed = await completeBurnVideoTitle(f.result, f.req, () => {}, new AbortController().signal, {
        probe, generate, write: async () => { writeCount++; return '' }
      })
      assert.equal(completed.ok, true)
      assert.equal(completed.output, f.video)
      assert.match(completed.titleError!, /AI chưa tạo được tiêu đề/u)
      assert.doesNotMatch(completed.titleError!, /secret-key|private-server|token\.json/u)
      assert.equal(completed.title, undefined)
      assert.equal(completed.titlePath, undefined)
    }
    assert.equal(writeCount, 0)
  } finally { await f.cleanup() }
})

test('existing sidecar is preserved and reported as a title save failure after successful render', async () => {
  const f = await fixture()
  try {
    await writeFile(join(f.root, 'tieude.txt'), 'Existing user title')
    const completed = await completeBurnVideoTitle(f.result, f.req, () => {}, new AbortController().signal, {
      probe, generate: async () => seo('New generated title')
    })
    assert.equal(completed.ok, true)
    assert.equal(completed.output, f.video)
    assert.match(completed.titleError!, /không lưu được tieude\.txt/u)
    assert.equal(completed.titlePath, undefined)
    assert.equal(await readFile(join(f.root, 'tieude.txt'), 'utf8'), 'Existing user title')
  } finally { await f.cleanup() }
})

test('unknown output duration or SRT entirely outside the export never causes an AI call', async () => {
  const f = await fixture()
  try {
    let generateCount = 0
    const io = { generate: async () => { generateCount++; return seo('Wrong title') } }
    const noDuration = await completeBurnVideoTitle(f.result, f.req, () => {}, new AbortController().signal, {
      ...io, probe: async () => ({ w: 320, h: 180, giay: 0, hasAudio: false })
    })
    assert.equal(noDuration.ok, true)
    assert.match(noDuration.titleError!, /chưa xác định/u)
    const outside = await completeBurnVideoTitle(f.result, f.req, () => {}, new AbortController().signal, {
      ...io, probe,
      readSubtitle: () => '1\n00:00:04,000 --> 00:00:06,000\nContent after the export\n'
    })
    assert.equal(outside.ok, true)
    assert.match(outside.titleError!, /không có nội dung/u)
    assert.equal(generateCount, 0)
  } finally { await f.cleanup() }
})

test('burn rejects title generation without SRT and locks overlapping requests before async validation', async () => {
  const f = await fixture()
  try {
    const first = burnSubtitle({ ...f.req, srt: null }, () => {})
    const second = await burnSubtitle({ ...f.req, srt: null }, () => {})
    assert.equal(second.ok, false)
    assert.match(second.error!, /Một video khác/u)
    assert.match((await first).error!, /Cần chọn file SRT/u)
    // The validation failure releases the lock for the next request.
    const next = await burnSubtitle({ ...f.req, srt: null }, () => {})
    assert.match(next.error!, /Cần chọn file SRT/u)
  } finally { await f.cleanup() }
})

const embeddedFfmpeg = 'C:\\Users\\PC\\AppData\\Roaming\\tedia-pros\\bin\\ffmpeg.exe'
const embeddedFfprobe = 'C:\\Users\\PC\\AppData\\Roaming\\tedia-pros\\bin\\ffprobe.exe'

test('burn reports a useful error when FFmpeg cannot be started', {
  skip: !existsSync(embeddedFfmpeg) || !existsSync(embeddedFfprobe),
  timeout: 30_000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'tedia-burn-spawn-error-'))
  const source = join(root, 'source.mp4')
  try {
    const generated = spawnSync(embeddedFfmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=s=160x90:d=0.25:r=10',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source
    ], { windowsHide: true, encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)

    const missingFfmpeg = join(root, 'missing-ffmpeg.exe')
    const result = await runBurnSubtitleLower({
      video: source,
      srt: null,
      outputDir: root,
      outputName: 'output.mp4',
      mode: 'burn',
      portraitBlur: true
    }, {
      outputPath: join(root, 'output.mp4'),
      plan: planBurnInputs({ sourceVideo: source }),
      ffmpegPath: missingFfmpeg,
      ffprobePath: embeddedFfprobe,
      cwd: root
    }, () => {})

    assert.equal(result.ok, false)
    assert.match(result.error || '', /không khởi chạy được FFmpeg/i)
    assert.match(result.error || '', /thiếu tệp hoặc công cụ/i)
    assert.doesNotMatch(result.error || '', new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('real FFmpeg render writes the AI sidecar for Auto Short and direct burn, then remains cancellable', {
  skip: !existsSync(embeddedFfmpeg) || !existsSync(embeddedFfprobe),
  timeout: 60_000
}, async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'tedia video title integration '))
  const previousUserData = process.env.TEDIAPROS_TEST_USER_DATA
  const userData = join(root, 'user-data')
  const runtime = join(userData, 'bin', 'ffmpeg')
  const ffmpeg = join(runtime, 'ffmpeg.exe')
  const source = join(root, 'source.mp4')
  const srt = join(root, 'translated.srt')
  const capturedBodies: string[] = []
  let notifySecondCall!: () => void
  const secondCall = new Promise<void>((resolve) => { notifySecondCall = resolve })
  const title = 'How plant roots absorb water'
  const metadata = seo(title)
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    capturedBodies.push(Buffer.concat(chunks).toString('utf8'))
    if (capturedBodies.length === 3) {
      notifySecondCall()
      return // The third title request stays pending until cancelBurn aborts it.
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(metadata) } }] }))
  })
  try {
    process.env.TEDIAPROS_TEST_USER_DATA = userData
    await mkdir(runtime, { recursive: true })
    await Promise.all([
      copyFile(embeddedFfmpeg, ffmpeg),
      copyFile(embeddedFfprobe, join(runtime, 'ffprobe.exe'))
    ])
    const generated = spawnSync(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=s=320x180:d=2:r=24',
      // Reproduce sources that make libx264 select the incompatible 4:4:4
      // output when the render path does not constrain the pixel format.
      '-c:v', 'libx264', '-pix_fmt', 'yuv444p', source
    ], { windowsHide: true, encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    await writeFile(srt, [
      '1', '00:00:00,000 --> 00:00:01,000', 'Plants need water.', '',
      '2', '00:00:01,000 --> 00:00:03,000', 'ROOT_WATER_EXPORT_TAIL', '',
      '3', '00:00:04,000 --> 00:00:07,000', 'OUTSIDE_EXPORT_SENTINEL', ''
    ].join('\n'))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const req: BurnReq = {
      video: source, srt, outputDir: root, outputName: 'plant-export.mp4', mode: 'soft',
      videoTitle: { provider: 'local', language: 'en', serverUrl: `http://127.0.0.1:${address.port}` }
    }

    const autoOutputDir = join(root, 'auto-short-output')
    const autoWorkDir = join(root, 'auto-short-work')
    await mkdir(autoOutputDir, { recursive: true })
    await mkdir(autoWorkDir, { recursive: true })
    const autoResult = await burnAutoShort(
      { ...req, mode: 'burn' },
      {
        ffmpegPath: ffmpeg,
        ffprobePath: join(runtime, 'ffprobe.exe'),
        finalOutputPath: join(autoOutputDir, 'plant-autoshort.mp4'),
        itemWorkDir: autoWorkDir,
        expectedMedia: {
          durationSeconds: 2,
          frameRate: 24,
          requireAudio: false,
          durationToleranceFrames: 3
        },
        signal: new AbortController().signal
      },
      () => {}
    )
    assert.equal(autoResult.ok, true, autoResult.error)
    assert.equal(autoResult.titleError, undefined)
    assert.equal(autoResult.title, title)
    assert.deepEqual(autoResult.seoMetadata, metadata)
    assert.ok(autoResult.output)
    assert.equal(dirname(autoResult.output!), autoOutputDir)
    assert.equal(dirname(autoResult.output!), dirname(autoResult.titlePath!))
    assert.equal(await readFile(autoResult.titlePath!, 'utf8'),
      `${title}\n\nDescription:\n${metadata.description}\n\nTags:\n${metadata.tags.join(', ')}\n\nHashtags:\n${metadata.hashtags.join(' ')}\n`)
    const autoProbeResult = spawnSync(join(runtime, 'ffprobe.exe'), [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,profile,pix_fmt', '-of', 'json', autoResult.output!
    ], { windowsHide: true, encoding: 'utf8' })
    assert.equal(autoProbeResult.status, 0, autoProbeResult.stderr)
    const autoVideoStream = JSON.parse(autoProbeResult.stdout).streams[0]
    assert.equal(autoVideoStream.pix_fmt, 'yuv420p')
    assert.notEqual(autoVideoStream.profile, 'High 4:4:4 Predictive')
    assert.equal(capturedBodies.length, 1)

    const result = await burnSubtitle(req, () => {})
    assert.equal(result.ok, true, result.error)
    assert.equal(result.titleError, undefined)
    assert.equal(result.title, title)
    assert.deepEqual(result.seoMetadata, metadata)
    assert.ok(result.output)
    assert.notEqual(dirname(result.output!), root)
    assert.equal(dirname(result.output!), dirname(result.titlePath!))
    assert.equal(await readFile(result.titlePath!, 'utf8'),
      `${title}\n\nDescription:\n${metadata.description}\n\nTags:\n${metadata.tags.join(', ')}\n\nHashtags:\n${metadata.hashtags.join(' ')}\n`)
    const probeResult = spawnSync(join(runtime, 'ffprobe.exe'), [
      '-v', 'error', '-show_entries', 'stream=codec_type,duration', '-of', 'json', result.output!
    ], { windowsHide: true, encoding: 'utf8' })
    assert.equal(probeResult.status, 0, probeResult.stderr)
    const videoStream = JSON.parse(probeResult.stdout).streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')
    assert.ok(Math.abs(Number(videoStream.duration) - 2) < 0.1)
    assert.equal(capturedBodies.length, 2)
    assert.match(capturedBodies[0], /ROOT_WATER_EXPORT_TAIL/u)
    assert.doesNotMatch(capturedBodies[0], /OUTSIDE_EXPORT_SENTINEL/u)
    assert.match(capturedBodies[0], /English|Tiếng Anh|\ben\b/u)

    const pending = burnSubtitle(req, () => {})
    await secondCall
    const busy = await burnSubtitle({ ...req, videoTitle: undefined }, () => {})
    assert.match(busy.error!, /Một video khác/u)
    cancelBurn()
    const stopped = await pending
    assert.equal(stopped.ok, true)
    assert.ok(stopped.output && existsSync(stopped.output))
    assert.notEqual(stopped.output, result.output)
    assert.match(stopped.titleError!, /Đã dừng tạo tiêu đề/u)
    assert.equal(existsSync(join(dirname(stopped.output!), 'tieude.txt')), false)

    const afterCancel = await burnAutoShort(
      { ...req, mode: 'burn', videoTitle: undefined },
      {
        ffmpegPath: ffmpeg,
        ffprobePath: join(runtime, 'ffprobe.exe'),
        finalOutputPath: join(autoOutputDir, 'after-cancel.mp4'),
        itemWorkDir: autoWorkDir,
        expectedMedia: {
          durationSeconds: 2,
          frameRate: 24,
          requireAudio: false,
          durationToleranceFrames: 3
        },
        signal: new AbortController().signal
      },
      () => {}
    )
    assert.equal(afterCancel.ok, true, afterCancel.error)
    assert.ok(afterCancel.output && existsSync(afterCancel.output))

    assert.equal(await readFile(result.titlePath!, 'utf8'),
      `${title}\n\nDescription:\n${metadata.description}\n\nTags:\n${metadata.tags.join(', ')}\n\nHashtags:\n${metadata.hashtags.join(' ')}\n`)
    context.diagnostic('Actual 2-second FFmpeg video + loopback AI title verified; cancellation preserved second MP4 and existing first title.')
  } finally {
    cancelBurn()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousUserData == null) delete process.env.TEDIAPROS_TEST_USER_DATA
    else process.env.TEDIAPROS_TEST_USER_DATA = previousUserData
    await rm(root, { recursive: true, force: true })
  }
})
