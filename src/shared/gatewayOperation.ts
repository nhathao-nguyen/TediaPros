export type GatewayOperationStatus =
  | 'queued'
  | 'waiting-provider'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelling'
  | 'cancelled'
  | 'outcome-unknown'

export type OperationAction = 'poll' | 'consume' | 'stop'

export function operationAction(status: GatewayOperationStatus): OperationAction {
  if (status === 'succeeded') return 'consume'
  if (status === 'queued' || status === 'waiting-provider' || status === 'running' || status === 'cancelling') return 'poll'
  return 'stop'
}

export interface GatewayOperationReceipt {
  id: string
  clientRequestId: string
  status: GatewayOperationStatus
  dispatchState: 'not-dispatched' | 'dispatched' | 'unknown'
  upstreamAttempts: number
  createdAtUtc: string
  updatedAtUtc?: string
  nextEligibleAtUtc?: string | null
  reason?: string
  error?: string
  errorCode?: string
}

export interface GatewaySchedulerCapabilities {
  schedulerContractVersion: number
  requestStatus: boolean
  requestJobs: boolean
  maxRequestBodyBytes: number
  egressGroup?: string
}

export interface GatewaySchedulerStatus {
  state: 'ready' | 'running' | 'spacing' | 'cooldown' | 'half-open' | 'blocked'
  egressGroup: string
  activePermits: number
  queuedRequests: number
  nextEligibleAtUtc?: string | null
  retryAfterSeconds?: number
  reason?: string
  revision: number
}
