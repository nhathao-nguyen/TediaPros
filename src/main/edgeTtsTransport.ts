import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type { Readable } from 'node:stream'

export const EDGE_TTS_DEADLINE_MS = 60_000
export const EDGE_TTS_MAX_AUDIO_BYTES = 16 * 1024 * 1024
const EDGE_TTS_VOICES_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4'

export interface EdgeAudioSession {
  audio(): AsyncIterable<Uint8Array>
  dispose(): void
}

export interface EdgeTtsTransport {
  open(
    input: { text: string; voice: string; rate?: string; pitch?: string },
    signal: AbortSignal
  ): Promise<EdgeAudioSession>
  getVoices(signal: AbortSignal): Promise<unknown>
}

export function escapeEdgeTtsText(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;')
}

function abortError(): Error {
  return new Error('Đã hủy tác vụ Edge-TTS')
}

async function raceAbort<T>(work: Promise<T>, signal: AbortSignal, dispose: () => void): Promise<T> {
  if (signal.aborted) {
    dispose()
    throw abortError()
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => {
      dispose()
      reject(abortError())
    })
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        if (settled) return dispose()
        finish(() => resolve(value))
      },
      (error) => {
        if (settled) return dispose()
        finish(() => reject(error))
      }
    )
  })
}

export async function collectEdgeAudio(
  session: EdgeAudioSession,
  signal: AbortSignal,
  maxBytes = EDGE_TTS_MAX_AUDIO_BYTES,
  onFirstChunk?: () => void
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  let disposed = false
  const iterator = session.audio()[Symbol.asyncIterator]()
  let rejectAbort: ((reason: Error) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const onAbort = (): void => rejectAbort?.(abortError())
  signal.addEventListener('abort', onAbort, { once: true })
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    session.dispose()
  }
  try {
    if (signal.aborted) throw abortError()
    while (true) {
      const next = await Promise.race([iterator.next(), aborted])
      if (next.done) break
      const raw = next.value
      if (total === 0) onFirstChunk?.()
      const chunk = Buffer.from(raw)
      total += chunk.length
      if (total > maxBytes) throw new Error(`Âm thanh Edge-TTS quá giới hạn ${maxBytes} bytes`)
      chunks.push(chunk)
    }
    if (signal.aborted) throw abortError()
    if (total === 0) throw new Error('Microsoft Edge-TTS không trả về dữ liệu âm thanh')
    return Buffer.concat(chunks, total)
  } finally {
    signal.removeEventListener('abort', onAbort)
    dispose()
    void Promise.resolve(iterator.return?.()).catch(() => undefined)
  }
}

export interface EdgeClient {
  setMetadata(voice: string, outputFormat: OUTPUT_FORMAT): Promise<void>
  toStream(text: string, options: { rate?: string; pitch?: string }): {
    audioStream: Readable
    metadataStream?: Readable | null
  }
  close(): void
}

export function createMsEdgeTtsTransport(createClient: () => EdgeClient = () => new MsEdgeTTS()): EdgeTtsTransport {
  return {
    async open(input, signal) {
      const client = createClient()
      let audioStream: Readable | undefined
      let metadataStream: Readable | null | undefined
      const dispose = (): void => {
        audioStream?.destroy()
        metadataStream?.destroy()
        client.close()
      }
      try {
        await raceAbort(
          client.setMetadata(input.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3),
          signal,
          dispose
        )
        if (signal.aborted) throw abortError()
        const streams = client.toStream(escapeEdgeTtsText(input.text), {
          ...(input.rate ? { rate: input.rate } : {}),
          ...(input.pitch ? { pitch: input.pitch } : {})
        })
        audioStream = streams.audioStream
        metadataStream = streams.metadataStream
        return {
          audio: () => audioStream as Readable & AsyncIterable<Uint8Array>,
          dispose
        }
      } catch (error) {
        dispose()
        throw error
      }
    },
    async getVoices(signal) {
      const response = await fetch(EDGE_TTS_VOICES_URL, {
        headers: { Accept: 'application/json' },
        signal
      })
      if (!response.ok) throw new Error(`Microsoft Edge-TTS voice catalog trả về HTTP ${response.status}`)
      return response.json()
    }
  }
}

export const msEdgeTtsTransport: EdgeTtsTransport = createMsEdgeTtsTransport()

export async function withEdgeDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  deadlineMs = EDGE_TTS_DEADLINE_MS
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const onParentAbort = (): void => controller.abort()
  if (parentSignal?.aborted) controller.abort()
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, deadlineMs)
  try {
    return await operation(controller.signal)
  } catch (error) {
    if (timedOut) throw new Error(`Edge-TTS hết thời gian chờ ${Math.round(deadlineMs / 1000)} giây`)
    throw error
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', onParentAbort)
  }
}
