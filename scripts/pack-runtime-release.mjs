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

  const manifestAssets = {}

  // 1. Whisper.cpp
  const whisperSource = join(appDataRuntime, 'whisper-cpp')
  const whisperZip = join(outDir, 'whisper-cpp-win32-x64.zip')
  if (await fileExists(join(whisperSource, 'whisper-local-worker.exe'))) {
    console.log(`[Pack] Nén Whisper ${whisperSource} -> ${whisperZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${whisperSource}\\*' -DestinationPath '${whisperZip}' -Force`
    ])
    const whisperStat = await stat(whisperZip)
    const whisperHash = await sha256File(whisperZip)
    console.log(`[Pack] whisper-cpp-win32-x64.zip: ${whisperStat.size} bytes, sha256: ${whisperHash}`)
    manifestAssets['whisper-cpp'] = {
      version: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      asset: 'whisper-cpp-win32-x64.zip',
      entrypoint: 'whisper-local-worker.exe',
      sha256: whisperHash,
      bytes: whisperStat.size,
      protocol: 'whisper-local/1'
    }
  }

  // 2. OCR Engine
  let ocrSource = join(appDataRuntime, 'ocr')
  if (!(await fileExists(join(ocrSource, 'ocr-engine.exe')))) {
    ocrSource = join(appData, 'tedia-pros', 'bin', 'ocr-engine')
  }
  const ocrZip = join(outDir, 'ocr-win32-x64.zip')
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
    console.log(`[Pack] ocr-win32-x64.zip: ${ocrStat.size} bytes, sha256: ${ocrHash}`)
    manifestAssets['ocr'] = {
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

  // 3. FFmpeg & FFprobe
  let ffmpegBinDir = 'D:\\New folder\\ffmpeg-2026-03-12-git-9dc44b43b2-essentials_build\\bin'
  if (!(await fileExists(join(ffmpegBinDir, 'ffmpeg.exe')))) {
    ffmpegBinDir = join(appDataRuntime, 'ffmpeg')
  }
  const ffmpegZip = join(outDir, 'ffmpeg-win32-x64.zip')
  if (await fileExists(join(ffmpegBinDir, 'ffmpeg.exe'))) {
    console.log(`[Pack] Nén FFmpeg ${ffmpegBinDir} -> ${ffmpegZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${ffmpegBinDir}\\ffmpeg.exe', '${ffmpegBinDir}\\ffprobe.exe' -DestinationPath '${ffmpegZip}' -Force`
    ])
    const ffStat = await stat(ffmpegZip)
    const ffHash = await sha256File(ffmpegZip)
    console.log(`[Pack] ffmpeg-win32-x64.zip: ${ffStat.size} bytes, sha256: ${ffHash}`)
    manifestAssets['ffmpeg'] = {
      version: '7.1.0',
      platform: 'win32',
      arch: 'x64',
      asset: 'ffmpeg-win32-x64.zip',
      entrypoint: 'ffmpeg.exe',
      sha256: ffHash,
      bytes: ffStat.size
    }
  }

  // 4. yt-dlp
  const ytdlpExe = join(appData, 'tedia-pros', 'bin', 'yt-dlp.exe')
  const ytdlpZip = join(outDir, 'ytdlp-win32-x64.zip')
  if (await fileExists(ytdlpExe)) {
    console.log(`[Pack] Nén yt-dlp ${ytdlpExe} -> ${ytdlpZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${ytdlpExe}' -DestinationPath '${ytdlpZip}' -Force`
    ])
    const ytStat = await stat(ytdlpZip)
    const ytHash = await sha256File(ytdlpZip)
    console.log(`[Pack] ytdlp-win32-x64.zip: ${ytStat.size} bytes, sha256: ${ytHash}`)
    manifestAssets['ytdlp'] = {
      version: '2026.08.01',
      platform: 'win32',
      arch: 'x64',
      asset: 'ytdlp-win32-x64.zip',
      entrypoint: 'yt-dlp.exe',
      sha256: ytHash,
      bytes: ytStat.size
    }
  }

  const manifest = {
    schemaVersion: 1,
    runtimeVersion: 'runtime-v1',
    platform: 'win32',
    arch: 'x64',
    assets: manifestAssets
  }

  const manifestPath = join(outDir, 'runtime-manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`\n[Pack] Đã ghi ${manifestPath}`)

  console.log('\n=== TỔNG HỢP TOÀN BỘ RELEASE ARTIFACTS SẴN SÀNG UPLOAD GITHUB RELEASE ===')
  for (const [key, item] of Object.entries(manifestAssets)) {
    console.log(`• [${key}]: ${join(outDir, item.asset)} (${(item.bytes / (1024 * 1024)).toFixed(2)} MB)`)
  }
  console.log(`• [manifest]: ${manifestPath}`)
}

main().catch((err) => {
  console.error('[Pack] Lỗi:', err)
  process.exit(1)
})
