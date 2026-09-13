import { app } from 'electron'
import { mkdir, readFile, writeFile, stat, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { logInfo, logWarn, errLabel, debugRaw } from './logger'
import { EDGE_VOICE_ID_PATTERN, resolveEdgeVoice, validateEdgeProsody } from '../shared/edgeTtsContract'
import { assertTtsAudioHeader } from '../shared/ttsAudioFormat'
import {
  collectEdgeAudio,
  msEdgeTtsTransport,
  withEdgeDeadline,
  type EdgeTtsTransport
} from './edgeTtsTransport'
import { EDGE_TTS_ENDPOINT_ID } from './edgeTtsIdentity'
import { resolveFfmpeg } from './deps'
import { terminateProcessTree, trackChildProcess } from './processTree'
import type {
  EdgeVoiceCatalogResult,
  AutoShortRequestSpan,
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

let cachedDynamicCatalog: EdgeVoiceCatalogResult | null = null
interface EdgeVoiceCatalogRequest {
  promise: Promise<EdgeVoiceCatalogResult>
  controller: AbortController
  waiters: number
  settled: boolean
}

let catalogRequest: EdgeVoiceCatalogRequest | null = null

/**
 * Lấy danh sách giọng đọc Edge-TTS đầy đủ.
 * Tự động đồng bộ hơn 300+ giọng đọc trực tuyến từ Microsoft Edge API khi có mạng.
 * Fallback an toàn về DEFAULT_EDGE_VOICES khi offline.
 */
async function loadEdgeVoices(signal?: AbortSignal): Promise<EdgeVoiceCatalogResult> {
  const checkedAtUtc = new Date().toISOString()
  try {
    const rawVoices = await withEdgeDeadline((deadlineSignal) => msEdgeTtsTransport.getVoices(deadlineSignal), signal)
    if (Array.isArray(rawVoices) && rawVoices.length > 0) {
      const mapped: EdgeVoiceDefinition[] = rawVoices.flatMap((raw) => {
        if (!raw || typeof raw !== 'object') return []
        const v = raw as Record<string, unknown>
        if (typeof v.ShortName !== 'string' || !EDGE_VOICE_ID_PATTERN.test(v.ShortName) || typeof v.Locale !== 'string' || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){1,2}$/u.test(v.Locale)) return []
        const lang = v.Locale.split('-')[0].toLowerCase()
        const friendly = typeof v.FriendlyName === 'string' ? v.FriendlyName : v.ShortName
        const cleanName = friendly
          .replace(/^Microsoft\s+/i, '')
          .replace(/\s+Online\s+\(Natural\)/i, '')
          .trim()
        return {
          id: v.ShortName,
          name: `${cleanName} (${v.Locale})`,
          gender: typeof v.Gender === 'string' && v.Gender.toLowerCase() === 'female' ? 'female' : 'male',
          language: lang,
          locale: v.Locale,
          isDefault: false
        }
      })

      const unique = new Map(mapped.map((voice) => [voice.id, voice]))
      const voices = [...unique.values()]
      cachedDynamicCatalog = { ok: true, voices, source: 'live', checkedAtUtc }
      logInfo(`[EdgeTTS] Đã tải thành công ${voices.length} giọng đọc từ Microsoft Edge API`)
      return cachedDynamicCatalog
    }
  } catch (err) {
    const error = errLabel(err)
    logWarn(`[EdgeTTS] Không tải được danh sách động, sử dụng ${DEFAULT_EDGE_VOICES.length} giọng mặc định: ${error}`)
    return { ok: false, voices: [...DEFAULT_EDGE_VOICES], source: 'fallback', checkedAtUtc, error }
  }

  return {
    ok: false,
    voices: [...DEFAULT_EDGE_VOICES],
    source: 'fallback',
    checkedAtUtc,
    error: 'Microsoft Edge-TTS trả về catalog rỗng'
  }
}

function waitForEdgeVoiceCatalog(
  request: EdgeVoiceCatalogRequest,
  signal?: AbortSignal
): Promise<EdgeVoiceCatalogResult> {
  request.waiters += 1
  return new Promise((resolve, reject) => {
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      signal?.removeEventListener('abort', onAbort)
      request.waiters -= 1
      if (request.waiters === 0 && !request.settled) request.controller.abort()
    }
    const onAbort = (): void => {
      release()
      reject(new Error('Đã hủy tác vụ Edge-TTS'))
    }

    if (signal?.aborted) return onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    request.promise.then(
      (catalog) => {
        if (released) return
        release()
        resolve(catalog)
      },
      (error) => {
        if (released) return
        release()
        reject(error)
      }
    )
  })
}

export async function fetchEdgeVoices(options: { forceRefresh?: boolean; signal?: AbortSignal } = {}): Promise<EdgeVoiceCatalogResult> {
  if (options.signal?.aborted) throw new Error('Đã hủy tác vụ Edge-TTS')
  if (!options.forceRefresh && cachedDynamicCatalog) {
    return cachedDynamicCatalog
  }
  if (!catalogRequest) {
    const controller = new AbortController()
    const request: EdgeVoiceCatalogRequest = {
      promise: loadEdgeVoices(controller.signal),
      controller,
      waiters: 0,
      settled: false
    }
    catalogRequest = request
    void request.promise.finally(() => {
      request.settled = true
      if (catalogRequest === request) catalogRequest = null
    })
  }
  return waitForEdgeVoiceCatalog(catalogRequest, options.signal)
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
export function getEdgeTtsModelInfo(
  voices: readonly EdgeVoiceDefinition[] = DEFAULT_EDGE_VOICES,
  defaultVoice = voices.find((voice) => voice.isDefault)?.id || voices[0]?.id || 'vi-VN-HoaiMyNeural'
): TtsModelInfo {
  return {
    id: 'edge-tts',
    name: 'Microsoft Edge-TTS (Trực tuyến)',
    provider: 'edge-tts',
    logical_model: 'edge-tts',
    available: true,
    languages: Array.from(new Set(voices.map((voice) => voice.language))),
    default_voice: defaultVoice,
    voices: voices.map((voice) => voice.id),
    supports_named_voice: true,
    supports_voice_clone: false,
    supported_options: ['pitch']
  }
}

export interface EdgeTtsOptions {
  pitch?: string
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
function formatEdgeRate(speed?: number): string | undefined {
  if (typeof speed === 'number' && Number.isFinite(speed)) {
    const pct = Math.round((speed - 1.0) * 100)
    return pct >= 0 ? `+${pct}%` : `${pct}%`
  }
  return undefined
}

type EdgeMediaResult = { stdout: string; stderr: string }

export interface EdgeTtsRuntimeHooks {
  transport?: EdgeTtsTransport
  voices?: readonly EdgeVoiceDefinition[]
  resolveFfmpeg?: () => Promise<string | null>
  runMedia?: (command: string, args: string[], signal: AbortSignal) => Promise<EdgeMediaResult>
  deadlineMs?: number
  afterPublish?: () => void | Promise<void>
  afterFinalStat?: () => void | Promise<void>
}

function throwIfEdgeAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Đã hủy tác vụ Edge-TTS')
}

async function runEdgeMedia(command: string, args: string[], signal: AbortSignal): Promise<EdgeMediaResult> {
  throwIfEdgeAborted(signal)
  return new Promise((resolve, reject) => {
    const child = trackChildProcess(spawn(command, args, { windowsHide: true, shell: false }))
    let stdout = ''
    let stderr = ''
    let abortFailure: Error | null = null
    const abort = (): void => {
      abortFailure = new Error('Đã hủy tác vụ Edge-TTS')
      terminateProcessTree(child)
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error) => {
      signal.removeEventListener('abort', abort)
      reject(abortFailure || error)
    })
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (abortFailure) reject(abortFailure)
      else if (code !== 0) reject(new Error(stderr.trim() || `Tiến trình media Edge-TTS thoát với mã ${code}`))
      else resolve({ stdout, stderr })
    })
  })
}

function parseProbedDurationMs(output: string): number {
  const seconds = Number(/duration=([\d.]+)/u.exec(output)?.[1])
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Không đọc được thời lượng audio Edge-TTS đã giải mã')
  return Math.round(seconds * 1000)
}

export async function probeEdgeTtsSynthesis(
  voice: string,
  signal?: AbortSignal,
  hooks: EdgeTtsRuntimeHooks = {}
): Promise<void> {
  const transport = hooks.transport || msEdgeTtsTransport
  await withEdgeDeadline(async (deadlineSignal) => {
    const active = await transport.open({ text: 'TediaPros', voice }, deadlineSignal)
    const audio = await collectEdgeAudio(active, deadlineSignal, 2 * 1024 * 1024)
    assertTtsAudioHeader(audio, 'audio/mpeg')
  }, signal, hooks.deadlineMs)
}

/**
 * Định dạng cao độ (pitch) sang chuỗi SSML hợp lệ.
 */
/**
 * Sinh giọng đọc bằng Microsoft Edge-TTS cho một câu thoại đơn lẻ.
 */
export async function generateEdgeTTS(
  req: EdgeTtsRequest | TtsSpeechRequest,
  signal?: AbortSignal,
  outputPath?: string,
  hooks: EdgeTtsRuntimeHooks = {}
): Promise<TtsGenerateResult> {
  const text = (req.text || '').trim()
  if (!text) {
    return { ok: false, error: 'Văn bản không được để trống' }
  }

  if (signal?.aborted) {
    return { ok: false, error: 'Đã hủy tác vụ' }
  }
  if (Array.from(text).length > 20_000) {
    return { ok: false, error: 'Văn bản Edge-TTS vượt quá 20.000 ký tự Unicode' }
  }
  if ('model' in req && req.model && req.model !== 'edge-tts') {
    return { ok: false, error: 'Microsoft Edge-TTS yêu cầu model edge-tts', provider: 'edge-tts' }
  }

  const requestedVoice = req.voice?.trim()
  const language = req.language || requestedVoice?.split('-').slice(0, 2).join('-') || 'vi'
  const catalog = hooks.voices || cachedDynamicCatalog?.voices || [...DEFAULT_EDGE_VOICES]
  let voice: string
  let speed: number
  let pitchStr: string | undefined
  try {
    voice = resolveEdgeVoice(catalog, language, requestedVoice).id
    const options = (req.options || {}) as Record<string, unknown>
    const unexpected = Object.keys(options).filter((key) => key !== 'pitch' && options[key] !== undefined)
    if (unexpected.length > 0) throw new Error(`Tùy chọn Edge-TTS không được hỗ trợ: ${unexpected.join(', ')}`)
    const prosody = validateEdgeProsody(
      { speed: req.speed, pitch: typeof options.pitch === 'string' ? options.pitch : undefined },
      'voice'
    )
    speed = prosody.speed
    pitchStr = prosody.pitch
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      provider: 'edge-tts'
    }
  }

  const rateStr = formatEdgeRate(speed)

  logInfo(`[EdgeTTS] Đang tạo giọng nói (${text.length} ký tự, voice=${voice}, rate=${rateStr || 'default'}, pitch=${pitchStr || 'default'})`)

  const startTime = Date.now()
  const requestSpan: AutoShortRequestSpan = {
    url: EDGE_TTS_ENDPOINT_ID,
    queuedAtUtc: new Date(startTime).toISOString(),
    retryIndex: 0,
    sourceChars: Array.from(text).length
  }

  const finalPath = outputPath || join(
    app.getPath('temp'),
    'tblao-tts-preview',
    `edge-${Date.now()}-${randomUUID().slice(0, 8)}.mp3`
  )
  const sourcePartialPath = `${finalPath}.${randomUUID()}.source.partial`
  const outputPartialPath = `${finalPath}.${randomUUID()}.output.partial`
  let publishedFinal = false
  try {
    const completed = await withEdgeDeadline(async (deadlineSignal) => {
      requestSpan.startedAtUtc = new Date().toISOString()
      const transport = hooks.transport || msEdgeTtsTransport
      const session = await transport.open({ text, voice, rate: rateStr, pitch: pitchStr }, deadlineSignal)
      const buffer = await collectEdgeAudio(session, deadlineSignal, undefined, () => {
        requestSpan.firstResponseAtUtc ||= new Date().toISOString()
      })
      assertTtsAudioHeader(buffer, 'audio/mpeg')
      throwIfEdgeAborted(deadlineSignal)
      if (await stat(finalPath).then(() => true).catch(() => false)) {
        throw new Error('File đầu ra Edge-TTS đã tồn tại')
      }
      const ffmpeg = await (hooks.resolveFfmpeg || resolveFfmpeg)()
      if (!ffmpeg) throw new Error('Thiếu FFmpeg để xác thực audio Edge-TTS')
      const runMedia = hooks.runMedia || runEdgeMedia
      const ffprobe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
      await mkdir(dirname(finalPath), { recursive: true })
      await writeFile(sourcePartialPath, buffer)
      throwIfEdgeAborted(deadlineSignal)

      let validatedPath = sourcePartialPath
      let audioMimeType = 'audio/mpeg'
      if (outputPath) {
        await runMedia(ffmpeg, [
          '-v', 'error', '-y', '-i', sourcePartialPath, '-vn',
          '-c:a', 'pcm_s16le', '-ar', '24000', '-ac', '1', '-f', 'wav', outputPartialPath
        ], deadlineSignal)
        throwIfEdgeAborted(deadlineSignal)
        const wavHeader = await readFile(outputPartialPath)
        assertTtsAudioHeader(wavHeader, 'audio/wav')
        validatedPath = outputPartialPath
        audioMimeType = 'audio/wav'
      } else {
        await runMedia(ffmpeg, ['-v', 'error', '-i', sourcePartialPath, '-f', 'null', '-'], deadlineSignal)
        throwIfEdgeAborted(deadlineSignal)
      }

      const probe = await runMedia(ffprobe, [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1', validatedPath
      ], deadlineSignal)
      const durationMs = parseProbedDurationMs(probe.stdout)
      throwIfEdgeAborted(deadlineSignal)
      await rename(validatedPath, finalPath)
      publishedFinal = true
      await hooks.afterPublish?.()
      throwIfEdgeAborted(deadlineSignal)
      if (outputPath) {
        await rm(sourcePartialPath, { force: true })
        throwIfEdgeAborted(deadlineSignal)
      }
      const fileStat = await stat(finalPath)
      await hooks.afterFinalStat?.()
      throwIfEdgeAborted(deadlineSignal)
      if (!fileStat.isFile() || fileStat.size <= 0) throw new Error('Không thể xác thực file âm thanh Edge-TTS trên đĩa')
      return { buffer, durationMs, audioMimeType }
    }, signal, hooks.deadlineMs)
    const generationMs = Date.now() - startTime
    requestSpan.endedAtUtc = new Date().toISOString()
    requestSpan.durationMs = generationMs
    requestSpan.audioDurationSec = completed.durationMs / 1000
    logInfo(`[EdgeTTS] Hoàn tất tạo giọng (${completed.buffer.length} bytes, ${(completed.durationMs / 1000).toFixed(2)}s) trong ${generationMs}ms`)
    return {
      ok: true,
      audioBase64: outputPath ? undefined : completed.buffer.toString('base64'),
      audioMimeType: completed.audioMimeType,
      savedPath: finalPath,
      characters: Array.from(text).length,
      durationMs: completed.durationMs,
      generationMs,
      model: 'edge-tts',
      provider: 'edge-tts',
      voice,
      speed,
      requestSpans: [requestSpan]
    }
  } catch (error) {
    await Promise.all([
      rm(sourcePartialPath, { force: true }).catch(() => undefined),
      rm(outputPartialPath, { force: true }).catch(() => undefined),
      publishedFinal ? rm(finalPath, { force: true }).catch(() => undefined) : Promise.resolve()
    ])
    debugRaw('Edge-TTS generation failed', error)
    const message = signal?.aborted ? 'Đã hủy tác vụ' : errLabel(error)
    requestSpan.endedAtUtc = new Date().toISOString()
    requestSpan.durationMs = Date.now() - startTime
    requestSpan.error = message
    requestSpan.failureKind = signal?.aborted ? 'cancelled' : /thời gian chờ/u.test(message) ? 'timeout' : 'transport'
    logWarn(`[EdgeTTS] Lỗi: ${message}`)
    return { ok: false, error: message, provider: 'edge-tts', voice, speed, requestSpans: [requestSpan] }
  }
}
