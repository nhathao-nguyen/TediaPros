// Read-only diagnostic probes against current source. No provider/TTS calls.
// Run from the repository root: node .ai/tasks/2026-09-15-vietnamese-translation-design-review/probe.mjs
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const exports = {
  'src/main/dubbing/plan.ts': ['buildDubbingPlan', 'groupDubbingPlanForSpeech'],
  'src/main/dubbing/translation.ts': ['applyDubbingTranslations', 'dubbingSpeakingDurations'],
  'src/main/geminiGatewayPrompts.ts': ['buildGatewayDraftMessages', 'buildGatewayReviewMessages'],
  'src/main/translation/prompts.ts': ['buildTranslationMessages', 'getLanguageSpeakingBudget'],
  'src/main/dubbing/durationPredictor.ts': ['createDurationPredictor', 'extractDurationFeatures'],
  'src/main/autoShortContentQuality.ts': ['validateRephraseSemanticPreservation']
}
const bundled = await build({
  stdin: { contents: Object.entries(exports).map(([file, names]) =>
    `export { ${names.join(', ')} } from ${JSON.stringify('./' + file)};`).join('\n'),
    resolveDir: process.cwd(), sourcefile: 'translation-review-entry.ts', loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false
})
const api = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`)

const cues = Array.from({ length: 7 }, (_, i) => ({
  id: `c${i}`, sourceIndex: i, start: i, end: i + 1,
  text: i === 5 || i === 6 ? '结束。' : '继续'
}))
const individual = api.dubbingSpeakingDurations(cues, 8)
const grouped = api.groupDubbingPlanForSpeech(api.buildDubbingPlan({ cues, videoDuration: 8 }), 'vi')
const firstGroup = grouped.cues[0]
assert.equal(firstGroup.sourceCueIds.length, 6)
assert.equal(individual.slice(0, 6).reduce((a, b) => a + b, 0), 3)
assert.equal(firstGroup.availableDuration, 5.5)
const input = {
  sourceLanguage: 'zh', targetLocale: 'vi-VN', mode: 'dubbing',
  cues: cues.map((cue, i) => ({ ...cue, groupId: `g${i}`, speakingDuration: individual[i] })),
  glossary: [], contextBefore: [], contextAfter: []
}
const batch = { id: 'probe', input, mapping: [], maxOutputTokens: 2048 }
const standard = JSON.stringify(api.buildTranslationMessages(input, 'json-items'))
const gatewayDraft = JSON.stringify(api.buildGatewayDraftMessages(batch))
const gatewayReview = JSON.stringify(api.buildGatewayReviewMessages(batch, '{}'))
const budgetFields = ['speaking_duration_seconds', 'target_natural_seconds', 'hard_max_natural_seconds', 'suggested_max_words']
const promptComparison = Object.fromEntries(budgetFields.map(field => [field, {
  standard: standard.includes(field), gatewayDraft: gatewayDraft.includes(field), gatewayReview: gatewayReview.includes(field)
}]))
assert.ok(budgetFields.every(field => promptComparison[field].standard && !promptComparison[field].gatewayDraft && !promptComparison[field].gatewayReview))

const semanticNegativeControls = [
  { error: 'changed-object', original: 'Cho 2 thìa muối vào nước.', candidate: 'Cho 2 thìa đường vào nước.' },
  { error: 'reversed-action-order', original: 'Rút phích cắm trước khi vệ sinh máy.', candidate: 'Vệ sinh máy trước khi rút phích cắm.' }
].map(pair => ({ ...pair, actual: api.validateRephraseSemanticPreservation(pair.original, pair.candidate, 'vi') }))
// These assertions reproduce limitations, NOT desired correctness.
assert.ok(semanticNegativeControls.every(pair => pair.actual.ok))

const predictor = api.createDurationPredictor()
const coldEstimate = predictor.estimate('Máy này dùng để thái rau.', { locale: 'vi' })
assert.equal(coldEstimate.calibration, 'uncalibrated')
assert.equal(coldEstimate.confidence, 0)

const replay = []
for (const name of ['live-v8-volvo-20260915-1245', 'live-v8-actual-113-20260915-1250']) {
  const root = resolve('.ai/tasks/2026-09-15-gateway-v2-hardening', name)
  const source = JSON.parse(await readFile(resolve(root, 'source.json'), 'utf8'))
  const result = JSON.parse(await readFile(resolve(root, 'result.json'), 'utf8'))
  const items = result.parsed.items
  const selected = [...items].sort((a, b) => b.text.split(/\s+/u).length - a.text.split(/\s+/u).length).slice(0, 3)
  const lookup = new Map(source.cues.map(cue => [cue.id, cue]))
  const plan = api.groupDubbingPlanForSpeech(api.applyDubbingTranslations(
    api.buildDubbingPlan({ cues: source.cues, videoDuration: Math.max(...source.cues.map(c => c.end)) + 0.5 }), items),
    source.targetLocale, { reviewedTargetBoundaries: true })
  replay.push({ name, cueCount: source.cues.length, speechGroups: plan.cues.length,
    timingEvidence: name.includes('volvo') ? 'synthetic fixture timestamps; do not use for real duration claims' : 'saved cue timeline; no TTS measurement in this probe',
    longRows: selected.map(item => ({ ...item, sourceText: lookup.get(item.id)?.text, whitespaceUnits: item.text.split(/\s+/u).length })) })
}

const sourceHashes = Object.fromEntries(await Promise.all(Object.keys(exports).map(async file =>
  [file, createHash('sha256').update(await readFile(file)).digest('hex')]
)))
console.log(JSON.stringify({ kind: 'OFFLINE_PROBE', providerCalls: 0, ttsCalls: 0, sourceHashes,
  promptComparison,
  budgetMismatch: { sourceCueCount: 6, sumOfIndividualWindows: 3, actualGroupedWindow: firstGroup.availableDuration,
    explanation: 'Individual reservations remove 0.5 seconds six times; the merged speech unit reserves its external gap once.' },
  semanticNegativeControls,
  coldEstimate,
  defaultVietnameseBudgetForTwoSeconds: api.getLanguageSpeakingBudget('vi-VN', 2),
  featureExamples: ['học sinh', '1.250 kg', 'một nghìn hai trăm năm mươi ki lô gam'].map(text => ({ text, features: api.extractDurationFeatures(text, 'vi') })),
  historicalArtifactReplay: replay
}, null, 2))
