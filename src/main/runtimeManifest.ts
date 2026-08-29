export type SupportedPlatform = 'win32' | 'darwin' | 'linux'
export type SupportedArch = 'x64' | 'arm64' | 'ia32'

export interface RuntimeAssetSpec {
  version: string
  platform: SupportedPlatform
  arch: SupportedArch
  asset: string
  sha256: string
  bytes?: number
  entrypoint: string
  protocol?: string
  capabilities?: string[]
  files?: string[]
}

export interface RuntimeDistributionManifest {
  schemaVersion: 1
  runtimeVersion: string
  platform: SupportedPlatform
  arch?: SupportedArch
  assets: Record<string, RuntimeAssetSpec>
}

export function isValidSha256(hash: unknown): hash is string {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash)
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

  const platform = raw.platform
  if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
    return { ok: false, error: `Platform không hợp lệ: ${String(platform)}` }
  }

  if (!raw.assets || typeof raw.assets !== 'object' || Array.isArray(raw.assets)) {
    return { ok: false, error: 'Thiếu mục assets trong manifest.' }
  }

  const assetsRaw = raw.assets as Record<string, unknown>
  const validatedAssets: Record<string, RuntimeAssetSpec> = {}

  for (const [kind, assetVal] of Object.entries(assetsRaw)) {
    if (!assetVal || typeof assetVal !== 'object' || Array.isArray(assetVal)) {
      return { ok: false, error: `Asset spec cho ${kind} không hợp lệ.` }
    }

    const item = assetVal as Record<string, unknown>

    if (typeof item.version !== 'string' || !item.version.trim()) {
      return { ok: false, error: `Asset ${kind} thiếu version hợp lệ.` }
    }

    if (item.platform !== 'win32' && item.platform !== 'darwin' && item.platform !== 'linux') {
      return { ok: false, error: `Asset ${kind} có platform không hợp lệ: ${String(item.platform)}` }
    }

    if (item.arch !== 'x64' && item.arch !== 'arm64' && item.arch !== 'ia32') {
      return { ok: false, error: `Asset ${kind} có arch không hợp lệ: ${String(item.arch)}` }
    }

    if (typeof item.asset !== 'string' || !item.asset.trim()) {
      return { ok: false, error: `Asset ${kind} thiếu tên file asset package.` }
    }

    if (!isValidSha256(item.sha256)) {
      return { ok: false, error: `Asset ${kind} thiếu SHA-256 hợp lệ (yêu cầu 64 ký tự hex).` }
    }

    if (item.bytes != null && (typeof item.bytes !== 'number' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0)) {
      return { ok: false, error: `Asset ${kind} có kích thước bytes không hợp lệ.` }
    }

    if (typeof item.entrypoint !== 'string' || !item.entrypoint.trim()) {
      return { ok: false, error: `Asset ${kind} thiếu entrypoint executable.` }
    }

    if (item.protocol != null && (typeof item.protocol !== 'string' || !item.protocol.trim())) {
      return { ok: false, error: `Asset ${kind} có protocol không hợp lệ.` }
    }

    const capabilities = Array.isArray(item.capabilities)
      ? item.capabilities.filter((c): c is string => typeof c === 'string')
      : undefined

    const files = Array.isArray(item.files)
      ? item.files.filter((f): f is string => typeof f === 'string')
      : undefined

    validatedAssets[kind] = {
      version: item.version.trim(),
      platform: item.platform as SupportedPlatform,
      arch: item.arch as SupportedArch,
      asset: item.asset.trim(),
      sha256: item.sha256.toLowerCase(),
      bytes: typeof item.bytes === 'number' ? item.bytes : undefined,
      entrypoint: item.entrypoint.trim(),
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
      platform: platform as SupportedPlatform,
      arch: (raw.arch === 'x64' || raw.arch === 'arm64' || raw.arch === 'ia32') ? raw.arch : undefined,
      assets: validatedAssets
    }
  }
}
