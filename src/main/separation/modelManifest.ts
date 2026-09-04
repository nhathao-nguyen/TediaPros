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
  runtimeChannel: 'runtime-v4'
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

export function validateSeparatorModelReleaseManifest(
  raw: unknown
): { ok: true; manifest: SeparatorModelReleaseManifest } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Manifest separator-model không phải object hợp lệ.' }
  }
  const obj = raw as Record<string, unknown>
  if (obj.schemaVersion !== 1) {
    return { ok: false, error: 'schemaVersion của model manifest phải là 1.' }
  }
  if (obj.runtimeChannel !== 'runtime-v4') {
    return { ok: false, error: 'runtimeChannel của model manifest phải là runtime-v4.' }
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
      return { ok: false, error: `Model ${key} có asset archive không an toàn hoặc không hợp lệ.` }
    }
    if (!isSha256(m.archiveSha256)) {
      return { ok: false, error: `Model ${key} archiveSha256 không hợp lệ.` }
    }
    if (typeof m.archiveBytes !== 'number' || m.archiveBytes <= 0 || !Number.isSafeInteger(m.archiveBytes)) {
      return { ok: false, error: `Model ${key} archiveBytes phải là số nguyên dương.` }
    }
    if (typeof m.expandedBytes !== 'number' || m.expandedBytes <= 0 || !Number.isSafeInteger(m.expandedBytes)) {
      return { ok: false, error: `Model ${key} expandedBytes phải là số nguyên dương.` }
    }
    if (!m.model || typeof m.model !== 'object') {
      return { ok: false, error: `Model ${key} thiếu cấu hình file model.` }
    }
    const mf = m.model as Record<string, unknown>
    if (mf.path !== 'model.onnx') {
      return { ok: false, error: `Model ${key} path phải là model.onnx.` }
    }
    if (!isSha256(mf.sha256)) {
      return { ok: false, error: `Model ${key} model.sha256 không hợp lệ.` }
    }
    if (typeof mf.bytes !== 'number' || mf.bytes <= 0 || !Number.isSafeInteger(mf.bytes)) {
      return { ok: false, error: `Model ${key} model.bytes phải là số nguyên dương.` }
    }

    if (!m.mdx || typeof m.mdx !== 'object') {
      return { ok: false, error: `Model ${key} thiếu cấu hình mdx dimensions.` }
    }
    const mdx = m.mdx as Record<string, unknown>
    if (mdx.sampleRate !== 44100 || mdx.channels !== 2) {
      return { ok: false, error: `Model ${key} mdx sampleRate phải là 44100 và channels phải là 2.` }
    }
    if (
      typeof mdx.nFft !== 'number' || mdx.nFft <= 0 ||
      typeof mdx.hopLength !== 'number' || mdx.hopLength <= 0 ||
      typeof mdx.dimF !== 'number' || mdx.dimF <= 0 ||
      typeof mdx.dimT !== 'number' || mdx.dimT <= 0 ||
      typeof mdx.segmentSamples !== 'number' || mdx.segmentSamples <= 0
    ) {
      return { ok: false, error: `Model ${key} có tham số mdx không hợp lệ.` }
    }
    if (mdx.primaryStem !== 'vocals' && mdx.primaryStem !== 'instrumental') {
      return { ok: false, error: `Model ${key} mdx.primaryStem phải là 'vocals' hoặc 'instrumental'.` }
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
      runtimeChannel: 'runtime-v4',
      models: validatedModels
    }
  }
}
