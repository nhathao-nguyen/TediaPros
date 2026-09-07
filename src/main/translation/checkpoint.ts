import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative } from 'node:path'
import type { TranslationAssessment, TranslationBatchResult, TranslationInput } from '../../shared/translation'
import { assertContainedParentDirectory, assertContainedRegularFile } from '../safeContainedPath'
import { canonicalJson } from '../autoShortStageKeys'
import type { TranslationBudgetSnapshot } from './budget'
import type { TranslationPlan } from './planner'

export interface TranslationIdentity {
  provider: string
  modelIdentity: string
  revisionKnown: boolean
  profileId: string
  promptVersion: string
  parserVersion: string
  plannerVersion: string
  assessmentVersion: string
  options: Record<string, unknown>
}

export interface TranslationArtifact {
  schemaVersion: 2
  key: string
  modelIdentity: string
  result: TranslationBatchResult
}

export interface TranslationCheckpoint {
  schemaVersion: 2
  key: string
  generation: number
  plan: TranslationPlan
  batches: Record<string, TranslationBatchResult>
  budget: TranslationBudgetSnapshot
  failures: Record<string, { fingerprint: string; repeats: number; requestedIds: string[] }>
  disposition: 'running' | 'validated' | 'with-warnings' | 'needs-review' | 'error' | 'cancelled'
  inFlight?: { originalBatchId: string; chargedAt: number; timeoutMs: number }
  assessment?: TranslationAssessment
}

const SECRET_KEY = /(?:api[_-]?key|authorization|bearer|token|password|secret|credential)/iu

function sanitizeIdentityValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[redacted]'
  if (Array.isArray(value)) return value.map((item) => sanitizeIdentityValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, sanitizeIdentityValue(childValue, childKey)]))
  }
  return value
}

/** Build an opaque key that includes ordered cue text/timing and policy identity. */
export function buildTranslationIdentity(input: TranslationInput, identity: TranslationIdentity): string {
  const canonicalInput = {
    sourceLanguage: input.sourceLanguage,
    targetLocale: input.targetLocale,
    mode: input.mode,
    cues: input.cues.map((cue) => ({ id: cue.id, sourceIndex: cue.sourceIndex, start: cue.start, end: cue.end, groupId: cue.groupId, text: cue.text })),
    contextBefore: input.contextBefore.map((cue) => ({ id: cue.id, sourceIndex: cue.sourceIndex, start: cue.start, end: cue.end, groupId: cue.groupId, text: cue.text })),
    contextAfter: input.contextAfter.map((cue) => ({ id: cue.id, sourceIndex: cue.sourceIndex, start: cue.start, end: cue.end, groupId: cue.groupId, text: cue.text })),
    glossary: input.glossary.map((entry) => ({ source: entry.source, target: entry.target }))
  }
  const canonicalIdentity = {
    provider: identity.provider,
    modelIdentity: identity.modelIdentity,
    revisionKnown: identity.revisionKnown,
    profileId: identity.profileId,
    promptVersion: identity.promptVersion,
    parserVersion: identity.parserVersion,
    plannerVersion: identity.plannerVersion,
    assessmentVersion: identity.assessmentVersion,
    options: sanitizeIdentityValue(identity.options || {})
  }
  return createHash('sha256').update(canonicalJson({ schemaVersion: 2, input: canonicalInput, identity: canonicalIdentity })).digest('hex')
}

function validCheckpoint(value: unknown): value is TranslationCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const raw = value as Record<string, unknown>
  return raw.schemaVersion === 2 && typeof raw.key === 'string' && /^[a-f0-9]{64}$/iu.test(raw.key) &&
    Number.isInteger(raw.generation) && (raw.generation as number) >= 0 &&
    raw.plan !== null && typeof raw.plan === 'object' &&
    raw.batches !== null && typeof raw.batches === 'object' &&
    raw.budget !== null && typeof raw.budget === 'object' &&
    raw.failures !== null && typeof raw.failures === 'object' &&
    ['running', 'validated', 'with-warnings', 'needs-review', 'error', 'cancelled'].includes(String(raw.disposition))
}

export async function readTranslationCheckpoint(path: string, root: string, key: string): Promise<TranslationCheckpoint | null> {
  if (!isAbsolute(path) || !isAbsolute(root)) throw new Error('Translation checkpoint paths must be absolute.')
  let contained: string
  try {
    contained = await assertContainedRegularFile(path, root, 'translation checkpoint')
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' || /file không tồn tại/iu.test(String((error as Error)?.message || error))) return null
    throw error
  }
  const parsed = JSON.parse(await readFile(contained, 'utf8')) as unknown
  if (!validCheckpoint(parsed) || parsed.key !== key) return null
  return parsed
}

export async function writeTranslationCheckpoint(path: string, root: string, data: TranslationCheckpoint): Promise<void> {
  if (!isAbsolute(path) || !isAbsolute(root)) throw new Error('Translation checkpoint paths must be absolute.')
  if (!validCheckpoint(data)) throw new Error('Invalid translation checkpoint payload.')
  await mkdir(root, { recursive: true })
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  const rootRelative = relative(root, path)
  if (!rootRelative || rootRelative.startsWith('..') || isAbsolute(rootRelative)) throw new Error('Translation checkpoint path escapes its scope.')
  await assertContainedParentDirectory(path, root, 'translation checkpoint')
  const tempPath = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8')
    await rename(tempPath, path)
  } finally {
    await rm(tempPath, { force: true }).catch(() => {})
  }
}

export function createTranslationRetryGeneration(checkpoint: TranslationCheckpoint): TranslationCheckpoint {
  const next: TranslationCheckpoint = JSON.parse(JSON.stringify(checkpoint)) as TranslationCheckpoint
  next.generation += 1
  next.disposition = 'running'
  next.failures = {}
  next.inFlight = undefined
  next.assessment = undefined
  next.budget = {
    ...next.budget,
    recoveryUsed: 0,
    activeElapsedMs: 0,
    perBatch: Object.fromEntries(Object.entries(next.budget.perBatch).map(([id, state]) => [id, {
      ...state,
      recoveryUsed: 0,
      splitDepth: 0,
      repairSets: [],
      transportRetries: {}
    }]))
  }
  return next
}
