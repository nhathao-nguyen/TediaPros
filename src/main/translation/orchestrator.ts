import type { SubtitleCue } from '../../shared/types'
import type {
  TranslationAssessment,
  TranslationBatchResult,
  TranslationInput,
  TranslationIssue,
  TranslationItem
} from '../../shared/translation'
import { assessContentQuality } from '../autoShortContentQuality'
import { assessTranslationLanguage } from './language'
import { parseTranslationResponse } from './response'
import { selectTranslationSourceContext } from './context'
import { fitTranslationSourceContext } from './context'
import { buildTranslationBatchMessages } from './prompts'
import { withSourceSpeechGroups } from './sourceGroups'
import {
  classifyTranslationError,
  createTranslationBudget,
  TranslationBudgetExhaustedError,
  type TranslationBudget,
  type TranslationBudgetSnapshot
} from './budget'
import {
  planTranslation,
  restoreOriginalCues,
  type PlannedTranslationBatch,
  type TranslationCapability,
  type TranslationPlan
} from './planner'

export interface TranslationAdapter {
  capability: TranslationCapability
  requestOnce(batch: PlannedTranslationBatch, signal: AbortSignal): Promise<{
    raw: string
    truncated: boolean
    modelIdentity: string
  }>
}

export type TranslationBatchCallback = (
  batchId: string,
  result: TranslationBatchResult,
  budget: TranslationBudgetSnapshot
) => Promise<void> | void

export interface TranslateWithAdapterOptions {
  plan?: TranslationPlan
  budget?: TranslationBudget
  /** Resume a durable budget without resetting normal/recovery usage. */
  restoredBudget?: TranslationBudgetSnapshot
  /** Validated source-ID items restored from an earlier generation. */
  resumeItems?: readonly TranslationItem[]
  beforeDispatch?: (snapshot: TranslationBudgetSnapshot) => Promise<void> | void
  onBatch?: TranslationBatchCallback
  /** Sleep between structured transient retries. Inject a no-op in tests. */
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
  /** Random source for bounded transport backoff; independent of content recovery. */
  random?: () => number
  /** Internal quality-repair calls disable recursion after one focused pass. */
  autoRepairContentWarnings?: boolean
  /** Quality repair consumes recovery accounting even when it uses a fresh sub-plan. */
  initialRequestKind?: 'normal' | 'recovery'
}

export interface TranslationRunResult extends TranslationBatchResult {
  plan: TranslationPlan
  budget: TranslationBudgetSnapshot
}

interface WorkItem {
  batch: PlannedTranslationBatch
  originalBatchId: string
  requestedIds: string[]
  splitDepth: number
  kind: 'normal' | 'recovery'
  transportAttempt?: number
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Translation cancelled.')
}

function issue(
  code: TranslationIssue['code'],
  message: string,
  cueIds: readonly string[] = [],
  confidence: TranslationIssue['confidence'] = 'certain',
  severity: TranslationIssue['severity'] = 'error'
): TranslationIssue {
  return { code, severity, cueIds: [...cueIds], confidence, message }
}

function assessmentForIssues(issues: readonly TranslationIssue[], complete: boolean): TranslationAssessment {
  const hasError = !complete || issues.some((item) => item.severity === 'error')
  return {
    version: 'translation-assessment-v2',
    disposition: hasError ? 'needs-review' : issues.length > 0 ? 'with-warnings' : 'validated',
    issues: [...issues],
    languageEvidence: 'unknown'
  }
}

/** Convert an invalid/empty source boundary into the same durable assessment
 * shape used by provider and parser failures. Callers can surface this in the
 * queue and persist it without pretending that a provider request ran. */
export function createInvalidSourceAssessment(
  message: string,
  cueIds: readonly string[] = []
): TranslationAssessment {
  return {
    version: 'translation-assessment-v2',
    disposition: 'needs-review',
    issues: [issue('invalid-source', message, cueIds)],
    languageEvidence: 'unknown'
  }
}

function uniqueValidItems(items: readonly TranslationItem[], expectedIds: readonly string[]): TranslationItem[] {
  const expected = new Set(expectedIds)
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.id, (counts.get(item.id) || 0) + 1)
  return items.filter((item) => expected.has(item.id) && counts.get(item.id) === 1 && Boolean(item.text.trim()))
}

function makeRequestSignal(parent: AbortSignal, remainingMs: number): { signal: AbortSignal; timeoutSignal: AbortSignal } {
  const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.min(180_000, Math.ceil(remainingMs))))
  return { signal: AbortSignal.any([parent, timeoutSignal]), timeoutSignal }
}

async function waitForRetry(
  delayMs: number,
  budget: TranslationBudget,
  signal: AbortSignal,
  sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>
): Promise<void> {
  const delay = Math.min(30_000, Math.max(0, Math.ceil(delayMs)))
  if (delay === 0) return
  const remaining = budget.remainingMs()
  if (remaining <= delay) throw new TranslationBudgetExhaustedError('Retry-After vượt ngân sách thời gian dịch.')
  await sleep(delay, signal)
}

function countPayloadTokens(capability: TranslationCapability, value: string): number {
  try {
    const count = capability.countTokens?.(value)
    if (typeof count === 'number' && Number.isFinite(count) && count >= 0) return count
  } catch {
    // Use the same conservative byte fallback as the planner.
  }
  return new TextEncoder().encode(value).length
}

function fitWorkForDispatch(work: WorkItem, capability: TranslationCapability): PlannedTranslationBatch | null {
  if (capability.contextTokens === null) return work.batch
  const fits = (candidate: TranslationInput): boolean => {
    const payload = JSON.stringify(buildTranslationBatchMessages({ ...work.batch, input: candidate }, capability.format))
    return countPayloadTokens(capability, payload) + work.batch.maxOutputTokens <= capability.contextTokens!
  }
  const input = fitTranslationSourceContext(work.batch.input, fits)
  return fits(input) ? { ...work.batch, input } : null
}

function childBatch(
  work: WorkItem,
  index: number,
  cues: PlannedTranslationBatch['input']['cues'],
  source: TranslationInput,
  completeMapping: TranslationPlan['mapping']
): PlannedTranslationBatch {
  const selectedIds = new Set(cues.map((cue) => cue.id))
  const context = selectTranslationSourceContext(source, cues, completeMapping)
  return {
    id: `${work.batch.id}/split-${index + 1}`,
    input: { ...work.batch.input, cues: cues.map((cue) => ({ ...cue })), ...context },
    maxOutputTokens: work.batch.maxOutputTokens,
    mapping: work.batch.mapping.filter((mapping) => selectedIds.has(mapping.unitId))
  }
}

function sourceSubtitleCues(input: TranslationInput): SubtitleCue[] {
  return input.cues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end, text: cue.text, sourceIndex: cue.sourceIndex }))
}

function targetSubtitleCues(source: readonly SubtitleCue[], items: readonly TranslationItem[]): SubtitleCue[] {
  const byId = new Map(items.map((item) => [item.id, item.text]))
  return source.filter((cue) => byId.has(cue.id)).map((cue) => ({ ...cue, text: byId.get(cue.id) || '' }))
}

function assessTranslatedItems(input: TranslationInput, items: readonly TranslationItem[]): {
  issues: TranslationIssue[]
  languageEvidence: TranslationAssessment['languageEvidence']
} {
  const source = sourceSubtitleCues(input)
  const content = assessContentQuality(source, targetSubtitleCues(source, items))
  const language = assessTranslationLanguage(input, items)
  return { issues: [...content.issues, ...language.issues], languageEvidence: language.languageEvidence }
}

function uniqueIssues(issues: readonly TranslationIssue[]): TranslationIssue[] {
  return issues.filter((item, index, all) => all.findIndex((candidate) =>
    candidate.code === item.code && candidate.message === item.message && candidate.cueIds.join(',') === item.cueIds.join(',')) === index)
}

/**
 * Provider-neutral bounded translation scheduler. Providers perform one
 * request; this loop owns retries, repair, split, validation and cancellation.
 */
export async function translateWithAdapter(
  input: TranslationInput,
  adapter: TranslationAdapter,
  signal: AbortSignal,
  options: TranslateWithAdapterOptions = {}
): Promise<TranslationRunResult> {
  // Establish groups on the full ledger, before resume, recovery or quality
  // repair selects a subset. Those paths must keep the same source identity.
  input = withSourceSpeechGroups(input)
  const plan = options.plan || planTranslation(input, adapter.capability)
  const budget = options.budget || createTranslationBudget(plan.batches.length, undefined, options.restoredBudget)
  const sleep = options.sleep || (async (delayMs: number, signal?: AbortSignal): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const parentSignal = signal
      if (parentSignal?.aborted) {
        reject(parentSignal.reason instanceof Error ? parentSignal.reason : new Error('Translation cancelled.'))
        return
      }
      let timer: ReturnType<typeof setTimeout>
      const onAbort = (): void => {
        clearTimeout(timer)
        parentSignal?.removeEventListener('abort', onAbort)
        reject(parentSignal?.reason instanceof Error ? parentSignal.reason : new Error('Translation cancelled.'))
      }
      timer = setTimeout(() => {
        parentSignal?.removeEventListener('abort', onAbort)
        resolve()
      }, delayMs)
      parentSignal?.addEventListener('abort', onAbort, { once: true })
    })
  })
  const accepted = new Map<string, TranslationItem>()
  const resumable = new Map<string, TranslationItem>()
  for (const item of options.resumeItems || []) {
    const id = item.id.trim()
    const text = item.text.trim()
    if (id && text && !resumable.has(id)) resumable.set(id, { id, text })
  }
  // A resumed source cue can be represented by one provider unit directly.
  // If the planner split a long cue, the old restored text cannot be divided
  // back into the original unit boundaries safely, so those units are sent
  // again instead of guessing a lossy split.
  const unitCountsByOriginal = new Map<string, number>()
  for (const mapping of plan.mapping) unitCountsByOriginal.set(mapping.originalId, (unitCountsByOriginal.get(mapping.originalId) || 0) + 1)
  for (const mapping of plan.mapping) {
    if (mapping.unitId !== mapping.originalId || unitCountsByOriginal.get(mapping.originalId) !== 1) continue
    const restored = resumable.get(mapping.originalId)
    if (restored) accepted.set(mapping.unitId, restored)
  }
  const durableBatchState = options.restoredBudget?.perBatch || {}
  const pending: WorkItem[] = plan.batches.flatMap((batch) => {
    const pendingCues = batch.input.cues.filter((cue) => !accepted.has(cue.id))
    if (pendingCues.length === 0) return []
    const pendingIds = new Set(pendingCues.map((cue) => cue.id))
    const firstPendingIndex = batch.input.cues.findIndex((cue) => pendingIds.has(cue.id))
    const lastPendingIndex = batch.input.cues.reduce((last, cue, index) => pendingIds.has(cue.id) ? index : last, -1)
    const restoredContextBefore = firstPendingIndex > 0
      ? batch.input.cues.slice(0, firstPendingIndex).filter((cue) => accepted.has(cue.id))
      : []
    const restoredContextAfter = lastPendingIndex >= 0 && lastPendingIndex < batch.input.cues.length - 1
      ? batch.input.cues.slice(lastPendingIndex + 1).filter((cue) => accepted.has(cue.id))
      : []
    const pendingBatch: PlannedTranslationBatch = {
      ...batch,
      input: {
        ...batch.input,
        cues: pendingCues.map((cue) => ({ ...cue })),
        // Keep already validated neighboring cues as read-only context after
        // filtering resume IDs. This preserves semantic meaning without
        // asking the provider to regenerate or publish those cues.
        contextBefore: [...batch.input.contextBefore, ...restoredContextBefore].map((cue) => ({ ...cue })),
        contextAfter: [...restoredContextAfter, ...batch.input.contextAfter].map((cue) => ({ ...cue }))
      },
      mapping: batch.mapping.filter((mapping) => pendingIds.has(mapping.unitId))
    }
    return [{
      batch: pendingBatch,
      originalBatchId: batch.id,
      requestedIds: pendingCues.map((cue) => cue.id),
      splitDepth: durableBatchState[batch.id]?.splitDepth || 0,
      // A request that was charged before a crash/restart is recovery work on
      // the next invocation. This prevents an idempotent normal charge from
      // bypassing the shared recovery quota after resume.
      kind: options.initialRequestKind || (durableBatchState[batch.id]?.normalCharged ? 'recovery' as const : 'normal' as const)
    } satisfies WorkItem]
  })
  const failures = new Map<string, { fingerprint: string; repeats: number }>()
  const terminalIssues: TranslationIssue[] = [...(plan.unsupported ? plan.warnings : []).map((message) => issue(
    'unsupported-capability',
    message,
    [],
    'unknown',
    plan.unsupported ? 'error' : 'warning'
  ))]
  let modelIdentity = adapter.capability.modelIdentity

  const enqueueRecovery = (work: WorkItem): void => {
    pending.push({ ...work, kind: 'recovery' })
  }

  // A known capability violation is a preflight failure. It must never spend
  // a provider request merely to discover what the planner already proved.
  if (plan.unsupported) pending.length = 0

  while (pending.length > 0) {
    let work = pending.shift()!
    try {
      throwIfAborted(signal)
      const alreadyDone = work.requestedIds.every((id) => accepted.has(id))
      if (alreadyDone) continue
      const dispatchBatch = fitWorkForDispatch(work, adapter.capability)
      if (!dispatchBatch) {
        terminalIssues.push(issue('unsupported-capability', 'Payload dịch/repair vượt giới hạn context đã biết của server.', work.requestedIds))
        continue
      }
      work = { ...work, batch: dispatchBatch }
      if (budget.remainingMs() <= 0) {
        throw new TranslationBudgetExhaustedError('Translation time budget exhausted before dispatch.')
      }
      budget.charge(work.kind, work.originalBatchId)
      await options.beforeDispatch?.(budget.snapshot())
      const { signal: requestSignal, timeoutSignal } = makeRequestSignal(signal, budget.remainingMs())
      let response: Awaited<ReturnType<TranslationAdapter['requestOnce']>>
      try {
        response = await adapter.requestOnce(work.batch, requestSignal)
      } catch (error) {
        const failure = signal.aborted ? { code: 'cancelled' as const, retryable: false, message: 'Translation cancelled.' } : classifyTranslationError(timeoutSignal.aborted
          ? Object.assign(new Error('Translation request timed out.'), { name: 'TimeoutError' })
          : error)
        if (failure.code === 'cancelled') {
          terminalIssues.push(issue('cancelled', 'Dịch đã bị hủy trước khi hoàn tất.', work.requestedIds))
          break
        }
        if (failure.retryable) {
          try {
            const requestKey = `${work.originalBatchId}|${work.requestedIds.join(',')}`
            budget.claimTransportRetry(work.originalBatchId, requestKey)
            const attempt = (work.transportAttempt || 0) + 1
            const sample = (options.random || Math.random)()
            const jitter = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0.5
            const backoff = Math.min(10_000, 1000 * 2 ** Math.min(attempt - 1, 4) * (1 + jitter * 0.5))
            await waitForRetry(failure.retryAfterMs ?? backoff, budget, signal, sleep)
            throwIfAborted(signal)
            enqueueRecovery({ ...work, transportAttempt: attempt })
            continue
          } catch (retryError) {
            if (signal.aborted) {
              terminalIssues.push(issue('cancelled', 'Dịch đã bị hủy khi chờ thử lại.', work.requestedIds))
              break
            }
            terminalIssues.push(issue('budget-exhausted', retryError instanceof Error ? retryError.message : 'Đã hết ngân sách retry.', work.requestedIds))
            break
          }
        }
        terminalIssues.push(issue(failure.code, failure.message, work.requestedIds))
        continue
      }

      modelIdentity = response.modelIdentity || modelIdentity
      const contextIds = [...work.batch.input.contextBefore, ...work.batch.input.contextAfter].map((cue) => cue.id)
      const parsed = parseTranslationResponse(response.raw, adapter.capability.format, work.requestedIds, response.truncated, contextIds)
      const untrustedContent = parsed.issues.some((item) =>
        item.code === 'unparsed-content' || item.code === 'truncated-output' || item.code === 'provider-protocol'
      )
      // A parser can recover IDs from a response while still losing prose
      // after a line break or token cutoff. Such items are never durable.
      const validItems = untrustedContent ? [] : uniqueValidItems(parsed.items, work.requestedIds)
      for (const item of validItems) accepted.set(item.id, item)
      const expectedComplete = validItems.length === work.requestedIds.length
      const blockingParserIssues = parsed.issues.filter((item) => item.severity === 'error' && item.code !== 'missing-id' && item.code !== 'unknown-id')
      const hardParserIssues = parsed.issues.filter((item) => item.severity === 'error')
      const fingerprint = `${work.requestedIds.join(',')}|${parsed.issues.map((item) => item.code).join(',')}|${validItems.map((item) => item.id).join(',')}`
      const previous = failures.get(work.originalBatchId)
      const repeats = previous && previous.fingerprint === fingerprint ? previous.repeats + 1 : 1
      failures.set(work.originalBatchId, { fingerprint, repeats })

      if (expectedComplete && hardParserIssues.length === 0) {
        await options.onBatch?.(work.originalBatchId, {
          items: validItems,
          assessment: assessmentForIssues(parsed.issues, true),
          modelIdentity
        }, budget.snapshot())
        continue
      }

      const missingIds = work.requestedIds.filter((id) => !accepted.has(id))
      if (validItems.length > 0 && !expectedComplete) {
        // Persist the good subset before scheduling recovery. A crash or
        // cancellation after this point can resume from these IDs without
        // asking the provider to regenerate them.
        await options.onBatch?.(work.originalBatchId, {
          items: validItems,
          assessment: assessmentForIssues(parsed.issues, false),
          modelIdentity
        }, budget.snapshot())
      }
      const missingOnly = parsed.issues.length > 0 && parsed.issues.every((item) => item.code === 'missing-id' || (item.code === 'unknown-id' && item.severity === 'warning'))
      if (!response.truncated && blockingParserIssues.length === 0 && missingOnly && validItems.length > 0 && missingIds.length < work.requestedIds.length) {
        const missingCues = work.batch.input.cues.filter((cue) => missingIds.includes(cue.id))
        if (missingCues.length > 0) {
          enqueueRecovery({ ...work, requestedIds: missingIds, batch: { ...work.batch, id: `${work.batch.id}/missing`, input: { ...work.batch.input, cues: missingCues, ...selectTranslationSourceContext(input, missingCues, plan.mapping) }, mapping: work.batch.mapping.filter((mapping) => missingIds.includes(mapping.unitId)) } })
          continue
        }
      }

      const canSplit = work.batch.input.cues.length > 1 && budget.canSplit(work.originalBatchId, work.splitDepth + 1)
      if (canSplit && (response.truncated || validItems.length === 0 || repeats >= 2 || blockingParserIssues.length > 0 || hardParserIssues.length > 0)) {
        try {
          budget.recordSplit(work.originalBatchId, work.splitDepth + 1)
          const midpoint = Math.ceil(work.batch.input.cues.length / 2)
          enqueueRecovery({ ...work, batch: childBatch(work, 0, work.batch.input.cues.slice(0, midpoint), input, plan.mapping), requestedIds: work.batch.input.cues.slice(0, midpoint).map((cue) => cue.id), splitDepth: work.splitDepth + 1 })
          enqueueRecovery({ ...work, batch: childBatch(work, 1, work.batch.input.cues.slice(midpoint), input, plan.mapping), requestedIds: work.batch.input.cues.slice(midpoint).map((cue) => cue.id), splitDepth: work.splitDepth + 1 })
          continue
        } catch (splitError) {
          terminalIssues.push(issue('budget-exhausted', splitError instanceof Error ? splitError.message : 'Không thể chia batch trong ngân sách.', work.requestedIds))
        }
      } else if (blockingParserIssues.length > 0 && work.requestedIds.length > 0) {
        const idSetKey = work.requestedIds.join(',')
        try {
          budget.claimFormatRepair(work.originalBatchId, idSetKey)
          enqueueRecovery({ ...work, batch: { ...work.batch, repairIssues: parsed.issues } })
          continue
        } catch {
          // The next branch records the bounded terminal state.
        }
      }

      terminalIssues.push(...(hardParserIssues.length > 0 ? hardParserIssues : [issue('no-progress', 'Bản dịch không tạo thêm cue hợp lệ; dừng để tránh retry lặp.', work.requestedIds)]))
    } catch (error) {
      if (error instanceof TranslationBudgetExhaustedError) {
        terminalIssues.push(issue('budget-exhausted', error.message, work.requestedIds))
        break
      }
      const failure = classifyTranslationError(error)
      if (failure.code === 'cancelled') terminalIssues.push(issue('cancelled', 'Dịch đã bị hủy.', work.requestedIds))
      else terminalIssues.push(issue(failure.code, failure.message, work.requestedIds))
    }
  }

  const sourceIds = plan.mapping.map((mapping) => mapping.unitId)
  const completeUnits = sourceIds.every((id) => accepted.has(id))
  let restoredItems: TranslationItem[] = []
  if (completeUnits) {
    try {
      restoredItems = restoreOriginalCues(input.cues, [...accepted.values()], plan.mapping, input.targetLocale)
    } catch (error) {
      terminalIssues.push(issue('provider-protocol', error instanceof Error ? error.message : 'Không thể ghép các unit dịch.', input.cues.map((cue) => cue.id)))
    }
  }

  let quality = { issues: [] as TranslationIssue[], languageEvidence: 'unknown' as TranslationAssessment['languageEvidence'] }
  if (completeUnits && restoredItems.length === input.cues.length) {
    quality = assessTranslatedItems(input, restoredItems)
    const repairableIssues = quality.issues.filter((item) =>
      item.severity === 'warning' &&
      (item.code === 'protected-token-suspect' || item.code === 'language-suspect') &&
      item.cueIds.length > 0)
    const repairIds = [...new Set(repairableIssues.flatMap((item) => item.cueIds))]
    if (options.autoRepairContentWarnings !== false && repairIds.length > 0) {
      const selectedCues = input.cues.filter((cue) => repairIds.includes(cue.id))
      if (selectedCues.length > 0) {
        const repairInput: TranslationInput = {
          ...input,
          cues: selectedCues,
          ...selectTranslationSourceContext(input, selectedCues)
        }
        const baseRepairPlan = planTranslation(repairInput, adapter.capability)
        const repairPlan: TranslationPlan = {
          ...baseRepairPlan,
          batches: baseRepairPlan.batches.map((batch, index) => {
            const issueCopies = repairableIssues.flatMap((item) => {
              const cueIds = batch.mapping
                .filter((mapping) => item.cueIds.includes(mapping.originalId))
                .map((mapping) => mapping.unitId)
              return cueIds.length > 0 ? [{ ...item, cueIds }] : []
            })
            return { ...batch, id: `quality-repair-${index + 1}-${batch.id}`, repairIssues: issueCopies }
          })
        }
        const repaired = await translateWithAdapter(repairInput, adapter, signal, {
          plan: repairPlan,
          budget,
          beforeDispatch: options.beforeDispatch,
          sleep,
          random: options.random,
          autoRepairContentWarnings: false,
          initialRequestKind: 'recovery'
        })
        if (repaired.assessment.disposition !== 'needs-review' && repaired.items.length === selectedCues.length) {
          const repairedById = new Map(repaired.items.map((item) => [item.id, item]))
          restoredItems = restoredItems.map((item) => repairedById.get(item.id) || item)
          quality = assessTranslatedItems(input, restoredItems)
          await options.onBatch?.('quality-repair', {
            items: repaired.items,
            assessment: {
              version: 'translation-assessment-v2',
              disposition: quality.issues.length > 0 ? 'with-warnings' : 'validated',
              issues: quality.issues,
              languageEvidence: quality.languageEvidence
            },
            modelIdentity
          }, budget.snapshot())
        }
      }
    }
  }

  const finalIssues = [...terminalIssues]
  let languageEvidence: TranslationAssessment['languageEvidence'] = 'unknown'
  if (completeUnits && restoredItems.length === input.cues.length) {
    finalIssues.push(...quality.issues)
    languageEvidence = quality.languageEvidence
  } else {
    finalIssues.push(issue('missing-id', 'Bản dịch chưa đủ mọi cue nguồn; không xuất bản kết quả một phần.', input.cues.map((cue) => cue.id)))
  }
  const dedupedIssues = uniqueIssues(finalIssues)
  const assessment: TranslationAssessment = {
    version: 'translation-assessment-v2',
    disposition: !completeUnits || dedupedIssues.some((item) => item.severity === 'error') ? 'needs-review' : dedupedIssues.length > 0 ? 'with-warnings' : 'validated',
    issues: dedupedIssues,
    languageEvidence
  }
  return {
    items: completeUnits ? restoredItems : [...accepted.values()],
    assessment,
    modelIdentity,
    plan,
    budget: budget.snapshot()
  }
}
