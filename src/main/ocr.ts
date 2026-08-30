import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, readFile, writeFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { resolveFfmpeg } from './deps'
import { resolveRuntimeExecutable, runtimeKindDir } from './runtimeResolver'
import { probeRuntimeExecutable } from './runtimeProbes'
import { debugRaw, errLabel, logError, logInfo } from './logger'
import { terminateProcessTree, trackChildProcess } from './processTree'
import type { OcrEngineStatus, OcrProgress, OcrResult } from '../shared/types'

const isWin = process.platform === 'win32'
async function resolveEnginePath(): Promise<string | null> {
  return resolveRuntimeExecutable('ocr-engine', isWin ? ['ocr-engine.exe'] : ['ocr-engine'])
}

async function probeOcr(path: string): Promise<{ healthy: boolean; version: string | null; protocol: string | null; message?: string }> {
  const result = await probeRuntimeExecutable('ocr-engine', path)
  return {
    healthy: result.healthy,
    version: result.version || null,
    protocol: result.protocol || null,
    message: result.message
  }
}

export async function ocrEngineStatus(): Promise<OcrEngineStatus> {
  const path = await resolveEnginePath()
  if (!path) return { has: false, healthy: false, needsUpdate: false, message: 'Chưa cài đặt OCR runtime.' }
  const probe = await probeOcr(path)
  return { has: true, needsUpdate: !probe.healthy, ...probe }
}

export async function installOcrEngine(onProgress: (p: number) => void): Promise<void> {
  logInfo('Dịch màn hình: đang kiểm tra và cài đặt asset OCR…')
  onProgress(10)

  const { downloadRuntimeEngineFromManifest } = await import('./runtimeInstaller')
  const installed = await downloadRuntimeEngineFromManifest('ocr-engine', (p) => onProgress(p))
  if (!installed) throw new Error('Không có asset OCR phù hợp trong runtime manifest.')

  const path = await resolveEnginePath()
  if (!path) throw new Error('Không tìm thấy OCR binary sau khi cài đặt runtime.')
  if (!isWin) {
    await chmod(path, 0o755).catch(() => {})
  }
  const probe = await probeOcr(path)
  if (!probe.healthy) throw new Error(probe.message || 'OCR binary không qua kiểm tra probe.')
  onProgress(100)
  logInfo('Dịch màn hình: đã cài xong công cụ.')
}

let child: ChildProcess | null = null

export function cancelOcr(): void {
  if (!child) return
  terminateProcessTree(child)
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
    const p = trackChildProcess(spawn(executable, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    }))
    child = p

    const abort = (): void => {
      terminateProcessTree(p)
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
