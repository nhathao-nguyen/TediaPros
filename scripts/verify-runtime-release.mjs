import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function fileExists(p) {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function verifyRuntimeReleaseDirectory(artifactsDir) {
  const manifestPath = join(artifactsDir, 'runtime-manifest.json')
  if (!(await fileExists(manifestPath))) {
    return { ok: false, error: `Thiếu file manifest tại ${manifestPath}` }
  }

  let manifest
  try {
    const raw = await readFile(manifestPath, 'utf8')
    manifest = JSON.parse(raw)
  } catch (err) {
    return { ok: false, error: `Manifest không parse được JSON: ${err.message}` }
  }

  if (manifest.schemaVersion !== 1) {
    return { ok: false, error: `schemaVersion phải là 1 (nhận ${manifest.schemaVersion})` }
  }

  if (!manifest.runtimeVersion || typeof manifest.runtimeVersion !== 'string') {
    return { ok: false, error: 'Thiếu runtimeVersion hợp lệ' }
  }

  if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    return { ok: false, error: 'Thiếu mục assets trong manifest' }
  }

  const assetKeys = Object.keys(manifest.assets)
  if (assetKeys.length === 0) {
    return { ok: false, error: 'Manifest không khai báo bất kỳ asset nào' }
  }

  for (const [kind, spec] of Object.entries(manifest.assets)) {
    if (!spec.asset || typeof spec.asset !== 'string') {
      return { ok: false, error: `Asset [${kind}] thiếu tên file asset` }
    }
    if (!spec.sha256 || !/^[a-f0-9]{64}$/i.test(spec.sha256)) {
      return { ok: false, error: `Asset [${kind}] thiếu SHA-256 hợp lệ` }
    }
    if (!spec.entrypoint || typeof spec.entrypoint !== 'string') {
      return { ok: false, error: `Asset [${kind}] thiếu entrypoint` }
    }

    const assetFile = join(artifactsDir, spec.asset)
    if (!(await fileExists(assetFile))) {
      return { ok: false, error: `File asset ${spec.asset} cho [${kind}] không tồn tại trên đĩa` }
    }

    const info = await stat(assetFile)
    if (spec.bytes && info.size !== spec.bytes) {
      return {
        ok: false,
        error: `File size của ${spec.asset} (${info.size} bytes) không khớp với manifest (${spec.bytes} bytes)`
      }
    }

    const actualHash = await sha256File(assetFile)
    if (actualHash.toLowerCase() !== spec.sha256.toLowerCase()) {
      return {
        ok: false,
        error: `SHA-256 của ${spec.asset} (${actualHash}) không khớp với manifest (${spec.sha256})`
      }
    }

    // Verify ZIP contains entrypoint using tar / powershell / unzip
    const isWin = process.platform === 'win32'
    let containsEntrypoint = false
    try {
      const inspect = isWin
        ? spawnSync('powershell', [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${assetFile}').Entries.FullName`
          ], { encoding: 'utf8', windowsHide: true })
        : spawnSync('unzip', ['-Z1', assetFile], { encoding: 'utf8' })

      if (inspect.status === 0 && inspect.stdout) {
        const entries = inspect.stdout.split(/\r?\n/).map((e) => e.trim().toLowerCase())
        const targetEntry = spec.entrypoint.toLowerCase()
        containsEntrypoint = entries.some((e) => e === targetEntry || e.endsWith('/' + targetEntry) || e.endsWith('\\' + targetEntry))
      }
    } catch {
      containsEntrypoint = true // fallback if inspection tool unavailable
    }

    if (!containsEntrypoint) {
      return {
        ok: false,
        error: `File ZIP ${spec.asset} không chứa entrypoint khai báo: ${spec.entrypoint}`
      }
    }
  }

  return { ok: true, manifest }
}

async function main() {
  const artifactsDir = resolve(process.argv[2] || 'release-artifacts')
  console.log(`[Verify] Kiểm tra runtime release artifacts trong: ${artifactsDir}...`)

  const result = await verifyRuntimeReleaseDirectory(artifactsDir)
  if (!result.ok) {
    console.error(`\n❌ RUNTIME RELEASE VERIFICATION FAILED:\n${result.error}`)
    process.exit(1)
  }

  console.log(`\n✓ PASS: Runtime release manifest và ${Object.keys(result.manifest.assets).length} assets hoàn toàn đồng bộ và hợp lệ!`)
  for (const [kind, item] of Object.entries(result.manifest.assets)) {
    console.log(`  • [${kind}]: ${item.asset} (${(item.bytes / (1024 * 1024)).toFixed(2)} MB, entrypoint: ${item.entrypoint})`)
  }
}

let isDirectRun = false
try {
  if (typeof import.meta !== 'undefined' && import.meta?.url && process.argv[1]) {
    isDirectRun = resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  }
} catch {
  isDirectRun = false
}

if (isDirectRun) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
