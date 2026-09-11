// Read-only probes against current production modules. Run from repository root.
const { buildSync, transformSync } = require('esbuild')
const { readFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { resolve } = require('node:path')
const { createRequire } = require('node:module')
const assert = require('node:assert/strict')

function loadTs(path, source) {
  const file = resolve(path)
  const built = buildSync({
    ...(source === undefined ? { entryPoints: [file] } : {
      stdin: { contents: source, sourcefile: file, resolveDir: resolve('src/main/translation'), loader: 'ts' }
    }),
    bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent'
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', built.outputFiles[0].text)(createRequire(file), module, module.exports)
  return module.exports
}

const qa = loadTs('src/main/autoShortContentQuality.ts')
const makeCue = text => ({ id: 'cue-a', sourceIndex: 0, start: 0, end: 2, text })
const cases = [
  ['valid interrogative control', '你吃饭了吗？', 'Bạn đã ăn cơm chưa?'],
  ['real negation omitted from question', '你为什么不去学校？', 'Tại sao bạn đi học?'],
  ['real negation omitted from statement ending in sao', '不要看星星。', 'Hãy nhìn các vì sao.'],
  ['compound numeral twelve', '我有十二个苹果。', 'Tôi có 12 quả táo.'],
  ['lexical CJK characters', '我们一起走吧。', 'Chúng ta cùng đi nhé.'],
  ['ordinal value silently lost', '这是第三次。', 'Đây là lần thứ tư.'],
  ['Eastern Arabic control', '١٢ kg', '12 kg']
]
for (const [label, source, target] of cases) {
  const result = qa.assessContentQuality([makeCue(source)], [makeCue(target)])
  console.log(JSON.stringify({ label, source, target, disposition: result.disposition, issues: result.issues }))
}

// Execute the exact new coordinator block, transpiled without modifying production files.
const coordinator = readFileSync('src/main/autoShortItemCoordinator.ts', 'utf8')
const begin = coordinator.indexOf('        // Resilient timeline clamping:')
const end = coordinator.indexOf('        const syncValidation = validateAutoShortTimelineSync(', begin)
assert.ok(begin >= 0 && end > begin)
const clamp = new Function('synthesized', 'meta', transformSync(coordinator.slice(begin, end), { loader: 'ts' }).code)
const { validateAutoShortTimelineSync } = loadTs('src/main/autoShortPolicy.ts')
const unit = {
  id: 'tail', timingPolicy: 'source-anchored-v2', sourceCueIds: ['tail'],
  sourceStart: 9, sourceEnd: 10, sourceText: 'Hello', translatedText: 'Hello',
  finalSpokenText: 'Hello', rephrased: false, naturalDuration: 1.2,
  finalDuration: 1, plannedStart: 9, plannedEnd: 10, plannedDuration: 1,
  tempo: 1.2, hardEnd: 10, preferredEnd: 10, finalAudioPath: 'unchanged.wav',
  subtitles: [{ id: 'tail', start: 9, end: 10, text: 'Hello' }]
}
for (const overshoot of [0.003, 0.01, 0.3]) {
  const actual = structuredClone(unit)
  actual.plannedEnd += overshoot
  actual.finalDuration += overshoot
  actual.tempo = Number((actual.naturalDuration / actual.finalDuration).toFixed(4))
  actual.subtitles[0].end += overshoot
  const before = validateAutoShortTimelineSync([actual], 10)
  const synthesized = { dubbingUnits: [actual], clips: [{ start: 9, path: 'unchanged.wav' }] }
  clamp(synthesized, { giay: 10 })
  const after = validateAutoShortTimelineSync(synthesized.dubbingUnits, 10)
  console.log(JSON.stringify({ label: 'coordinator-clamp', overshoot, before, after, unit: actual, clips: synthesized.clips }))
}

const promptPath = 'src/main/translation/prompts.ts'
const current = loadTs(promptPath)
const baselineSource = execFileSync('git', ['show', '481ae06:' + promptPath], { encoding: 'utf8' })
const baseline = loadTs(promptPath, baselineSource)
const { buildTranslationIdentity } = loadTs('src/main/translation/checkpoint.ts')
const input = {
  sourceLanguage: 'zh', targetLocale: 'vi', mode: 'dubbing',
  cues: [makeCue('你好。')], contextBefore: [], contextAfter: [], glossary: []
}
const identity = {
  provider: 'local', modelIdentity: 'review-model@revision1', revisionKnown: true,
  profileId: 'review-profile', promptVersion: baseline.TRANSLATION_PROMPT_VERSION,
  parserVersion: baseline.TRANSLATION_PARSER_VERSION, plannerVersion: 'translation-plan-v2',
  assessmentVersion: 'translation-assessment-v2', options: { videoDuration: 10, strict: true }
}
const keyBefore = buildTranslationIdentity(input, identity)
const keyAfter = buildTranslationIdentity(input, { ...identity, promptVersion: current.TRANSLATION_PROMPT_VERSION })
const promptChanged = JSON.stringify(baseline.buildTranslationMessages(input, 'id-lines')) !== JSON.stringify(current.buildTranslationMessages(input, 'id-lines'))
assert.equal(promptChanged, true)
assert.equal(keyBefore, keyAfter)
console.log(JSON.stringify({ label: 'translation-identity', promptChanged, versionBefore: baseline.TRANSLATION_PROMPT_VERSION, versionAfter: current.TRANSLATION_PROMPT_VERSION, keyBefore, keyAfter }))
console.log(JSON.stringify({ label: 'language-profile-count', count: Object.keys(current.GLOBAL_LANGUAGE_PROFILES).length, supported: Object.keys(current.GLOBAL_LANGUAGE_PROFILES) }))
