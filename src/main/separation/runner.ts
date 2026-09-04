import { spawn, type ChildProcess } from 'node:child_process'
import { dirname } from 'node:path'
import { trackChildProcess, terminateProcessTree } from '../processTree'
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

  return new Promise((resolve) => {
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
      resolve(res)
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
          // Attempt to parse probe event or error event from stdout
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
