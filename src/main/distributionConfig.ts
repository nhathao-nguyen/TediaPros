export interface DistributionConfig {
  owner: string
  repo: string
  runtimeChannel: string
  manifestUrl: string
  getAssetUrl: (assetName: string) => string
}

/** Central distribution repository configuration for the immutable runtime channel. */
export function getDistributionConfig(): DistributionConfig {
  const owner = process.env.TEDIAPROS_DISTRIBUTION_OWNER?.trim() || 'nhathao-nguyen'
  const repo = process.env.TEDIAPROS_DISTRIBUTION_REPO?.trim() || 'TediaPros'
  const runtimeChannel = process.env.TEDIAPROS_RUNTIME_CHANNEL?.trim() || 'runtime-v3'

  const manifestUrl =
    owner && repo
      ? `https://github.com/${owner}/${repo}/releases/download/${runtimeChannel}/runtime-manifest.json`
      : ''

  const getAssetUrl = (assetName: string): string => {
    if (!owner || !repo) return ''
    return `https://github.com/${owner}/${repo}/releases/download/${runtimeChannel}/${encodeURIComponent(assetName)}`
  }

  return {
    owner,
    repo,
    runtimeChannel,
    manifestUrl,
    getAssetUrl
  }
}
