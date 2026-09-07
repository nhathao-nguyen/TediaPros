import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTranslationBudget } from '../src/main/translation/budget'
import { createTranslationRetryGeneration, readTranslationCheckpoint, writeTranslationCheckpoint, type TranslationCheckpoint } from '../src/main/translation/checkpoint'
import { planTranslation, type TranslationCapability } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'

const capability: TranslationCapability = { provider: 'fixture', modelIdentity: 'fixture@1', revisionKnown: true, format: 'json-items', contextTokens: 4096, outputTokens: 512 }
const input: TranslationInput = {
  sourceLanguage: 'zh', targetLocale: 'en', mode: 'subtitle',
  cues: [
    { id: 'a', sourceIndex: 0, start: 0, end: 1, groupId: 'a', text: '第一句。' },
    { id: 'b', sourceIndex: 1, start: 1, end: 2, groupId: 'b', text: '第二句。' }
  ], contextBefore: [], contextAfter: [], glossary: []
}

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tedia-translation-checkpoint-'))
  try { await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('checkpoint persists a charged budget and valid batches atomically', async () => fixture(async (root) => {
  const plan = planTranslation(input, capability)
  const budget = createTranslationBudget(plan.batches.length, () => 0)
  budget.charge('normal', plan.batches[0]!.id)
  const key = 'a'.repeat(64)
  const data: TranslationCheckpoint = {
    schemaVersion: 2, key, generation: 0, plan, batches: { [plan.batches[0]!.id]: { items: [{ id: 'a', text: 'A' }], assessment: { version: 'translation-assessment-v2', disposition: 'validated', issues: [], languageEvidence: 'unknown' }, modelIdentity: 'fixture@1' } },
    budget: budget.snapshot(), failures: {}, disposition: 'running'
  }
  const path = join(root, 'item', 'translation.json')
  await writeTranslationCheckpoint(path, root, data)
  const loaded = await readTranslationCheckpoint(path, root, key)
  assert.equal(loaded?.budget.normalUsed, 1)
  assert.equal(Object.keys(loaded?.batches || {}).length, 1)
  assert.equal(await readTranslationCheckpoint(path, root, 'b'.repeat(64)), null)
}))

test('manual retry generation resets recovery state but retains valid batches', () => {
  const plan = planTranslation(input, capability)
  const budget = createTranslationBudget(plan.batches.length, () => 0)
  budget.charge('normal', plan.batches[0]!.id)
  budget.charge('recovery', plan.batches[0]!.id)
  const checkpoint: TranslationCheckpoint = {
    schemaVersion: 2, key: 'c'.repeat(64), generation: 2, plan,
    batches: { cached: { items: [{ id: 'a', text: 'A' }], assessment: { version: 'translation-assessment-v2', disposition: 'with-warnings', issues: [], languageEvidence: 'unknown' }, modelIdentity: 'fixture@1' } },
    budget: budget.snapshot(), failures: { b: { fingerprint: 'same', repeats: 2, requestedIds: ['b'] } }, disposition: 'needs-review'
  }
  const retry = createTranslationRetryGeneration(checkpoint)
  assert.equal(retry.generation, 3)
  assert.equal(retry.disposition, 'running')
  assert.equal(retry.budget.recoveryUsed, 0)
  assert.deepEqual(retry.batches, checkpoint.batches)
  assert.deepEqual(retry.failures, {})
})
