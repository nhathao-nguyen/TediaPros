import { app } from 'electron'
import { mkdir, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { logInfo, logWarn, errLabel } from './logger'
import type {
  EdgeVoiceDefinition,
  TtsGenerateResult,
  TtsModelInfo,
  TtsSpeechRequest
} from '../shared/types'

export type { EdgeVoiceDefinition }

/**
 * Danh sách các giọng Microsoft Edge-TTS thông dụng được hỗ trợ sẵn.
 * Bao gồm đầy đủ các quốc gia: Việt Nam, Mỹ, Anh, Úc, Đức, Ý, Tây Ban Nha,
 * Bồ Đào Nha, Brazil, Hàn Quốc, Nhật Bản, Thái Lan, Indonesia, Philippines...
 */
export const DEFAULT_EDGE_VOICES: readonly EdgeVoiceDefinition[] = [
  // 🇻🇳 Tiếng Việt
  {
    id: 'vi-VN-HoaiMyNeural',
    name: 'Hoài My (Nữ · Chuẩn miền Bắc)',
    gender: 'female',
    language: 'vi',
    locale: 'vi-VN',
    isDefault: true
  },
  {
    id: 'vi-VN-NamMinhNeural',
    name: 'Nam Minh (Nam · Chuẩn miền Bắc)',
    gender: 'male',
    language: 'vi',
    locale: 'vi-VN'
  },
  // 🇺🇸 Tiếng Anh (Mỹ / US)
  {
    id: 'en-US-JennyNeural',
    name: 'Jenny (US · Nữ · Tự nhiên)',
    gender: 'female',
    language: 'en',
    locale: 'en-US',
    isDefault: true
  },
  {
    id: 'en-US-GuyNeural',
    name: 'Guy (US · Nam · Truyền cảm)',
    gender: 'male',
    language: 'en',
    locale: 'en-US'
  },
  {
    id: 'en-US-AriaNeural',
    name: 'Aria (US · Nữ · Tươi vui)',
    gender: 'female',
    language: 'en',
    locale: 'en-US'
  },
  // 🇬🇧 Tiếng Anh (Anh / UK)
  {
    id: 'en-GB-SoniaNeural',
    name: 'Sonia (UK · Nữ · Chuẩn London)',
    gender: 'female',
    language: 'en',
    locale: 'en-GB'
  },
  {
    id: 'en-GB-RyanNeural',
    name: 'Ryan (UK · Nam · Trầm ấm)',
    gender: 'male',
    language: 'en',
    locale: 'en-GB'
  },
  // 🇦🇺 Tiếng Anh (Úc / Australia)
  {
    id: 'en-AU-NatashaNeural',
    name: 'Natasha (Úc · Nữ · Tự nhiên)',
    gender: 'female',
    language: 'en',
    locale: 'en-AU'
  },
  {
    id: 'en-AU-WilliamMultilingualNeural',
    name: 'William (Úc · Nam · Đa ngữ)',
    gender: 'male',
    language: 'en',
    locale: 'en-AU'
  },
  // 🇩🇪 Tiếng Đức (Germany)
  {
    id: 'de-DE-KatjaNeural',
    name: 'Katja (Đức · Nữ)',
    gender: 'female',
    language: 'de',
    locale: 'de-DE',
    isDefault: true
  },
  {
    id: 'de-DE-ConradNeural',
    name: 'Conrad (Đức · Nam)',
    gender: 'male',
    language: 'de',
    locale: 'de-DE'
  },
  // 🇮🇹 Tiếng Ý (Italy)
  {
    id: 'it-IT-ElsaNeural',
    name: 'Elsa (Ý · Nữ)',
    gender: 'female',
    language: 'it',
    locale: 'it-IT',
    isDefault: true
  },
  {
    id: 'it-IT-DiegoNeural',
    name: 'Diego (Ý · Nam)',
    gender: 'male',
    language: 'it',
    locale: 'it-IT'
  },
  // 🇪🇸 Tiếng Tây Ban Nha (Spain)
  {
    id: 'es-ES-ElviraNeural',
    name: 'Elvira (Tây Ban Nha · Nữ)',
    gender: 'female',
    language: 'es',
    locale: 'es-ES',
    isDefault: true
  },
  {
    id: 'es-ES-AlvaroNeural',
    name: 'Alvaro (Tây Ban Nha · Nam)',
    gender: 'male',
    language: 'es',
    locale: 'es-ES'
  },
  // 🇵🇹 Tiếng Bồ Đào Nha (Portugal)
  {
    id: 'pt-PT-RaquelNeural',
    name: 'Raquel (Bồ Đào Nha · Nữ)',
    gender: 'female',
    language: 'pt',
    locale: 'pt-PT',
    isDefault: true
  },
  {
    id: 'pt-PT-DuarteNeural',
    name: 'Duarte (Bồ Đào Nha · Nam)',
    gender: 'male',
    language: 'pt',
    locale: 'pt-PT'
  },
  // 🇧🇷 Tiếng Bồ Đào Nha (Brazil)
  {
    id: 'pt-BR-FranciscaNeural',
    name: 'Francisca (Brazil · Nữ)',
    gender: 'female',
    language: 'pt',
    locale: 'pt-BR'
  },
  {
    id: 'pt-BR-AntonioNeural',
    name: 'Antonio (Brazil · Nam)',
    gender: 'male',
    language: 'pt',
    locale: 'pt-BR'
  },
  // 🇰🇷 Tiếng Hàn (Korea)
  {
    id: 'ko-KR-SunHiNeural',
    name: 'SunHi (Hàn · Nữ)',
    gender: 'female',
    language: 'ko',
    locale: 'ko-KR',
    isDefault: true
  },
  {
    id: 'ko-KR-InJoonNeural',
    name: 'InJoon (Hàn · Nam)',
    gender: 'male',
    language: 'ko',
    locale: 'ko-KR'
  },
  // 🇯🇵 Tiếng Nhật (Japan)
  {
    id: 'ja-JP-NanamiNeural',
    name: 'Nanami (Nhật · Nữ)',
    gender: 'female',
    language: 'ja',
    locale: 'ja-JP',
    isDefault: true
  },
  {
    id: 'ja-JP-KeitaNeural',
    name: 'Keita (Nhật · Nam)',
    gender: 'male',
    language: 'ja',
    locale: 'ja-JP'
  },
  // 🇹🇭 Tiếng Thái (Thailand)
  {
    id: 'th-TH-PremwadeeNeural',
    name: 'Premwadee (Thái · Nữ)',
    gender: 'female',
    language: 'th',
    locale: 'th-TH',
    isDefault: true
  },
  {
    id: 'th-TH-NiwatNeural',
    name: 'Niwat (Thái · Nam)',
    gender: 'male',
    language: 'th',
    locale: 'th-TH'
  },
  // 🇮🇩 Tiếng Indonesia
  {
    id: 'id-ID-GadisNeural',
    name: 'Gadis (Indo · Nữ)',
    gender: 'female',
    language: 'id',
    locale: 'id-ID',
    isDefault: true
  },
  {
    id: 'id-ID-ArdiNeural',
    name: 'Ardi (Indo · Nam)',
    gender: 'male',
    language: 'id',
    locale: 'id-ID'
  },
  // 🇵🇭 Tiếng Philippines (Filipino)
  {
    id: 'fil-PH-BlessicaNeural',
    name: 'Blessica (Philippines · Nữ)',
    gender: 'female',
    language: 'fil',
    locale: 'fil-PH',
    isDefault: true
  },
  {
    id: 'fil-PH-AngeloNeural',
    name: 'Angelo (Philippines · Nam)',
    gender: 'male',
    language: 'fil',
    locale: 'fil-PH'
  },
  // 🇨🇳 Tiếng Trung (Chinese)
  {
    id: 'zh-CN-XiaoxiaoNeural',
    name: 'Xiaoxiao (Trung · Nữ)',
    gender: 'female',
    language: 'zh',
    locale: 'zh-CN',
    isDefault: true
  },
  {
    id: 'zh-CN-YunxiNeural',
    name: 'Yunxi (Trung · Nam)',
    gender: 'male',
    language: 'zh',
    locale: 'zh-CN'
  },
  // 🇫🇷 Tiếng Pháp (France)
  {
    id: 'fr-FR-DeniseNeural',
    name: 'Denise (Pháp · Nữ)',
    gender: 'female',
    language: 'fr',
    locale: 'fr-FR',
    isDefault: true
  },
  {
    id: 'fr-FR-HenriNeural',
    name: 'Henri (Pháp · Nam)',
    gender: 'male',
    language: 'fr',
    locale: 'fr-FR'
  },
  // 🇷🇺 Tiếng Nga (Russian)
  {
    id: 'ru-RU-SvetlanaNeural',
    name: 'Svetlana (Nga · Nữ)',
    gender: 'female',
    language: 'ru',
    locale: 'ru-RU',
    isDefault: true
  },
  {
    id: 'ru-RU-DmitryNeural',
    name: 'Dmitry (Nga · Nam)',
    gender: 'male',
    language: 'ru',
    locale: 'ru-RU'
  }
]

let cachedDynamicVoices: EdgeVoiceDefinition[] | null = null

/**
 * Lấy danh sách giọng đọc Edge-TTS đầy đủ.
 * Tự động đồng bộ hơn 300+ giọng đọc trực tuyến từ Microsoft Edge API khi có mạng.
 * Fallback an toàn về DEFAULT_EDGE_VOICES khi offline.
 */
export async function fetchEdgeVoices(): Promise<EdgeVoiceDefinition[]> {
  if (cachedDynamicVoices && cachedDynamicVoices.length > 0) {
    return cachedDynamicVoices
  }

  try {
    const tts = new MsEdgeTTS()
    const rawVoices = await tts.getVoices()
    if (Array.isArray(rawVoices) && rawVoices.length > 0) {
      const mapped: EdgeVoiceDefinition[] = rawVoices.map((v: any) => {
        const lang = (v.Locale || '').split('-')[0].toLowerCase()
        const friendly = v.FriendlyName || v.ShortName || ''
        const cleanName = friendly
          .replace(/^Microsoft\s+/i, '')
          .replace(/\s+Online\s+\(Natural\)/i, '')
          .trim()
        return {
          id: v.ShortName,
          name: `${cleanName} (${v.Locale})`,
          gender: v.Gender?.toLowerCase() === 'female' ? 'female' : 'male',
          language: lang,
          locale: v.Locale || '',
          isDefault: false
        }
      })

      const defaultIds = new Set(DEFAULT_EDGE_VOICES.map((d) => d.id))
      const additional = mapped.filter((m) => !defaultIds.has(m.id))
      cachedDynamicVoices = [...DEFAULT_EDGE_VOICES, ...additional]
      logInfo(`[EdgeTTS] Đã tải thành công ${cachedDynamicVoices.length} giọng đọc từ Microsoft Edge API`)
      return cachedDynamicVoices
    }
  } catch (err) {
    logWarn(`[EdgeTTS] Không tải được danh sách động, sử dụng ${DEFAULT_EDGE_VOICES.length} giọng mặc định: ${errLabel(err)}`)
  }

  return [...DEFAULT_EDGE_VOICES]
}

/**
 * Tìm kiếm giọng đọc mặc định phù hợp với mã ngôn ngữ.
 */
export function getDefaultEdgeVoiceForLanguage(lang?: string): string {
  const code = (lang || 'vi').toLowerCase().split('-')[0]
  const match = DEFAULT_EDGE_VOICES.find((v) => v.language === code && v.isDefault)
    || DEFAULT_EDGE_VOICES.find((v) => v.language === code)
  return match?.id || 'vi-VN-HoaiMyNeural'
}

/**
 * Xuất danh sách giọng Edge-TTS định dạng TtsModelInfo tương thích với UI hiện tại.
 */
export function getEdgeTtsModelInfo(): TtsModelInfo {
  return {
    id: 'edge-tts',
    name: 'Microsoft Edge-TTS (Trực tuyến · Miễn phí)',
    provider: 'edge-tts',
    logical_model: 'edge-tts',
    available: true,
    languages: Array.from(new Set(DEFAULT_EDGE_VOICES.map((v) => v.language))),
    default_voice: 'vi-VN-HoaiMyNeural',
    voices: DEFAULT_EDGE_VOICES.map((v) => v.id),
    supports_named_voice: true,
    supports_voice_clone: false,
    supported_options: ['rate', 'pitch', 'volume']
  }
}

export interface EdgeTtsOptions {
  rate?: string | number
  pitch?: string
  volume?: string | number
  timeoutMs?: number
}

export interface EdgeTtsRequest {
  text: string
  voice?: string
  language?: string
  speed?: number
  options?: EdgeTtsOptions
}

/**
 * Chuyển đổi tốc độ số (0.5 - 2.0) sang chuỗi phần trăm SSML Prosody rate của Edge-TTS.
 */
function formatEdgeRate(speed?: number, explicitRate?: string | number): string | undefined {
  if (explicitRate != null) {
    if (typeof explicitRate === 'number') {
      const pct = Math.round((explicitRate - 1) * 100)
      return pct >= 0 ? `+${pct}%` : `${pct}%`
    }
    return String(explicitRate).trim() || undefined
  }
  if (typeof speed === 'number' && Number.isFinite(speed)) {
    const clamped = Math.min(2.0, Math.max(0.5, speed))
    const pct = Math.round((clamped - 1.0) * 100)
    return pct >= 0 ? `+${pct}%` : `${pct}%`
  }
  return undefined
}

/**
 * Định dạng cao độ (pitch) sang chuỗi SSML hợp lệ.
 */
function formatEdgePitch(pitch?: string): string | undefined {
  if (!pitch || !pitch.trim()) return undefined
  const p = pitch.trim()
  if (/^[+-]?\d+(?:Hz|st|%)$/i.test(p)) return p
  return undefined
}

/**
 * Sinh giọng đọc bằng Microsoft Edge-TTS cho một câu thoại đơn lẻ.
 */
export async function generateEdgeTTS(
  req: EdgeTtsRequest | TtsSpeechRequest,
  signal?: AbortSignal,
  outputPath?: string
): Promise<TtsGenerateResult> {
  const text = (req.text || '').trim()
  if (!text) {
    return { ok: false, error: 'Văn bản không được để trống' }
  }

  if (signal?.aborted) {
    return { ok: false, error: 'Đã hủy tác vụ' }
  }

  const voice = req.voice?.trim() || getDefaultEdgeVoiceForLanguage(req.language)
  const speed = typeof req.speed === 'number' ? req.speed : 1.0
  const opts = (req.options || {}) as EdgeTtsOptions
  const timeoutMs = opts.timeoutMs || 30_000

  const rateStr = formatEdgeRate(speed, opts.rate)
  const pitchStr = formatEdgePitch(opts.pitch)

  logInfo(`[EdgeTTS] Đang tạo giọng nói (${text.length} ký tự, voice=${voice}, rate=${rateStr || 'default'}, pitch=${pitchStr || 'default'})`)

  const startTime = Date.now()

  return new Promise<TtsGenerateResult>((resolve) => {
    let finished = false
    const chunks: Buffer[] = []
    let timeoutTimer: NodeJS.Timeout | null = null

    const cleanup = (): void => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }

    const finishWithError = (errMessage: string): void => {
      if (finished) return
      finished = true
      cleanup()
      logWarn(`[EdgeTTS] Lỗi: ${errMessage}`)
      resolve({ ok: false, error: errMessage, provider: 'edge-tts', voice, speed })
    }

    const onAbort = (): void => {
      finishWithError('Đã hủy tác vụ tạo giọng nói')
    }

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }

    timeoutTimer = setTimeout(() => {
      finishWithError(`Hết thời gian chờ (${Math.round(timeoutMs / 1000)}s). Vui lòng kiểm tra lại kết nối mạng Internet.`)
    }, timeoutMs)

    ;(async () => {
      try {
        const tts = new MsEdgeTTS()
        await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3)

        const prosody: Record<string, any> = {}
        if (rateStr) prosody.rate = rateStr
        if (pitchStr) prosody.pitch = pitchStr

        const { audioStream } = tts.toStream(text, Object.keys(prosody).length > 0 ? prosody : undefined)

        audioStream.on('data', (data: Buffer | Uint8Array) => {
          if (Buffer.isBuffer(data)) {
            chunks.push(data)
          } else {
            chunks.push(Buffer.from(data))
          }
        })

        audioStream.on('error', (err: any) => {
          finishWithError(`Lỗi luồng âm thanh Microsoft Edge-TTS: ${errLabel(err)}`)
        })

        audioStream.on('close', async () => {
          if (finished) return
          try {
            const buffer = Buffer.concat(chunks)
            if (buffer.length === 0) {
              finishWithError('Microsoft Edge-TTS không trả về dữ liệu âm thanh')
              return
            }

            const finalPath = outputPath || join(
              app.getPath('temp'),
              'tblao-tts-preview',
              `edge-${Date.now()}-${randomUUID().slice(0, 8)}.mp3`
            )

            await mkdir(dirname(finalPath), { recursive: true })
            await writeFile(finalPath, buffer)

            const fileStat = await stat(finalPath).catch(() => null)
            if (!fileStat || fileStat.size <= 0) {
              finishWithError('Không thể lưu file âm thanh vào đĩa')
              return
            }

            // Với định dạng audio-24khz-96kbitrate-mono-mp3: bitrate = 96000 bps = 12000 B/s
            const estimatedDurationMs = Math.round((buffer.length / 12_000) * 1000)
            const generationMs = Date.now() - startTime
            const audioBase64 = outputPath ? undefined : buffer.toString('base64')

            finished = true
            cleanup()

            logInfo(`[EdgeTTS] Hoàn tất tạo giọng (${buffer.length} bytes, ~${(estimatedDurationMs / 1000).toFixed(2)}s) trong ${generationMs}ms`)

            resolve({
              ok: true,
              audioBase64,
              audioMimeType: 'audio/mpeg',
              savedPath: finalPath,
              characters: text.length,
              durationMs: estimatedDurationMs,
              generationMs,
              model: 'edge-tts',
              provider: 'edge-tts',
              voice,
              speed
            })
          } catch (writeErr) {
            finishWithError(`Lỗi ghi file âm thanh: ${errLabel(writeErr)}`)
          }
        })
      } catch (err: any) {
        finishWithError(`Không thể kết nối đến Microsoft Edge-TTS (vui lòng kiểm tra Internet): ${errLabel(err)}`)
      }
    })()
  })
}

export interface EdgeTtsBatchItem {
  id: string
  text: string
  voice?: string
  speed?: number
  outputPath?: string
  options?: EdgeTtsOptions
}

export interface EdgeTtsBatchResult {
  id: string
  result: TtsGenerateResult
}

export interface EdgeTtsBatchOptions {
  /** Số luồng xử lý đồng thời tối đa (mặc định 4) */
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (completed: number, total: number, item: EdgeTtsBatchItem) => void
}

/**
 * Xử lý tạo giọng nói hàng loạt với giới hạn số luồng đồng thời (Concurrency Control).
 * Giúp tạo giọng cho hàng chục câu thoại chỉ trong vài giây mà không bị nghẽn mạng.
 */
export async function generateEdgeTTSBatch(
  items: readonly EdgeTtsBatchItem[],
  options?: EdgeTtsBatchOptions
): Promise<EdgeTtsBatchResult[]> {
  if (items.length === 0) return []

  const concurrency = Math.max(1, Math.min(8, options?.concurrency ?? 4))
  const signal = options?.signal
  const results: EdgeTtsBatchResult[] = new Array(items.length)
  let nextIndex = 0
  let completed = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      if (signal?.aborted) throw new Error('Đã hủy tác vụ')
      const currentIndex = nextIndex++
      const item = items[currentIndex]

      const res = await generateEdgeTTS(
        {
          text: item.text,
          voice: item.voice,
          speed: item.speed,
          options: item.options
        },
        signal,
        item.outputPath
      )

      results[currentIndex] = {
        id: item.id,
        result: res
      }

      completed++
      if (options?.onProgress) {
        options.onProgress(completed, items.length, item)
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)

  return results
}
