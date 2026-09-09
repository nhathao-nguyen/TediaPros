import assert from 'node:assert/strict'
import test from 'node:test'
import {
  TranslationBudgetExhaustedError,
  classifyTranslationError,
  createTranslationBudget
} from '../src/main/translation/budget'

// Retain coverage of the optional bounded policy while production defaults to unlimited.
const createLimitedBudget = (
  planned: number,
  now: () => number,
  restored?: Parameters<typeof createTranslationBudget>[2]
) => createTranslationBudget(planned, now, restored, true)

test('default translation accounting does not cap requests or elapsed time', () => {
  let now = 0
  const budget = createTranslationBudget(1, () => now)
  for (let index = 0; index < 25; index++) {
    budget.charge('normal', `b${index}`)
    budget.charge('recovery', 'b0')
  }
  now = 86_400_000
  assert.equal(budget.remainingMs(), Number.POSITIVE_INFINITY)
  const persisted = JSON.parse(JSON.stringify(budget.snapshot()))
  assert.equal(persisted.normalUsed, 25)
  assert.equal(persisted.recoveryUsed, 25)
  const resumed = createTranslationBudget(1, () => now, persisted)
  resumed.charge('recovery', 'b0')
  assert.equal(resumed.snapshot().recoveryUsed, 26)
  assert.equal(resumed.canSplit('b0', 1), true)
})

test('default mode resumes an exhausted legacy budget without resetting counters', () => {
  const seed = createTranslationBudget(1, () => 0).snapshot()
  const resumed = createTranslationBudget(1, () => 0, {
    ...seed, normalUsed: 1, recoveryUsed: 4, activeElapsedMs: seed.activeBudgetMs,
    perBatch: { b0: { normalCharged: true, recoveryUsed: 4, splitDepth: 0, repairSets: [], transportRetries: {} } }
  })
  resumed.charge('recovery', 'b0')
  assert.equal(resumed.snapshot().recoveryUsed, 5)
  assert.equal(resumed.remainingMs(), Number.POSITIVE_INFINITY)
})

test('five normal batches share four recovery credits and restore without reset', () => {
  const budget = createLimitedBudget(5, () => 0)
  for (let i = 0; i < 5; i++) budget.charge('normal', `b${i}`)
  for (let i = 0; i < 4; i++) budget.charge('recovery', 'b0')
  assert.throws(() => budget.charge('recovery', 'b1'), TranslationBudgetExhaustedError)
  assert.equal(budget.snapshot().recoveryUsed, 4)
  const resumed = createLimitedBudget(5, () => 0, budget.snapshot())
  assert.throws(() => resumed.charge('recovery', 'b1'), TranslationBudgetExhaustedError)
})

test('normal charge is idempotent and per-batch recovery/split limits are finite', () => {
  const budget = createLimitedBudget(1, () => 0)
  budget.charge('normal', 'b0')
  budget.charge('normal', 'b0')
  assert.equal(budget.snapshot().normalUsed, 1)
  for (let i = 0; i < 4; i++) budget.charge('recovery', 'b0')
  assert.throws(() => budget.charge('recovery', 'b0'), TranslationBudgetExhaustedError)
  budget.recordSplit('b0', 1)
  budget.recordSplit('b0', 2)
  assert.equal(budget.canSplit('b0', 2), false)
  assert.throws(() => budget.recordSplit('b0', 3), TranslationBudgetExhaustedError)
})

test('transport and format repair claims are bounded per exact request', () => {
  const budget = createTranslationBudget(2, () => 0)
  budget.claimTransportRetry('b0', 'request-a')
  budget.claimTransportRetry('b0', 'request-a')
  assert.throws(() => budget.claimTransportRetry('b0', 'request-a'), TranslationBudgetExhaustedError)
  budget.claimFormatRepair('b0', 'ids-a')
  budget.claimFormatRepair('b0', 'ids-b')
  assert.throws(() => budget.claimFormatRepair('b0', 'ids-a'), TranslationBudgetExhaustedError)
})

test('failure classification uses structured status and names', () => {
  assert.deepEqual(classifyTranslationError({ status: 401, providerCode: 'invalid_api_key', message: 'x' }), {
    code: 'provider-auth', retryable: false, status: 401, message: 'x'
  })
  assert.equal(classifyTranslationError({ status: 503, retryAfterMs: 250, message: 'x' }).retryable, true)
  assert.equal(classifyTranslationError({ status: 429, providerCode: 'quota_exhausted', message: 'x' }).retryable, false)
  assert.equal(classifyTranslationError({ name: 'AbortError', message: 'cancelled' }).code, 'cancelled')
  assert.equal(classifyTranslationError({ name: 'TimeoutError', message: 'timeout' }).retryable, true)
  assert.equal(classifyTranslationError(new Error('arbitrary user text')).code, 'provider-protocol')
})

test('restoring malformed or over-quota snapshots is rejected', () => {
  const budget = createTranslationBudget(2, () => 0)
  const snapshot = budget.snapshot()
  assert.throws(() => createTranslationBudget(2, () => 0, { ...snapshot, recoveryUsed: Number.NaN }))
  assert.throws(() => createLimitedBudget(2, () => 0, { ...snapshot, normalUsed: 3 }))
})

test('restoring a lower persisted quota never increases it', () => {
  const snapshot = createTranslationBudget(2, () => 0).snapshot()
  const resumed = createLimitedBudget(2, () => 0, {
    ...snapshot,
    recoveryLimit: 1,
    activeBudgetMs: 600_000
  })
  assert.equal(resumed.recoveryLimit, 1)
  assert.throws(() => {
    resumed.charge('recovery', 'b0')
    resumed.charge('recovery', 'b0')
  }, TranslationBudgetExhaustedError)
})

test('resuming fewer pending batches retains the original plan and remaining quota', () => {
  const original = createTranslationBudget(5, () => 0)
  original.charge('normal', 'b0')
  original.charge('normal', 'b1')
  original.charge('recovery', 'b0')

  const snapshot = original.snapshot()
  const resumed = createTranslationBudget(2, () => 0, snapshot)
  assert.equal(resumed.plannedRequests, 5)
  assert.equal(resumed.recoveryLimit, 4)
  assert.deepEqual(resumed.snapshot(), snapshot)

  resumed.charge('normal', 'b2')
  assert.equal(resumed.snapshot().normalUsed, 3)
  assert.equal(resumed.snapshot().recoveryUsed, 1)
})
