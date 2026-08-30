import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SUPPORTED_KINDS = new Set(['ffmpeg', 'whisper-engine', 'whisper-cuda', 'ocr-engine', 'video2x', 'douyin'])
const SUPPORTED_PLATFORMS = new Set(['win32', 'darwin', 'linux'])
const SUPPORTED_ARCHES = new Set(['x64', 'arm64', 'ia32'])

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  const normalized = value.replace(/\\/g, '/')
  return !normalized.startsWith('/') && !/^[A-Za-z]:\//u.test(normalized) &&
    normalized.split('/').every((part) => part && part !== '.' && part !== '..')
}

export function validateRuntimeReleaseManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return 'manifest must be an object'
  if (manifest.schemaVersion !== 1) return 'schemaVersion must be 1'
  if (typeof manifest.runtimeVersion !== 'string' || !manifest.runtimeVersion.trim()) return 'runtimeVersion is required'
  if (!SUPPORTED_PLATFORMS.has(manifest.platform) || !SUPPORTED_ARCHES.has(manifest.arch)) return 'platform and arch must be explicit'
  if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) return 'assets is required'

  const entries = Object.entries(manifest.assets)
  if (entries.length === 0) return 'assets must not be empty'
  const assetNames = new Set()
  for (const [kind, spec] of entries) {
    if (!SUPPORTED_KINDS.has(kind)) return `unsupported runtime kind: ${kind}`
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return `invalid asset spec: ${kind}`
    if (typeof spec.version !== 'string' || !spec.version.trim()) return `${kind}.version is required`
    if (spec.platform !== manifest.platform || spec.arch !== manifest.arch) return `${kind} platform/arch mismatch`
    if (typeof spec.asset !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(spec.asset.trim())) return `${kind}.asset is invalid`
    if (assetNames.has(spec.asset)) return `duplicate asset archive: ${spec.asset}`
    assetNames.add(spec.asset)
    if (!/^[a-f0-9]{64}$/iu.test(spec.sha256 || '')) return `${kind}.sha256 is invalid`
    if (!Number.isSafeInteger(spec.bytes) || spec.bytes <= 0) return `${kind}.bytes must be positive`
    if (!safeRelativePath(spec.entrypoint)) return `${kind}.entrypoint is unsafe`
    if (!Array.isArray(spec.files) || spec.files.length === 0 || !spec.files.every(safeRelativePath)) return `${kind}.files is required`
    const files = spec.files.map((file) => file.replace(/\\/g, '/'))
    if (!files.includes(spec.entrypoint.replace(/\\/g, '/'))) return `${kind}.entrypoint must be in files`
    if (new Set(files).size !== files.length) return `${kind}.files contains duplicates`
    if (!Array.isArray(spec.capabilities) || spec.capabilities.length === 0 || !spec.capabilities.every((cap) => typeof cap === 'string' && cap.trim())) return `${kind}.capabilities is required`
    if (spec.protocol !== undefined && (typeof spec.protocol !== 'string' || !spec.protocol.trim())) return `${kind}.protocol is invalid`
  }
  return null
}

function escapePowerShellString(value) {
  return value.replace(/'/g, "''")
}

function listArchiveEntries(assetFile) {
  const isWindows = process.platform === 'win32'
  const command = isWindows
    ? `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead('${escapePowerShellString(assetFile)}'); try { $zip.Entries.FullName } finally { $zip.Dispose() }`
    : null
  const inspected = isWindows
    ? spawnSync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command
      ], { encoding: 'utf8', windowsHide: true })
    : spawnSync('unzip', ['-Z1', assetFile], { encoding: 'utf8' })
  if (inspected.error || inspected.status !== 0) {
    return { ok: false, error: `cannot inspect ZIP ${assetFile}` }
  }
  return {
    ok: true,
    entries: String(inspected.stdout || '').split(/\r?\n/).map((entry) => entry.trim().replace(/\\/g, '/').toLowerCase()).filter(Boolean)
  }
}

function archiveContains(entries, expected) {
  const target = expected.replace(/\\/g, '/').toLowerCase()
  return entries.some((entry) => entry === target || entry.endsWith(`/${target}`))
}

export function isSafeRuntimeReleaseArchiveEntry(entry) {
  if (typeof entry !== 'string' || !entry.trim() || entry.includes('\0')) return false
  const normalized = entry.replace(/\\/g, '/').replace(/\/+$/u, '')
  return Boolean(normalized) && safeRelativePath(normalized)
}

export async function verifyRuntimeReleaseDirectory(artifactsDir) {
  const manifestPath = join(artifactsDir, 'runtime-manifest.json')
  if (!(await fileExists(manifestPath))) return { ok: false, error: `missing manifest: ${manifestPath}` }

  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    return { ok: false, error: `manifest is not valid JSON: ${error.message}` }
  }

  const contractError = validateRuntimeReleaseManifest(manifest)
  if (contractError) return { ok: false, error: contractError }
  const provenancePath = join(artifactsDir, 'runtime-provenance.json')
  if (!(await fileExists(provenancePath))) return { ok: false, error: 'missing runtime-provenance.json' }
  let provenance
  try {
    provenance = JSON.parse(await readFile(provenancePath, 'utf8'))
  } catch (error) {
    return { ok: false, error: `runtime-provenance.json is not valid JSON: ${error.message}` }
  }
  if (!provenance || provenance.schemaVersion !== 1 || provenance.runtimeVersion !== manifest.runtimeVersion || provenance.platform !== manifest.platform || provenance.arch !== manifest.arch) {
    return { ok: false, error: 'runtime-provenance.json does not match runtime-manifest.json' }
  }

  for (const [kind, spec] of Object.entries(manifest.assets)) {
    const assetFile = join(artifactsDir, spec.asset)
    const info = await stat(assetFile).catch(() => null)
    if (!info?.isFile()) return { ok: false, error: `missing asset ${spec.asset} for ${kind}` }
    if (info.size !== spec.bytes) return { ok: false, error: `byte count mismatch for ${spec.asset}` }
    const actualHash = await sha256File(assetFile)
    if (actualHash.toLowerCase() !== spec.sha256.toLowerCase()) return { ok: false, error: `SHA-256 mismatch for ${spec.asset}` }

    const inspected = listArchiveEntries(assetFile)
    if (!inspected.ok) return { ok: false, error: inspected.error }
    const unsafeEntry = inspected.entries.find((entry) => !isSafeRuntimeReleaseArchiveEntry(entry))
    if (unsafeEntry) return { ok: false, error: `${spec.asset} contains unsafe archive entry: ${unsafeEntry}` }
    const missingFiles = spec.files.filter((file) => !archiveContains(inspected.entries, file))
    if (missingFiles.length > 0) return { ok: false, error: `${spec.asset} is missing required files: ${missingFiles.join(', ')}` }
  }

  return { ok: true, manifest }
}

async function main() {
  const artifactsDir = resolve(process.argv[2] || 'release-artifacts')
  const result = await verifyRuntimeReleaseDirectory(artifactsDir)
  if (!result.ok) {
    console.error(`RUNTIME RELEASE VERIFICATION FAILED: ${result.error}`)
    process.exit(1)
  }
  console.log(`Runtime release OK: ${result.manifest.runtimeVersion}; ${Object.keys(result.manifest.assets).length} assets verified.`)
}

let isDirectRun = false
try {
  isDirectRun = Boolean(process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
} catch {
  isDirectRun = false
}

if (isDirectRun) main().catch((error) => { console.error(error); process.exit(1) })
