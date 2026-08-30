import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, rm, stat, writeFile, copyFile, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
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

async function findInPath(cmd) {
  try {
    const { stdout } = await execFileAsync('where.exe', [cmd])
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    return lines[0] || null
  } catch {
    return null
  }
}

async function main() {
  const outDir = resolve('release-artifacts')
  await mkdir(outDir, { recursive: true })

  const appData = process.env.APPDATA || (process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Roaming') : '')
  const appDataBin = appData ? join(appData, 'tedia-pros', 'bin') : ''
  const devRuntime = process.env.TEDIAPROS_RUNTIME_DIR || ''

  const manifestAssets = {}

  // 1. Faster-Whisper Engine
  const whisperSearch = [
    resolve('engines/whisper-engine/dist/whisper-engine'),
    resolve('dist-engine/whisper-engine'),
    process.env.WHISPER_RUNTIME_DIR,
    devRuntime ? join(devRuntime, 'whisper-engine') : null,
    appDataBin ? join(appDataBin, 'whisper-engine') : null
  ].filter(Boolean)

  let whisperDir = null
  for (const dir of whisperSearch) {
    if (await fileExists(join(dir, 'whisper-engine.exe'))) {
      whisperDir = dir
      break
    }
  }

  const whisperZip = join(outDir, 'whisper-engine-win.zip')
  if (whisperDir) {
    console.log(`[Pack] Nén Faster-Whisper ${whisperDir} -> ${whisperZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${whisperDir}\\*' -DestinationPath '${whisperZip}' -Force`
    ])
  }

  if (await fileExists(whisperZip)) {
    const whisperStat = await stat(whisperZip)
    const whisperHash = await sha256File(whisperZip)
    console.log(`[Pack] whisper-engine-win.zip: ${whisperStat.size} bytes, sha256: ${whisperHash}`)
    manifestAssets['whisper'] = {
      version: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      asset: 'whisper-engine-win.zip',
      entrypoint: 'whisper-engine.exe',
      sha256: whisperHash,
      bytes: whisperStat.size,
      protocol: 'whisper-engine/1'
    }
  }

  // 2. OCR Engine
  const ocrSearch = [
    resolve('engines/ocr-engine/dist/ocr-engine'),
    resolve('dist-engine/ocr-engine'),
    process.env.OCR_RUNTIME_DIR,
    devRuntime ? join(devRuntime, 'ocr-engine') : null,
    devRuntime ? join(devRuntime, 'ocr') : null,
    appDataBin ? join(appDataBin, 'ocr-engine') : null,
    appDataBin ? join(appDataBin, 'ocr') : null
  ].filter(Boolean)

  let ocrDir = null
  for (const dir of ocrSearch) {
    if (await fileExists(join(dir, 'ocr-engine.exe'))) {
      ocrDir = dir
      break
    }
  }

  const ocrZip = join(outDir, 'ocr-engine-win.zip')
  if (ocrDir) {
    console.log(`[Pack] Nén OCR ${ocrDir} -> ${ocrZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${ocrDir}\\*' -DestinationPath '${ocrZip}' -Force`
    ])
  }

  if (await fileExists(ocrZip)) {
    const ocrStat = await stat(ocrZip)
    const ocrHash = await sha256File(ocrZip)
    console.log(`[Pack] ocr-engine-win.zip: ${ocrStat.size} bytes, sha256: ${ocrHash}`)
    manifestAssets['ocr'] = {
      version: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      asset: 'ocr-engine-win.zip',
      entrypoint: 'ocr-engine.exe',
      sha256: ocrHash,
      bytes: ocrStat.size,
      protocol: 'ocr-local/1'
    }
  }

  // 3. FFmpeg & FFprobe
  const ffmpegSearch = [
    process.env.FFMPEG_DIR,
    devRuntime ? join(devRuntime, 'ffmpeg') : null,
    appDataBin ? join(appDataBin, 'ffmpeg') : null,
    appDataBin
  ].filter(Boolean)

  let ffmpegDir = null
  for (const dir of ffmpegSearch) {
    if ((await fileExists(join(dir, 'ffmpeg.exe'))) && (await fileExists(join(dir, 'ffprobe.exe')))) {
      ffmpegDir = dir
      break
    }
  }

  if (!ffmpegDir) {
    const foundFf = await findInPath('ffmpeg.exe')
    const foundPr = await findInPath('ffprobe.exe')
    if (foundFf && foundPr) {
      ffmpegDir = dirname(foundFf)
    }
  }

  const ffmpegZip = join(outDir, 'ffmpeg-win.zip')
  if (ffmpegDir && (await fileExists(join(ffmpegDir, 'ffmpeg.exe'))) && (await fileExists(join(ffmpegDir, 'ffprobe.exe')))) {
    console.log(`[Pack] Nén FFmpeg ${ffmpegDir} -> ${ffmpegZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${ffmpegDir}\\ffmpeg.exe', '${ffmpegDir}\\ffprobe.exe' -DestinationPath '${ffmpegZip}' -Force`
    ])
  }

  if (await fileExists(ffmpegZip)) {
    const ffStat = await stat(ffmpegZip)
    const ffHash = await sha256File(ffmpegZip)
    console.log(`[Pack] ffmpeg-win.zip: ${ffStat.size} bytes, sha256: ${ffHash}`)
    manifestAssets['ffmpeg'] = {
      version: '7.1.0',
      platform: 'win32',
      arch: 'x64',
      asset: 'ffmpeg-win.zip',
      entrypoint: 'ffmpeg.exe',
      sha256: ffHash,
      bytes: ffStat.size
    }
  }

  // 4. Video2X Engine
  const video2xSearch = [
    process.env.VIDEO2X_RUNTIME_DIR,
    devRuntime ? join(devRuntime, 'video2x') : null,
    appDataBin ? join(appDataBin, 'video2x') : null
  ].filter(Boolean)

  let video2xDir = null
  for (const dir of video2xSearch) {
    if (await fileExists(join(dir, 'video2x.exe'))) {
      video2xDir = dir
      break
    }
  }

  const video2xZip = join(outDir, 'video2x-win.zip')
  if (video2xDir) {
    console.log(`[Pack] Nén Video2X ${video2xDir} -> ${video2xZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${video2xDir}\\*' -DestinationPath '${video2xZip}' -Force`
    ])
  }

  if (await fileExists(video2xZip)) {
    const v2xStat = await stat(video2xZip)
    const v2xHash = await sha256File(video2xZip)
    console.log(`[Pack] video2x-win.zip: ${v2xStat.size} bytes, sha256: ${v2xHash}`)
    manifestAssets['video2x'] = {
      version: '6.4.0',
      platform: 'win32',
      arch: 'x64',
      asset: 'video2x-win.zip',
      entrypoint: 'video2x.exe',
      sha256: v2xHash,
      bytes: v2xStat.size
    }
  }

  // 5. Douyin Engine
  const douyinSearch = [
    resolve('engines/douyin-engine/dist/dy-engine'),
    resolve('dist-engine/douyin-engine'),
    process.env.DOUYIN_RUNTIME_DIR,
    devRuntime ? join(devRuntime, 'douyin') : null,
    appDataBin ? join(appDataBin, 'douyin') : null
  ].filter(Boolean)

  let douyinDir = null
  for (const dir of douyinSearch) {
    if (await fileExists(join(dir, 'dy-engine.exe'))) {
      douyinDir = dir
      break
    }
  }

  const douyinZip = join(outDir, 'douyin-win.zip')
  if (douyinDir) {
    console.log(`[Pack] Nén Douyin ${douyinDir} -> ${douyinZip}...`)
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${douyinDir}\\*' -DestinationPath '${douyinZip}' -Force`
    ])
  }

  if (await fileExists(douyinZip)) {
    const dyStat = await stat(douyinZip)
    const dyHash = await sha256File(douyinZip)
    console.log(`[Pack] douyin-win.zip: ${dyStat.size} bytes, sha256: ${dyHash}`)
    manifestAssets['douyin'] = {
      version: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      asset: 'douyin-win.zip',
      entrypoint: 'dy-engine.exe',
      sha256: dyHash,
      bytes: dyStat.size
    }
  }

  // 6. Manifest
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

  const enginesManifest = {
    whisper: 1,
    ocr: 1,
    douyin: 1,
    video2x: 1
  }
  const enginesManifestPath = join(outDir, 'engines-manifest.json')
  await writeFile(enginesManifestPath, JSON.stringify(enginesManifest, null, 2), 'utf8')
  console.log(`[Pack] Đã ghi ${enginesManifestPath}`)

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
