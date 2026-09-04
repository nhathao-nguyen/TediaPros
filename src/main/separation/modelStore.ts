import { app } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import type { SeparatorModelId } from '../../shared/types'
import type { SeparatorModelReleaseSpec } from './modelManifest'

export interface InstalledSeparatorModel {
  id: SeparatorModelId
  directory: string
  modelPath: string
  manifestPath: string
  spec: SeparatorModelReleaseSpec
}

export function separatorModelRoot(): string {
  return join(app.getPath('userData'), 'separator-models')
}

export function separatorModelDir(id: SeparatorModelId): string {
  return join(separatorModelRoot(), id)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
  }
  return hash.digest('hex').toLowerCase()
}

export async function resolveInstalledSeparatorModel(
  id: SeparatorModelId
): Promise<InstalledSeparatorModel | null> {
  const dir = separatorModelDir(id)
  const manifestPath = join(dir, 'manifest.json')
  const modelPath = join(dir, 'model.onnx')

  if (!(await fileExists(manifestPath)) || !(await fileExists(modelPath))) {
    return null
  }

  try {
    const rawManifest = await readFile(manifestPath, 'utf8')
    const parsed = JSON.parse(rawManifest) as Record<string, unknown>
    const spec = (parsed.spec || parsed) as SeparatorModelReleaseSpec

    if (spec.id !== id) return null
    if (spec.license?.weightRedistributionApproved !== true) return null

    const modelStat = await stat(modelPath)
    if (!modelStat.isFile() || modelStat.size !== spec.model.bytes) {
      return null
    }

    const hash = await sha256File(modelPath)
    if (hash !== spec.model.sha256.toLowerCase()) {
      return null
    }

    return {
      id,
      directory: dir,
      modelPath,
      manifestPath,
      spec
    }
  } catch {
    return null
  }
}
