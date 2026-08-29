import { app, dialog } from 'electron'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { logInfo, logWarn, errLabel } from './logger'
import type {
  TtsCloneRequest,
  TtsGenerateResult,
  TtsModelInfo,
  TtsServerHealth,
  TtsSpeechRequest
} from '../shared/types'

const DEFAULT_SERVER_URL = 'http://192.168.1.19:8000'

const VIENEU_PRESET_VOICES = [
  'Minh Đức',
  'Phạm Tuyên',
  'Thái Sơn',
  'Xuân Vĩnh',
  'Thanh Bình',
  'Trúc Ly',
  'Ngọc Linh',
  'Đoan Trang',
  'Mai Anh',
  'Thục Đoan',
  'Minh Triết',
  'Thùy Dung',
  'Quang Sơn',
  'Ngọc Trân',
  'Mỹ Duyên',
  'Quỳnh Anh',
  'Đức Trí',
  'Kim Thanh',
  'Ngọc Huyền',
  'Adam'
]

const CHATTERBOX_SUPPORTED_LANGUAGES = [
  'ar',
  'da',
  'de',
  'el',
  'en',
  'es',
  'fi',
  'fr',
  'he',
  'hi',
  'it',
  'ja',
  'ko',
  'ms',
  'nl',
  'no',
  'pl',
  'pt',
  'ru',
  'sv',
  'sw',
  'tr',
  'zh'
]

const TTS_MODEL_IDS = new Set(['tts-vietnamese', 'tts-multilingual'])

function normalizeUrl(url?: string): string {
  const target = (url || DEFAULT_SERVER_URL).trim()
  return target.replace(/\/+$/, '')
}

function getAuthHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {}
  if (apiKey && apiKey.trim()) {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`
  }
  return headers
}

function requestSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

function errorMessageFromPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const body = payload as Record<string, unknown>
  const nested = body.error
  if (nested && typeof nested === 'object') {
    const error = nested as Record<string, unknown>
    const message = typeof error.message === 'string' ? error.message.trim() : ''
    const code = typeof error.code === 'string' ? error.code.trim() : ''
    if (code && message) return `${code}: ${message}`
    if (message) return message
    if (code) return code
  }
  for (const value of [body.message, body.detail, body.error]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

async function responseErrorMessage(res: Response, fallback: string): Promise<string> {
  const raw = await res.text().catch(() => '')
  if (!raw.trim()) return fallback
  try {
    return errorMessageFromPayload(JSON.parse(raw) as unknown, fallback)
  } catch {
    return raw.trim().slice(0, 300) || fallback
  }
}

function audioMimeType(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop()
  if (extension === 'mp3') return 'audio/mpeg'
  if (extension === 'flac') return 'audio/flac'
  if (extension === 'm4a') return 'audio/mp4'
  if (extension === 'ogg') return 'audio/ogg'
  return 'audio/wav'
}

export async function checkTtsServerHealth(
  serverUrl?: string,
  apiKey?: string
): Promise<TtsServerHealth> {
  const base = normalizeUrl(serverUrl)
  try {
    const res = await fetch(`${base}/health/live`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...getAuthHeaders(apiKey)
      },
      signal: AbortSignal.timeout(1500)
    })

    if (!res.ok) {
      return {
        ok: false,
        status: `HTTP ${res.status}`,
        error: `Server phản hồi mã lỗi ${res.status}`
      }
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, any>
    return {
      ok: true,
      status: data.status || 'live',
      gpu: data.gpu?.name || data.gpu_name || data.gpu || undefined,
      vram: data.gpu?.vram || data.vram || undefined,
      details: data
    }
  } catch (err: any) {
    return {
      ok: false,
      status: 'offline',
      error: `Không thể kết nối đến ${base} (quá thời gian hoặc server chưa bật): ${errLabel(err)}`
    }
  }
}

export async function getTtsModels(
  serverUrl?: string,
  apiKey?: string
): Promise<{ ok: boolean; models: TtsModelInfo[]; error?: string }> {
  const base = normalizeUrl(serverUrl)
  try {
    const res = await fetch(`${base}/v1/models`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...getAuthHeaders(apiKey)
      },
      // `/v1/models` refreshes provider readiness and may take several
      // seconds on a cold server; the server integration guide uses a 60s
      // client timeout for this endpoint.
      signal: AbortSignal.timeout(60_000)
    })

    if (!res.ok) {
      return { ok: false, models: [], error: await responseErrorMessage(res, `Server trả về mã lỗi ${res.status}`) }
    }

    const body = (await res.json()) as unknown
    let rawList: unknown[] = []
    if (Array.isArray(body)) {
      rawList = body
    } else if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>
      const candidate = record.data ?? record.models
      if (Array.isArray(candidate)) rawList = candidate
    }
    const models: TtsModelInfo[] = rawList.flatMap((raw: unknown) => {
        if (!raw || typeof raw !== 'object') return []
        const m = raw as Record<string, unknown>
        const capabilities = m.capabilities && typeof m.capabilities === 'object'
          ? (m.capabilities as Record<string, unknown>)
          : {}
        const id = typeof m.id === 'string' ? m.id : typeof m.logical_model === 'string' ? m.logical_model : ''
        if (!TTS_MODEL_IDS.has(id)) return []
        const provider = typeof m.provider === 'string' ? m.provider : id === 'tts-vietnamese' ? 'vieneu' : 'chatterbox'
        const languages = capabilities.supported_languages
        const voices = capabilities.preset_voice_names
        const supportedOptions = capabilities.supported_options
        const defaultOptions = capabilities.default_options
        return [{
          id,
          name: typeof m.name === 'string' ? m.name : typeof m.physical_model === 'string' ? m.physical_model : id,
          provider,
          logical_model: typeof m.logical_model === 'string' ? m.logical_model : id,
          available: m.available !== false,
          languages: Array.isArray(languages) ? languages.filter((v): v is string => typeof v === 'string') : [],
          default_voice: typeof capabilities.default_voice === 'string' ? capabilities.default_voice : undefined,
          voices: Array.isArray(voices) ? voices.filter((v): v is string => typeof v === 'string') : [],
          supports_voice_clone: capabilities.supports_voice_clone === true,
          supports_named_voice: capabilities.supports_named_voice === true,
          supported_options: Array.isArray(supportedOptions)
            ? supportedOptions.filter((v): v is string => typeof v === 'string')
            : [],
          default_options: defaultOptions && typeof defaultOptions === 'object' ? defaultOptions as Record<string, unknown> : undefined
        }]
    })
    if (models.length === 0) {
      return { ok: false, models: [], error: 'tts-server không trả về model TTS hợp lệ' }
    }
    return { ok: true, models }
  } catch (err: any) {
    logWarn(`[TTS] Could not load models from ${base}: ${errLabel(err)}`)
    return { ok: false, models: [], error: `Không thể tải capability TTS: ${errLabel(err)}` }
  }
}

function cleanOptionsForProvider(
  provider: 'vieneu' | 'chatterbox',
  options?: Record<string, any>
): Record<string, any> {
  if (!options) return {}
  const clean: Record<string, any> = {}
  if (provider === 'vieneu') {
    if (typeof options.denoise === 'boolean') clean.denoise = options.denoise
    if (typeof options.temperature === 'number') clean.temperature = options.temperature
    if (typeof options.top_p === 'number') clean.top_p = options.top_p
    if (typeof options.repetition_penalty === 'number') clean.repetition_penalty = options.repetition_penalty
    if (typeof options.top_k === 'number') clean.top_k = options.top_k
  } else {
    // chatterbox options
    if (typeof options.temperature === 'number') clean.temperature = options.temperature
    if (typeof options.top_p === 'number') clean.top_p = options.top_p
    if (typeof options.repetition_penalty === 'number') clean.repetition_penalty = options.repetition_penalty
    if (typeof options.exaggeration === 'number') clean.exaggeration = options.exaggeration
    if (typeof options.cfg_weight === 'number') clean.cfg_weight = options.cfg_weight
    if (typeof options.min_p === 'number') clean.min_p = options.min_p
  }
  return clean
}

export async function generateSpeech(
  req: TtsSpeechRequest,
  signal?: AbortSignal,
  savePath?: string
): Promise<TtsGenerateResult> {
  const base = normalizeUrl(req.serverUrl)
  const text = (req.text || '').trim()
  if (!text) {
    return { ok: false, error: 'Văn bản không được để trống' }
  }

  const isVieneu = (req.model || 'tts-vietnamese') === 'tts-vietnamese'
  const provider = isVieneu ? 'vieneu' : 'chatterbox'
  const cleanOptions = cleanOptionsForProvider(provider, req.options)

  let validVoice: string | null = null
  if (isVieneu) {
    validVoice = req.voice && VIENEU_PRESET_VOICES.includes(req.voice) ? req.voice : 'Adam'
  } else {
    validVoice = req.voice === 'default' ? 'default' : null
  }

  const safeSpeed = Number.isFinite(req.speed) ? Math.min(2, Math.max(0.5, req.speed!)) : 1.0
  const payload: Record<string, any> = {
    input: text,
    text: text,
    language: req.language || 'vi',
    model: req.model || 'tts-vietnamese',
    voice: validVoice,
    speed: safeSpeed,
    options: cleanOptions
  }

  logInfo(`[TTS] Requesting speech from ${base}/v1/audio/speech (${text.length} chars)`)

  try {
    const res = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/wav, audio/*',
        ...getAuthHeaders(req.apiKey)
      },
      body: JSON.stringify(payload),
      signal: requestSignal(120_000, signal)
    })

    if (!res.ok) {
      return { ok: false, error: await responseErrorMessage(res, `Server trả về mã lỗi ${res.status}`) }
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const audioBase64 = savePath ? undefined : buffer.toString('base64')
    const mimeType = res.headers.get('content-type') || 'audio/wav'

    const tempPath = savePath || join(app.getPath('temp'), 'tblao-tts-preview', `speech-${Date.now()}-${randomUUID().slice(0, 8)}.wav`)
    await mkdir(dirname(tempPath), { recursive: true })
    await writeFile(tempPath, buffer)
    const fileStat = await stat(tempPath).catch(() => null)
    if (!fileStat || fileStat.size <= 0) {
      return { ok: false, error: 'Không thể lưu file âm thanh vào đĩa' }
    }

    return {
      ok: true,
      audioBase64: savePath ? undefined : audioBase64,
      audioMimeType: mimeType,
      savedPath: tempPath,
      characters: parseInt(res.headers.get('x-tts-characters') || `${text.length}`, 10),
      durationMs: parseFloat(res.headers.get('x-tts-duration-ms') || '0'),
      generationMs: parseFloat(res.headers.get('x-tts-generation-ms') || '0'),
      credits: parseFloat(res.headers.get('x-tts-credits') || '0'),
      model: res.headers.get('x-tts-model') || req.model,
      provider: res.headers.get('x-tts-provider') || undefined,
      voice: res.headers.get('x-tts-voice') ? decodeURIComponent(res.headers.get('x-tts-voice')!) : (validVoice || req.voice),
      speed: parseFloat(res.headers.get('x-tts-speed') || '1.0')
    }
  } catch (err: any) {
    logWarn(`[TTS] Error generating speech: ${errLabel(err)}`)
    if (signal?.aborted) return { ok: false, error: 'Đã hủy tác vụ' }
    return { ok: false, error: `Lỗi kết nối tts-server: ${errLabel(err)}` }
  }
}

export async function generateVoiceClone(
  req: TtsCloneRequest,
  signal?: AbortSignal,
  savePath?: string
): Promise<TtsGenerateResult> {
  const base = normalizeUrl(req.serverUrl)
  const text = (req.text || '').trim()
  if (!text) {
    return { ok: false, error: 'Văn bản cần đọc không được để trống' }
  }
  if (!req.referenceAudioPath) {
    return { ok: false, error: 'Vui lòng chọn file âm thanh mẫu (Reference Audio)' }
  }

  try {
    const audioFileBuffer = await readFile(req.referenceAudioPath)
    const fileName = basename(req.referenceAudioPath)
    const blob = new Blob([audioFileBuffer], { type: audioMimeType(fileName) })

    const isVieneu = (req.model || 'tts-vietnamese') === 'tts-vietnamese'
    const provider = isVieneu ? 'vieneu' : 'chatterbox'
    const cleanOptions = cleanOptionsForProvider(provider, req.options)

    const form = new FormData()
    form.append('text', text)
    form.append('language', req.language || 'vi')
    if (req.model) form.append('model', req.model)
    if (req.referenceTranscript) form.append('reference_transcript', req.referenceTranscript)
    const safeSpeed = Number.isFinite(req.speed) ? Math.min(2, Math.max(0.5, req.speed!)) : 1.0
    form.append('speed', String(safeSpeed))
    if (Object.keys(cleanOptions).length > 0) {
      form.append('options_json', JSON.stringify(cleanOptions))
    }
    // `voice` is deliberately omitted for clone requests. The server treats the
    // reference file as the voice and only accepts preset/default names during
    // validation; the UI's clone name is local metadata, not an API voice id.
    form.append('reference_audio', blob, fileName)

    logInfo(`[TTS] Requesting voice clone from ${base}/v1/audio/voice-clone with ${fileName}`)

    const res = await fetch(`${base}/v1/audio/voice-clone`, {
      method: 'POST',
      headers: {
        Accept: 'audio/wav, audio/*',
        ...getAuthHeaders(req.apiKey)
      },
      body: form,
      signal: requestSignal(180_000, signal)
    })

    if (!res.ok) {
      return { ok: false, error: await responseErrorMessage(res, `Server trả về mã lỗi ${res.status}`) }
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const audioBase64 = savePath ? undefined : buffer.toString('base64')
    const mimeType = res.headers.get('content-type') || 'audio/wav'

    const tempPath = savePath || join(app.getPath('temp'), 'tblao-tts-preview', `clone-${Date.now()}-${randomUUID().slice(0, 8)}.wav`)
    await mkdir(dirname(tempPath), { recursive: true })
    await writeFile(tempPath, buffer)
    const fileStat = await stat(tempPath).catch(() => null)
    if (!fileStat || fileStat.size <= 0) {
      return { ok: false, error: 'Không thể lưu file âm thanh vào đĩa' }
    }

    return {
      ok: true,
      audioBase64: savePath ? undefined : audioBase64,
      audioMimeType: mimeType,
      savedPath: tempPath,
      characters: parseInt(res.headers.get('x-tts-characters') || `${text.length}`, 10),
      durationMs: parseFloat(res.headers.get('x-tts-duration-ms') || '0'),
      generationMs: parseFloat(res.headers.get('x-tts-generation-ms') || '0'),
      credits: parseFloat(res.headers.get('x-tts-credits') || '0'),
      model: res.headers.get('x-tts-model') || req.model,
      provider: res.headers.get('x-tts-provider') || undefined,
      voice: 'reference_clone',
      speed: parseFloat(res.headers.get('x-tts-speed') || `${req.speed || 1.0}`)
    }
  } catch (err: any) {
    logWarn(`[TTS] Error generating voice clone: ${errLabel(err)}`)
    if (signal?.aborted) return { ok: false, error: 'Đã hủy tác vụ' }
    return { ok: false, error: `Lỗi clone giọng nói: ${errLabel(err)}` }
  }
}

export async function saveTtsAudio(
  audioBase64: string,
  defaultName = 'voice-output.wav'
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!audioBase64) {
    return { ok: false, error: 'Dữ liệu âm thanh rỗng' }
  }

  try {
    const result = await dialog.showSaveDialog({
      title: 'Lưu file âm thanh TTS',
      defaultPath: defaultName,
      filters: [
        { name: 'WAV Audio (*.wav)', extensions: ['wav'] },
        { name: 'All Files (*.*)', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { ok: false }
    }

    const buffer = Buffer.from(audioBase64, 'base64')
    await writeFile(result.filePath, buffer)
    return { ok: true, path: result.filePath }
  } catch (err: any) {
    return { ok: false, error: `Không thể lưu file: ${errLabel(err)}` }
  }
}

export async function selectReferenceAudioFile(): Promise<{ ok: boolean; path?: string }> {
  const res = await dialog.showOpenDialog({
    title: 'Chọn file âm thanh mẫu (Reference Audio)',
    properties: ['openFile'],
    filters: [
      {
        name: 'Audio Files',
        extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'aac']
      },
      { name: 'All Files', extensions: ['*'] }
    ]
  })

  if (res.canceled || !res.filePaths.length) {
    return { ok: false }
  }
  return { ok: true, path: res.filePaths[0] }
}
