import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const audit = process.argv[2]
if (!audit) throw new Error('Pass the existing AutoShort audit directory.')
const temporary = await mkdtemp(join(tmpdir(), 'tedia-volvo-review-'))
try {
  const compiled = join(temporary, 'probe.cjs')
  await build({
    stdin: {
      resolveDir: process.cwd(), loader: 'ts', contents: `
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSrt } from './src/shared/subtitles'
import { planTranslation } from './src/main/translation/planner'
import { buildTranslationBatchMessages } from './src/main/translation/prompts'
import { validateAutoShortContentQuality } from './src/main/autoShortContentQuality'
import { assessTranslationLanguage } from './src/main/translation/language'
import { translateWithAdapter } from './src/main/translation/orchestrator'
import { groupSourceSpeechCues } from './src/main/sourceSpeechGrouping'
const audit = process.argv[2]
const source = parseSrt(readFileSync(join(audit, 'source.srt'), 'utf8')).cues
const target = parseSrt(readFileSync(join(audit, 'translated.srt'), 'utf8')).cues
const input = {
  sourceLanguage: 'zh', targetLocale: 'vi', mode: 'dubbing' as const,
  cues: source.map((cue, i) => ({ ...cue, groupId: 'cue-' + i })),
  contextBefore: [], contextAfter: [], glossary: []
}
const capability = { provider: 'gemini' as const, modelIdentity: 'offline-unverified-model',
  revisionKnown: false, format: 'json-items' as const, contextTokens: null, outputTokens: 2048 }
const plan = planTranslation(input, capability)
const batches = plan.batches.map(batch => {
  const prompt = buildTranslationBatchMessages(batch, 'json-items')
  return { id: batch.id, cueNumbers: batch.input.cues.map(cue => cue.sourceIndex + 1),
    before: batch.input.contextBefore.map(cue => ({ cue: cue.sourceIndex + 1, text: cue.text })),
    after: batch.input.contextAfter.map(cue => ({ cue: cue.sourceIndex + 1, text: cue.text })),
    containsCorrectVolvo: prompt.some(message => /沃尔沃|Volvo/iu.test(message.content)),
    containsMisheardVolvo: prompt.some(message => /窝耳窝/u.test(message.content)) }
})
const byId = new Map(target.map(cue => [cue.id, cue.text]))
const calls: unknown[] = []
globalThis.fetch = async () => { throw new Error('Network forbidden in review probe') }
async function run() {
  const replay = await translateWithAdapter(input, { capability,
    async requestOnce(batch) {
      calls.push(batch.input.cues.map(cue => cue.sourceIndex + 1))
      return { raw: JSON.stringify({ items: batch.input.cues.map(cue => ({ id: cue.id, text: byId.get(cue.id) })) }),
        truncated: false, modelIdentity: 'offline-unverified-model' }
    }
  }, new AbortController().signal)
  const groups = groupSourceSpeechCues(source)
  const spoken = JSON.parse(readFileSync(join(audit, 'final-spoken-text.json'), 'utf8'))
  const timing = JSON.parse(readFileSync(join(audit, 'tts-timeline.json'), 'utf8'))
  console.log(JSON.stringify({
    evidence: 'Offline replay of current code using saved SRT; not a captured live provider request.',
    sourceCount: source.length, targetCount: target.length,
    timelinesAndIdsEqual: source.every((cue, i) => cue.id === target[i]?.id && cue.start === target[i]?.start && cue.end === target[i]?.end),
    sourceTerminalPunctuationCount: source.filter(cue => /[.!?。！？]$/u.test(cue.text)).length,
    targetTerminalPunctuationCount: target.filter(cue => /[.!?。！？]$/u.test(cue.text)).length,
    batches,
    structuralQuality: validateAutoShortContentQuality({ sourceCues: source, targetCues: target }),
    languageQuality: assessTranslationLanguage(input, target.map(cue => ({ id: cue.id, text: cue.text }))),
    replay: { calls, assessment: replay.assessment, returnedCount: replay.items.length,
      wrongWootingSurvived: replay.items.filter(cue => /Wooting/u.test(cue.text)),
      wrongPixelSurvived: replay.items.filter(cue => /pixel/u.test(cue.text)) },
    speechGroups: groups.map(group => ({ id: group.id, cueNumbers: group.cues.map(cue => cue.sourceIndex + 1) })),
    spoken: { count: spoken.length, unchanged: spoken.every(cue => cue.translatedText === cue.finalSpokenText),
      rephrased: spoken.filter(cue => cue.rephrased).length },
    timing: { averageTempo: timing.averageTempo, maxTempo: timing.maxTempo, rephraseCount: timing.rephraseCount,
      overflowCount: timing.overflowCount, timingWarnings: timing.timingWarnings }
  }, null, 2))
}
run().catch(error => { console.error(error); process.exitCode = 1 })
` },
    bundle: true, platform: 'node', format: 'cjs', outfile: compiled, logLevel: 'silent'
  })
  const result = spawnSync(process.execPath, [compiled, audit], { encoding: 'utf8' })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
