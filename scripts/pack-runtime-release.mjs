import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
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

async function main() {
  const outDir = resolve('release-artifacts')
  await rm(outDir, { recursive: true, force: true }).catch(() => {})
  await mkdir(outDir, { recursive: true })

  const appDataRuntime = process.env.APPDATA
    ? join(process.env.APPDATA, 'tedia-pros', 'runtime')
    : null

  if (!appDataRuntime) {
    console.error('Không tìm thấy APPDATA')
    process.exit(1)
  }

  const whisperSource = join(appDataRuntime, 'whisper-cpp')
  const whisperZip = join(outDir, 'whisper-cpp-win32-x64.zip')

  console.log(`[Pack] Nén ${whisperSource} -> ${whisperZip}...`)

  if (process.platform === 'win32') {
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${whisperSource}\\*' -DestinationPath '${whisperZip}' -Force`
    ])
  } else {
    await execFileAsync('zip', ['-r', whisperZip, '.'], { cwd: whisperSource })
  }

  const zipStat = await stat(whisperZip)
  const zipHash = await sha256File(whisperZip)
  console.log(`[Pack] whisper-cpp-win32-x64.zip tạo thành công: ${zipStat.size} bytes, sha256: ${zipHash}`)

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
        sha256: zipHash,
        bytes: zipStat.size,
        protocol: 'whisper-local/1'
      }
    }
  }

  const manifestPath = join(outDir, 'runtime-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`[Pack] Đã ghi ${manifestPath}`)

  console.log('\n=== TỔNG HỢP RELEASE ARTIFACTS SẴN SÀNG UPLOAD GITHUB RELEASE ===')
  console.log(`1. ${whisperZip}`)
  console.log(`2. ${manifestPath}`)
}

main().catch((err) => {
  console.error('[Pack] Lỗi:', err)
  process.exit(1)
})
