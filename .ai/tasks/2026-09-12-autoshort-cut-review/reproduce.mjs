import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(evidenceDir, '../../..')
const scratch = mkdtempSync(join(tmpdir(), 'tediapros-cut-review-'))
const require = createRequire(import.meta.url)
const ffmpeg = process.argv[2]
const ffprobe = process.argv[3]
if (!ffmpeg || !ffprobe) throw new Error('Pass managed FFmpeg and FFprobe executable paths.')
process.env.TEDIAPROS_TEST_USER_DATA = scratch
const report = { reviewedCommit: '0d7fa21', scope: 'Production cut functions with isolated Electron mock; synthetic media; component CSS harness, not live Electron UI' }
const run = (command, args) => {
  const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr)
  return result.stdout
}
const encoder = ['-c:v', 'ffv1', '-level', '3', '-c:a', 'pcm_s16le']
const edit = (ranges) => ({ schemaVersion: 1, revision: 1, mode: 'ripple-delete', removedRanges: ranges })
const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
try {
  const electronPlugin = {
    name: 'review-electron-mock', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'review' }))
      b.onLoad({ filter: /.*/, namespace: 'review' }, () => ({ contents: `module.exports = { app: { getPath: () => process.env.TEDIAPROS_TEST_USER_DATA, getAppPath: () => process.cwd(), isPackaged: false, getVersion: () => 'review' }, safeStorage: { isEncryptionAvailable: () => false }, BrowserWindow: class {} };`, loader: 'js' }))
    }
  }
  await build({ stdin: { contents: `export * from './src/main/autoShortCutMedia'; export * from './src/shared/autoShortTemporalEdit'; export * from './src/main/autoShortStageKeys';`, resolveDir: root, loader: 'ts' }, outfile: join(scratch, 'logic.cjs'), bundle: true, platform: 'node', format: 'cjs', plugins: [electronPlugin] })
  const { cutAutoShortSource, buildAutoShortCutFilter, compileAutoShortCutPlan, normalizeAutoShortTemporalEdit, canonicalJson } = require(join(scratch, 'logic.cjs'))
  const measure = (path) => {
    const meta = JSON.parse(run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=index,codec_type,pix_fmt,start_time', '-of', 'json', path]))
    const frames = JSON.parse(run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=pts_time,duration_time', '-of', 'json', path])).frames
    const pcm = join(scratch, 'measure.pcm')
    run(ffmpeg, ['-y', '-v', 'error', '-i', path, '-map', '0:a:0', '-ar', '48000', '-ac', '1', '-f', 's16le', pcm])
    return { ...meta, frameCount: frames.length, videoEnd: Number(frames.at(-1)?.pts_time) + Number(frames.at(-1)?.duration_time), audioSamples: statSync(pcm).size / 2, audioSeconds: statSync(pcm).size / 96000 }
  }
  const source = join(scratch, 'source.mkv')
  run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', ...encoder, source])
  const sourceHash = digest(source)
  const performCut = async (name, sourcePath, ranges, duration = 6) => {
    const workDir = join(scratch, name)
    mkdirSync(workDir)
    return cutAutoShortSource({ ffmpeg, sourcePath, workDir, edit: edit(ranges), sourceDurationSeconds: duration, hasAudio: true, signal: new AbortController().signal })
  }
  const basic = await performCut('basic', source, [{ id: 'middle', startUs: 2_000_000, endUs: 4_000_000 }])
  report.basicAligned = { plannedSeconds: basic.plan.editedDurationUs / 1e6, ...measure(basic.path) }
  const tiny = await performCut('subframe', source, [1, 2, 3, 4, 5].map((n) => ({ id: `tiny-${n}`, startUs: n * 1e6 + 1000, endUs: n * 1e6 + 19000 })))
  report.subframeCuts = { plannedSeconds: tiny.plan.editedDurationUs / 1e6, ...measure(tiny.path) }
  const again = await performCut('repeat', source, [{ id: 'middle', startUs: 2_000_000, endUs: 4_000_000 }])
  report.sameEditRepeat = { firstDigest: digest(basic.path), secondDigest: digest(again.path), ...measure(again.path) }
  const offsetSource = join(scratch, 'audio-offset.mkv')
  run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=6', '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5.5', ...encoder, offsetSource])
  report.offsetSource = measure(offsetSource)
  const offsetCut = await performCut('offset', offsetSource, [{ id: 'middle', startUs: 2_000_000, endUs: 4_000_000 }])
  report.offsetCut = { plannedSeconds: offsetCut.plan.editedDurationUs / 1e6, ...measure(offsetCut.path) }
  const highDepth = join(scratch, '10bit.mkv')
  run(ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', ...encoder, '-pix_fmt', 'yuv420p10le', highDepth])
  const converted = await performCut('10bit-cut', highDepth, [{ id: 'middle', startUs: 2_000_000, endUs: 4_000_000 }])
  report.bitDepth = { source: measure(highDepth).streams, cut: measure(converted.path).streams }
  const large = compileAutoShortCutPlan(edit(Array.from({ length: 1000 }, (_, i) => ({ id: `cut-${i}`, startUs: i * 5000 + 1000, endUs: i * 5000 + 2000 }))), 6_000_000)
  const graph = buildAutoShortCutFilter(large, true)
  const largeRun = spawnSync(ffmpeg, ['-v', 'error', '-i', source, '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8', timeout: 10000 })
  report.thousandRanges = { graphCharacters: graph.length, status: largeRun.status, errorCode: largeRun.error?.code, signal: largeRun.signal, stderr: largeRun.stderr?.slice(-300) }
  const ids = compileAutoShortCutPlan(edit([{ id: 'head', startUs: 0, endUs: 1_000_000 }, { id: 'middle', startUs: 2_000_000, endUs: 3_000_000 }]), 4_000_000)
  report.keepSegmentIds = ids.keepSegments.map(s => s.id)
  const first = normalizeAutoShortTemporalEdit(edit([{ id: 'first', startUs: 1_000_000, endUs: 3_000_000 }]))
  const merged = normalizeAutoShortTemporalEdit(edit([...first.removedRanges, { id: 'second', startUs: 2_000_000, endUs: 4_000_000 }]))
  report.restoreOverlapping = { first: first.removedRanges, afterSecond: merged.removedRanges, restoreDisplayedRangeLeaves: merged.removedRanges.filter(r => r.id !== merged.removedRanges[0].id) }
  const cfg = { outputDir: 'C:/output', ttsEnabled: false }
  const sha = value => createHash('sha256').update(canonicalJson(value)).digest('hex')
  report.legacyNoCutDigest = { old: sha(cfg), current: sha({ config: cfg, temporalEdit: undefined }) }
  report.sourcePreserved = sourceHash === digest(source)
  report.ffmpegVersion = run(ffmpeg, ['-version']).split('\n')[0].trim()
  writeFileSync(join(evidenceDir, 'media-results.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  const rel = relative(resolve(tmpdir()), scratch)
  if (rel.startsWith('..') || !rel.startsWith('tediapros-cut-review-')) throw new Error('Unexpected scratch cleanup target')
  rmSync(scratch, { recursive: true, force: true })
}
