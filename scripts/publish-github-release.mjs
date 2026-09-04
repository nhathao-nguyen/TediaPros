import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { verifyRuntimeReleaseDirectory } from './verify-runtime-release.mjs'

const owner = process.env.TEDIAPROS_DISTRIBUTION_OWNER?.trim() || 'nhathao-nguyen'
const repo = process.env.TEDIAPROS_DISTRIBUTION_REPO?.trim() || 'TediaPros'
const DEFAULT_RUNTIME_CHANNEL = 'runtime-v3'
const requestedTag = process.env.TEDIAPROS_RUNTIME_CHANNEL?.trim() || process.env.RUNTIME_VERSION?.trim() || DEFAULT_RUNTIME_CHANNEL
let tag = null
const tokenArg = process.argv.indexOf('--token')
const token = (tokenArg >= 0 ? process.argv[tokenArg + 1] : null) || process.env.GITHUB_TOKEN || process.env.GH_TOKEN

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function sha256Response(response) {
  const hash = createHash('sha256')
  if (!response.body) throw new Error('GitHub returned an empty asset body.')
  for await (const chunk of Readable.fromWeb(response.body)) hash.update(chunk)
  return hash.digest('hex')
}

function parseArgs(argv) {
  const values = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--token') { i += 1; continue }
    if (!argv[i].startsWith('--')) throw new Error(`Unknown argument: ${argv[i]}`)
    const key = argv[i].slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    values[key] = value
    i += 1
  }
  return values
}

function apiHeaders() {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

async function getRelease() {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, { headers: apiHeaders() })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`)
  return response.json()
}

async function remoteAssetHash(asset) {
  if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')) return asset.digest.slice('sha256:'.length).toLowerCase()
  const response = await fetch(asset.browser_download_url, { headers: { ...apiHeaders(), Accept: 'application/octet-stream' }, redirect: 'follow' })
  if (!response.ok) throw new Error(`Cannot download existing GitHub asset ${asset.name} (${response.status}).`)
  return sha256Response(response)
}

async function assertExistingReleaseMatches(release, expected) {
  if (release.tag_name !== tag) throw new Error(`Existing release does not point to ${tag}.`)
  const remote = new Map((release.assets || []).map((asset) => [asset.name, asset]))
  for (const file of expected) {
    const asset = remote.get(file.name)
    if (!asset) throw new Error(`Immutable release ${tag} is missing asset ${file.name}; refusing to mutate it.`)
    const localSize = (await stat(file.path)).size
    if (asset.size !== localSize) throw new Error(`Immutable release asset ${file.name} has a different byte count.`)
    const remoteHash = await remoteAssetHash(asset)
    const localHash = await sha256File(file.path)
    if (remoteHash !== localHash) throw new Error(`Immutable release asset ${file.name} has a different SHA-256.`)
  }
  console.log(`Existing immutable runtime release ${tag} matches all ${expected.length} local assets.`)
  return release
}

async function uploadAsset(uploadUrl, file, fileName) {
  const info = await stat(file)
  const body = await readFile(file)
  const url = uploadUrl.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(fileName)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...apiHeaders(), 'Content-Type': fileName.endsWith('.json') ? 'application/json' : 'application/zip', 'Content-Length': String(info.size) },
    body
  })
  if (!response.ok) throw new Error(`Upload failed for ${fileName} (${response.status}): ${await response.text()}`)
}

async function publishDraftRelease(release) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false })
  })
  if (!response.ok) throw new Error(`GitHub release publication failed (${response.status}): ${await response.text()}`)
  return response.json()
}

async function main() {
  if (!token) throw new Error('A GitHub token is required through --token, GITHUB_TOKEN, or GH_TOKEN.')
  const args = parseArgs(process.argv.slice(2))
  const artifactsDir = resolve(args['artifacts-dir'] || 'release-artifacts')
  const verification = await verifyRuntimeReleaseDirectory(artifactsDir)
  if (!verification.ok) throw new Error(`Refusing to publish unverified runtime artifacts: ${verification.error}`)
  const manifest = verification.manifest
  const manifestTag = manifest.runtimeVersion
  if (requestedTag && requestedTag !== manifestTag) {
    throw new Error(`Requested runtime channel ${requestedTag} differs from manifest runtimeVersion ${manifestTag}.`)
  }
  tag = manifestTag

  const expected = [
    { name: 'runtime-manifest.json', path: join(artifactsDir, 'runtime-manifest.json') },
    { name: 'runtime-provenance.json', path: join(artifactsDir, 'runtime-provenance.json') },
    ...Object.values(verification.manifest.assets).map((spec) => ({ name: spec.asset, path: join(artifactsDir, spec.asset) }))
  ]
  for (const file of expected) if (!(await fileExists(file.path))) throw new Error(`Missing release file ${file.path}`)

  let release = await getRelease()
  if (release) {
    await assertExistingReleaseMatches(release, expected)
    if (release.draft) {
      await publishDraftRelease(release)
      console.log(`Published previously staged immutable runtime release: ${tag}`)
    }
    return
  }

  const created = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
    method: 'POST',
    headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: process.env.GITHUB_SHA || 'main',
      name: `TediaPros runtime ${tag}`,
      body: `Immutable TediaPros ${tag} bundles. All assets are generated from clean pinned inputs and verified before upload.`,
      draft: true,
      prerelease: false
    })
  })
  if (!created.ok) throw new Error(`GitHub release creation failed (${created.status}): ${await created.text()}`)
  release = await created.json()

  for (const file of expected) {
    await uploadAsset(release.upload_url, file.path, file.name)
    console.log(`Uploaded ${file.name} (${(await stat(file.path)).size} bytes, ${await sha256File(file.path)}).`)
  }
  await publishDraftRelease(release)
  const published = await getRelease()
  if (!published) throw new Error(`Release ${tag} disappeared after upload.`)
  await assertExistingReleaseMatches(published, expected)
  console.log(`Published and verified immutable runtime release: ${published.html_url}`)
}

main().catch((error) => { console.error(`[Release] ${error.message}`); process.exit(1) })
