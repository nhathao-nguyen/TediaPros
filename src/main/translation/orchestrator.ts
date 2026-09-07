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
  beforeDispatch?: (snapshot: TranslationBudgetSnapshot) => Promise<void> | void
  onBatch?: TranslationBatchCallback
  /** Sleep between structured transient retries. Inject a no-op in tests. */
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>
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
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Translation cancelled.')
}

function issue(
  code: TranslationIssue['code'],
  message: string,
  cueIds: readonly string[] = [],
  confidence: TranslationIssue['confidence'] = 'certain'
): TranslationIssue {
  return { code, severity: 'error', cueIds: [...cueIds], confidence, message }
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
  const delay = Math.max(0, Math.ceil(delayMs))
  if (delay === 0) return
  const remaining = budget.remainingMs()
  if (remaining <= delay) throw new TranslationBudgetExhaustedError('Retry-After vượt ngân sách thời gian dịch.')
  await sleep(delay, signal)
}

function childBatch(work: WorkItem, index: number, cues: PlannedTranslationBatch['input']['cues']): PlannedTranslationBatch {
  const selectedIds = new Set(cues.map((cue) => cue.id))
  return {
    id: `${work.batch.id}/split-${index + 1}`,
    input: { ...work.batch.input, cues: cues.map((cue) => ({ ...cue })) },
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
  const plan = options.plan || planTranslation(input, adapter.capability)
  const budget = options.budget || createTranslationBudget(plan.batches.length)
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
  const pending: WorkItem[] = plan.batches.map((batch) => ({
    batch,
    originalBatchId: batch.id,
    requestedIds: batch.input.cues.map((cue) => cue.id),
    splitDepth: 0,
    kind: 'normal'
  }))
  const accepted = new Map<string, TranslationItem>()
  const failures = new Map<string, { fingerprint: string; repeats: number }>()
  const terminalIssues: TranslationIssue[] = [...plan.warnings.map((message) => issue('unsupported-capability', message, [], 'unknown'))]
  let modelIdentity = adapter.capability.modelIdentity

  const enqueueRecovery = (work: WorkItem): void => {
    pending.push({ ...work, kind: 'recovery' })
  }

  while (pending.length > 0) {
    let work = pending.shift()!
    try {
      throwIfAborted(signal)
      const alreadyDone = work.requestedIds.every((id) => accepted.has(id))
      if (alreadyDone) continue
      budget.charge(work.kind, work.originalBatchId)
      await options.beforeDispatch?.(budget.snapshot())
      const { signal: requestSignal, timeoutSignal } = makeRequestSignal(signal, budget.remainingMs())
      let response: Awaited<ReturnType<TranslationAdapter['requestOnce']>>
      try {
        response = await adapter.requestOnce(work.batch, requestSignal)
      } catch (error) {
        const failure = classifyTranslationError(timeoutSignal.aborted && !signal.aborted
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
            await waitForRetry(failure.retryAfterMs ?? 0, budget, signal, sleep)
            enqueueRecovery(work)
            continue
          } catch (retryError) {
            terminalIssues.push(issue('budget-exhausted', retryError instanceof Error ? retryError.message : 'Đã hết ngân sách retry.', work.requestedIds))
            break
          }
        }
        terminalIssues.push(issue(failure.code, failure.message, work.requestedIds))
        continue
      }

      modelIdentity = response.modelIdentity || modelIdentity
      const contextIds = [...input.contextBefore, ...input.contextAfter].map((cue) => cue.id)
      const parsed = parseTranslationResponse(response.raw, adapter.capability.format, work.requestedIds, response.truncated, contextIds)
      const validItems = uniqueValidItems(parsed.items, work.requestedIds)
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
          enqueueRecovery({ ...work, requestedIds: missingIds, batch: { ...work.batch, id: `${work.batch.id}/missing`, input: { ...work.batch.input, cues: missingCues }, mapping: work.batch.mapping.filter((mapping) => missingIds.includes(mapping.unitId)) } })
          continue
        }
      }

      const canSplit = work.batch.input.cues.length > 1 && budget.canSplit(work.originalBatchId, work.splitDepth + 1)
      if (canSplit && (response.truncated || validItems.length === 0 || repeats >= 2 || blockingParserIssues.length > 0 || hardParserIssues.length > 0)) {
        try {
          budget.recordSplit(work.originalBatchId, work.splitDepth + 1)
          const midpoint = Math.ceil(work.batch.input.cues.length / 2)
          enqueueRecovery({ ...work, batch: childBatch(work, 0, work.batch.input.cues.slice(0, midpoint)), requestedIds: work.batch.input.cues.slice(0, midpoint).map((cue) => cue.id), splitDepth: work.splitDepth + 1 })
          enqueueRecovery({ ...work, batch: childBatch(work, 1, work.batch.input.cues.slice(midpoint)), requestedIds: work.batch.input.cues.slice(midpoint).map((cue) => cue.id), splitDepth: work.splitDepth + 1 })
          continue
        } catch (splitError) {
          terminalIssues.push(issue('budget-exhausted', splitError instanceof Error ? splitError.message : 'Không thể chia batch trong ngân sách.', work.requestedIds))
        }
      } else if (blockingParserIssues.length > 0 && work.requestedIds.length > 0) {
        const idSetKey = work.requestedIds.join(',')
        try {
          budget.claimFormatRepair(work.originalBatchId, idSetKey)
          enqueueRecovery(work)
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

  const finalIssues = [...terminalIssues]
  let languageEvidence: TranslationAssessment['languageEvidence'] = 'unknown'
  if (completeUnits && restoredItems.length === input.cues.length) {
    const content = assessContentQuality(sourceSubtitleCues(input), targetSubtitleCues(sourceSubtitleCues(input), restoredItems))
    finalIssues.push(...content.issues)
    const language = assessTranslationLanguage(input, restoredItems)
    finalIssues.push(...language.issues)
    languageEvidence = language.languageEvidence
  } else {
    finalIssues.push(issue('missing-id', 'Bản dịch chưa đủ mọi cue nguồn; không xuất bản kết quả một phần.', input.cues.map((cue) => cue.id)))
  }
  const dedupedIssues = finalIssues.filter((item, index, all) => all.findIndex((candidate) => candidate.code === item.code && candidate.message === item.message && candidate.cueIds.join(',') === item.cueIds.join(',')) === index)
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
