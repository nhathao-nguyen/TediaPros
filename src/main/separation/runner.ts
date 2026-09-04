import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { trackChildProcess, terminateProcessTree } from '../processTree'
import { separationPresetConfig } from '../../shared/autoShortSeparation'
import type { AutoShortSeparationPreset, SeparatorModelId, SeparatorProvider } from '../../shared/types'
import type { InstalledSeparatorModel } from './modelStore'

export interface SeparatorProbeResult {
  ready: boolean
  provider: SeparatorProvider
  modelId: SeparatorModelId
  message?: string
}

export interface SeparatorRunResult {
  vocalsPath: string
  instrumentalPath: string
  provider: SeparatorProvider
  elapsedMs: number
  stderrTail?: string
}

export interface RunSeparatorEngineInput {
  executablePath: string
  inputPath: string
  outputDir: string
  model: InstalledSeparatorModel
  preset: AutoShortSeparationPreset
  provider: 'auto' | 'cpu'
  signal: AbortSignal
  timeoutMs: number
  onProgress?: (percent: number, phase: 'loading' | 'separating' | 'writing') => void
  spawnChild?: typeof spawn
}

function sanitizeDiagnostics(text: string): string {
  return text.replace(/[A-Za-z]:\\[^\s:"]+/g, '<redacted_path>')
}

function isInsideDirectory(filePath: string, dir: string): boolean {
  const rel = relative(resolve(dir), resolve(filePath)).replace(/\\/g, '/')
  return !rel.startsWith('..') && !rel.startsWith('/') && !/^[A-Za-z]:\//.test(rel)
}

export async function probeSeparatorModel(input: {
  executablePath: string
  model: InstalledSeparatorModel
  provider: 'directml' | 'cpu'
  signal?: AbortSignal
}): Promise<SeparatorProbeResult> {
  const { executablePath, model, provider, signal } = input
  const args = [
    '--probe',
    '--provider',
    provider,
    '--model',
    model.modelPath,
    '--model-manifest',
    model.manifestPath
  ]

  return new Promise((resolveResult) => {
    let child: ChildProcess | null = null
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let resolved = false

    const cleanup = (): void => {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort)
    }

    const finish = (res: SeparatorProbeResult): void => {
      if (resolved) return
      resolved = true
      cleanup()
      resolveResult(res)
    }

    const onAbort = (): void => {
      if (child) terminateProcessTree(child)
      finish({
        ready: false,
        provider,
        modelId: model.id,
        message: 'Separator probe đã bị hủy.'
      })
    }

    if (signal?.aborted) {
      return finish({
        ready: false,
        provider,
        modelId: model.id,
        message: 'Separator probe đã bị hủy.'
      })
    }
    if (signal) signal.addEventListener('abort', onAbort)

    try {
      child = spawn(executablePath, args, {
        cwd: dirname(executablePath),
        windowsHide: true,
        shell: false
      })
      trackChildProcess(child)

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf8')
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf8')
        if (stderrBuffer.length > 64 * 1024) {
          stderrBuffer = stderrBuffer.slice(-64 * 1024)
        }
      })

      child.on('error', (err) => {
        finish({
          ready: false,
          provider,
          modelId: model.id,
          message: `Lỗi khởi chạy separator engine: ${err.message}`
        })
      })

      child.on('close', (code) => {
        if (code !== 0) {
          try {
            const lines = stdoutBuffer.trim().split('\n')
            for (const line of lines) {
              const event = JSON.parse(line.trim())
              if (event.type === 'probe') {
                return finish({
                  ready: false,
                  provider: event.provider || provider,
                  modelId: model.id,
                  message: event.message || 'Probe báo trạng thái không sẵn sàng.'
                })
              }
              if (event.type === 'error') {
                return finish({
                  ready: false,
                  provider,
                  modelId: model.id,
                  message: event.message || event.code
                })
              }
            }
          } catch {
            // ignore
          }
          return finish({
            ready: false,
            provider,
            modelId: model.id,
            message: sanitizeDiagnostics(stderrBuffer || `Separator probe exited with code ${code}`)
          })
        }

        try {
          const lines = stdoutBuffer.trim().split('\n')
          for (const line of lines) {
            const event = JSON.parse(line.trim())
            if (event.type === 'probe') {
              return finish({
                ready: Boolean(event.ready),
                provider: event.provider === 'directml' ? 'directml' : 'cpu',
                modelId: model.id,
                message: event.message
              })
            }
          }
        } catch (e) {
          return finish({
            ready: false,
            provider,
            modelId: model.id,
            message: `Không thể đọc kết quả probe: ${e}`
          })
        }

        finish({
          ready: false,
          provider,
          modelId: model.id,
          message: 'Không nhận được sự kiện probe hợp lệ từ separator engine.'
        })
      })
    } catch (err: unknown) {
      finish({
        ready: false,
        provider,
        modelId: model.id,
        message: `Lỗi spawn separator engine: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  })
}

export async function runSeparatorEngine(input: RunSeparatorEngineInput): Promise<SeparatorRunResult> {
  const {
    executablePath,
    inputPath,
    outputDir,
    model,
    preset,
    provider,
    signal,
    timeoutMs,
    onProgress,
    spawnChild = spawn
  } = input

  const presetConf = separationPresetConfig(preset)
  const args = [
    '--separate',
    '--input',
    inputPath,
    '--output-dir',
    outputDir,
    '--model',
    model.modelPath,
    '--model-manifest',
    model.manifestPath,
    '--model-id',
    model.id,
    '--preset',
    preset,
    '--overlap',
    String(presetConf.overlap),
    '--batch',
    '1',
    '--provider',
    provider
  ]

  return new Promise((resolveResult, reject) => {
    if (signal.aborted) return reject(new Error('Đã hủy tác vụ.'))

    let child: ChildProcess | null = null
    let stdoutBuffer = ''
    let stderrBuffer = ''
    let settled = false
    let lastProgress = -1
    let terminalEventSeen = false
    let resultPayload: SeparatorRunResult | null = null
    let timer: NodeJS.Timeout | null = null

    const cleanup = (): void => {
      if (timer) clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }

    const finishSuccess = (res: SeparatorRunResult): void => {
      if (settled) return
      settled = true
      cleanup()
      resolveResult(res)
    }

    const finishError = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (child) {
        try {
          terminateProcessTree(child)
        } catch {
          // ignore
        }
      }
      reject(err)
    }

    const onAbort = (): void => {
      finishError(new Error('Đã hủy tác vụ.'))
    }
    signal.addEventListener('abort', onAbort)

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        finishError(new Error(`Separator engine timed out after ${timeoutMs}ms.`))
      }, timeoutMs)
    }

    try {
      child = spawnChild(executablePath, args, {
        cwd: dirname(executablePath),
        windowsHide: true,
        shell: false
      })
      trackChildProcess(child)

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString('utf8')
        const lines = stdoutBuffer.split('\n')
        stdoutBuffer = lines.pop() || '' // keep partial line

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          if (terminalEventSeen) {
            return finishError(new Error('Separator engine emitted data after terminal event.'))
          }

          let event: Record<string, unknown>
          try {
            event = JSON.parse(trimmed)
          } catch {
            return finishError(new Error(`Separator engine emitted malformed JSON: ${sanitizeDiagnostics(trimmed)}`))
          }

          if (event.type === 'progress') {
            const percent = typeof event.percent === 'number' ? event.percent : 0
            const phase = event.phase as 'loading' | 'separating' | 'writing'
            if (percent < lastProgress || percent < 0 || percent > 100) {
              return finishError(new Error(`Non-monotonic progress emitted: ${percent} after ${lastProgress}`))
            }
            lastProgress = percent
            if (onProgress) onProgress(percent, phase)
          } else if (event.type === 'result') {
            terminalEventSeen = true
            const vocalsPath = String(event.vocalsPath || '')
            const instrumentalPath = String(event.instrumentalPath || '')
            const prov = event.provider === 'directml' ? 'directml' : 'cpu'
            const elapsedMs = typeof event.elapsedMs === 'number' ? event.elapsedMs : 0

            if (!vocalsPath || !instrumentalPath) {
              return finishError(new Error('Result event missing vocalsPath or instrumentalPath.'))
            }

            if (!isInsideDirectory(vocalsPath, outputDir) || !isInsideDirectory(instrumentalPath, outputDir)) {
              return finishError(new Error('Result path escapes the requested output directory.'))
            }

            resultPayload = {
              vocalsPath,
              instrumentalPath,
              provider: prov,
              elapsedMs
            }
          } else if (event.type === 'error') {
            terminalEventSeen = true
            const err = new Error(String(event.message || event.code || 'Engine error'))
            ;(err as unknown as { retryable: boolean; code: string }).retryable = Boolean(event.retryable)
            ;(err as unknown as { retryable: boolean; code: string }).code = String(event.code || '')
            return finishError(err)
          }
        }
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrBuffer += chunk.toString('utf8')
        if (stderrBuffer.length > 64 * 1024) {
          stderrBuffer = stderrBuffer.slice(-64 * 1024)
        }
      })

      child.on('error', (err) => {
        finishError(err)
      })

      child.on('close', (code) => {
        if (settled) return
        if (code !== 0 && !resultPayload) {
          const err = new Error(
            `Separator engine failed (exit ${code}): ${sanitizeDiagnostics(stderrBuffer || 'Unknown error')}`
          )
          return finishError(err)
        }
        if (resultPayload) {
          resultPayload.stderrTail = sanitizeDiagnostics(stderrBuffer)
          return finishSuccess(resultPayload)
        }
        finishError(new Error('Separator engine closed without emitting result event.'))
      })
    } catch (err) {
      finishError(err instanceof Error ? err : new Error(String(err)))
    }
  })
}
