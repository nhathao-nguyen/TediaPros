import { lstat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { isAbsolute, join, resolve } from 'node:path'
import { app } from 'electron'

export interface DistributionConfig {
  owner: string
  repo: string
  runtimeChannel: string
  runtimeSource: 'remote' | 'local'
  localRuntimeDir?: string
  manifestUrl: string
  separatorModelManifestUrl: string
  getAssetUrl: (assetName: string) => string
  getSeparatorModelAssetUrl: (assetName: string) => string
}

const LOCAL_RUNTIME_SCHEME = 'local-runtime:'
const LOCAL_RUNTIME_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

function localRuntimeFileName(url: string | URL | Request): string | null {
  const rawUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== LOCAL_RUNTIME_SCHEME || parsed.search || parsed.hash) return null
  let fileName: string
  try {
    fileName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  } catch {
    return null
  }
  return LOCAL_RUNTIME_FILE_PATTERN.test(fileName) ? fileName : null
}

/**
 * Creates the runtime distribution fetcher. In local dev mode this is a
 * bounded file adapter; packaged builds never read from the local directory.
 */
export function createDistributionFetch(config: DistributionConfig): typeof fetch {
  const localRuntimeDir = config.localRuntimeDir
  if (app.isPackaged !== false || !localRuntimeDir) return fetch

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const fileName = localRuntimeFileName(input)
    if (!fileName) return new Response('Invalid local runtime asset URL', { status: 400 })

    try {
      const path = join(localRuntimeDir, fileName)
      const info = await lstat(path)
      if (!info.isFile()) return new Response('Local runtime asset not found', { status: 404 })
      init?.signal?.throwIfAborted()
      const data = Readable.toWeb(createReadStream(path, { signal: init?.signal ?? undefined }))
      return new Response(data as ReadableStream<Uint8Array>, {
        status: 200,
        headers: {
          'content-type': fileName === 'runtime-manifest.json' ? 'application/json' : 'application/octet-stream',
          'content-length': String(info.size)
        }
      })
    } catch {
      return new Response('Local runtime asset not found', { status: 404 })
    }
  }
}

/** Central distribution repository configuration for the immutable runtime channel. */
export function getDistributionConfig(): DistributionConfig {
  const owner = process.env.TEDIAPROS_DISTRIBUTION_OWNER?.trim() || 'nhathao-nguyen'
  const repo = process.env.TEDIAPROS_DISTRIBUTION_REPO?.trim() || 'TediaPros'
  const runtimeChannel = process.env.TEDIAPROS_RUNTIME_CHANNEL?.trim() || 'runtime-v5'
  const localCandidate = process.env.TEDIAPROS_LOCAL_RUNTIME_DIR?.trim()
  const localRuntimeDir = app.isPackaged === false && localCandidate && isAbsolute(localCandidate) ? resolve(localCandidate) : undefined
  const runtimeSource: DistributionConfig['runtimeSource'] = localRuntimeDir ? 'local' : 'remote'

  const manifestUrl =
    localRuntimeDir
      ? 'local-runtime:///runtime-manifest.json'
      : owner && repo
      ? `https://github.com/${owner}/${repo}/releases/download/${runtimeChannel}/runtime-manifest.json`
      : ''

  const separatorModelManifestUrl =
    localRuntimeDir
      ? 'local-runtime:///separator-model-manifest.json'
      : owner && repo
      ? `https://github.com/${owner}/${repo}/releases/download/${runtimeChannel}/separator-model-manifest.json`
      : ''

  const getAssetUrl = (assetName: string): string => {
    if (localRuntimeDir) return `local-runtime:///${encodeURIComponent(assetName)}`
    if (!owner || !repo) return ''
    return `https://github.com/${owner}/${repo}/releases/download/${runtimeChannel}/${encodeURIComponent(assetName)}`
  }

  const getSeparatorModelAssetUrl = (assetName: string): string => {
    if (localRuntimeDir) return `local-runtime:///${encodeURIComponent(assetName)}`
    if (!owner || !repo) return ''
    return `https://github.com/${owner}/${repo}/releases/download/${runtimeChannel}/${encodeURIComponent(assetName)}`
  }

  return {
    owner,
    repo,
    runtimeChannel,
    runtimeSource,
    ...(localRuntimeDir ? { localRuntimeDir } : {}),
    manifestUrl,
    separatorModelManifestUrl,
    getAssetUrl,
    getSeparatorModelAssetUrl
  }
}
