#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const REQUIRED_MODELS = new Set(['separator-fast-balanced-v1', 'separator-quality-v1'])

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex').toLowerCase()
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
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
    throw new Error(`Failed to list archive entries for ${assetFile}: ${inspected.stderr || inspected.error}`)
  }
  return inspected.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export async function verifySeparatorModelReleaseDirectory(releaseDir) {
  const manifestPath = join(releaseDir, 'separator-model-manifest.json')
  if (!(await fileExists(manifestPath))) {
    return { ok: false, error: 'separator-model-manifest.json not found' }
  }

  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (e) {
    return { ok: false, error: `Invalid JSON in manifest: ${e.message}` }
  }

  if (manifest.schemaVersion !== 1) return { ok: false, error: 'schemaVersion must be 1' }
  if (manifest.runtimeChannel !== 'runtime-v4' && manifest.runtimeChannel !== 'runtime-v5') {
    return { ok: false, error: 'runtimeChannel must be runtime-v4 or runtime-v5' }
  }
  if (!manifest.models || typeof manifest.models !== 'object') return { ok: false, error: 'models object is required' }

  const modelKeys = Object.keys(manifest.models)
  if (modelKeys.length !== REQUIRED_MODELS.size || !modelKeys.every((k) => REQUIRED_MODELS.has(k))) {
    return { ok: false, error: 'manifest must contain exactly separator-fast-balanced-v1 and separator-quality-v1' }
  }

  for (const [id, spec] of Object.entries(manifest.models)) {
    if (spec.id !== id) return { ok: false, error: `id mismatch for ${id}` }
    const assetPath = join(releaseDir, spec.asset)
    if (!(await fileExists(assetPath))) {
      return { ok: false, error: `Model archive ${spec.asset} not found` }
    }

    const fileStat = await stat(assetPath)
    if (fileStat.size !== spec.archiveBytes) {
      return { ok: false, error: `Byte mismatch for ${spec.asset}: got ${fileStat.size}, expected ${spec.archiveBytes}` }
    }

    const actualHash = await sha256File(assetPath)
    if (actualHash !== spec.archiveSha256.toLowerCase()) {
      return { ok: false, error: `SHA-256 mismatch for ${spec.asset}: got ${actualHash}, expected ${spec.archiveSha256}` }
    }

    // Inspect archive entries
    const entries = listArchiveEntries(assetPath)
    if (entries.length === 0) {
      return { ok: false, error: `Archive ${spec.asset} is empty` }
    }

    const normalizedEntries = entries.map((e) => e.replace(/\\/g, '/'))
    for (const entry of normalizedEntries) {
      if (entry.startsWith('/') || /^[A-Za-z]:\//.test(entry) || entry.includes('..')) {
        return { ok: false, error: `Unsafe path in archive ${spec.asset}: ${entry}` }
      }
      if (/\.(exe|dll|so|dylib|py|sh|bat|cmd|wav|mp3|flac|ogg)$/i.test(entry) && !entry.endsWith('model.onnx')) {
        return { ok: false, error: `Forbidden file in model archive ${spec.asset}: ${entry}` }
      }
    }

    if (!normalizedEntries.some((e) => e === 'model.onnx' || e.endsWith('/model.onnx'))) {
      return { ok: false, error: `Archive ${spec.asset} missing model.onnx` }
    }
  }

  return { ok: true }
}

async function main() {
  const targetDir = process.argv[2]
  if (!targetDir) {
    console.error('Usage: verify-separator-model-release.mjs <release-directory>')
    process.exit(1)
  }
  const result = await verifySeparatorModelReleaseDirectory(resolve(targetDir))
  if (!result.ok) {
    console.error(`Verification failed: ${result.error}`)
    process.exit(1)
  }
  console.log('Successfully verified separator model release directory.')
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename || '')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
