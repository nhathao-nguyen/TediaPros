import type {
  AutoShortBlurRegion,
  AutoShortConfig,
  AutoShortNormalizedRegion,
  AutoShortQueueItemInput,
  AutoShortStartRequest,
  AutoShortSubtitleMethod,
  SubtitleDisplayStyle,
  SubtitleLayoutProfile
} from './types'

export type AutoShortValidation =
  | { ok: true; value: AutoShortStartRequest }
  | { ok: false; error: string }

const METHODS = new Set<AutoShortSubtitleMethod>(['whisper', 'ocr', 'whisper-ocr'])
const PROVIDERS = new Set(['gemini', 'openai', 'local'])
const DISPLAY_STYLES = new Set<SubtitleDisplayStyle>(['standard', 'word-reveal', 'word-highlight'])
const LAYOUTS = new Set<SubtitleLayoutProfile>(['readable', 'social', 'vertical'])
const MODELS = new Set(['base', 'small', 'medium'])
const TTS_MODELS = new Set(['tts-vietnamese', 'tts-multilingual'])
const LANGUAGES = new Set(['none', 'vi', 'en', 'zh', 'ja', 'ko'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value: unknown, label: string, max = 4096): string | null {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    return `${label} không hợp lệ.`
  }
  return null
}

function optionalString(value: unknown, label: string, max = 4096): string | null {
  if (value == null) return null
  return nonEmptyString(value, label, max)
}

function absolutePath(value: unknown, label: string): string | null {
  const error = nonEmptyString(value, label, 32768)
  if (error) return error
  const path = value as string
  if (path.includes('\0') || !/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(path)) {
    return `${label} phải là đường dẫn tuyệt đối.`
  }
  return null
}

function url(value: unknown, label: string): string | null {
  const error = nonEmptyString(value, label, 2048)
  if (error) return error
  try {
    const parsed = new URL(value as string)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return `${label} chỉ hỗ trợ HTTP/HTTPS.`
  } catch {
    return `${label} không hợp lệ.`
  }
  return null
}

function numberIn(value: unknown, label: string, min: number, max: number): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return `${label} không hợp lệ.`
  }
  return null
}

function color(value: unknown, label: string): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(value)) {
    return `${label} không hợp lệ.`
  }
  return null
}

function region(value: unknown, label: string): string | null {
  if (!isRecord(value)) return `${label} không hợp lệ.`
  for (const key of ['x0', 'y0', 'x1', 'y1'] as const) {
    const error = numberIn(value[key], `${label}.${key}`, 0, 1)
    if (error) return error
  }
  if ((value.x1 as number) <= (value.x0 as number) || (value.y1 as number) <= (value.y0 as number)) {
    return `${label} phải có chiều rộng và chiều cao lớn hơn 0.`
  }
  return null
}

function blurRegion(value: unknown, index: number): string | null {
  if (!isRecord(value)) return `Vùng làm mờ ${index + 1} không hợp lệ.`
  const idError = nonEmptyString(value.id, `ID vùng làm mờ ${index + 1}`, 128)
  if (idError) return idError
  return region(value, `Vùng làm mờ ${index + 1}`)
}

function migrateLegacyConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const oldMethod = raw.subtitleMethod
  const subtitleMethod = oldMethod === 'fast-whisper' ? 'whisper' : oldMethod
  const oldModel = raw.whisperModel
  const whisperModel = oldModel === 'tiny' ? 'base' : oldModel === 'large-v3' ? 'medium' : oldModel
  const whisperDevice = raw.whisperDevice === 'cuda' || raw.whisperDevice === 'cpu'
    ? raw.whisperDevice
    : oldMethod === 'fast-whisper' || oldMethod === 'whisper-ocr'
      ? 'cuda'
      : 'cpu'
  return {
    ...raw,
    subtitleMethod,
    whisperModel,
    whisperDevice,
    voiceOverMode: typeof raw.voiceOverMode === 'boolean' ? raw.voiceOverMode : false
  }
}

function validateConfig(raw: unknown): AutoShortConfig | string {
  if (!isRecord(raw)) return 'Cấu hình Auto Short không hợp lệ.'
  return validateConfigRecord(migrateLegacyConfig(raw))
}

function validateConfigRecord(raw: Record<string, unknown>): AutoShortConfig | string {
  if (!METHODS.has(raw.subtitleMethod as AutoShortSubtitleMethod)) return 'Phương thức tạo phụ đề không hợp lệ.'
  if (typeof raw.whisperModel !== 'string' || !MODELS.has(raw.whisperModel)) return 'Mô hình Whisper không hợp lệ.'
  if (raw.whisperDevice !== 'cpu' && raw.whisperDevice !== 'cuda') return 'Thiết bị Whisper không hợp lệ.'
  if (raw.whisperLanguage != null && optionalString(raw.whisperLanguage, 'Ngôn ngữ Whisper', 32)) {
    return 'Ngôn ngữ Whisper không hợp lệ.'
  }
  if (!Array.isArray(raw.blurRegions) || raw.blurRegions.length > 32) return 'Danh sách vùng làm mờ không hợp lệ.'
  for (const [index, item] of raw.blurRegions.entries()) {
    const error = blurRegion(item, index)
    if (error) return error
  }
  for (const [key, label] of [
    ['ocrRegion', 'Vùng OCR'],
    ['subRegion', 'Vùng phụ đề']
  ] as const) {
    if (raw[key] != null) {
      const error = region(raw[key], label)
      if (error) return error
    }
  }
  for (const [key, label] of [
    ['textColor', 'Màu chữ'],
    ['outlineColor', 'Màu viền'],
    ['bgColor', 'Màu nền'],
    ['highlightColor', 'Màu highlight']
  ] as const) {
    const error = color(raw[key], label)
    if (error) return error
  }
  if (raw.fontId != null && optionalString(raw.fontId, 'Font', 128)) return 'Font không hợp lệ.'
  if (raw.subtitleDisplayStyle != null && !DISPLAY_STYLES.has(raw.subtitleDisplayStyle as SubtitleDisplayStyle)) {
    return 'Kiểu hiển thị phụ đề không hợp lệ.'
  }
  if (raw.subtitleLayoutProfile != null && !LAYOUTS.has(raw.subtitleLayoutProfile as SubtitleLayoutProfile)) {
    return 'Bố cục phụ đề không hợp lệ.'
  }
  if (raw.subtitleAutoOptimize != null && typeof raw.subtitleAutoOptimize !== 'boolean') {
    return 'Tối ưu phụ đề tự động không hợp lệ.'
  }
  for (const [key, label] of [
    ['outlinePx', 'Độ dày viền'],
    ['bgOpacity', 'Độ đậm nền'],
    ['originalAudioVolume', 'Âm lượng gốc']
  ] as const) {
    if (raw[key] != null) {
      const error = numberIn(raw[key], label, 0, key === 'outlinePx' ? 8 : 100)
      if (error) return error
    }
  }
  if (raw.subtitleFontSize != null) {
    const error = numberIn(raw.subtitleFontSize, 'Cỡ chữ', 1, 1000)
    if (error) return error
  }
  for (const [key, label] of [
    ['subtitleFontScale', 'Tỷ lệ cỡ chữ'],
    ['outlineScale', 'Tỷ lệ viền chữ']
  ] as const) {
    if (raw[key] != null) {
      const error = numberIn(raw[key], label, 0.0001, 1)
      if (error) return error
    }
  }
  if (typeof raw.lamMo !== 'boolean' || typeof raw.ttsEnabled !== 'boolean' || typeof raw.voiceOverMode !== 'boolean') return 'Cấu hình bật/tắt không hợp lệ.'
  if (raw.translateTarget !== 'none' && !LANGUAGES.has(raw.translateTarget as string)) return 'Ngôn ngữ đích không hợp lệ.'
  if (!PROVIDERS.has(raw.translateProvider as string)) return 'Nhà cung cấp dịch không hợp lệ.'
  if (raw.translateServerUrl != null) {
    const error = url(raw.translateServerUrl, 'Server dịch')
    if (error) return error
  }
  if (raw.ttsServerUrl != null) {
    const error = url(raw.ttsServerUrl, 'Server TTS')
    if (error) return error
  }
  if (raw.ttsModel != null && (typeof raw.ttsModel !== 'string' || !TTS_MODELS.has(raw.ttsModel))) {
    return 'Mô hình TTS không hợp lệ.'
  }
  for (const [key, label] of [
    ['ttsVoice', 'Voice TTS'],
    ['ttsLanguage', 'Ngôn ngữ TTS'],
    ['ttsRefTranscript', 'Transcript voice clone']
  ] as const) {
    const error = optionalString(raw[key], label, 4096)
    if (error) return error
  }
  if (raw.ttsRefAudioPath != null) {
    const error = absolutePath(raw.ttsRefAudioPath, 'File voice clone')
    if (error) return error
  }
  if (raw.ttsSpeed != null) {
    const error = numberIn(raw.ttsSpeed, 'Tốc độ TTS', 0.5, 2)
    if (error) return error
  }
  if (raw.ttsOptions != null && !isRecord(raw.ttsOptions)) return 'Tùy chọn TTS không hợp lệ.'
  if (raw.audioMode !== 'replace' && raw.audioMode !== 'mix') return 'Chế độ âm thanh không hợp lệ.'
  const outputError = absolutePath(raw.outputDir, 'Thư mục đầu ra')
  if (outputError) return outputError

  return {
    ...(raw as unknown as AutoShortConfig),
    blurRegions: raw.blurRegions as AutoShortBlurRegion[],
    ocrRegion: (raw.ocrRegion as AutoShortNormalizedRegion | null | undefined) ?? null,
    subRegion: (raw.subRegion as AutoShortNormalizedRegion | null | undefined) ?? null,
    translateTarget: raw.translateTarget as string,
    translateProvider: raw.translateProvider as AutoShortConfig['translateProvider'],
    outputDir: raw.outputDir as string
  }
}

export function validateAutoShortStartRequest(raw: unknown): AutoShortValidation {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return { ok: false, error: 'Yêu cầu Auto Short không hợp lệ.' }
  if (raw.items.length === 0 || raw.items.length > 100) return { ok: false, error: 'Hàng đợi phải có từ 1 đến 100 video.' }
  const ids = new Set<string>()
  const paths = new Set<string>()
  const items: AutoShortQueueItemInput[] = []
  for (const [index, rawItem] of raw.items.entries()) {
    if (!isRecord(rawItem)) return { ok: false, error: `Video thứ ${index + 1} không hợp lệ.` }
    const idError = nonEmptyString(rawItem.id, `ID video thứ ${index + 1}`, 128)
    if (idError) return { ok: false, error: idError }
    const pathError = absolutePath(rawItem.filePath, `Đường dẫn video thứ ${index + 1}`)
    if (pathError) return { ok: false, error: pathError }
    const id = rawItem.id as string
    const filePath = rawItem.filePath as string
    if (ids.has(id)) return { ok: false, error: 'ID video bị trùng.' }
    if (paths.has(filePath)) return { ok: false, error: 'Video bị trùng trong hàng đợi.' }
    ids.add(id)
    paths.add(filePath)
    items.push({ id, filePath })
  }
  const config = validateConfig(raw.config)
  if (typeof config === 'string') return { ok: false, error: config }
  return { ok: true, value: { config, items } }
}
