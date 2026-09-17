import { randomBytes, randomUUID } from 'node:crypto'
import {
  GatewayOperationReceipt,
  GatewayOperationStatus,
  GatewaySchedulerStatus,
  operationAction
} from '../shared/gatewayOperation'
import type { ProviderWaitStage } from '../shared/autoShortBatchJournal'
import { readBoundedAiResponseJson, readBoundedAiResponseText } from './aiResponseBody'

export function createGatewayError(status: number, detail: string): Error {
  let errorCode: string | undefined
  let errorMsg: string | undefined
  try {
    const parsed = JSON.parse(detail)
    errorCode = parsed?.error?.code || parsed?.gateway_metadata?.error_code || (typeof parsed?.error === 'string' ? parsed.error : undefined)
    errorMsg = parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : undefined)
  } catch {}

  const message = errorMsg || detail || `Gemini Gateway báo lỗi HTTP ${status}.`
  const isThrottled = status === 429 || status === 405 || /rate limit|quota|too many requests|chống bot/iu.test(message)
  const providerCode = isThrottled ? 'provider-throttled' : (status >= 500 ? 'provider-transient' : 'provider-protocol')
  return Object.assign(new Error(message), {
    status,
    providerCode,
    errorCode
  })
}

export interface SubmitOperationOptions {
  baseUrl: string
  clientRequestId?: string
  operationToken?: string
  requestPayload: unknown
  signal: AbortSignal
  httpTimeoutMs?: number
}

export interface PollOperationOptions {
  baseUrl: string
  operationId: string
  operationToken: string
  signal: AbortSignal
  pollIntervalMs?: number
  onProgress?: (receipt: GatewayOperationReceipt) => void
  expectedClientRequestId?: string
  httpTimeoutMs?: number
  runtime?: GatewayOperationRuntime
  deferOnWaitingProvider?: boolean
}

export interface GetOperationOptions {
  baseUrl: string
  operationId: string
  operationToken: string
  signal: AbortSignal
  expectedClientRequestId?: string
  httpTimeoutMs?: number
}

export interface GatewayOperationRuntime {
  nowMs: () => number
  delay: (ms: number, signal: AbortSignal) => Promise<void>
}

export function isReceiptOutcomeUnknown(receipt: GatewayOperationReceipt): boolean {
  return receipt.status === 'outcome-unknown' ||
    receipt.errorCode === 'outcome-unknown' ||
    receipt.reason === 'outcome-unknown' ||
    Boolean(receipt.error?.includes('outcome-unknown'))
}

export class GatewayOperationDeferredError extends Error {
  readonly providerCode: 'provider-throttled' | 'outcome-unknown'
  readonly operationId: string
  readonly nextEligibleAtUtc: string | null
  readonly reason: string
  /** Set by the adapter after it binds the deferred receipt to a durable stage. */
  stage?: ProviderWaitStage
  /** Queue cancellation callback for the exact durable gateway operation. */
  cancelOperation?: () => Promise<void>

  constructor(readonly receipt: GatewayOperationReceipt) {
    const unknown = isReceiptOutcomeUnknown(receipt)
    super(receipt.reason || (unknown ? 'outcome-unknown' : 'Gateway operation đang chờ provider.'))
    this.name = 'GatewayOperationDeferredError'
    this.providerCode = unknown ? 'outcome-unknown' : 'provider-throttled'
    this.operationId = receipt.id
    this.nextEligibleAtUtc = unknown ? null : (receipt.nextEligibleAtUtc ?? null)
    // The Gateway may preserve the last scheduling reason (for example
    // `spacing`) when an already-dispatched request later becomes unknown.
    // Persist the terminal safety state so resume/recovery does not mistake it
    // for an ordinary timed wait.
    this.reason = unknown ? 'outcome-unknown' : (receipt.reason || receipt.errorCode || receipt.status)
  }
}

/**
 * Preserve a deferred operation across module boundaries and test bundles.
 * `instanceof` alone is not sufficient when a bundler embeds two copies of an
 * Error subclass, so validate the complete durable-operation shape as well.
 */
export function isGatewayOperationDeferredError(error: unknown): error is GatewayOperationDeferredError {
  if (error instanceof GatewayOperationDeferredError) return true
  if (!error || typeof error !== 'object') return false
  const value = error as Record<string, unknown>
  return value.name === 'GatewayOperationDeferredError' &&
    (value.providerCode === 'provider-throttled' || value.providerCode === 'outcome-unknown') &&
    typeof value.operationId === 'string' && value.operationId.trim().length > 0 &&
    (value.nextEligibleAtUtc === null || typeof value.nextEligibleAtUtc === 'string') &&
    typeof value.reason === 'string'
}

const OPERATION_STATUSES = new Set<GatewayOperationStatus>([
  'queued', 'waiting-provider', 'running', 'succeeded', 'failed', 'blocked',
  'cancelling', 'cancelled', 'outcome-unknown'
])
const DISPATCH_STATES = new Set<GatewayOperationReceipt['dispatchState']>([
  'not-dispatched', 'dispatched', 'unknown'
])

function httpDeadline(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const onParentAbort = (): void => controller.abort(parent?.reason)
  if (parent?.aborted) onParentAbort()
  else parent?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Gateway HTTP request timed out.', 'TimeoutError')), Math.max(1, Math.ceil(timeoutMs)))
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer)
      parent?.removeEventListener('abort', onParentAbort)
    }
  }
}

export function generateOperationToken(): string {
  return randomBytes(32).toString('hex')
}

export function generateClientRequestId(): string {
  return randomUUID()
}

export async function submitGatewayOperation(options: SubmitOperationOptions): Promise<GatewayOperationReceipt> {
  const { baseUrl, requestPayload, signal } = options
  const clientRequestId = options.clientRequestId || generateClientRequestId()
  const operationToken = options.operationToken || generateOperationToken()

  const envelope = {
    client_request_id: clientRequestId,
    request: requestPayload
  }

  const deadline = httpDeadline(signal, options.httpTimeoutMs ?? 30_000)
  try {
    const response = await fetch(`${baseUrl}/gateway/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Operation-Token': operationToken
      },
      body: JSON.stringify(envelope),
      signal: deadline.signal
    })

    if (!response.ok && response.status !== 202) {
      const detail = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024).catch(() => '')
      throw createGatewayError(response.status, detail)
    }

    const data = await readBoundedAiResponseJson<Record<string, unknown>>(response, deadline.signal, 64 * 1024)
    return parseOperationReceipt(data, { expectedClientRequestId: clientRequestId })
  } finally {
    deadline.dispose()
  }
}

export async function getGatewayOperation(options: GetOperationOptions): Promise<{
  data: Record<string, unknown>
  receipt: GatewayOperationReceipt
}> {
  const deadline = httpDeadline(options.signal, options.httpTimeoutMs ?? 30_000)
  try {
    const response = await fetch(`${options.baseUrl}/gateway/requests/${encodeURIComponent(options.operationId)}`, {
      method: 'GET',
      headers: { 'X-Operation-Token': options.operationToken },
      signal: deadline.signal
    })
    if (!response.ok) {
      const detail = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024).catch(() => '')
      throw createGatewayError(response.status, detail)
    }
    const data = await readBoundedAiResponseJson<Record<string, unknown>>(response, deadline.signal, 4 * 1024 * 1024)
    return {
      data,
      receipt: parseOperationReceipt(data, {
        expectedClientRequestId: options.expectedClientRequestId,
        expectedOperationId: options.operationId
      })
    }
  } finally {
    deadline.dispose()
  }
}

export async function pollGatewayOperation(options: PollOperationOptions): Promise<unknown> {
  const { baseUrl, operationId, operationToken, signal, pollIntervalMs = 5000, onProgress } = options
  const runtime = options.runtime || { nowMs: () => Date.now(), delay: delayWithSignal }

  while (!signal.aborted) {
    const { data, receipt } = await getGatewayOperation({
      baseUrl,
      operationId,
      operationToken,
      signal,
      expectedClientRequestId: options.expectedClientRequestId,
      httpTimeoutMs: options.httpTimeoutMs
    })

    if (onProgress) {
      onProgress(receipt)
    }

    const deferrableStatus = receipt.status === 'waiting-provider' ||
      receipt.status === 'outcome-unknown' ||
      (receipt.status === 'blocked' && isReceiptOutcomeUnknown(receipt))

    if (deferrableStatus && options.deferOnWaitingProvider) {
      throw new GatewayOperationDeferredError(receipt)
    }

    const action = operationAction(receipt.status)
    if (action === 'consume') {
      return data.response
    }

    if (action === 'stop') {
      const msg = receipt.error || `Gateway operation ended with status: ${receipt.status}`
      const err = new Error(msg)
      Object.assign(err, { providerCode: receipt.errorCode || receipt.status, operationId: receipt.id, receipt })
      throw err
    }

    // action === 'poll'
    let waitTime = pollIntervalMs
    if (receipt.nextEligibleAtUtc) {
      const nextMs = Date.parse(receipt.nextEligibleAtUtc)
      if (Number.isFinite(nextMs)) {
        const delta = nextMs - runtime.nowMs()
        if (delta > waitTime) {
          waitTime = delta
        }
      }
    }
    const step = Math.max(waitTime, 500)
    await runtime.delay(step, signal)
  }

  throw new Error('Đã hủy tác vụ.')
}

export async function cancelGatewayOperation(
  baseUrl: string,
  operationId: string,
  operationToken: string,
  options: { timeoutMs?: number; expectedClientRequestId?: string } = {}
): Promise<GatewayOperationReceipt | undefined> {
  const deadline = httpDeadline(undefined, options.timeoutMs ?? 10_000)
  try {
    const response = await fetch(`${baseUrl}/gateway/requests/${encodeURIComponent(operationId)}/cancel`, {
      method: 'POST',
      headers: { 'X-Operation-Token': operationToken },
      signal: deadline.signal
    })
    if (!response.ok) {
      const detail = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024).catch(() => '')
      throw createGatewayError(response.status, detail)
    }
    if (response.status === 204) return undefined
    const text = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024)
    if (!text.trim()) return undefined
    const data = JSON.parse(text) as Record<string, unknown>
    if (data.id === undefined) return undefined
    return parseOperationReceipt(data, {
      expectedClientRequestId: options.expectedClientRequestId,
      expectedOperationId: operationId
    })
  } finally {
    deadline.dispose()
  }
}

export async function ackGatewayOperation(baseUrl: string, operationId: string, operationToken: string, timeoutMs = 10_000): Promise<void> {
  const deadline = httpDeadline(undefined, timeoutMs)
  try {
    const response = await fetch(`${baseUrl}/gateway/requests/${encodeURIComponent(operationId)}/ack`, {
      method: 'POST',
      headers: { 'X-Operation-Token': operationToken },
      signal: deadline.signal
    })
    if (!response.ok) {
      const detail = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024).catch(() => '')
      throw createGatewayError(response.status, detail)
    }
  } finally {
    deadline.dispose()
  }
}

export async function getGatewaySchedulerStatus(baseUrl: string, signal: AbortSignal): Promise<GatewaySchedulerStatus> {
  const response = await fetch(`${baseUrl}/gateway/scheduler`, { signal })
  if (!response.ok) {
    const detail = await readBoundedAiResponseText(response, signal, 64 * 1024).catch(() => '')
    throw createGatewayError(response.status, detail)
  }
  const data = await readBoundedAiResponseJson<Record<string, unknown>>(response, signal, 64 * 1024)
  return {
    state: (data.state as GatewaySchedulerStatus['state']) || 'ready',
    egressGroup: String(data.egress_group || 'default'),
    activePermits: Number(data.active_permits || 0),
    queuedRequests: Number(data.queued_requests || 0),
    nextEligibleAtUtc: typeof data.next_eligible_at_utc === 'string' ? data.next_eligible_at_utc : null,
    retryAfterSeconds: typeof data.retry_after_seconds === 'number' ? data.retry_after_seconds : undefined,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    revision: Number(data.revision || 0)
  }
}

export function parseOperationReceipt(
  data: Record<string, unknown>,
  expected: { expectedClientRequestId?: string; expectedOperationId?: string } = {}
): GatewayOperationReceipt {
  const id = typeof data.id === 'string' ? data.id.trim() : ''
  const clientRequestId = typeof data.client_request_id === 'string' ? data.client_request_id.trim() : ''
  const status = data.status
  const dispatchState = data.dispatch_state
  const upstreamAttempts = data.upstream_attempts
  const createdAtUtc = data.created_at_utc
  const updatedAtUtc = data.updated_at_utc
  const nextEligibleAtUtc = data.next_eligible_at_utc
  const validDate = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value))

  if (!id || !clientRequestId || !OPERATION_STATUSES.has(status as GatewayOperationStatus) ||
      !DISPATCH_STATES.has(dispatchState as GatewayOperationReceipt['dispatchState']) ||
      typeof upstreamAttempts !== 'number' || !Number.isFinite(upstreamAttempts) || upstreamAttempts < 0 || !Number.isInteger(upstreamAttempts) ||
      !validDate(createdAtUtc) || (updatedAtUtc !== undefined && !validDate(updatedAtUtc)) ||
      (nextEligibleAtUtc !== undefined && nextEligibleAtUtc !== null && !validDate(nextEligibleAtUtc))) {
    throw Object.assign(new Error('Gateway operation receipt không hợp lệ.'), { providerCode: 'provider-protocol' })
  }
  if (expected.expectedClientRequestId && clientRequestId !== expected.expectedClientRequestId) {
    throw Object.assign(new Error('Gateway operation receipt có client_request_id không khớp lease.'), { providerCode: 'provider-protocol' })
  }
  if (expected.expectedOperationId && id !== expected.expectedOperationId) {
    throw Object.assign(new Error('Gateway operation receipt có operation ID không khớp lease.'), { providerCode: 'provider-protocol' })
  }
  return {
    id,
    clientRequestId,
    status: status as GatewayOperationStatus,
    dispatchState: dispatchState as GatewayOperationReceipt['dispatchState'],
    upstreamAttempts,
    createdAtUtc,
    updatedAtUtc: updatedAtUtc as string | undefined,
    nextEligibleAtUtc: nextEligibleAtUtc === null || nextEligibleAtUtc === undefined ? null : nextEligibleAtUtc as string,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
    errorCode: typeof data.error_code === 'string' ? data.error_code : undefined
  }
}

function delayWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error('Đã hủy tác vụ.'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Đã hủy tác vụ.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function resetGatewayScheduler(baseUrl: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/gateway/reset`, { method: 'POST', signal })
    return response.ok
  } catch {
    return false
  }
}
