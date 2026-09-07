// Offline acceptance of the real planner with FFmpeg and an existing WAV.
// No synthesis requests, input mutation, or automatic cleanup of user media.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

const input = process.argv[2] && resolve(process.argv[2])
const ffmpeg = process.argv[3] && resolve(process.argv[3])
if (!input || !ffmpeg) throw new Error('Usage: node scripts/dubbing-tempo-acceptance.mjs <existing.wav> <ffmpeg.exe>')
const ffprobe = join(dirname(ffmpeg), 'ffprobe.exe')
const root = resolve('release-artifacts')
await mkdir(root, { recursive: true })
const output = await mkdtemp(join(root, 'dubbing-tempo-'))
const bundle = join(output, 'synthesis.cjs')
await build({
  stdin: { contents: "export { synthesizeDubbingPlan } from './src/main/dubbing/synthesis'; export { buildDubbingPlan } from './src/main/dubbing/plan'; export { validateAutoShortTimelineSync } from './src/main/autoShortPolicy'", resolveDir: process.cwd(), loader: 'ts' },
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs'
})
const { synthesizeDubbingPlan, buildDubbingPlan, validateAutoShortTimelineSync } = createRequire(import.meta.url)(bundle)
function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.slice(-2000))
  return result.stdout
}
function duration(path) {
  return Number(JSON.parse(run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path])).format.duration)
}
const natural = duration(input)
assert.ok(Number.isFinite(natural) && natural > 0.5)
const results = []
for (const ratio of [1, 1.3, 2.5]) {
  const available = natural / ratio
  const plan = buildDubbingPlan({ videoDuration: available + 0.02, paceMode: 'fixed', cues: [
    { id: 'sample', start: 0, end: Math.min(available, natural), text: 'Offline fixture: original cached PCM is used without generating speech.' }
  ] })
  const calls = []
  const started = performance.now()
  const result = await synthesizeDubbingPlan({
    plan, language: 'en', model: 'offline-fixture', fixedTempo: 1,
    tts: { synthesize: async () => ({ path: input }) },
    audio: {
      // Isolate the tempo change: retain exactly the same input PCM for every case.
      trim: async (path) => ({ path, duration: natural }),
      applyTempo: async (path, hint, target) => {
        assert.equal(path, input, 'never process an already time-stretched output')
        let tempo = duration(path) / target
        const filters = []
        while (tempo > 2) { filters.push('atempo=2'); tempo /= 2 }
        while (tempo < 0.5) { filters.push('atempo=0.5'); tempo /= 0.5 }
        if (Math.abs(tempo - 1) > 0.01) filters.push(`atempo=${tempo.toFixed(5)}`)
        filters.push('asetpts=PTS-STARTPTS')
        const pathOut = join(output, `${ratio}-${hint}.wav`)
        run(ffmpeg, ['-v', 'error', '-y', '-i', path, '-vn', '-ac', '2', '-ar', '44100', '-af', filters.join(','), pathOut])
        calls.push({ target, duration: duration(pathOut) })
        return { path: pathOut, duration: duration(pathOut) }
      }
    }
  })
  const cue = result.plan.cues[0]
  assert.ok(cue.voiceEnd <= available + 0.005)
  assert.equal(cue.tempo, Number((natural / cue.actualDuration).toFixed(4)))
  const validation = validateAutoShortTimelineSync(result.plan.cues.map((item) => ({
    ...item, timingPolicy: 'source-anchored-v2', plannedStart: item.start,
    plannedEnd: item.voiceEnd, finalDuration: item.actualDuration
  })), plan.videoDuration)
  assert.equal(validation.ok, true, validation.violations.join('\n'))
  if (ratio > 1.5) assert.ok(validation.warnings?.length > 0)
  run(ffmpeg, ['-v', 'error', '-i', cue.audioPath, '-f', 'null', '-'])
  results.push({ ratio, naturalSeconds: natural, availableSeconds: available, actualSeconds: cue.actualDuration,
    effectiveTempo: cue.tempo, exportValidation: validation, tempoPasses: calls.length, elapsedMs: Math.round(performance.now() - started), calls })
}
await writeFile(join(output, 'result.json'), JSON.stringify({ scope: 'Offline planner + FFmpeg; no live TTS or perceptual quality score', results }, null, 2))
console.log(JSON.stringify({ output, results }, null, 2))
