import { app } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, access, rm, copyFile, chmod, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { DepStatus, SetupProgress } from '../shared/types'
import { resolveFfmpeg as canonicalResolveFfmpeg } from './runtimeResolver'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
const YTDLP_RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const YTDLP_RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
let ytDlpInstallInFlight: Promise<void> | null = null

export type YtDlpSource = 'managed' | 'path'

export interface YtDlpInstallation {
  command: string
  source: YtDlpSource
}

export interface YtDlpCapabilities {
  installation: YtDlpInstallation | null
  version: string | null
  probeSucceeded: boolean
  impersonationAvailable: boolean
  impersonateTargets: string[]
  probeError: string | null
}

interface YtDlpReleaseAsset {
  name: string
  url: string
  checksumUrl: string | null
  version: string | null
}

/** Thu muc luu binaries tai ve, nam trong userData (khong can quyen admin). */
export function binDir(): string {
  return join(app.getPath('userData'), 'bin')
}

function exe(name: string): string {
  return isWin ? `${name}.exe` : name
}

/** Duong dan co dinh cua yt-dlp do app quan ly. */
export function managedYtDlpPath(): string {
  return join(binDir(), exe('yt-dlp'))
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Chay 1 lenh, gom stdout+stderr va khong de probe treo app vo han. */
function runCapture(
  cmd: string,
  args: string[],
  timeoutMs = 30_000
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    try {
      const child = spawn(cmd, args, { windowsHide: true })
      const finish = (code: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ code, out })
      }
      const timer = setTimeout(() => {
        out += '\nQua thoi gian cho yt-dlp.'
        child.kill()
        finish(-1)
      }, timeoutMs)
      child.stdout?.on('data', (d) => (out += d.toString()))
      child.stderr?.on('data', (d) => (out += d.toString()))
      child.on('error', () => finish(-1))
      child.on('close', (code) => finish(code ?? -1))
    } catch {
      resolve({ code: -1, out })
    }
  })
}

/** Kiem tra mot lenh co chay duoc khong (tren PATH hoac duong dan tuyet doi). */
async function canRun(cmd: string, args: string[] = ['--version']): Promise<boolean> {
  return (await runCapture(cmd, args)).code === 0
}

/**
 * Tim yt-dlp va cho biet no den tu app hay PATH.
 * Ban do app quan ly luon duoc uu tien de tranh vo tinh dung ban pip thieu
 * dependency (dac biet la curl_cffi/impersonation).
 */
export async function resolveYtDlpInstallation(): Promise<YtDlpInstallation | null> {
  if (ytDlpInstallInFlight) await ytDlpInstallInFlight.catch(() => {})
  const local = managedYtDlpPath()
  if ((await fileExists(local)) && (await canRun(local))) {
    return { command: local, source: 'managed' }
  }
  if (await canRun('yt-dlp')) return { command: 'yt-dlp', source: 'path' }
  return null
}

/** Tra ve lenh yt-dlp dung duoc. Giu API cu cho cac module hien tai. */
export async function resolveYtDlp(): Promise<string | null> {
  return (await resolveYtDlpInstallation())?.command ?? null
}

function parseImpersonateTargets(output: string): string[] {
  const targets = new Set<string>()
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '')

  for (const rawLine of clean.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (
      !line ||
      line.startsWith('[info]') ||
      /^Client\s+OS\s+Source$/i.test(line) ||
      /^-+$/.test(line) ||
      /\((?:unavailable|not available)\)\s*$/i.test(line)
    ) {
      continue
    }

    const columns = line.split(/\s{2,}/)
    if (columns.length < 3 || columns[0] === '-') continue
    const client = columns[0].toLowerCase()
    const os = columns[1] && columns[1] !== '-' ? `:${columns[1].toLowerCase()}` : ''
    targets.add(`${client}${os}`)
  }

  return [...targets]
}

/**
 * Kiem tra capability that cua binary dang duoc app chon.
 */
export async function probeYtDlpCapabilities(): Promise<YtDlpCapabilities> {
  const installation = await resolveYtDlpInstallation()
  if (!installation) {
    return {
      installation: null,
      version: null,
      probeSucceeded: false,
      impersonationAvailable: false,
      impersonateTargets: [],
      probeError: 'Khong tim thay yt-dlp.'
    }
  }

  const [versionResult, targetsResult] = await Promise.all([
    runCapture(installation.command, ['--version']),
    runCapture(installation.command, ['--list-impersonate-targets'])
  ])
  const targets = targetsResult.code === 0 ? parseImpersonateTargets(targetsResult.out) : []
  const version =
    versionResult.code === 0
      ? versionResult.out.trim().split(/\r?\n/).find(Boolean) ?? null
      : null

  return {
    installation,
    version,
    probeSucceeded: targetsResult.code === 0,
    impersonationAvailable: targets.length > 0,
    impersonateTargets: targets,
    probeError:
      targetsResult.code === 0
        ? null
        : targetsResult.out.trim() || 'Khong the kiem tra browser impersonation.'
  }
}

/** Tra ve duong dan ffmpeg dung duoc: runtime -> PATH. Null neu khong co. */
export async function resolveFfmpeg(): Promise<string | null> {
  return canonicalResolveFfmpeg()
}

export async function checkDependencies(): Promise<DepStatus> {
  const [managedYtDlp, ff] = await Promise.all([
    canRun(managedYtDlpPath()),
    resolveFfmpeg()
  ])
  return { ytdlp: managedYtDlp, ffmpeg: ff !== null, platform: process.platform }
}

type ProgressCb = (p: SetupProgress) => void

/** Tai 1 file voi progress theo Content-Length. Theo redirect (fetch mac dinh). */
export async function downloadFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void
): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`Tai that bai (${res.status}) tu ${url}`)
  }
  const total = Number(res.headers.get('content-length') || 0)
  let received = 0

  await mkdir(binDir(), { recursive: true })
  const out = createWriteStream(dest)

  const nodeStream = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)))
  })

  await new Promise<void>((resolve, reject) => {
    nodeStream.pipe(out)
    out.on('finish', resolve)
    out.on('error', reject)
    nodeStream.on('error', reject)
  })
}

/** Giai nen zip: Windows dung Expand-Archive, macOS/Linux dung unzip (co san). */
export function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = isWin
      ? spawn(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`
          ],
          { windowsHide: true, stdio: 'ignore' }
        )
      : spawn('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'ignore' })
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Giải nén thất bại'))))
  })
}

function isMuslLinux(): boolean {
  if (process.platform !== 'linux') return false
  try {
    const report = process.report.getReport() as {
      header?: { glibcVersionRuntime?: string }
    }
    return !report.header?.glibcVersionRuntime
  } catch {
    return false
  }
}

/** Ten asset official phu hop voi he dieu hanh/kien truc hien tai. */
export function ytDlpReleaseAssetName(): string {
  if (isWin) {
    if (process.arch === 'arm64') return 'yt-dlp_arm64.exe'
    if (process.arch === 'ia32') return 'yt-dlp_x86.exe'
    return 'yt-dlp.exe'
  }
  if (isMac) return 'yt-dlp_macos'
  if (process.platform === 'linux') {
    const musl = isMuslLinux()
    if (process.arch === 'arm64') {
      return musl ? 'yt-dlp_musllinux_aarch64' : 'yt-dlp_linux_aarch64'
    }
    if (process.arch === 'x64') return musl ? 'yt-dlp_musllinux' : 'yt-dlp_linux'
  }

  return 'yt-dlp'
}

async function latestYtDlpAsset(name: string): Promise<YtDlpReleaseAsset> {
  try {
    const res = await fetch(YTDLP_RELEASE_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(15_000)
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status}`)
    const data = (await res.json()) as {
      tag_name?: unknown
      assets?: Array<{ name?: unknown; browser_download_url?: unknown }>
    }
    const assets = Array.isArray(data.assets) ? data.assets : []
    const wanted = assets.find((asset) => asset.name === name)
    const sums = assets.find((asset) => asset.name === 'SHA2-256SUMS')
    if (typeof wanted?.browser_download_url !== 'string') {
      throw new Error(`Release khong co asset ${name}`)
    }
    return {
      name,
      url: wanted.browser_download_url,
      checksumUrl:
        typeof sums?.browser_download_url === 'string' ? sums.browser_download_url : null,
      version: typeof data.tag_name === 'string' ? data.tag_name : null
    }
  } catch {
    return {
      name,
      url: `${YTDLP_RELEASE_BASE}/${name}`,
      checksumUrl: `${YTDLP_RELEASE_BASE}/SHA2-256SUMS`,
      version: null
    }
  }
}

async function expectedSha256(url: string, assetName: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Khong tai duoc checksum yt-dlp (${res.status}).`)
  const sums = await res.text()
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+?)\s*$/i.exec(line)
    if (match?.[2] === assetName) return match[1].toLowerCase()
  }
  throw new Error(`Khong tim thay checksum cho ${assetName}.`)
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function replaceManagedYtDlp(candidate: string, dest: string): Promise<void> {
  const previous = `${dest}.previous`

  if (!(await fileExists(dest)) && (await fileExists(previous))) {
    await rename(previous, dest)
  } else if ((await fileExists(dest)) && (await fileExists(previous))) {
    await rm(previous, { force: true })
  }

  if (!(await fileExists(dest))) {
    await rename(candidate, dest)
    return
  }

  if (!isWin) {
    await rename(candidate, dest)
    return
  }

  await rename(dest, previous)
  try {
    await rename(candidate, dest)
    const verified = await runCapture(dest, ['--version'])
    if (verified.code !== 0) throw new Error('Binary yt-dlp moi khong khoi dong duoc.')
    await rm(previous, { force: true }).catch(() => {})
  } catch (err) {
    await rm(dest, { force: true })
    try {
      await rename(previous, dest)
    } catch {
      await copyFile(previous, dest).catch(() => {})
    }
    if (!(await fileExists(dest))) {
      throw new Error(
        `Không thể khôi phục công cụ tải; bản sao an toàn còn tại ${previous}.`,
        { cause: err }
      )
    }
    throw err
  }
}

async function doInstallYtDlp(onProgress: ProgressCb): Promise<void> {
  onProgress({ phase: 'downloading-ytdlp', message: 'Đang tải bộ tải xuống…', percent: 0 })
  const dest = managedYtDlpPath()
  const candidate = `${dest}.download`
  const release = await latestYtDlpAsset(ytDlpReleaseAssetName())

  await mkdir(binDir(), { recursive: true })
  await rm(candidate, { force: true })
  try {
    if (!release.checksumUrl) throw new Error('Release yt-dlp không có checksum SHA-256.')
    const checksum = await expectedSha256(release.checksumUrl, release.name)
    await downloadFile(release.url, candidate, (p) =>
      onProgress({ phase: 'downloading-ytdlp', message: `Đang tải bộ tải xuống… ${p}%`, percent: p })
    )
    if (!isWin) await chmod(candidate, 0o755)

    if ((await sha256File(candidate)) !== checksum) {
      throw new Error('Checksum yt-dlp khong khop; da giu nguyen binary cu.')
    }
    const version = await runCapture(candidate, ['--version'])
    if (version.code !== 0 || !version.out.trim()) {
      throw new Error('Binary yt-dlp vua tai khong hop le; da giu nguyen binary cu.')
    }

    await replaceManagedYtDlp(candidate, dest)
  } finally {
    await rm(candidate, { force: true }).catch(() => {})
  }
}

async function installYtDlp(onProgress: ProgressCb): Promise<void> {
  if (ytDlpInstallInFlight) return ytDlpInstallInFlight
  ytDlpInstallInFlight = doInstallYtDlp(onProgress)
  try {
    await ytDlpInstallInFlight
  } finally {
    ytDlpInstallInFlight = null
  }
}

export async function installFfmpeg(onProgress: ProgressCb): Promise<void> {
  onProgress({ phase: 'downloading-ffmpeg', message: 'Đang kiểm tra FFmpeg…', percent: 0 })
  const existing = await canonicalResolveFfmpeg()
  if (existing) {
    onProgress({ phase: 'done', message: 'Đã sẵn sàng FFmpeg.', percent: 100 })
    return
  }

  const { downloadRuntimeEngineFromManifest } = await import('./runtimeInstaller')
  const installed = await downloadRuntimeEngineFromManifest('ffmpeg', (percent, message) => {
    onProgress({ phase: percent >= 90 ? 'extracting' : 'downloading-ffmpeg', message, percent })
  })
  if (!installed || !(await canonicalResolveFfmpeg())) {
    throw new Error('Không có asset FFmpeg/FFprobe hợp lệ trong runtime manifest.')
  }
  onProgress({ phase: 'done', message: 'Đã sẵn sàng FFmpeg.', percent: 100 })
}

/** Da co ban yt-dlp rieng do app quan ly (trong userData/bin) chua? */
export function hasLocalYtDlp(): Promise<boolean> {
  return fileExists(managedYtDlpPath())
}

/** Phien ban yt-dlp hien tai (chuoi), null neu khong lay duoc. */
export async function ytDlpVersion(): Promise<string | null> {
  const cmd = await resolveYtDlp()
  if (!cmd) return null
  const r = await runCapture(cmd, ['--version'])
  return r.code === 0 ? r.out.trim().split(/\r?\n/)[0] || null : null
}

export async function updateYtDlp(): Promise<{ ok: boolean; message: string }> {
  try {
    const local = managedYtDlpPath()
    if (await fileExists(local)) {
      const [current, latest] = await Promise.all([
        runCapture(local, ['--version']),
        latestYtDlpAsset(ytDlpReleaseAssetName())
      ])
      const currentVersion = current.code === 0 ? current.out.trim().split(/\r?\n/)[0] : null
      if (currentVersion && latest.version && currentVersion === latest.version) {
        return { ok: true, message: `Đã là bản mới nhất (${currentVersion}).` }
      }
    }

    await installYtDlp(() => {})
    const v = await ytDlpVersion()
    return { ok: true, message: `Đã cập nhật bản mới nhất${v ? ` (${v})` : ''}.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** Chay setup: chi tai cai nao dang thieu. */
export async function runSetup(onProgress: ProgressCb): Promise<void> {
  try {
    const status = await checkDependencies()
    if (!status.ytdlp) await installYtDlp(onProgress)
    if (!status.ffmpeg) await installFfmpeg(onProgress)
    onProgress({ phase: 'done', message: 'Hoàn tất! Sẵn sàng sử dụng.', percent: 100 })
  } catch (err) {
    onProgress({
      phase: 'error',
      message: err instanceof Error ? err.message : String(err),
      percent: -1
    })
    throw err
  }
}
