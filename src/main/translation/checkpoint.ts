import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative } from 'node:path'
import type { TranslationAssessment, TranslationBatchResult, TranslationInput } from '../../shared/translation'
import { parseAiJsonObject } from '../../shared/aiOutput'
import { assertContainedParentDirectory, assertContainedRegularFile } from '../safeContainedPath'
import { canonicalJson } from '../autoShortStageKeys'
import { createTranslationBudget, type TranslationBudgetSnapshot } from './budget'
import { TRANSLATION_PLAN_VERSION, type TranslationPlan } from './planner'

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
const MAX_CHECKPOINT_BYTES = 2 * 1024 * 1024
const MAX_CHECKPOINT_COLLECTION = 10_000

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
    cues: input.cues.map((cue) => ({
      id: cue.id,
      sourceIndex: cue.sourceIndex,
      start: cue.start,
      end: cue.end,
      groupId: cue.groupId,
      text: cue.text,
      ...(cue.speakingDuration === undefined ? {} : { speakingDuration: cue.speakingDuration })
    })),
    contextBefore: input.contextBefore.map((cue) => ({ id: cue.id, sourceIndex: cue.sourceIndex, start: cue.start, end: cue.end, groupId: cue.groupId, text: cue.text })),
    contextAfter: input.contextAfter.map((cue) => ({ id: cue.id, sourceIndex: cue.sourceIndex, start: cue.start, end: cue.end, groupId: cue.groupId, text: cue.text })),
    glossary: input.glossary.map((entry) => ({ source: entry.source, target: entry.target })),
    synopsis: input.synopsis || ''
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

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, allowed: readonly string[], required = allowed): boolean {
  const keys = Object.keys(value)
  return keys.every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(value, key))
}

function finite(value: unknown, integer = false): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!integer || Number.isInteger(value))
}

function stringArray(value: unknown, allowEmpty = true): value is string[] {
  return Array.isArray(value) && value.length <= MAX_CHECKPOINT_COLLECTION &&
    (allowEmpty || value.length > 0) && value.every((item) => typeof item === 'string' && item.length > 0)
}

function validCue(value: unknown): boolean {
  if (!record(value) || !exact(value,
    ['id', 'sourceIndex', 'start', 'end', 'text', 'groupId', 'speakingDuration'],
    ['id', 'sourceIndex', 'start', 'end', 'text', 'groupId'])) return false
  return typeof value.id === 'string' && value.id.trim().length > 0 && finite(value.sourceIndex, true) &&
    finite(value.start) && finite(value.end) && value.end >= value.start &&
    typeof value.text === 'string' && value.text.trim().length > 0 &&
    typeof value.groupId === 'string' && value.groupId.trim().length > 0 &&
    (value.speakingDuration === undefined || finite(value.speakingDuration))
}

function validInput(value: unknown): boolean {
  if (!record(value) || !exact(value,
    ['sourceLanguage', 'targetLocale', 'mode', 'cues', 'contextBefore', 'contextAfter', 'sourceSpeechGroups', 'glossary', 'synopsis'],
    ['sourceLanguage', 'targetLocale', 'mode', 'cues', 'contextBefore', 'contextAfter', 'glossary'])) return false
  const cueArray = (candidate: unknown, allowEmpty: boolean): boolean =>
    Array.isArray(candidate) && candidate.length <= MAX_CHECKPOINT_COLLECTION &&
    (allowEmpty || candidate.length > 0) && candidate.every(validCue)
  if (typeof value.sourceLanguage !== 'string' || !value.sourceLanguage.trim() ||
      typeof value.targetLocale !== 'string' || !value.targetLocale.trim() ||
      !['subtitle', 'dubbing'].includes(String(value.mode)) ||
      !cueArray(value.cues, false) || !cueArray(value.contextBefore, true) || !cueArray(value.contextAfter, true) ||
      !Array.isArray(value.glossary) || value.glossary.length > 50 ||
      !value.glossary.every((item) => record(item) && exact(item, ['source', 'target']) &&
        typeof item.source === 'string' && item.source.trim().length > 0 && typeof item.target === 'string' && item.target.trim().length > 0) ||
      (value.synopsis !== undefined && (typeof value.synopsis !== 'string' || value.synopsis.length > 2_000))) return false
  if (value.sourceSpeechGroups !== undefined) {
    if (!Array.isArray(value.sourceSpeechGroups) || value.sourceSpeechGroups.length > MAX_CHECKPOINT_COLLECTION ||
      !value.sourceSpeechGroups.every((group) => record(group) && exact(group, ['id', 'cues']) &&
        typeof group.id === 'string' && group.id.trim().length > 0 && cueArray(group.cues, false))) return false
  }
  return true
}

function validIssue(value: unknown): boolean {
  if (!record(value) || !exact(value, ['code', 'severity', 'cueIds', 'confidence', 'message'])) return false
  return ['invalid-source', 'missing-id', 'duplicate-id', 'unknown-id', 'empty-text', 'unparsed-content',
    'truncated-output', 'protected-token-suspect', 'language-suspect', 'unsupported-capability',
    'budget-exhausted', 'no-progress', 'provider-auth', 'provider-transient', 'provider-protocol', 'cancelled'].includes(String(value.code)) &&
    ['error', 'warning'].includes(String(value.severity)) && stringArray(value.cueIds) &&
    ['certain', 'heuristic', 'unknown'].includes(String(value.confidence)) &&
    typeof value.message === 'string' && value.message.length > 0
}

function validAssessment(value: unknown): value is TranslationAssessment {
  if (!record(value) || !exact(value, ['version', 'disposition', 'issues', 'languageEvidence'])) return false
  return value.version === 'translation-assessment-v2' &&
    ['validated', 'with-warnings', 'needs-review'].includes(String(value.disposition)) &&
    Array.isArray(value.issues) && value.issues.length <= MAX_CHECKPOINT_COLLECTION && value.issues.every(validIssue) &&
    ['matched', 'suspect', 'unknown'].includes(String(value.languageEvidence))
}

function validMapping(value: unknown): boolean {
  if (!record(value) || !exact(value, ['unitId', 'originalId', 'partIndex', 'startOffset', 'endOffset'])) return false
  return typeof value.unitId === 'string' && value.unitId.length > 0 &&
    typeof value.originalId === 'string' && value.originalId.length > 0 &&
    finite(value.partIndex, true) && value.partIndex >= 1 && finite(value.startOffset, true) &&
    finite(value.endOffset, true) && value.endOffset >= value.startOffset
}

function validPlan(value: unknown): value is TranslationPlan {
  if (!record(value) || !exact(value, ['planVersion', 'batches', 'mapping', 'warnings', 'unsupported'])) return false
  if (value.planVersion !== TRANSLATION_PLAN_VERSION || !Array.isArray(value.batches) || value.batches.length < 1 ||
      value.batches.length > MAX_CHECKPOINT_COLLECTION || !Array.isArray(value.mapping) ||
      value.mapping.length > MAX_CHECKPOINT_COLLECTION || !value.mapping.every(validMapping) ||
      !stringArray(value.warnings) || typeof value.unsupported !== 'boolean') return false
  const ids = new Set<string>()
  return value.batches.every((batch) => {
    if (!record(batch) || !exact(batch, ['repairIssues', 'id', 'input', 'maxOutputTokens', 'mapping'], ['id', 'input', 'maxOutputTokens', 'mapping']) ||
        typeof batch.id !== 'string' || !batch.id.trim() || ids.has(batch.id) || !validInput(batch.input) ||
        !finite(batch.maxOutputTokens, true) || batch.maxOutputTokens < 1 ||
        !Array.isArray(batch.mapping) || batch.mapping.length > MAX_CHECKPOINT_COLLECTION || !batch.mapping.every(validMapping) ||
        (batch.repairIssues !== undefined && (!Array.isArray(batch.repairIssues) || batch.repairIssues.length > MAX_CHECKPOINT_COLLECTION || !batch.repairIssues.every(validIssue)))) return false
    ids.add(batch.id)
    return true
  })
}

function validBatchResult(value: unknown): value is TranslationBatchResult {
  if (!record(value) || !exact(value, ['items', 'assessment', 'modelIdentity']) ||
      !Array.isArray(value.items) || value.items.length > MAX_CHECKPOINT_COLLECTION ||
      !validAssessment(value.assessment) || typeof value.modelIdentity !== 'string' || !value.modelIdentity.trim()) return false
  const ids = new Set<string>()
  return value.items.every((item) => {
    if (!record(item) || !exact(item, ['id', 'text']) || typeof item.id !== 'string' || !item.id.trim() ||
        ids.has(item.id) || typeof item.text !== 'string' || !item.text.trim()) return false
    ids.add(item.id)
    return true
  })
}

function validBudget(value: unknown, plannedBatches: number): value is TranslationBudgetSnapshot {
  if (!record(value) || !exact(value,
    ['limitsEnforced', 'plannedRequests', 'recoveryLimit', 'normalUsed', 'recoveryUsed', 'activeElapsedMs', 'activeBudgetMs', 'perBatch'],
    ['plannedRequests', 'recoveryLimit', 'normalUsed', 'recoveryUsed', 'activeElapsedMs', 'activeBudgetMs', 'perBatch'])) return false
  if ((value.limitsEnforced !== undefined && typeof value.limitsEnforced !== 'boolean') ||
      !finite(value.plannedRequests, true) || value.plannedRequests < plannedBatches ||
      !finite(value.recoveryLimit, true) || !finite(value.normalUsed, true) || !finite(value.recoveryUsed, true) ||
      !finite(value.activeElapsedMs) || !finite(value.activeBudgetMs) || !record(value.perBatch) ||
      Object.keys(value.perBatch).length > MAX_CHECKPOINT_COLLECTION) return false
  for (const [batchId, state] of Object.entries(value.perBatch)) {
    if (!batchId.trim() || !record(state) || !exact(state, ['normalCharged', 'recoveryUsed', 'splitDepth', 'repairSets', 'transportRetries']) ||
        typeof state.normalCharged !== 'boolean' || !finite(state.recoveryUsed, true) || !finite(state.splitDepth, true) ||
        !stringArray(state.repairSets) || !record(state.transportRetries) || Object.keys(state.transportRetries).length > MAX_CHECKPOINT_COLLECTION ||
        !Object.entries(state.transportRetries).every(([key, count]) => key.length > 0 && finite(count, true))) return false
  }
  try {
    createTranslationBudget(plannedBatches, () => 0, value as unknown as TranslationBudgetSnapshot, value.limitsEnforced === true)
    return true
  } catch {
    return false
  }
}

function validCheckpoint(value: unknown): value is TranslationCheckpoint {
  if (!record(value) || !exact(value,
    ['schemaVersion', 'key', 'generation', 'plan', 'batches', 'budget', 'failures', 'disposition', 'inFlight', 'assessment'],
    ['schemaVersion', 'key', 'generation', 'plan', 'batches', 'budget', 'failures', 'disposition'])) return false
  if (value.schemaVersion !== 2 || typeof value.key !== 'string' || !/^[a-f0-9]{64}$/iu.test(value.key) ||
      !finite(value.generation, true) || !validPlan(value.plan) || !record(value.batches) ||
      Object.keys(value.batches).length > MAX_CHECKPOINT_COLLECTION || !Object.values(value.batches).every(validBatchResult) ||
      !validBudget(value.budget, value.plan.batches.length) || !record(value.failures) ||
      Object.keys(value.failures).length > MAX_CHECKPOINT_COLLECTION ||
      !['running', 'validated', 'with-warnings', 'needs-review', 'error', 'cancelled'].includes(String(value.disposition)) ||
      (value.assessment !== undefined && !validAssessment(value.assessment))) return false
  for (const [batchId, failure] of Object.entries(value.failures)) {
    if (!batchId.trim() || !record(failure) || !exact(failure, ['fingerprint', 'repeats', 'requestedIds']) ||
        typeof failure.fingerprint !== 'string' || !failure.fingerprint || !finite(failure.repeats, true) ||
        !stringArray(failure.requestedIds)) return false
  }
  return value.inFlight === undefined || (record(value.inFlight) && exact(value.inFlight, ['originalBatchId', 'chargedAt', 'timeoutMs']) &&
    typeof value.inFlight.originalBatchId === 'string' && value.inFlight.originalBatchId.trim().length > 0 &&
    finite(value.inFlight.chargedAt) && finite(value.inFlight.timeoutMs) && value.inFlight.timeoutMs > 0)
}

async function readBoundedUtf8(path: string): Promise<string | null> {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (info.size > MAX_CHECKPOINT_BYTES) return null
    const buffer = Buffer.alloc(MAX_CHECKPOINT_BYTES + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset > MAX_CHECKPOINT_BYTES) return null
    return buffer.subarray(0, offset).toString('utf8')
  } finally {
    await file.close()
  }
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
  const content = await readBoundedUtf8(contained)
  if (content === null) return null
  let parsed: unknown
  try {
    parseAiJsonObject(content, {
      allowFence: false,
      allowProseObject: false,
      limits: {
        maxBytes: MAX_CHECKPOINT_BYTES,
        maxDepth: 32,
        maxMembers: 100_000,
        maxCandidates: 1
      }
    })
    // Keep the persisted domain object on the ordinary Object prototype;
    // the strict parser above is the security/grammar gate and intentionally
    // constructs null-prototype records for untrusted AI responses.
    parsed = JSON.parse(content) as unknown
  } catch {
    return null
  }
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
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(tempPath, 'wx')
    await file.writeFile(JSON.stringify(data, null, 2), 'utf8')
    await file.sync()
    await file.close()
    file = undefined
    await rename(tempPath, path)
  } finally {
    await file?.close().catch(() => {})
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
  // A manual retry is a new generation for UI/state purposes. Preserve durable
  // accounting even while quota enforcement is temporarily disabled; the
  // active budget policy decides whether these counters limit dispatch.
  return next
}
