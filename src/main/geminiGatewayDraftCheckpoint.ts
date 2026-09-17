import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import { AI_OUTPUT_PARSER_VERSION, assertExactKeys, parseAiJsonObject } from '../shared/aiOutput'
import type { TranslationInput } from '../shared/translation'

export const GATEWAY_DRAFT_FILENAME = 'gemini-gateway-draft.json'
export const GATEWAY_REVIEW_FILENAME = 'gemini-gateway-review.json'
/** The draft is an intermediate JSON response, not a video artifact. */
export const MAX_GATEWAY_DRAFT_RAW_BYTES = 1024 * 1024 // 1 MiB normalized model JSON
/** JSON escaping can expand raw text, so the durable envelope gets headroom. */
export const MAX_GATEWAY_DRAFT_BYTES = 2 * 1024 * 1024 // 2 MiB envelope
export const GATEWAY_DRAFT_SCHEMA_VERSION = 2
export const GATEWAY_DRAFT_PARSER_VERSION = `${AI_OUTPUT_PARSER_VERSION}:gateway-draft-v2`

export interface GatewayDraftRecord {
  schemaVersion: typeof GATEWAY_DRAFT_SCHEMA_VERSION
  state: 'draft-validated'
  identity: string
  raw: string
  rawSha256: string
  observedModelId: string
  /** Label is optional upstream evidence; null records its actual absence. */
  observedModel: string | null
  routeFingerprint: string
  sourceDigest: string
  expectedIds: string[]
  targetLocale: string
  draftPromptVersion: string
  reviewPromptVersion: string
  parserVersion: string
  savedAtUtc: string
}

export interface GatewayDraftExpectation {
  identity: string
  sourceDigest: string
  expectedIds: readonly string[]
  targetLocale: string
  draftPromptVersion: string
  reviewPromptVersion: string
  parserVersion: string
  /** Current account-scoped route fingerprint obtained from capabilities. */
  routeFingerprint: string
}

export interface GatewayReviewRecord {
  schemaVersion: 1
  state: 'review-validated'
  identity: string
  raw: string
  rawSha256: string
  observedModelId: string
  observedModel: string | null
  routeFingerprint: string
  sourceDigest: string
  expectedIds: string[]
  targetLocale: string
  promptVersion: string
  parserVersion: string
  savedAtUtc: string
}

export interface GatewayReviewExpectation {
  identity: string
  sourceDigest: string
  expectedIds: readonly string[]
  targetLocale: string
  promptVersion: string
  parserVersion: string
  /** Current account-scoped route fingerprint obtained from capabilities. */
  routeFingerprint: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/iu.test(value)
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function validExpectedIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 1_000 &&
    value.every(nonEmptyString) && new Set(value).size === value.length
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function validateCompactDraft(raw: unknown, expectedIds: readonly string[]): raw is string {
  if (!nonEmptyString(raw) || Buffer.byteLength(raw, 'utf8') > MAX_GATEWAY_DRAFT_RAW_BYTES) return false
  try {
    const parsed = parseAiJsonObject(raw, {
      allowFence: false,
      allowProseObject: false,
      limits: {
        maxBytes: MAX_GATEWAY_DRAFT_RAW_BYTES,
        maxDepth: 8,
        maxMembers: Math.max(64, expectedIds.length + 8),
        maxCandidates: 1
      }
    }).value
    assertExactKeys(parsed, ['translations'])
    if (!parsed.translations || typeof parsed.translations !== 'object' || Array.isArray(parsed.translations)) return false
    const translations = parsed.translations as Record<string, unknown>
    const actualIds = Object.keys(translations)
    if (actualIds.length !== expectedIds.length || actualIds.some((id) => !expectedIds.includes(id))) return false
    return actualIds.every((id) => nonEmptyString(translations[id]))
  } catch {
    return false
  }
}

function isValidRecord(value: unknown): value is GatewayDraftRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = [
    'schemaVersion', 'state', 'identity', 'raw', 'rawSha256', 'observedModelId', 'observedModel',
    'routeFingerprint', 'sourceDigest', 'expectedIds', 'targetLocale', 'draftPromptVersion',
    'reviewPromptVersion', 'parserVersion', 'savedAtUtc'
  ]
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) return false
  if (record.schemaVersion !== GATEWAY_DRAFT_SCHEMA_VERSION || record.state !== 'draft-validated') return false
  if (!nonEmptyString(record.identity) || !nonEmptyString(record.observedModelId) ||
      (record.observedModel !== null && !nonEmptyString(record.observedModel)) ||
      !isSha256(record.routeFingerprint) || !isSha256(record.sourceDigest) || !isSha256(record.rawSha256) ||
      !nonEmptyString(record.targetLocale) || !nonEmptyString(record.draftPromptVersion) ||
      !nonEmptyString(record.reviewPromptVersion) || !nonEmptyString(record.parserVersion) || !validTimestamp(record.savedAtUtc) ||
      !validExpectedIds(record.expectedIds) || !validateCompactDraft(record.raw, record.expectedIds)) return false
  return sha256(record.raw) === record.rawSha256
}

function matchesExpectation(record: GatewayDraftRecord, expected: GatewayDraftExpectation): boolean {
  return record.identity === expected.identity &&
    record.sourceDigest === expected.sourceDigest &&
    sameIds(record.expectedIds, expected.expectedIds) &&
    record.targetLocale === expected.targetLocale &&
    record.draftPromptVersion === expected.draftPromptVersion &&
    record.reviewPromptVersion === expected.reviewPromptVersion &&
    record.parserVersion === expected.parserVersion &&
    record.routeFingerprint === expected.routeFingerprint
}

async function readBoundedUtf8(path: string): Promise<string | null> {
  const handle = await open(path, 'r')
  try {
    const stats = await handle.stat()
    if (!Number.isSafeInteger(stats.size) || stats.size < 1 || stats.size > MAX_GATEWAY_DRAFT_BYTES) return null
    const buffer = Buffer.alloc(stats.size)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) return null
      offset += bytesRead
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } catch {
      return null
    }
  } finally {
    await handle.close()
  }
}

export function calculateGatewaySourceDigest(input: TranslationInput): string {
  const payload = {
    sourceLanguage: input.sourceLanguage || 'auto',
    targetLocale: input.targetLocale,
    mode: input.mode,
    ...(input.sourceVideoDuration === undefined ? {} : { sourceVideoDuration: input.sourceVideoDuration }),
    glossary: input.glossary || [],
    synopsis: input.synopsis || '',
    cues: input.cues.map((c) => ({
      id: c.id,
      sourceIndex: c.sourceIndex,
      start: c.start,
      end: c.end,
      ...(c.speakingDuration === undefined ? {} : { speakingDuration: c.speakingDuration }),
      text: c.text,
      groupId: c.groupId
    }))
  }
  return sha256(JSON.stringify(payload))
}

/** Return only an exact, current draft. Every mismatch is a safe cache miss. */
export async function readGatewayDraft(
  dir: string,
  expected: GatewayDraftExpectation
): Promise<GatewayDraftRecord | null> {
  if (!dir || !isAbsolute(dir)) return null
  const targetPath = join(dir, GATEWAY_DRAFT_FILENAME)
  try {
    const contained = await assertContainedRegularFile(targetPath, dir, 'readGatewayDraft')
    const content = await readBoundedUtf8(contained)
    if (content === null) return null
    // Strict parsing rejects duplicate decoded fields, prose and malformed JSON
    // before JSON.parse constructs the persisted domain object.
    parseAiJsonObject(content, {
      allowFence: false,
      allowProseObject: false,
      limits: { maxBytes: MAX_GATEWAY_DRAFT_BYTES, maxDepth: 16, maxMembers: 2_000, maxCandidates: 1 }
    })
    const parsed = JSON.parse(content) as unknown
    if (!isValidRecord(parsed) || !matchesExpectation(parsed, expected)) return null
    return parsed
  } catch {
    // Missing file, traversal block, malformed/corrupt content and stale
    // records are all cache misses. They never become a final translation.
    return null
  }
}

export async function writeGatewayDraft(dir: string, record: GatewayDraftRecord): Promise<void> {
  if (!dir || !isAbsolute(dir)) throw new Error('writeGatewayDraft: dir must be an absolute path.')
  if (!isValidRecord(record)) throw new Error('writeGatewayDraft: invalid draft record.')
  const targetPath = join(dir, GATEWAY_DRAFT_FILENAME)
  await mkdir(dir, { recursive: true })
  await assertContainedParentDirectory(targetPath, dir, 'writeGatewayDraft')

  const data = JSON.stringify(record, null, 2)
  if (Buffer.byteLength(data, 'utf8') > MAX_GATEWAY_DRAFT_BYTES) {
    throw new Error('writeGatewayDraft: record exceeds maximum allowed byte size.')
  }
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, 'wx')
    await handle.writeFile(data, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, targetPath)
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}

function isValidReviewRecord(value: unknown): value is GatewayReviewRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = [
    'schemaVersion', 'state', 'identity', 'raw', 'rawSha256', 'observedModelId', 'observedModel',
    'routeFingerprint', 'sourceDigest', 'expectedIds', 'targetLocale', 'promptVersion', 'parserVersion', 'savedAtUtc'
  ]
  if (Object.keys(record).length !== keys.length || keys.some((key) => !(key in record))) return false
  if (record.schemaVersion !== 1 || record.state !== 'review-validated') return false
  return nonEmptyString(record.identity) && typeof record.raw === 'string' && validExpectedIds(record.expectedIds) &&
    validateCompactDraft(record.raw, record.expectedIds) &&
    isSha256(record.rawSha256) && sha256(record.raw) === record.rawSha256 &&
    nonEmptyString(record.observedModelId) && (record.observedModel === null || nonEmptyString(record.observedModel)) &&
    isSha256(record.routeFingerprint) && isSha256(record.sourceDigest) &&
    nonEmptyString(record.targetLocale) && nonEmptyString(record.promptVersion) &&
    nonEmptyString(record.parserVersion) && validTimestamp(record.savedAtUtc)
}

function matchesReviewExpectation(record: GatewayReviewRecord, expected: GatewayReviewExpectation): boolean {
  return record.identity === expected.identity &&
    record.sourceDigest === expected.sourceDigest &&
    sameIds(record.expectedIds, expected.expectedIds) &&
    record.targetLocale === expected.targetLocale &&
    record.promptVersion === expected.promptVersion &&
    record.parserVersion === expected.parserVersion &&
    record.routeFingerprint === expected.routeFingerprint
}

/** Return only a review whose identity and source ledger still exactly match. */
export async function readGatewayReview(
  dir: string,
  expected: GatewayReviewExpectation
): Promise<GatewayReviewRecord | null> {
  if (!dir || !isAbsolute(dir)) return null
  const targetPath = join(dir, GATEWAY_REVIEW_FILENAME)
  try {
    const contained = await assertContainedRegularFile(targetPath, dir, 'readGatewayReview')
    const content = await readBoundedUtf8(contained)
    if (content === null) return null
    parseAiJsonObject(content, {
      allowFence: false,
      allowProseObject: false,
      limits: { maxBytes: MAX_GATEWAY_DRAFT_BYTES, maxDepth: 16, maxMembers: 2_000, maxCandidates: 1 }
    })
    const parsed = JSON.parse(content) as unknown
    if (!isValidReviewRecord(parsed) || !matchesReviewExpectation(parsed, expected)) return null
    return parsed
  } catch {
    return null
  }
}

/** Persist the independently validated final review before the operation is ACKed. */
export async function writeGatewayReview(dir: string, record: GatewayReviewRecord): Promise<void> {
  if (!dir || !isAbsolute(dir)) throw new Error('writeGatewayReview: dir must be an absolute path.')
  if (!isValidReviewRecord(record)) throw new Error('writeGatewayReview: invalid review record.')
  const targetPath = join(dir, GATEWAY_REVIEW_FILENAME)
  await mkdir(dir, { recursive: true })
  await assertContainedParentDirectory(targetPath, dir, 'writeGatewayReview')
  const data = JSON.stringify(record, null, 2)
  if (Buffer.byteLength(data, 'utf8') > MAX_GATEWAY_DRAFT_BYTES) throw new Error('writeGatewayReview: record exceeds maximum allowed byte size.')
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, 'wx')
    await handle.writeFile(data, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, targetPath)
  } finally {
    await handle?.close().catch(() => {})
    await rm(temporaryPath, { force: true }).catch(() => {})
  }
}
