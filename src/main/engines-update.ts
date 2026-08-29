import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { binDir } from './deps'
import { logInfo } from './logger'

/** Local installation receipt. No remote manifest is consulted at runtime. */
export type EngineKind = 'ocr' | 'whisper' | 'douyin' | 'whisperCuda' | 'video2x'

type VerMap = Partial<Record<EngineKind, { version: string; installedAt: string }>>

import { runtimeStateRoot, installedRuntimeReceiptPath } from './runtimeResolver'

function localPath(): string {
  return installedRuntimeReceiptPath()
}

function legacyLocalPath(): string {
  return join(binDir(), 'engines-local.json')
}

async function readLocal(): Promise<VerMap> {
  try {
    let raw = ''
    try {
      raw = await readFile(localPath(), 'utf-8')
    } catch {
      raw = await readFile(legacyLocalPath(), 'utf-8')
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: VerMap = {}
    for (const kind of ['ocr', 'whisper', 'douyin', 'whisperCuda', 'video2x'] as EngineKind[]) {
      const value = parsed[kind]
      if (typeof value === 'number' && Number.isFinite(value)) {
        result[kind] = { version: String(value), installedAt: '' }
      } else if (value && typeof value === 'object') {
        const record = value as { version?: unknown; installedAt?: unknown }
        if (typeof record.version === 'string') {
          result[kind] = {
            version: record.version,
            installedAt: typeof record.installedAt === 'string' ? record.installedAt : ''
          }
        }
      }
    }
    return result
  } catch {
    return {}
  }
}

async function writeLocal(map: VerMap): Promise<void> {
  await mkdir(runtimeStateRoot(), { recursive: true })
  await writeFile(localPath(), JSON.stringify(map, null, 2), 'utf-8')
}

/**
 * Updates are explicit local asset imports only. A binary's real probe is the
 * source of truth; this receipt intentionally never calls GitHub or a registry.
 */
export async function engineNeedsUpdate(_kind: EngineKind, _installed: boolean): Promise<boolean> {
  return false
}

export async function markEngineInstalled(kind: EngineKind, version = 'local-1'): Promise<void> {
  const local = await readLocal()
  local[kind] = { version, installedAt: new Date().toISOString() }
  await writeLocal(local)
  logInfo(`Công cụ ${kind}: đã ghi phiên bản local ${version}.`)
}
