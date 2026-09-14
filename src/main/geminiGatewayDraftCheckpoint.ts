import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { assertContainedParentDirectory, assertContainedRegularFile } from './safeContainedPath'
import type { TranslationInput } from '../shared/translation'

export const GATEWAY_DRAFT_FILENAME = 'gemini-gateway-draft.json'
export const MAX_GATEWAY_DRAFT_BYTES = 16 * 1024 * 1024 // 16 MiB

export interface GatewayDraftRecord {
  schemaVersion: 1
  state: 'draft-validated'
  identity: string
  raw: string
  rawSha256: string
  observedModelId: string
  observedModel: string
  routeFingerprint: string
  sourceDigest: string
  expectedIds: string[]
  targetLocale: string
  savedAtUtc: string
}

export function calculateGatewaySourceDigest(input: TranslationInput): string {
  const payload = {
    sourceLanguage: input.sourceLanguage || 'auto',
    targetLocale: input.targetLocale,
    mode: input.mode,
    glossary: input.glossary || [],
    synopsis: input.synopsis || '',
    cues: input.cues.map((c) => ({ id: c.id, text: c.text, groupId: c.groupId }))
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function readGatewayDraft(
  dir: string,
  expectedIdentity: string,
  expectedSourceDigest: string
): Promise<GatewayDraftRecord | null> {
  if (!dir) return null
  const targetPath = join(dir, GATEWAY_DRAFT_FILENAME)
  try {
    await assertContainedRegularFile(targetPath, dir, 'readGatewayDraft')
    const handle = await open(targetPath, 'r')
    try {
      const stats = await handle.stat()
      if (stats.size > MAX_GATEWAY_DRAFT_BYTES) return null
      const buffer = Buffer.alloc(stats.size)
      await handle.read(buffer, 0, stats.size, 0)
      const parsed = JSON.parse(buffer.toString('utf8'))
      if (!parsed || typeof parsed !== 'object') return null

      if (parsed.schemaVersion !== 1) return null
      if (parsed.state !== 'draft-validated') return null
      if (parsed.identity !== expectedIdentity) return null
      if (parsed.sourceDigest !== expectedSourceDigest) return null
      if (!parsed.raw || typeof parsed.raw !== 'string') return null
      if (!parsed.observedModelId || typeof parsed.observedModelId !== 'string') return null
      if (!parsed.routeFingerprint || typeof parsed.routeFingerprint !== 'string') return null
      if (!Array.isArray(parsed.expectedIds) || parsed.expectedIds.length === 0) return null
      if (!parsed.targetLocale || typeof parsed.targetLocale !== 'string') return null

      const computedSha = createHash('sha256').update(parsed.raw).digest('hex')
      if (parsed.rawSha256 !== computedSha) return null

      return parsed as GatewayDraftRecord
    } finally {
      await handle.close()
    }
  } catch {
    // Missing file, directory traversal blocked, corrupt JSON or stat error
    return null
  }
}

export async function writeGatewayDraft(dir: string, record: GatewayDraftRecord): Promise<void> {
  if (!dir) throw new Error('writeGatewayDraft: dir must be specified.')
  if (record.schemaVersion !== 1 || record.state !== 'draft-validated') {
    throw new Error('writeGatewayDraft: invalid draft record state or schemaVersion.')
  }
  const targetPath = join(dir, GATEWAY_DRAFT_FILENAME)
  await mkdir(dir, { recursive: true })
  await assertContainedParentDirectory(targetPath, dir, 'writeGatewayDraft')

  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  const data = JSON.stringify(record, null, 2)
  if (Buffer.byteLength(data, 'utf8') > MAX_GATEWAY_DRAFT_BYTES) {
    throw new Error('writeGatewayDraft: record exceeds maximum allowed byte size.')
  }
  const handle = await open(temporaryPath, 'w')
  try {
    await handle.writeFile(data, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporaryPath, targetPath)
}
