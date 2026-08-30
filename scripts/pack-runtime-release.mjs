import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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

async function main() {
  const outDir = resolve('release-artifacts')
  await rm(outDir, { recursive: true, force: true }).catch(() => {})
  await mkdir(outDir, { recursive: true })

  const appData = process.env.APPDATA || join(process.env.USERPROFILE || 'C:\\Users\\PC', 'AppData', 'Roaming')
  const appDataRuntime = join(appData, 'tedia-pros', 'runtime')

  const whisperSource = join(appDataRuntime, 'whisper-cpp')
  const whisperZip = join(outDir, 'whisper-cpp-win32-x64.zip')

  console.log(`[Pack] Nén Whisper ${whisperSource} -> ${whisperZip}...`)
  await execFileAsync('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Compress-Archive -Path '${whisperSource}\\*' -DestinationPath '${whisperZip}' -Force`
  ])

  const whisperStat = await stat(whisperZip)
  const whisperHash = await sha256File(whisperZip)
  console.log(`[Pack] whisper-cpp-win32-x64.zip tạo thành công: ${whisperStat.size} bytes, sha256: ${whisperHash}`)

  // OCR Engine
  let ocrSource = join(appDataRuntime, 'ocr')
  if (!(await fileExists(join(ocrSource, 'ocr-engine.exe')))) {
    ocrSource = join(appData, 'tedia-pros', 'bin', 'ocr-engine')
  }

  const ocrZip = join(outDir, 'ocr-win32-x64.zip')
  let ocrAssetEntry = null

  if (await fileExists(join(ocrSource, 'ocr-engine.exe'))) {
    console.log(`[Pack] Nén OCR ${ocrSource} -> ${ocrZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${ocrSource}\\*' -DestinationPath '${ocrZip}' -Force`
    ])
    const ocrStat = await stat(ocrZip)
    const ocrHash = await sha256File(ocrZip)
    console.log(`[Pack] ocr-win32-x64.zip tạo thành công: ${ocrStat.size} bytes, sha256: ${ocrHash}`)

    ocrAssetEntry = {
      version: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      asset: 'ocr-win32-x64.zip',
      entrypoint: 'ocr-engine.exe',
      sha256: ocrHash,
      bytes: ocrStat.size,
      protocol: 'ocr-local/1'
    }
  }

  const manifest = {
    schemaVersion: 1,
    runtimeVersion: 'runtime-v1',
    platform: 'win32',
    arch: 'x64',
    assets: {
      'whisper-cpp': {
        version: '1.0.0',
        platform: 'win32',
        arch: 'x64',
        asset: 'whisper-cpp-win32-x64.zip',
        entrypoint: 'whisper-local-worker.exe',
        sha256: whisperHash,
        bytes: whisperStat.size,
        protocol: 'whisper-local/1'
      },
      ...(ocrAssetEntry ? { ocr: ocrAssetEntry } : {})
    }
  }

  const manifestPath = join(outDir, 'runtime-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`[Pack] Đã ghi ${manifestPath}`)

  console.log('\n=== TỔNG HỢP RELEASE ARTIFACTS SẴN SÀNG UPLOAD GITHUB RELEASE ===')
  console.log(`1. ${whisperZip}`)
  if (ocrAssetEntry) console.log(`2. ${ocrZip}`)
  console.log(`3. ${manifestPath}`)
}

main().catch((err) => {
  console.error('[Pack] Lỗi:', err)
  process.exit(1)
})
