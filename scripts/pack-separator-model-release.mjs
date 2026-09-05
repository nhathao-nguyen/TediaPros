#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readdir, rm, stat, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function escapePowerShellString(value) {
  return value.replace(/'/g, "''")
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex').toLowerCase()
}

async function archiveDirectory(sourceDir, archivePath) {
  await rm(archivePath, { force: true }).catch(() => {})
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

function parseArgs(argv) {
  const values = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    values[key] = value
    i += 1
  }
  return values
}

export async function packSeparatorModelRelease(options) {
  const inputDir = resolve(options.inputDir)
  const outputDir = resolve(options.outputDir)
  const modelInputsPath = resolve(options.modelInputs)
  const runtimeVersion = options.runtimeVersion || 'runtime-v5'

  const inputs = JSON.parse(await readFile(modelInputsPath, 'utf8'))
  const models = inputs.models || {}
  const modelKeys = Object.keys(models).sort()

  if (modelKeys.length !== 2 || !modelKeys.includes('separator-fast-balanced-v1') || !modelKeys.includes('separator-quality-v1')) {
    throw new Error('model-inputs must contain exactly separator-fast-balanced-v1 and separator-quality-v1')
  }

  await mkdir(outputDir, { recursive: true })

  const manifestModels = {}

  for (const modelId of modelKeys) {
    const spec = models[modelId]
    const modelSourceDir = join(inputDir, modelId)
    const modelFilePath = join(modelSourceDir, 'model.onnx')

    const fileStat = await stat(modelFilePath)
    if (!fileStat.isFile() || fileStat.size <= 0) {
      throw new Error(`Model file not found or empty: ${modelFilePath}`)
    }

    const actualHash = await sha256File(modelFilePath)
    if (actualHash !== spec.model.sha256.toLowerCase()) {
      throw new Error(`Model SHA-256 mismatch for ${modelId}: got ${actualHash}, expected ${spec.model.sha256}`)
    }
    if (fileStat.size !== spec.model.bytes) {
      throw new Error(`Model byte mismatch for ${modelId}: got ${fileStat.size}, expected ${spec.model.bytes}`)
    }

    // Write package manifest.json
    const packageManifest = {
      id: spec.id,
      version: spec.version,
      mdx: spec.mdx,
      license: spec.license,
      source: spec.source
    }
    await writeFile(join(modelSourceDir, 'manifest.json'), JSON.stringify(packageManifest, null, 2), 'utf8')

    const assetName = `${modelId}-${spec.version}.zip`
    const archivePath = join(outputDir, assetName)

    await archiveDirectory(modelSourceDir, archivePath)

    const archiveStat = await stat(archivePath)
    const archiveSha256 = await sha256File(archivePath)

    manifestModels[modelId] = {
      ...spec,
      asset: assetName,
      archiveBytes: archiveStat.size,
      expandedBytes: fileStat.size + Buffer.byteLength(JSON.stringify(packageManifest, null, 2)),
      archiveSha256
    }
  }

  const releaseManifest = {
    schemaVersion: 1,
    runtimeChannel: runtimeVersion,
    models: manifestModels
  }

  const manifestPath = join(outputDir, 'separator-model-manifest.json')
  await writeFile(manifestPath, JSON.stringify(releaseManifest, null, 2), 'utf8')

  return { manifest: releaseManifest, outputDir }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args['input-dir'] || !args['output-dir'] || !args['model-inputs']) {
    console.error('Usage: pack-separator-model-release.mjs --input-dir <dir> --model-inputs <file> --output-dir <dir> [--runtime-version <version>]')
    process.exit(1)
  }
  await packSeparatorModelRelease({
    inputDir: args['input-dir'],
    modelInputs: args['model-inputs'],
    outputDir: args['output-dir'],
    runtimeVersion: args['runtime-version']
  })
  console.log('Successfully packed separator model release.')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || '')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
