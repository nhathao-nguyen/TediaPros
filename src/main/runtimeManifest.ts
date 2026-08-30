import type { RuntimeEngineKind } from './runtimeResolver'

export type SupportedPlatform = 'win32' | 'darwin' | 'linux'
export type SupportedArch = 'x64' | 'arm64' | 'ia32'

export interface RuntimeAssetSpec {
  version: string
  platform: SupportedPlatform
  arch: SupportedArch
  asset: string
  sha256: string
  bytes: number
  entrypoint: string
  protocol?: string
  capabilities: string[]
  files: string[]
}

export interface RuntimeDistributionManifest {
  schemaVersion: 1
  runtimeVersion: string
  platform: SupportedPlatform
  arch: SupportedArch
  assets: Partial<Record<RuntimeEngineKind, RuntimeAssetSpec>>
  provenance?: Record<string, unknown>
}

const RUNTIME_KINDS = new Set<RuntimeEngineKind>([
  'ffmpeg',
  'whisper-engine',
  'whisper-cuda',
  'ocr-engine',
  'video2x',
  'douyin'
])

export function isValidSha256(hash: unknown): hash is string {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)
}

function isPlatform(value: unknown): value is SupportedPlatform {
  return value === 'win32' || value === 'darwin' || value === 'linux'
}

function isArch(value: unknown): value is SupportedArch {
  return value === 'x64' || value === 'arm64' || value === 'ia32'
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  const normalized = value.replace(/\\/g, '/')
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//u.test(normalized) &&
    normalized.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

export function validateRuntimeDistributionManifest(
  data: unknown
): { ok: true; manifest: RuntimeDistributionManifest } | { ok: false; error: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Manifest runtime không phải là một JSON object hợp lệ.' }
  }

  const raw = data as Record<string, unknown>
  if (raw.schemaVersion !== 1) {
    return { ok: false, error: `schemaVersion không hợp lệ (yêu cầu 1, nhận ${String(raw.schemaVersion)}).` }
  }
  if (typeof raw.runtimeVersion !== 'string' || !raw.runtimeVersion.trim()) {
    return { ok: false, error: 'Thiếu runtimeVersion hợp lệ trong manifest.' }
  }
  if (!isPlatform(raw.platform) || !isArch(raw.arch)) {
    return { ok: false, error: 'Manifest phải khai báo platform và arch cụ thể.' }
  }
  if (!raw.assets || typeof raw.assets !== 'object' || Array.isArray(raw.assets)) {
    return { ok: false, error: 'Thiếu mục assets trong manifest.' }
  }
  if (raw.provenance !== undefined && (!raw.provenance || typeof raw.provenance !== 'object' || Array.isArray(raw.provenance))) {
    return { ok: false, error: 'provenance phải là một JSON object nếu được khai báo.' }
  }

  const entries = Object.entries(raw.assets as Record<string, unknown>)
  if (entries.length === 0) return { ok: false, error: 'Manifest không được để trống assets.' }
  const assets: Partial<Record<RuntimeEngineKind, RuntimeAssetSpec>> = {}
  const assetNames = new Set<string>()

  for (const [kind, value] of entries) {
    if (!RUNTIME_KINDS.has(kind as RuntimeEngineKind)) {
      return { ok: false, error: `Loại runtime không được hỗ trợ: ${kind}.` }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: `Asset spec cho ${kind} không hợp lệ.` }
    }
    const item = value as Record<string, unknown>
    if (typeof item.version !== 'string' || !item.version.trim()) {
      return { ok: false, error: `Asset ${kind} thiếu version hợp lệ.` }
    }
    if (item.platform !== raw.platform || item.arch !== raw.arch) {
      return { ok: false, error: `Asset ${kind} không khớp platform/arch của manifest.` }
    }
    if (typeof item.asset !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(item.asset.trim())) {
      return { ok: false, error: `Asset ${kind} thiếu tên archive hợp lệ.` }
    }
    if (assetNames.has(item.asset.trim())) {
      return { ok: false, error: `Asset ${kind} dùng trùng tên archive.` }
    }
    assetNames.add(item.asset.trim())
    if (!isValidSha256(item.sha256)) {
      return { ok: false, error: `Asset ${kind} thiếu SHA-256 hợp lệ.` }
    }
    if (typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) {
      return { ok: false, error: `Asset ${kind} phải khai báo bytes dương.` }
    }
    if (!isSafeRelativePath(item.entrypoint)) {
      return { ok: false, error: `Asset ${kind} có entrypoint không an toàn.` }
    }
    if (!Array.isArray(item.files) || item.files.length === 0 || !item.files.every(isSafeRelativePath)) {
      return { ok: false, error: `Asset ${kind} phải khai báo files bắt buộc hợp lệ.` }
    }
    const files = item.files.map((file) => file.replace(/\\/g, '/'))
    const entrypoint = item.entrypoint.replace(/\\/g, '/')
    if (!files.includes(entrypoint)) {
      return { ok: false, error: `Asset ${kind} phải liệt kê entrypoint trong files.` }
    }
    if (new Set(files).size !== files.length) {
      return { ok: false, error: `Asset ${kind} có files trùng lặp.` }
    }
    const capabilities = Array.isArray(item.capabilities) && item.capabilities.length > 0 && item.capabilities.every((cap) => typeof cap === 'string' && cap.trim())
      ? item.capabilities.map((cap) => (cap as string).trim())
      : null
    if (!capabilities) return { ok: false, error: `Asset ${kind} có capabilities không hợp lệ.` }
    if (item.protocol !== undefined && (typeof item.protocol !== 'string' || !item.protocol.trim())) {
      return { ok: false, error: `Asset ${kind} có protocol không hợp lệ.` }
    }

    assets[kind as RuntimeEngineKind] = {
      version: item.version.trim(),
      platform: item.platform as SupportedPlatform,
      arch: item.arch as SupportedArch,
      asset: item.asset.trim(),
      sha256: (item.sha256 as string).toLowerCase(),
      bytes: item.bytes,
      entrypoint,
      protocol: typeof item.protocol === 'string' ? item.protocol.trim() : undefined,
      capabilities,
      files
    }
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: 1,
      runtimeVersion: raw.runtimeVersion.trim(),
      platform: raw.platform,
      arch: raw.arch,
      assets,
      ...(raw.provenance ? { provenance: raw.provenance as Record<string, unknown> } : {})
    }
  }
}
