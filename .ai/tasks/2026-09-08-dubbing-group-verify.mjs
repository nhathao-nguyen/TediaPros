import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'

const evidence = resolve(process.argv[2] || '.ai/tasks/2026-09-08-dubbing-group-evidence2')
const report = JSON.parse(await readFile(join(evidence, 'report.json'), 'utf8'))
const bundled = await build({ stdin: { contents: `
module.exports = { ...require('./src/main/dubbing/plan'), ...require('./src/main/dubbing/translation'), ...require('./src/main/dubbing/subtitles'), ...require('./src/shared/subtitles') }
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', write: false })
const module = { exports: {} }
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
const { buildDubbingPlan, applyDubbingTranslations, groupDubbingPlanForSpeech, validateDubbingPlan, buildDubbingSubtitle, buildDubbingSubtitleSegments, serializeSrt } = module.exports
const exec = promisify(execFile)
const output = join(evidence, 'verified')
await mkdir(output, { recursive: true })
const verified = []
for (const result of report.results) {
  assert.equal(result.ok, true, result.error)
  const original = JSON.parse(await readFile(join(evidence, result.checkpoint, 'dubbing-plan.json'), 'utf8'))
  const plan = structuredClone(original)
  const checkpoint = JSON.parse(await readFile(`C:/Users/PC/AppData/Roaming/tedia-pros/autoshort-checkpoints/${result.checkpoint}/checkpoint.json`, 'utf8'))
  const current = groupDubbingPlanForSpeech(applyDubbingTranslations(buildDubbingPlan({ videoDuration: plan.videoDuration, paceMode: plan.paceMode, cues: checkpoint.sourceCues }), checkpoint.translatedCues), 'en')
  const anchors = p => p.cues.map(c => [c.id, c.sourceCueIds, c.sourceText, c.sourceStart, c.sourceEnd, c.hardEnd, c.translatedText])
  assert.deepEqual(anchors(plan), anchors(current), 'current grouping must match live audio anchors')
  plan.sourceCues = current.sourceCues
  assert.equal(plan.sourceCues.length, result.sourceCues)
  assert.deepEqual(plan.cues.flatMap(c => c.sourceCueIds), plan.sourceCues.map(c => c.id))
  const tempos = []
  let minGap = Infinity
  let previousEnd = null
  for (const cue of plan.cues) {
    const { stdout } = await exec('C:/Users/PC/AppData/Roaming/tedia-pros/bin/ffprobe.exe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', cue.audioPath
    ], { windowsHide: true })
    const actual = Number(stdout.trim())
    assert.ok(actual > 0)
    assert.ok(Math.abs(actual - cue.actualDuration) < 0.001, `${cue.id}: duration differs`)
    const tempo = cue.naturalDuration / actual
    assert.ok(tempo <= 1.45, `${cue.id}: physical tempo ${tempo}`)
    tempos.push(tempo)
    assert.ok(cue.start + actual <= cue.hardEnd + 0.001, `${cue.id}: overflow`)
    if (previousEnd !== null) minGap = Math.min(minGap, cue.start - previousEnd)
    previousEnd = cue.start + actual
    // The live helper was bundled before the sourceIndex metadata correction.
    // Rebuild captions with current production functions in a separate artifact.
    const offset = plan.sourceCues.findIndex(s => s.id === cue.sourceCueIds[0])
    const sourceIndex = plan.sourceCues[offset].sourceIndex ?? offset
    const input = { cueId: cue.id, sourceIndex, start: cue.start, end: cue.voiceEnd, finalSpokenText: cue.finalSpokenText }
    cue.subtitles = cue.sourceCueIds.length > 1 ? buildDubbingSubtitleSegments(input) : [buildDubbingSubtitle(input)]
    assert.ok(cue.subtitles.every(c => c.sourceIndex === sourceIndex))
  }
  assert.ok(minGap >= 0.5 - 0.005, `protected gap ${minGap}`)
  assert.ok(validateDubbingPlan(plan).ok)
  const captions = plan.cues.flatMap(c => c.subtitles)
  await writeFile(join(output, `${result.checkpoint}-plan.json`), JSON.stringify(plan, null, 2))
  await writeFile(join(output, `${result.checkpoint}.srt`), serializeSrt(captions))
  verified.push({ checkpoint: result.checkpoint, sourceCues: result.sourceCues, units: plan.cues.length,
    captions: captions.length, maxPhysicalTempo: Math.max(...tempos), minGapSeconds: minGap,
    videoDuration: plan.videoDuration, finalVoiceEnd: previousEnd, ok: true })
}
const summary = { verifiedAt: new Date().toISOString(), liveFinished: Boolean(report.finishedAt),
  scope: 'Real TTS WAV duration/tempo, grouped timeline and current caption metadata; no full video render or semantic certification.', results: verified }
await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
