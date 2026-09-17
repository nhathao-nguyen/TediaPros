import { readFile, readdir, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { ProviderWaitRecord } from '../shared/autoShortBatchJournal'
import { assertContainedRegularFile } from './safeContainedPath'
import { ackGatewayOperation, getGatewayOperation, getGatewaySchedulerStatus, isReceiptOutcomeUnknown, resetGatewayScheduler } from './geminiGatewayOperations'

async function findOperationLease(draftDir: string, wait: ProviderWaitRecord): Promise<{ path: string; lease: Record<string, unknown> }> {
  const fileName = `${wait.stage}-operation.json`
  const candidateDirs = [draftDir]
  const entries = await readdir(draftDir, { withFileTypes: true }).catch(() => [])
  candidateDirs.push(...entries
    .filter((entry) => entry.isDirectory() && /^chunk-\d{3}$/u.test(entry.name))
    .map((entry) => join(draftDir, entry.name)))
  for (const candidateDir of candidateDirs) {
    const names: string[] = await readdir(candidateDir).catch((): string[] => [])
    if (!names.includes(fileName)) continue
    const path = await assertContainedRegularFile(join(candidateDir, fileName), draftDir, 'Gateway operation lease')
    const lease = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    if (lease.schemaVersion === 1 && lease.stage === wait.stage && lease.operationId === wait.operationId) return { path, lease }
  }
  throw new Error('Operation cần phục hồi không khớp checkpoint.')
}

/** Only called by an explicit resume/retry action, never by a polling loop. */
export async function recoverUnknownGatewayOperation(baseUrl: string, draftDir: string, wait: ProviderWaitRecord): Promise<void> {
  if (!['restore-translate', 'independent-review', 'restoration-draft', 'restoration-review', 'rephrase', 'metadata'].includes(wait.stage)) {
    throw new Error('Gateway recovery stage không hợp lệ.')
  }
  const located = await findOperationLease(draftDir, wait)
  const leasePath = located.path
  const lease = located.lease
  if (lease.schemaVersion !== 1 || lease.stage !== wait.stage || lease.operationId !== wait.operationId ||
      typeof lease.operationToken !== 'string' || !lease.operationToken || typeof lease.clientRequestId !== 'string' || !lease.clientRequestId) {
    throw new Error('Operation cần phục hồi không khớp checkpoint.')
  }
  const signal = AbortSignal.timeout(30_000)
  const { receipt } = await getGatewayOperation({ baseUrl, operationId: lease.operationId, operationToken: lease.operationToken,
    expectedClientRequestId: lease.clientRequestId, signal })
  if (receipt.status === 'succeeded') return // Consume the existing result on resume.
  const isUnknown = receipt.status === 'outcome-unknown' ||
    (receipt.status === 'blocked' && isReceiptOutcomeUnknown(receipt))
  if (!isUnknown) throw new Error('Operation đã thay đổi trạng thái; hãy tải lại batch trước khi tiếp tục.')
  const scheduler = await getGatewaySchedulerStatus(baseUrl, signal)
  if (scheduler.activePermits !== 0 || scheduler.queuedRequests !== 0 ||
      (scheduler.state === 'blocked' && !['outcome-unknown', 'recovered-from-store'].includes(scheduler.reason || ''))) {
    throw new Error('Gateway đang bận hoặc bị khóa vì lý do khác; chưa thể thử lại operation này.')
  }
  if (scheduler.state === 'blocked' && !await resetGatewayScheduler(baseUrl, signal)) throw new Error('Không khôi phục được Gateway.')
  await ackGatewayOperation(baseUrl, lease.operationId, lease.operationToken)
  // Retain the old lease for diagnosis; the next explicit run gets a fresh ID.
  await rename(leasePath, join(dirname(leasePath), `${wait.stage}-operation.abandoned-${randomUUID()}.json`))
}
