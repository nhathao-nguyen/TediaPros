import { spawn, type ChildProcess } from 'node:child_process'
import { access, chmod, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import { binDir, resolveFfmpeg } from './deps'
import { engineNeedsUpdate, markEngineInstalled } from './engines-update'
import { copyPackagedLocalAsset, packagedLocalAssetRoots, resolvePackagedLocalAsset } from './localAssets'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import type { OcrEngineStatus, OcrProgress, OcrResult } from '../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'
function engineDir(): string {
  return join(binDir(), 'ocr-engine')
}
function enginePath(): string {
  return join(engineDir(), isWin ? 'ocr-engine.exe' : 'ocr-engine')
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function resolveEnginePath(): Promise<string | null> {
  const managed = [
    enginePath(),
    join(process.env.APPDATA || '', 'tediapros', 'bin', 'ocr-engine', isWin ? 'ocr-engine.exe' : 'ocr-engine')
  ]
  for (const candidate of managed) if (candidate && await exists(candidate)) return candidate
  const packaged = await resolvePackagedLocalAsset('ocr', [isWin ? 'ocr-engine.exe' : 'ocr-engine'])
  return packaged?.path ?? null
}

function runCapture(command: string, args: string[], timeoutMs = 15_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const child = spawn(command, args, { windowsHide: true, cwd: join(command, '..') })
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, out })
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      finish(-1)
    }, timeoutMs)
    child.stdout?.on('data', (data: Buffer) => { out += data.toString() })
    child.stderr?.on('data', (data: Buffer) => { out += data.toString() })
    child.on('error', () => finish(-1))
    child.on('close', (code) => finish(code ?? -1))
  })
}

function parseJsonLine(output: string): Record<string, unknown> | null {
  for (const line of output.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    if (!line.startsWith('{')) continue
    try {
      const value = JSON.parse(line) as Record<string, unknown>
      if (value && typeof value === 'object') return value
    } catch { /* try next line */ }
  }
  return null
}

async function probeOcr(path: string): Promise<{ healthy: boolean; version: string | null; protocol: string | null; message?: string }> {
  const version = await runCapture(path, ['--version'])
  const versionJson = parseJsonLine(version.out)
  const protocol = typeof versionJson?.protocol === 'string' ? versionJson.protocol : null
  const versionText = typeof versionJson?.version === 'string' ? versionJson.version : null
  // Older bundled OCR builds expose the same JSON streaming inference CLI but
  // predate the --version/--probe readiness protocol. Accept that interface
  // after verifying its required input/output flags; inference still validates
  // the actual process and output below.
  const legacyCliHelp = await runCapture(path, ['--help'])
  if (/--input[\s\S]+--output/u.test(legacyCliHelp.out)) {
    return { healthy: true, version: versionText, protocol: 'ocr-legacy-cli/1' }
  }
  if (version.code !== 0 || versionJson?.type !== 'version' || protocol !== 'ocr-local/1' || versionJson.engine !== 'rapidocr') {
    return { healthy: false, version: versionText, protocol, message: 'OCR binary không hỗ trợ protocol ocr-local/1; không dùng --help để đánh dấu sẵn sàng.' }
  }
  const probe = await runCapture(path, ['--probe'])
  const probeJson = parseJsonLine(probe.out)
  if (probe.code !== 0 || probeJson?.type !== 'probe' || probeJson.ready !== true || probeJson.protocol !== 'ocr-local/1') {
    return { healthy: false, version: versionText, protocol, message: 'OCR probe thất bại hoặc RapidOCR/model nhúng chưa khởi tạo được.' }
  }
  return { healthy: true, version: versionText, protocol }
}

export async function ocrEngineStatus(): Promise<OcrEngineStatus> {
  const path = await resolveEnginePath()
  if (!path) return { has: false, healthy: false, needsUpdate: false, message: 'Thiếu OCR asset local có manifest.' }
  const probe = await probeOcr(path)
  return { has: true, needsUpdate: await engineNeedsUpdate('ocr', true), ...probe }
}

export async function installOcrEngine(onProgress: (p: number) => void): Promise<void> {
  await mkdir(binDir(), { recursive: true })
  logInfo('Dịch màn hình: đang lấy asset OCR local…')
  onProgress(10)
  const copied = await copyPackagedLocalAsset('ocr', engineDir(), [isWin ? 'ocr-engine.exe' : 'ocr-engine'])
  if (!copied) throw new Error(`Thiếu OCR asset local có manifest. Đặt bundle vào ${packagedLocalAssetRoots()[0]} rồi thử lại.`)
  if (!isWin && (await exists(enginePath()))) {
    await chmod(enginePath(), 0o755)
  }
  const path = await resolveEnginePath()
  if (!path) throw new Error('Không tìm thấy OCR binary sau khi import asset local.')
  const probe = await probeOcr(path)
  if (!probe.healthy) throw new Error(probe.message || 'OCR asset local không qua probe.')
  await markEngineInstalled('ocr')
  onProgress(100)
  logInfo('Dịch màn hình: đã cài xong công cụ.')
}

let child: ChildProcess | null = null

/** Huy giua chung: dong tien trinh, video dai co the chay vai phut. */
export function cancelOcr(): void {
  if (!child) return
  try {
    child.kill()
  } catch {
    /* bo qua */
  }
  child = null
}

/**
 * Doc chu chay tren video -> .srt.
 * y0/y1 la PIXEL CUA VIDEO GOC (giao dien da quy doi san).
 */
interface SrtCue {
  id: number
  start: string
  end: string
  text: string
}

function parseSrt(content: string): SrtCue[] {
  const blocks = content.trim().split(/\r?\n\r?\n/)
  const cues: SrtCue[] = []
  for (const block of blocks) {
    const lines = block.split(/\r?\n/)
    if (lines.length >= 3) {
      const id = parseInt(lines[0].trim(), 10)
      const timeLine = lines[1].trim()
      const text = lines.slice(2).join('\n').trim()
      const timeParts = timeLine.split(' --> ')
      if (timeParts.length === 2) {
        cues.push({
          id,
          start: timeParts[0],
          end: timeParts[1],
          text
        })
      }
    }
  }
  return cues
}

function convertToVtt(cues: SrtCue[]): string {
  const lines = ['WEBVTT', '']
  for (const cue of cues) {
    const start = cue.start.replace(',', '.')
    const end = cue.end.replace(',', '.')
    lines.push(`${cue.id}`)
    lines.push(`${start} --> ${end}`)
    lines.push(cue.text)
    lines.push('')
  }
  return lines.join('\n')
}

function convertToTxt(cues: SrtCue[]): string {
  return cues.map((c) => c.text).join('\n')
}

function convertToJson(cues: SrtCue[]): string {
  return JSON.stringify(cues, null, 2)
}

/**
 * Doc chu chay tren video -> .srt.
 * y0/y1 la PIXEL CUA VIDEO GOC (giao dien da quy doi san).
 */
export async function ocrVideo(
  input: string,
  outputDir: string,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
  formats: string[],
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal,
  sampleFps = 2
): Promise<OcrResult> {
  if (child) return { ok: false, error: 'Đang xử lý một video khác.' }
  const executable = await resolveEnginePath()
  if (!executable) return { ok: false, error: 'Chưa có OCR asset local có manifest. Hãy import asset trước.' }
  const ready = await probeOcr(executable)
  if (!ready.healthy) return { ok: false, error: ready.message || 'OCR engine chưa qua probe.' }
  const ff = await resolveFfmpeg()
  if (!ff) return { ok: false, error: 'Thiếu ffmpeg. Hãy chạy lại bước cài đặt.' }

  const out = join(outputDir, basename(input).replace(/\.[^.]+$/, '') + '.srt')
  const args = [
    '--input', input,
    '--output', out,
    '--y0', String(y0),
    '--y1', String(y1),
    '--x0', String(x0),
    '--x1', String(x1),
    '--fps', String(Math.max(2, Math.min(12, Math.round(sampleFps)))),
    '--ffmpeg', ff
  ]
  logInfo(`Dịch màn hình: bắt đầu đọc ${basename(input)}…`)

  return new Promise<OcrResult>((resolve) => {
    const p = spawn(executable, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    })
    child = p

    const abort = (): void => {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })

    let buf = ''
    let errTail = ''
    let doneOut: string | null = null
    let count = 0
    let bandTop: number | null = null
    let bandBot: number | null = null
    let errMsg: string | null = null

    p.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      const parts = buf.split(/\r?\n/)
      buf = parts.pop() ?? ''
      for (const line of parts) {
        const t = line.trim()
        if (!t || t[0] !== '{') continue
        try {
          const o = JSON.parse(t) as {
            type?: string
            percent?: number
            text?: string
            message?: string
            output?: string
            count?: number
            band_top?: number | null
            band_bot?: number | null
          }
          if (o.type === 'progress') {
            onProgress({ percent: o.percent ?? 0, text: o.text ?? '' })
          } else if (o.type === 'status') {
            onProgress({ percent: -1, text: o.message ?? '' })
          } else if (o.type === 'done') {
            doneOut = o.output ?? out
            count = o.count ?? 0
            bandTop = o.band_top ?? null
            bandBot = o.band_bot ?? null
          } else if (o.type === 'error') {
            errMsg = o.message ?? null
          }
        } catch {
          /* bo qua dong hong */
        }
      }
    })

    p.stderr.on('data', (d: Buffer) => {
      const last = d.toString().trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
      if (last) errTail = last
    })

    p.on('error', (err) => {
      signal?.removeEventListener('abort', abort)
      debugRaw('ocr spawn', err)
      child = null
      const nhan = errLabel(err)
      logError(`Dịch màn hình: ${nhan}`)
      resolve({ ok: false, error: nhan })
    })

    p.on('close', async (code) => {
      signal?.removeEventListener('abort', abort)
      child = null
      if (code !== 0 || !doneOut) {
        const raw = errMsg || errTail || `code ${code ?? '?'}`
        debugRaw('ocr close', raw)
        resolve({ ok: false, error: errLabel(raw) })
        return
      }
      if (doneOut) {
        logInfo(`Dịch màn hình: xong ${count} câu.`)

        const outputs: string[] = []
        try {
          const srtContent = await readFile(doneOut, 'utf8')
          const cues = parseSrt(srtContent)
          if (srtContent.trim().length === 0 || cues.length === 0 || count <= 0) {
            throw new Error('OCR không tạo được SRT có cue hợp lệ.')
          }

          const txtPath = doneOut.replace(/\.srt$/i, '.txt')
          const vttPath = doneOut.replace(/\.srt$/i, '.vtt')
          const jsonPath = doneOut.replace(/\.srt$/i, '.json')

          if (formats.includes('.srt')) {
            outputs.push(doneOut)
          }
          if (formats.includes('.txt')) {
            await writeFile(txtPath, convertToTxt(cues), 'utf8')
            outputs.push(txtPath)
          }
          if (formats.includes('.vtt')) {
            await writeFile(vttPath, convertToVtt(cues), 'utf8')
            outputs.push(vttPath)
          }
          if (formats.includes('.json')) {
            await writeFile(jsonPath, convertToJson(cues), 'utf8')
            outputs.push(jsonPath)
          }

          if (!formats.includes('.srt')) {
            await rm(doneOut, { force: true })
          }
        } catch (err) {
          debugRaw('ocr format conversion error', err)
          if (outputs.length === 0) {
            outputs.push(doneOut)
          }
        }

        resolve({ ok: true, output: outputs[0] || doneOut, outputs, count, bandTop, bandBot })
        return
      }
      // Bi huy giua chung -> khong phai loi
      if (code === null) {
        resolve({ ok: false, error: 'Đã huỷ.' })
        return
      }
      const raw = errMsg || errTail || `code ${code}`
      debugRaw('ocr close', raw)
      const nhan = errLabel(raw)
      logError(`Dịch màn hình: ${nhan}`)
      resolve({ ok: false, error: nhan })
    })
  })
}
