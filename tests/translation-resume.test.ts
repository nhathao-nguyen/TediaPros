import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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

test('manual retry generation retains recovery budget and valid batches', () => {
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
  assert.equal(retry.budget.recoveryUsed, 1)
  assert.equal(retry.budget.perBatch[plan.batches[0]!.id]?.recoveryUsed, 1)
  assert.deepEqual(retry.batches, checkpoint.batches)
  assert.deepEqual(retry.failures, {})
})

test('checkpoint reader treats corrupt, future, and invalid nested state as a cache miss', async () => fixture(async (root) => {
  const path = join(root, 'item', 'translation.json')
  const key = 'd'.repeat(64)
  await writeFile(path, '{"schemaVersion":2,"key":', 'utf8').catch(async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(root, 'item'), { recursive: true })
    await writeFile(path, '{"schemaVersion":2,"key":', 'utf8')
  })
  assert.equal(await readTranslationCheckpoint(path, root, key), null)

  const plan = planTranslation(input, capability)
  const budget = createTranslationBudget(plan.batches.length, () => 0).snapshot()
  const valid: TranslationCheckpoint = {
    schemaVersion: 2, key, generation: 0, plan, batches: {}, budget,
    failures: {}, disposition: 'running'
  }
  await writeFile(path, JSON.stringify({ ...valid, schemaVersion: 3 }), 'utf8')
  assert.equal(await readTranslationCheckpoint(path, root, key), null)

  await writeFile(path, JSON.stringify({ ...valid, budget: { ...budget, recoveryUsed: -1 } }), 'utf8')
  assert.equal(await readTranslationCheckpoint(path, root, key), null)

  await writeFile(path, JSON.stringify({ ...valid, plan: { ...plan, batches: [{ ...plan.batches[0], maxOutputTokens: -1 }] } }), 'utf8')
  assert.equal(await readTranslationCheckpoint(path, root, key), null)
}))

test('checkpoint writer rejects invalid nested state before publication', async () => fixture(async (root) => {
  const plan = planTranslation(input, capability)
  const key = 'e'.repeat(64)
  const invalid = {
    schemaVersion: 2, key, generation: 0, plan, batches: {},
    budget: { ...createTranslationBudget(plan.batches.length, () => 0).snapshot(), activeElapsedMs: Number.NaN },
    failures: {}, disposition: 'running'
  } as TranslationCheckpoint
  await assert.rejects(writeTranslationCheckpoint(join(root, 'item', 'translation.json'), root, invalid), /Invalid translation checkpoint/u)
}))
