import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readdir, rm, stat, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const REQUIRED_KINDS = ['ffmpeg', 'whisper-engine', 'whisper-cuda', 'ocr-engine', 'video2x', 'douyin']
const LEGACY_INPUT_ENV = [
  'TEDIAPROS_RUNTIME_DIR',
  'WHISPER_RUNTIME_DIR',
  'OCR_RUNTIME_DIR',
  'FFMPEG_DIR',
  'VIDEO2X_RUNTIME_DIR',
  'DOUYIN_RUNTIME_DIR'
]

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

function currentPlatform() {
  return process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
}

function currentArch() {
  return process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'ia32' : 'x64'
}

function parseArgs(argv) {
  const values = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    values[key] = value
    i += 1
  }
  return values
}

function ensureCleanInputEnvironment() {
  const configured = LEGACY_INPUT_ENV.filter((name) => process.env[name]?.trim())
  if (configured.length > 0) throw new Error(`Refusing implicit runtime inputs from environment: ${configured.join(', ')}`)
}

function ensureInside(root, candidate) {
  const rootPath = resolve(root)
  const candidatePath = resolve(candidate)
  const prefix = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`
  if (candidatePath !== rootPath && !candidatePath.startsWith(prefix)) {
    throw new Error(`Runtime input escapes input root: ${candidatePath}`)
  }
  return candidatePath
}

async function collectFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(current, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not allowed in runtime input: ${fullPath}`)
    if (entry.isDirectory()) files.push(...await collectFiles(root, fullPath))
    else if (entry.isFile()) files.push(relative(root, fullPath).replace(/\\/g, '/'))
    else throw new Error(`Unsupported runtime input entry: ${fullPath}`)
  }
  return files
}

function escapePowerShellString(value) {
  return value.replace(/'/g, "''")
}

async function archiveDirectory(sourceDir, archivePath) {
  await rm(archivePath, { force: true })
  if (process.platform === 'win32') {
    const source = escapePowerShellString(resolve(sourceDir))
    const destination = escapePowerShellString(resolve(archivePath))
    const command = `Compress-Archive -Path '${source}\\*' -DestinationPath '${destination}' -Force`
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command
    ], { windowsHide: true })
  } else {
    await execFileAsync('zip', ['-q', '-r', resolve(archivePath), '.'], { cwd: resolve(sourceDir) })
  }
}

async function loadInputSpec(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'))
  if (!parsed || parsed.schemaVersion !== 1 || !parsed.assets || typeof parsed.assets !== 'object') {
    throw new Error(`Invalid runtime input specification: ${path}`)
  }
  return parsed
}

function validateAssetMetadata(kind, metadata) {
  if (!metadata || typeof metadata !== 'object') throw new Error(`Missing metadata for runtime kind ${kind}`)
  for (const field of ['version', 'entrypoint']) {
    if (typeof metadata[field] !== 'string' || !metadata[field].trim()) throw new Error(`${kind}.${field} is required`)
  }
  if (!Array.isArray(metadata.capabilities) || metadata.capabilities.length === 0 || !metadata.capabilities.every((value) => typeof value === 'string' && value.trim())) {
    throw new Error(`${kind}.capabilities is required`)
  }
  if (metadata.protocol !== undefined && (typeof metadata.protocol !== 'string' || !metadata.protocol.trim())) {
    throw new Error(`${kind}.protocol is invalid`)
  }
  const entrypoint = metadata.entrypoint.replace(/\\/g, '/')
  if (entrypoint.split('/').some((part) => !part || part === '.' || part === '..') || entrypoint.startsWith('/')) {
    throw new Error(`${kind}.entrypoint is unsafe`)
  }
  return { ...metadata, entrypoint }
}

export async function buildRuntimeRelease({ inputDir, outputDir, runtimeVersion, platform = currentPlatform(), arch = currentArch(), inputSpecPath = resolve('distribution/runtime-inputs.json') }) {
  ensureCleanInputEnvironment()
  if (!inputDir) throw new Error('An explicit --input-dir is required; no developer or APPDATA discovery is allowed.')
  if (!runtimeVersion) throw new Error('An explicit --runtime-version is required.')
  const inputRoot = resolve(inputDir)
  const outputRoot = resolve(outputDir || 'release-artifacts')
  if (!(await stat(inputRoot).catch(() => null))?.isDirectory()) throw new Error(`Input directory does not exist: ${inputRoot}`)
  if (process.env.APPDATA && resolve(inputRoot).toLowerCase().startsWith(resolve(process.env.APPDATA).toLowerCase())) {
    throw new Error('Refusing runtime input rooted in APPDATA.')
  }
  const inputSpec = await loadInputSpec(resolve(inputSpecPath))
  if (inputSpec.runtimeVersion !== runtimeVersion || inputSpec.platform !== platform || inputSpec.arch !== arch) {
    throw new Error('Runtime input specification does not match the requested version/platform/architecture.')
  }
  await mkdir(outputRoot, { recursive: true })
  const assets = {}
  const provenanceAssets = {}
  for (const kind of REQUIRED_KINDS) {
    const sourceDir = ensureInside(inputRoot, join(inputRoot, kind))
    const metadata = validateAssetMetadata(kind, inputSpec.assets[kind])
    if (!(await stat(sourceDir).catch(() => null))?.isDirectory()) throw new Error(`Missing clean runtime input: ${sourceDir}`)
    const files = await collectFiles(sourceDir)
    if (files.length === 0) throw new Error(`Runtime input is empty: ${kind}`)
    if (!files.includes(metadata.entrypoint)) throw new Error(`${kind} input does not contain entrypoint ${metadata.entrypoint}`)
    const asset = `tediapros-${kind}-${platform}-${arch}.zip`
    const archivePath = join(outputRoot, asset)
    await archiveDirectory(sourceDir, archivePath)
    const info = await stat(archivePath)
    assets[kind] = {
      version: metadata.version,
      platform,
      arch,
      asset,
      sha256: await sha256File(archivePath),
      bytes: info.size,
      entrypoint: metadata.entrypoint,
      ...(metadata.protocol ? { protocol: metadata.protocol } : {}),
      capabilities: metadata.capabilities,
      files
    }
    provenanceAssets[kind] = metadata.source || null
  }

  const provenance = {
    schemaVersion: 1,
    runtimeVersion,
    platform,
    arch,
    sourceRevision: process.env.GITHUB_SHA || null,
    generatedBy: 'scripts/pack-runtime-release.mjs',
    assets: provenanceAssets,
    externalInputs: inputSpec.externalInputs || {}
  }
  const manifest = { schemaVersion: 1, runtimeVersion, platform, arch, assets, provenance }
  await writeFile(join(outputRoot, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeFile(join(outputRoot, 'runtime-provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8')
  const { verifyRuntimeReleaseDirectory } = await import('./verify-runtime-release.mjs')
  const verification = await verifyRuntimeReleaseDirectory(outputRoot)
  if (!verification.ok) throw new Error(`Generated runtime release failed verification: ${verification.error}`)
  return { outputDir: outputRoot, manifest, provenance }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await buildRuntimeRelease({
    inputDir: args['input-dir'],
    outputDir: args['output-dir'],
    runtimeVersion: args['runtime-version'],
    platform: args.platform,
    arch: args.arch,
    inputSpecPath: args['input-spec'] ? resolve(args['input-spec']) : resolve('distribution/runtime-inputs.json')
  })
  console.log(`Runtime release packed and verified: ${result.manifest.runtimeVersion}; ${Object.keys(result.manifest.assets).length} assets.`)
}

let isDirectRun = false
try {
  isDirectRun = Boolean(process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
} catch {
  isDirectRun = false
}
if (isDirectRun) main().catch((error) => { console.error(`[Pack] ${error.message}`); process.exit(1) })
