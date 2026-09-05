import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SUPPORTED_KINDS = new Set(['ffmpeg', 'whisper-engine', 'whisper-cuda', 'ocr-engine', 'video2x', 'douyin', 'separator-engine'])
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
    if (new Set(spec.capabilities).size !== spec.capabilities.length) return `${kind}.capabilities contains duplicates`
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

export function sha256ArchiveEntry(archivePath, normalizedEntrypoint) {
  const target = normalizedEntrypoint.replace(/\\/g, '/').toLowerCase()
  const isWindows = process.platform === 'win32'
  if (isWindows) {
    const script = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $zip = [System.IO.Compression.ZipFile]::OpenRead('${escapePowerShellString(archivePath)}')
      try {
        $entry = $zip.Entries | Where-Object { $_.FullName.Replace('\\', '/').ToLower() -eq '${escapePowerShellString(target)}' } | Select-Object -First 1
        if (-not $entry) { throw "entry not found in archive" }
        $stream = $entry.Open()
        try {
          $sha = [System.Security.Cryptography.SHA256]::Create()
          $hashBytes = $sha.ComputeHash($stream)
          [System.BitConverter]::ToString($hashBytes).Replace('-', '').ToLower()
        } finally {
          $stream.Dispose()
        }
      } finally {
        $zip.Dispose()
      }
    `
    const res = spawnSync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script
    ], { encoding: 'utf8', windowsHide: true })
    if (res.error || res.status !== 0) {
      throw new Error(`Failed to compute hash of entry ${normalizedEntrypoint} in ${archivePath}: ${res.stderr || res.error}`)
    }
    const lines = res.stdout.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const hash = lines[lines.length - 1]
    if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error(`Invalid entry hash computed: ${hash}`)
    return hash.toLowerCase()
  } else {
    const res = spawnSync('unzip', ['-p', archivePath, normalizedEntrypoint], { maxBuffer: 500 * 1024 * 1024 })
    if (res.error || res.status !== 0) {
      throw new Error(`Failed to extract entry ${normalizedEntrypoint} from ${archivePath}`)
    }
    return createHash('sha256').update(res.stdout).digest('hex').toLowerCase()
  }
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

  // Verify nativeCapabilityProofs for ffmpeg if present or required
  const ffmpegSpec = manifest.assets['ffmpeg']
  const hasOcrMask = Boolean(ffmpegSpec?.capabilities?.includes('ocr-mask-v1'))
  const manifestProof = manifest.provenance?.nativeCapabilityProofs?.ffmpegOcrMask
  const standaloneProof = provenance.nativeCapabilityProofs?.ffmpegOcrMask

  if (!hasOcrMask) {
    if (manifestProof || standaloneProof) {
      return { ok: false, error: 'stray ffmpegOcrMask proof present when ocr-mask-v1 capability is absent' }
    }
  } else {
    if (!manifestProof || !standaloneProof) {
      return { ok: false, error: 'missing required ffmpegOcrMask native proof in manifest or provenance' }
    }
    if (JSON.stringify(manifestProof) !== JSON.stringify(standaloneProof)) {
      return { ok: false, error: 'embedded manifest proof does not match standalone runtime-provenance.json' }
    }
    if (
      manifestProof.schemaVersion !== 1 ||
      manifestProof.capability !== 'ocr-mask-v1' ||
      manifestProof.native !== true ||
      manifestProof.passed !== true ||
      manifestProof.runtimeVersion !== manifest.runtimeVersion ||
      manifestProof.platform !== manifest.platform ||
      manifestProof.arch !== manifest.arch ||
      manifestProof.asset !== ffmpegSpec.asset ||
      manifestProof.entrypoint !== ffmpegSpec.entrypoint
    ) {
      return { ok: false, error: 'invalid metadata in ffmpegOcrMask proof' }
    }
    try {
      const parsedDate = new Date(manifestProof.executedAt)
      if (parsedDate.toISOString() !== manifestProof.executedAt) {
        return { ok: false, error: 'executedAt must be a valid round-tripping ISO timestamp' }
      }
    } catch {
      return { ok: false, error: 'executedAt must be a valid ISO timestamp' }
    }

    const expectedCases = [
      'appear-disappear',
      'terminal-black-frame',
      'moving-resize',
      'moving-resize-with-narration'
    ]
    if (
      !Array.isArray(manifestProof.cases) ||
      manifestProof.cases.length !== 4 ||
      manifestProof.cases.some((c, i) => c.id !== expectedCases[i] || c.passed !== true)
    ) {
      return { ok: false, error: 'proof cases must contain the exact four passed test case IDs' }
    }

    const entryHash = sha256ArchiveEntry(join(artifactsDir, ffmpegSpec.asset), ffmpegSpec.entrypoint)
    if (entryHash.toLowerCase() !== manifestProof.ffmpegExecutableSha256.toLowerCase()) {
      return { ok: false, error: `archived ffmpeg entry SHA-256 (${entryHash}) does not match proof (${manifestProof.ffmpegExecutableSha256})` }
    }
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
