import type { SeparatorModelId } from '../../shared/types'

export interface SeparatorMdxMetadata {
  sampleRate: 44100
  channels: 2
  nFft: number
  hopLength: number
  dimF: number
  dimT: number
  segmentSamples: number
  primaryStem: 'vocals' | 'instrumental'
}

export interface SeparatorModelReleaseSpec {
  id: SeparatorModelId
  version: string
  asset: string
  archiveBytes: number
  expandedBytes: number
  archiveSha256: string
  model: { path: 'model.onnx'; bytes: number; sha256: string }
  mdx: SeparatorMdxMetadata
  source: { url: string; revision: string }
  license: {
    codeSpdx: string
    weightName: string
    weightUrl: string
    weightRedistributionApproved: true
    attribution: string
  }
}

export interface SeparatorModelReleaseManifest {
  schemaVersion: 1
  runtimeChannel: 'runtime-v4' | 'runtime-v5'
  models: Record<SeparatorModelId, SeparatorModelReleaseSpec>
}

export interface InstalledSeparatorModelManifest {
  id: SeparatorModelId
  version: string
  installedAt: string
  protocol: 'separator-engine/1'
  spec: SeparatorModelReleaseSpec
}

const REQUIRED_MODEL_IDS: ReadonlySet<SeparatorModelId> = new Set([
  'separator-fast-balanced-v1',
  'separator-quality-v1'
])

function isSha256(val: unknown): val is string {
  return typeof val === 'string' && /^[a-f0-9]{64}$/i.test(val)
}

function isSafeRelativePath(val: unknown): val is string {
  if (typeof val !== 'string' || !val.trim()) return false
  const normalized = val.replace(/\\/g, '/')
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized) &&
    normalized.split('/').every((p) => p && p !== '.' && p !== '..')
}

export function validateSeparatorModelReleaseManifest(raw: unknown):
  | { ok: true; manifest: SeparatorModelReleaseManifest }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Model manifest không phải là object hợp lệ.' }
  }
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== 1) {
    return { ok: false, error: 'schemaVersion của model manifest phải là 1.' }
  }
  if (obj.runtimeChannel !== 'runtime-v4' && obj.runtimeChannel !== 'runtime-v5') {
    return { ok: false, error: 'runtimeChannel của model manifest phải là runtime-v4 hoặc runtime-v5.' }
  }
  if (!obj.models || typeof obj.models !== 'object' || Array.isArray(obj.models)) {
    return { ok: false, error: 'models trong manifest không hợp lệ.' }
  }
  const models = obj.models as Record<string, unknown>
  const keys = Object.keys(models)
  if (keys.length !== REQUIRED_MODEL_IDS.size || !keys.every((k) => REQUIRED_MODEL_IDS.has(k as SeparatorModelId))) {
    return { ok: false, error: 'Manifest phải chứa đúng 2 model: separator-fast-balanced-v1 và separator-quality-v1.' }
  }

  const validatedModels = {} as Record<SeparatorModelId, SeparatorModelReleaseSpec>

  for (const [key, modelRaw] of Object.entries(models)) {
    if (!modelRaw || typeof modelRaw !== 'object') {
      return { ok: false, error: `Model spec ${key} không hợp lệ.` }
    }
    const m = modelRaw as Record<string, unknown>
    if (m.id !== key) {
      return { ok: false, error: `Model id ${m.id} không khớp key ${key}.` }
    }
    if (typeof m.version !== 'string' || !m.version.trim()) {
      return { ok: false, error: `Model ${key} thiếu version.` }
    }
    if (typeof m.asset !== 'string' || !isSafeRelativePath(m.asset) || !m.asset.endsWith('.zip')) {
      return { ok: false, error: `Model ${key} asset phải là safe relative path đuôi .zip.` }
    }
    if (typeof m.archiveBytes !== 'number' || m.archiveBytes <= 0 || !Number.isInteger(m.archiveBytes)) {
      return { ok: false, error: `Model ${key} archiveBytes không hợp lệ.` }
    }
    if (typeof m.expandedBytes !== 'number' || m.expandedBytes <= 0 || !Number.isInteger(m.expandedBytes)) {
      return { ok: false, error: `Model ${key} expandedBytes không hợp lệ.` }
    }
    if (!isSha256(m.archiveSha256)) {
      return { ok: false, error: `Model ${key} archiveSha256 không hợp lệ.` }
    }

    if (!m.model || typeof m.model !== 'object') {
      return { ok: false, error: `Model ${key} thiếu model metadata.` }
    }
    const innerModel = m.model as Record<string, unknown>
    if (innerModel.path !== 'model.onnx') {
      return { ok: false, error: `Model ${key} model.path phải là "model.onnx".` }
    }
    if (typeof innerModel.bytes !== 'number' || innerModel.bytes <= 0 || !Number.isInteger(innerModel.bytes)) {
      return { ok: false, error: `Model ${key} model.bytes không hợp lệ.` }
    }
    if (!isSha256(innerModel.sha256)) {
      return { ok: false, error: `Model ${key} model.sha256 không hợp lệ.` }
    }

    if (!m.mdx || typeof m.mdx !== 'object') {
      return { ok: false, error: `Model ${key} thiếu MDX metadata.` }
    }
    const mdx = m.mdx as Record<string, unknown>
    if (mdx.sampleRate !== 44100 || mdx.channels !== 2) {
      return { ok: false, error: `Model ${key} MDX sampleRate phải là 44100 và channels là 2.` }
    }
    for (const f of ['nFft', 'hopLength', 'dimF', 'dimT', 'segmentSamples']) {
      if (typeof mdx[f] !== 'number' || (mdx[f] as number) <= 0 || !Number.isInteger(mdx[f])) {
        return { ok: false, error: `Model ${key} MDX ${f} không hợp lệ.` }
      }
    }
    if (mdx.primaryStem !== 'vocals' && mdx.primaryStem !== 'instrumental') {
      return { ok: false, error: `Model ${key} primaryStem phải là vocals hoặc instrumental.` }
    }

    if (!m.source || typeof m.source !== 'object') {
      return { ok: false, error: `Model ${key} thiếu source metadata.` }
    }
    const src = m.source as Record<string, unknown>
    if (typeof src.url !== 'string' || !src.url.startsWith('https://')) {
      return { ok: false, error: `Model ${key} source.url phải là HTTPS URL.` }
    }
    if (typeof src.revision !== 'string' || !src.revision.trim() || src.revision === 'main' || src.revision === 'master') {
      return { ok: false, error: `Model ${key} source.revision không được là mutable branch.` }
    }

    if (!m.license || typeof m.license !== 'object') {
      return { ok: false, error: `Model ${key} thiếu license metadata.` }
    }
    const lic = m.license as Record<string, unknown>
    if (lic.weightRedistributionApproved !== true) {
      return { ok: false, error: `Model ${key} chưa được phê duyệt quyền phân phối lại weights.` }
    }
    if (typeof lic.codeSpdx !== 'string' || !lic.codeSpdx.trim()) {
      return { ok: false, error: `Model ${key} thiếu codeSpdx.` }
    }
    if (typeof lic.weightName !== 'string' || !lic.weightName.trim()) {
      return { ok: false, error: `Model ${key} thiếu weightName.` }
    }

    validatedModels[key as SeparatorModelId] = m as unknown as SeparatorModelReleaseSpec
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: 1,
      runtimeChannel: obj.runtimeChannel as 'runtime-v4' | 'runtime-v5',
      models: validatedModels
    }
  }
}
