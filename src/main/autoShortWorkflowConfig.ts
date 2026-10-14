import { app } from 'electron'
import { join } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import type { AutoShortConfig } from '../shared/types'
import { validateAutoShortConfig } from '../shared/autoShortContract'
import { atomicWorkflowWrite } from './reelsWorkflowStore'
import { assertContainedRegularFile } from './safeContainedPath'

let pending: Promise<unknown> = Promise.resolve()
let lastWriteError: string | null = null

export function saveWorkflowAutoShortConfig(raw: unknown, validationError?: string): Promise<void> {
  const work = pending.then(async () => {
    const root = app.getPath('userData')
    const config = validationError ? validationError.slice(0, 800) : validateAutoShortConfig(raw && typeof raw === 'object' && !Array.isArray(raw)
      ? { ...raw, outputDir: root } : raw)
    const snapshot = typeof config === 'string' ? { version: 1, error: config } : { version: 1, config }
    const rawSnapshot = JSON.stringify(snapshot)
    if (Buffer.byteLength(rawSnapshot) > 1024 * 1024) throw Error('Snapshot AutoShort quá lớn.')
    await atomicWorkflowWrite(join(root, 'autoshort-workflow-config.json'), root, rawSnapshot)
    if (typeof config === 'string') throw Error(config)
    lastWriteError = null
  }).catch(error => {
    lastWriteError = error instanceof Error ? error.message : String(error)
    throw error
  })
  pending = work.catch(() => undefined)
  return work
}

export async function getWorkflowAutoShortConfig(outputDir: string): Promise<AutoShortConfig> {
  await pending
  if (lastWriteError) throw Error(`Cấu hình AutoShort cần sửa/lưu lại: ${lastWriteError}`)
  const root = app.getPath('userData'), path = join(root, 'autoshort-workflow-config.json')
  try { await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw Error('Hãy mở tab AutoShort và lưu cấu hình trước khi chạy workflow tự động.')
    throw error
  }
  await assertContainedRegularFile(path, root, 'Cấu hình AutoShort Workflow')
  if ((await lstat(path)).size > 1024 * 1024) throw Error('Snapshot AutoShort quá lớn.')
  const raw = JSON.parse(await readFile(path, 'utf8'))
  if (raw?.version === 1 && raw.error) throw Error(`Cấu hình AutoShort cần sửa: ${String(raw.error).slice(0, 500)}`)
  const candidate = raw?.version === 1 ? raw.config : raw
  const config = validateAutoShortConfig(candidate && typeof candidate === 'object' ? { ...candidate, outputDir } : candidate)
  if (typeof config === 'string') throw Error(config)
  return config
}
