import { app } from 'electron'
import { spawn } from 'node:child_process'
import { chmod, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveRuntimeExecutable, runtimeKindDir } from './runtimeResolver'
import { probeRuntimeExecutable } from './runtimeProbes'
import { readDyCookies } from './douyinCookies'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import { trackChildProcess } from './processTree'
import { DouyinProgress, DouyinRequest, DouyinResult, DyChannel, DyEngineStatus } from '../shared/types'

const isWin = process.platform === 'win32'
export const MAX_DOUYIN_OUTPUT_BUFFER_CHARS = 256 * 1024

export interface DouyinOutputBuffers {
  stdout: string
  stderr: string
}

export function appendDouyinOutputChunk(
  buffers: DouyinOutputBuffers,
  chunk: string,
  isErr: boolean,
  maxChars = MAX_DOUYIN_OUTPUT_BUFFER_CHARS
): DouyinOutputBuffers {
  const safeMax = Number.isSafeInteger(maxChars) && maxChars > 0
    ? maxChars
    : MAX_DOUYIN_OUTPUT_BUFFER_CHARS
  const appendBounded = (current: string): string => {
    const next = current + chunk
    return next.length <= safeMax ? next : next.slice(-safeMax)
  }
  return isErr
    ? { stdout: buffers.stdout, stderr: appendBounded(buffers.stderr) }
    : { stdout: appendBounded(buffers.stdout), stderr: buffers.stderr }
}

export interface DouyinCompletionCounts {
  total: number
  success: number
  failed: number
  skipped: number
}

export function summarizeDouyinCompletion(
  exitCode: number | null,
  counts: DouyinCompletionCounts
): { ok: boolean; total: number; error: string | null } {
  const total = Math.max(0, counts.total || counts.success + counts.failed + counts.skipped)
  const complete = total > 0 && counts.success + counts.failed + counts.skipped === total
  const ok = exitCode === 0 && complete && counts.failed === 0
  if (ok) return { ok: true, total, error: null }
  if (exitCode !== 0) return { ok: false, total, error: `Douyin engine thoát với mã ${exitCode ?? '?'}.` }
  if (counts.failed > 0) return { ok: false, total, error: `Có ${counts.failed}/${total || '?'} mục tải thất bại.` }
  return { ok: false, total, error: 'Douyin engine không trả về thống kê hoàn tất hợp lệ.' }
}

function engineName(): string {
  return isWin ? 'dy-engine.exe' : 'dy-engine'
}
async function resolveEnginePath(): Promise<string | null> {
  return resolveRuntimeExecutable('douyin', [engineName()])
}
function libraryDbPath(): string {
  return join(app.getPath('userData'), 'dy-library.db')
}
function configPath(): string {
  return join(app.getPath('userData'), 'dy-config.yml')
}
function channelsPath(): string {
  return join(app.getPath('userData'), 'dy-channels.json')
}

export async function dyEngineStatus(): Promise<DyEngineStatus> {
  const path = await resolveEnginePath()
  if (!path) return { has: false, healthy: false, needsUpdate: false, message: 'Chưa cài đặt Douyin runtime.' }
  const probe = await probeRuntimeExecutable('douyin', path)
  return { has: true, healthy: probe.healthy, needsUpdate: !probe.healthy, message: probe.message }
}

export async function installDyEngine(onProgress: (percent: number) => void): Promise<void> {
  logInfo('Douyin: đang kiểm tra và cài đặt asset Douyin…')
  onProgress(10)

  const { downloadRuntimeEngineFromManifest } = await import('./runtimeInstaller')
  const installed = await downloadRuntimeEngineFromManifest('douyin', (p) => onProgress(p))
  if (!installed) throw new Error('Không có asset Douyin phù hợp trong runtime manifest.')

  const path = await resolveEnginePath()
  if (!path) throw new Error('Không tìm thấy Douyin binary sau khi cài đặt.')
  if (!isWin) await chmod(path, 0o755).catch(() => {})
  onProgress(100)
  logInfo('Douyin: đã tải xong bộ tải Douyin.')
}
/** Dung config (object) tu yeu cau + cookie. Ghi JSON (la YAML hop le). */
function buildConfig(req: DouyinRequest, cookies: Record<string, string>): object {
  const number = { post: 0, like: 0, allmix: 0, mix: 0, music: 0, collect: 0, collectmix: 0 }
  const increase = { post: false, like: false, allmix: false, mix: false, music: false }

  if (req.isChannel) {
    if (req.mode === 'batch') number.post = Math.max(1, req.batchSize || 15)
    else if (req.mode === 'new') increase.post = true
    // 'all' -> number.post = 0, increase.post = false (tai het, chay lai tu tai tiep nho DB)
  }

  const outPath = req.outputDir.replace(/\\/g, '/').replace(/\/?$/, '/')

  return {
    link: [req.url],
    path: outPath,
    music: req.music,
    cover: req.cover,
    avatar: req.avatar,
    json: req.metaJson,
    folderstyle: req.folderstyle,
    mode: ['post'],
    number,
    increase,
    thread: 5,
    retry_times: 3,
    proxy: req.proxy || '',
    database: true,
    database_path: libraryDbPath().replace(/\\/g, '/'),
    browser_fallback: { enabled: false },
    progress: { quiet_logs: true },
    cookies
  }
}

async function writeConfig(req: DouyinRequest, cookies: Record<string, string>): Promise<string> {
  const p = configPath()
  await writeFile(p, JSON.stringify(buildConfig(req, cookies), null, 2), 'utf-8')
  return p
}

/** Tai Douyin: spawn engine, doc stdout+stderr, parse tien do + tong ket. */
export async function downloadDouyin(
  id: string,
  req: DouyinRequest,
  onProgress: (p: DouyinProgress) => void
): Promise<DouyinResult> {
  const engine = await resolveEnginePath()
  if (!engine) {
    return {
      id,
      ok: false,
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      error: 'Chưa có bộ tải Douyin. Vui lòng tải công cụ Douyin trước.'
    }
  }

  const cookies = await readDyCookies()
  const cfgPath = await writeConfig(req, cookies)
  logInfo(`Douyin: bắt đầu tải (kiểu: ${req.mode})`)

  try {
    return await new Promise<DouyinResult>((resolve) => {
      const child = trackChildProcess(spawn(engine, ['-c', cfgPath, '--verbose'], {
        windowsHide: true,
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      }))

      let success = 0
      let total = 0
      let failed = 0
      let skipped = 0
      let lastFile: string | null = null
      let outBuf = ''
      let errBuf = ''
      let errTail = ''

      onProgress({ id, status: 'preparing', line: 'Bắt đầu…', lastFile: null, success: 0 })

      const num = (v: string): number => {
        const n = Number(v)
        return isFinite(n) ? n : 0
      }

      const handleLine = (line: string): void => {
        const t = line.trim()
        if (!t) return

        const mDl = t.match(/Downloaded (?:video|image|媒体)?:?\s*(.+?)\s*\(\d+\)\s*$/i)
        if (mDl) {
          success++
          lastFile = mDl[1]
          onProgress({ id, status: 'downloading', line: t, lastFile, success })
          return
        }

        const mTotal = t.match(/Total\s*[│|]\s*(\d+)/i)
        if (mTotal) total = num(mTotal[1])
        const mSucc = t.match(/Success\s*[│|]\s*(\d+)/i)
        if (mSucc) success = num(mSucc[1])
        const mFail = t.match(/Failed\s*[│|]\s*(\d+)/i)
        if (mFail) failed = num(mFail[1])
        const mSkip = t.match(/Skipped\s*[│|]\s*(\d+)/i)
        if (mSkip) skipped = num(mSkip[1])

        if (/ERROR|Traceback|Exception/i.test(t)) errTail = t
      }

      const feed = (chunk: string, isErr: boolean): void => {
        const buffers = appendDouyinOutputChunk({ stdout: outBuf, stderr: errBuf }, chunk, isErr)
        outBuf = buffers.stdout
        errBuf = buffers.stderr
        let buf = isErr ? errBuf : outBuf
        const parts = buf.split(/\r?\n/)
        buf = parts.pop() ?? ''
        if (isErr) errBuf = buf
        else outBuf = buf
        for (const l of parts) handleLine(l)
      }

      child.stdout.on('data', (d) => feed(d.toString(), false))
      child.stderr.on('data', (d) => feed(d.toString(), true))

      child.on('error', (err) => {
        debugRaw('douyin spawn', err)
        const nhan = errLabel(err)
        logError(`Douyin: ${nhan}`)
        resolve({ id, ok: false, total, success, failed, skipped, error: nhan })
      })

      child.on('close', (code) => {
        if (outBuf) handleLine(outBuf)
        if (errBuf) handleLine(errBuf)
        const completion = summarizeDouyinCompletion(code, { total, success, failed, skipped })
        if (completion.ok) {
          logInfo(`Douyin: hoàn tất — thành công ${success}/${completion.total}`)
          onProgress({ id, status: 'finished', line: null, lastFile, success })
          if (req.isChannel) void recordChannel(req.url, req.outputDir, success)
          resolve({ id, ok: true, total: completion.total, success, failed, skipped, error: null })
        } else {
          const raw = errTail || completion.error || errBuf.trim().split(/\r?\n/).slice(-2).join(' ') || `code ${code}`
          debugRaw('douyin close', raw)
          const nhan = errLabel(raw)
          logError(`Douyin: ${nhan}`)
          onProgress({ id, status: 'error', line: nhan, lastFile, success })
          resolve({ id, ok: false, total: completion.total, success, failed, skipped, error: nhan })
        }
      })
    })
  } finally {
    await rm(cfgPath, { force: true }).catch(() => {})
  }
}

// ---- Thu vien kenh ----
export async function getChannels(): Promise<DyChannel[]> {
  try {
    const list = JSON.parse(await readFile(channelsPath(), 'utf-8')) as DyChannel[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function saveChannels(list: DyChannel[]): Promise<void> {
  await writeFile(channelsPath(), JSON.stringify(list, null, 2), 'utf-8')
}
/** Doc ten kenh (author_name) tu manifest cua lan tai. */
async function channelNameFromManifest(outputDir: string): Promise<string | null> {
  try {
    const text = await readFile(join(outputDir, 'download_manifest.jsonl'), 'utf-8')
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const rec = JSON.parse(lines[i]) as { author_name?: string }
        if (rec.author_name) return rec.author_name
      } catch {
        /* bo qua dong hong */
      }
    }
  } catch {
    /* khong co manifest */
  }
  return null
}

async function recordChannel(url: string, outputDir: string, added: number): Promise<void> {
  const list = await getChannels()
  const name = (await channelNameFromManifest(outputDir)) ?? 'Kênh Douyin'
  const now = new Date().toISOString()
  const existing = list.find((c) => c.url === url)
  if (existing) {
    existing.name = name || existing.name
    existing.lastRun = now
    existing.count += added
  } else {
    list.unshift({ url, name, lastRun: now, count: added })
  }
  await saveChannels(list)
}

export async function removeChannel(url: string): Promise<DyChannel[]> {
  const list = (await getChannels()).filter((c) => c.url !== url)
  await saveChannels(list)
  return list
}
