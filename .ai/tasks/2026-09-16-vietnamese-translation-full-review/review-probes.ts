/** Diagnostic reproductions: PASS confirms the observed defect, not acceptance. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { buildDubbingPlan, groupDubbingPlanForSpeech } from '../../../src/main/dubbing/plan'
import { applyDubbingTranslations } from '../../../src/main/dubbing/translation'
import { createDubbingFeedbackJournal, synthesizeDubbingPlan, type DubbingSynthesisInput } from '../../../src/main/dubbing/synthesis'
import { buildSourceSpeechUnitPlan } from '../../../src/main/translation/speechUnitPlanner'
import { planTranslation } from '../../../src/main/translation/planner'
import { buildGatewayDraftMessages } from '../../../src/main/geminiGatewayPrompts'
import { createGeminiGatewayTranslationAdapter } from '../../../src/main/geminiGateway'
import { translateWithAdapter } from '../../../src/main/translation/orchestrator'
import { createTranslationBudget } from '../../../src/main/translation/budget'
import { readTranslationCheckpoint, writeTranslationCheckpoint } from '../../../src/main/translation/checkpoint'
import { validateRephraseSemanticPreservation } from '../../../src/main/autoShortContentQuality'
import type { TranslationInput } from '../../../src/shared/translation'

const predictor = () => ({
  profile: { version: 2 as const, samples: 1, weights: [0, 0, 0, 0, 0, 0], residualP90: 0 },
  estimate: () => ({ seconds: 1, uncertaintySeconds: 0, confidence: 1 }), addSample: () => {}
})
const shortText = 'Short candidate.'
const longText = 'This original wording is deliberately too long.'

function synthesisInput(spoken: string[], journal?: ReturnType<typeof createDubbingFeedbackJournal>): DubbingSynthesisInput {
  return {
    allowVideoExtension: true,
    recoveryAttempt: 1,
    plan: applyDubbingTranslations(buildDubbingPlan({ videoDuration: 1.4, cues: [
      { id: 'cue', start: 0, end: 1.2, text: 'nguồn không đổi' }
    ] }), [{ id: 'cue', text: longText }]),
    language: 'en', model: 'fixture', voice: 'fixture-voice', options: { rate: 1 },
    feedbackJournal: journal, feedbackJournalItemId: 'item-one', predictor: predictor(),
    tts: { synthesize: async ({ text }) => { spoken.push(text); return { path: text } } },
    audio: { trim: async (path) => ({ path, duration: path === shortText ? 0.6 : 5 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration }) },
    rephraseBatch: async () => new Map([['cue', [shortText]]])
  }
}

test('F01: the active coordinator omits feedbackJournal, so repeated synthesis dispatches the candidate again', async (t) => {
  const code = readFileSync('src/main/autoShortItemCoordinator.ts', 'utf8')
  const source = ts.createSourceFile('coordinator.ts', code, ts.ScriptTarget.Latest, true)
  let keys: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'jobAdapter' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      keys = node.initializer.properties.map((property) => property.name?.getText(source) || '')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(keys.includes('ttsCapabilities'))
  assert.ok(!keys.includes('feedbackJournal'))
  const spoken: string[] = []
  await synthesizeDubbingPlan(synthesisInput(spoken))
  await synthesizeDubbingPlan({ ...synthesisInput(spoken), recoveryAttempt: 2 })
  assert.equal(spoken.filter((text) => text === shortText).length, 2)
  t.diagnostic(JSON.stringify({ jobAdapterFields: keys, repeatedCandidateDispatches: 2 }))
})

test('F02: a shared journal forgets an accepted result; the second invocation fails on the original long cue', async (t) => {
  const spoken: string[] = []
  const journal = createDubbingFeedbackJournal()
  const first = await synthesizeDubbingPlan(synthesisInput(spoken, journal))
  assert.equal(first.plan.cues[0].finalSpokenText, shortText)
  let failure = ''
  try { await synthesizeDubbingPlan({ ...synthesisInput(spoken, journal), recoveryAttempt: 2 }) }
  catch (error) { failure = String(error) }
  assert.ok(failure, 'the accepted candidate is not restored and the original exceeds bounded extension')
  assert.equal(spoken.filter((text) => text === shortText).length, 1)
  t.diagnostic(JSON.stringify({ acceptedFirst: first.plan.cues[0].finalSpokenText, secondFailure: failure, spoken }))
})

test('F03: source-repair accepts a changed number and emits it in final audio/subtitles', async (t) => {
  const spoken: string[] = []
  const original = 'Cho 2 thìa muối vào nồi rồi khuấy đều.'
  const corrupted = 'Cho 20 thìa đường.'
  const sameLanguageGuard = validateRephraseSemanticPreservation(original, corrupted, 'vi')
  assert.equal(sameLanguageGuard.ok, false)
  const result = await synthesizeDubbingPlan({
    ...synthesisInput(spoken), recoveryAttempt: 2, language: 'vi',
    plan: applyDubbingTranslations(buildDubbingPlan({ videoDuration: 1.4, cues: [
      { id: 'cue', start: 0, end: 1.2, text: '加入2勺盐，然后搅拌。' }
    ] }), [{ id: 'cue', text: original }]),
    audio: { trim: async (path) => ({ path, duration: path === corrupted ? 0.6 : 5 }),
      applyTempo: async (path, _hint, duration) => ({ path, duration }) },
    rephraseBatch: async () => new Map([['cue', [corrupted]]])
  })
  assert.equal(result.plan.cues[0].finalSpokenText, corrupted)
  assert.equal(result.subtitles[0].text, corrupted)
  t.diagnostic(JSON.stringify({ source: result.plan.cues[0].sourceText, acceptedText: corrupted, ordinaryGuardReasons: sameLanguageGuard.reasons }))
})

test('F04: internal split IDs have no corresponding text or offset mapping in the full-ledger Gateway prompt', (t) => {
  const source: TranslationInput = {
    sourceLanguage: 'en', targetLocale: 'vi-VN', mode: 'subtitle',
    cues: [{ id: 'long', groupId: 'long', sourceIndex: 0, start: 0, end: 90, text: 'First distinct section. '.repeat(250) + 'Second distinct section. '.repeat(250) }],
    contextBefore: [], contextAfter: [], glossary: []
  }
  const adapter = createGeminiGatewayTranslationAdapter('http://fixture.invalid/openai/v1')
  const plan = planTranslation(source, adapter.capability)
  const batch = plan.batches[0]!
  const messages = buildGatewayDraftMessages(batch, { sourceLedger: source })
  const prompt = messages.map((message) => message.content).join('\n')
  const ledger = prompt.split('[FULL_SOURCE_LEDGER_JSONL]')[1]!.split('[/FULL_SOURCE_LEDGER_JSONL]')[0]!.trim().split('\n').map((line) => JSON.parse(line))
  const requested = batch.input.cues.map((cue) => cue.id)
  assert.ok(requested.some((id) => id.includes('/part-')))
  assert.ok(requested.every((id) => !ledger.some((cue) => cue.id === id)))
  assert.doesNotMatch(prompt, /startOffset|endOffset|start_offset|end_offset|original_id/u)
  assert.ok(batch.mapping.every((mapping) => mapping.endOffset > mapping.startOffset))
  t.diagnostic(JSON.stringify({ requestedIds: requested, ledgerIds: ledger.map((cue) => cue.id), mappingExistsOnlyInCode: batch.mapping }))
})

test('F05: truncated Gateway draft terminates instead of reaching scheduler output splitting', async (t) => {
  const source: TranslationInput = {
    sourceLanguage: 'en', targetLocale: 'vi-VN', mode: 'subtitle',
    cues: ['one', 'two', 'three', 'four'].map((id, i) => ({ id, groupId: id, sourceIndex: i, start: i, end: i + 1, text: 'Mix gently.' })),
    contextBefore: [], contextAfter: [], glossary: []
  }
  let calls = 0
  const previous = globalThis.fetch
  try {
    globalThis.fetch = async () => {
      calls++
      return new Response(JSON.stringify({
        model: 'gemini-advanced',
        gateway_metadata: { gateway_contract_version: 2, resolved_model: 'gemini-advanced', observed_model_id: 'fixture',
          route_fingerprint: 'a'.repeat(64), model_verification: 'matched', completion_state: 'complete',
          completion_evidence: 'fixture-complete', upstream_attempts: 1 },
        choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ translations: { one: 'Khuấy nhẹ.' } }) } }]
      }))
    }
    const result = await translateWithAdapter(source, createGeminiGatewayTranslationAdapter('http://fixture.invalid/openai/v1'), new AbortController().signal)
    assert.equal(calls, 1)
    assert.equal(result.assessment.disposition, 'needs-review')
    assert.ok(result.assessment.issues.some((issue) => issue.code === 'provider-protocol'))
    t.diagnostic(JSON.stringify({ calls, disposition: result.assessment.disposition, items: result.items, issues: result.assessment.issues }))
  } finally { globalThis.fetch = previous }
})

test('F06: source prompt budget and reviewed-target TTS grouping reserve different total speaking time', (t) => {
  const cues = Array.from({ length: 6 }, (_, i) => ({ id: `cue-${i}`, groupId: `cue-${i}`, sourceIndex: i, start: i, end: i + 1, text: `源片段${i}` }))
  const promptPlan = buildSourceSpeechUnitPlan({ sourceDigest: 'fixture', videoDuration: 6, cues })
  const targetPlan = groupDubbingPlanForSpeech(applyDubbingTranslations(buildDubbingPlan({ videoDuration: 6, cues }), cues.map((cue) => ({ id: cue.id, text: 'Khuấy đều.' }))), 'vi', { reviewedTargetBoundaries: true })
  const promptSeconds = promptPlan.units.reduce((sum, unit) => sum + unit.budget.availableSeconds, 0)
  const ttsSeconds = targetPlan.cues.reduce((sum, cue) => sum + cue.availableDuration, 0)
  assert.notDeepEqual(promptPlan.units.map((unit) => unit.memberCueIds), targetPlan.cues.map((cue) => cue.sourceCueIds))
  assert.ok(promptSeconds > ttsSeconds)
  t.diagnostic(JSON.stringify({ sourceGroups: promptPlan.units.map((unit) => unit.memberCueIds), targetGroups: targetPlan.cues.map((cue) => cue.sourceCueIds), promptSeconds, ttsSeconds }))
})

test('F07: quantified-object Map overwrites repeated units and rejects a meaning-preserving list reorder', (t) => {
  const result = validateRephraseSemanticPreservation('Cho 2 thìa muối và 2 thìa đường.', 'Cho 2 thìa đường và 2 thìa muối.', 'vi')
  assert.equal(result.ok, false)
  assert.ok(result.reasons.includes('quantified-object'))
  t.diagnostic(JSON.stringify(result))
})

test('F08: a valid long-context plan writes a checkpoint that its own 2 MiB reader discards', async (t) => {
  const source: TranslationInput = {
    sourceLanguage: 'en', targetLocale: 'vi-VN', mode: 'subtitle',
    cues: Array.from({ length: 720 }, (_, i) => ({
      id: `long-${i}`, groupId: `long-${i}`, sourceIndex: i, start: i * 20, end: (i + 1) * 20,
      text: 'A long fixture phrase with distinct source context. '.repeat(62).trim()
    })),
    contextBefore: [], contextAfter: [], glossary: []
  }
  const adapter = createGeminiGatewayTranslationAdapter('http://fixture.invalid/openai/v1')
  const plan = planTranslation(source, adapter.capability)
  assert.equal(plan.unsupported, false)
  const root = await mkdtemp(join(tmpdir(), 'tedia-review-checkpoint-20260916-'))
  const checkpointPath = join(root, 'checkpoint.json')
  await writeTranslationCheckpoint(checkpointPath, root, {
    schemaVersion: 2, key: 'b'.repeat(64), generation: 0, plan, batches: {},
    budget: createTranslationBudget(plan.batches.length).snapshot(), failures: {}, disposition: 'running'
  })
  const writtenBytes = (await stat(checkpointPath)).size
  assert.ok(writtenBytes > 2 * 1024 * 1024)
  const restored = await readTranslationCheckpoint(checkpointPath, root, 'b'.repeat(64))
  assert.equal(restored, null)
  t.diagnostic(JSON.stringify({ sourceBytes: Buffer.byteLength(JSON.stringify(source)), batches: plan.batches.length, writtenBytes, restored, checkpointPath }))
})
