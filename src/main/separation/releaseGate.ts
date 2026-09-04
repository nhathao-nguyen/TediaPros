import bundledStatus from '../../../distribution/separator-release-status.json'

export type SeparatorVendorStatus = 'pending' | 'verified' | 'beta'

export interface SeparatorReleaseStatus {
  schemaVersion: 1
  qualificationPassed: boolean
  enabledByDefault: boolean
  vendors: Record<'nvidia' | 'amd' | 'intel' | 'cpu', SeparatorVendorStatus>
  qualificationReport: string
}

export function validateSeparatorReleaseStatus(raw: unknown): SeparatorReleaseStatus {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Separator release status must be an object.')
  }
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== 1) {
    throw new Error(`Invalid schemaVersion: expected 1, got ${r.schemaVersion}`)
  }
  if (typeof r.qualificationPassed !== 'boolean') {
    throw new Error('qualificationPassed must be a boolean.')
  }
  if (typeof r.enabledByDefault !== 'boolean') {
    throw new Error('enabledByDefault must be a boolean.')
  }
  if (!r.vendors || typeof r.vendors !== 'object') {
    throw new Error('vendors must be an object.')
  }
  const v = r.vendors as Record<string, unknown>
  const requiredVendors = ['nvidia', 'amd', 'intel', 'cpu'] as const
  for (const vendor of requiredVendors) {
    if (v[vendor] !== 'pending' && v[vendor] !== 'verified' && v[vendor] !== 'beta') {
      throw new Error(`Invalid vendor status for ${vendor}: ${v[vendor]}`)
    }
  }
  if (typeof r.qualificationReport !== 'string' || !r.qualificationReport) {
    throw new Error('qualificationReport must be a non-empty string.')
  }
  return {
    schemaVersion: 1,
    qualificationPassed: r.qualificationPassed,
    enabledByDefault: r.enabledByDefault,
    vendors: {
      nvidia: v.nvidia as SeparatorVendorStatus,
      amd: v.amd as SeparatorVendorStatus,
      intel: v.intel as SeparatorVendorStatus,
      cpu: v.cpu as SeparatorVendorStatus
    },
    qualificationReport: r.qualificationReport
  }
}

export function loadSeparatorReleaseStatus(): SeparatorReleaseStatus {
  return validateSeparatorReleaseStatus(bundledStatus)
}

export function separatorFeatureEnabled(
  status: SeparatorReleaseStatus,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    status.qualificationPassed &&
    (status.enabledByDefault || env.TEDIAPROS_ENABLE_SEPARATOR === '1')
  )
}
