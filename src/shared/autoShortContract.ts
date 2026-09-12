import type {
  AutoShortBlurRegion,
  AutoShortConfig,
  AutoShortBackgroundMusicMode,
  AutoShortNormalizedRegion,
  AutoShortQueueItemInput,
  AutoShortStartRequest,
  AutoShortSubtitleMethod,
  SubtitleDisplayStyle,
  SubtitleLayoutProfile
} from './types'
import { normalizeVideoAdjustments } from './videoAdjustments'
import { normalizeAutoShortOverlays } from './autoShortOverlays'
import { normalizeAutoShortTemporalEdit } from './autoShortTemporalEdit'
import { isAutoShortSeparationPreset } from './autoShortSeparation'
import { validateVideoTitleConfig } from './videoTitle'
import { translationGuidanceError } from './translation'

export type AutoShortValidation =
  | { ok: true; value: AutoShortStartRequest }
  | { ok: false; error: string }

const METHODS = new Set<AutoShortSubtitleMethod>(['whisper', 'ocr', 'whisper-ocr'])
const PROVIDERS = new Set(['gemini', 'openai', 'local'])
const DISPLAY_STYLES = new Set<SubtitleDisplayStyle>(['standard', 'word-reveal', 'word-highlight'])
const LAYOUTS = new Set<SubtitleLayoutProfile>(['readable', 'social', 'vertical'])
const MODELS = new Set(['base', 'small', 'medium'])
const BACKGROUND_MUSIC_MODES = new Set<AutoShortBackgroundMusicMode>(['single', 'random', 'per-video'])
const PACE_MODES = new Set(['source-adaptive', 'fixed'])

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

  const { separationPreset: legacyPreset, ...restRaw } = raw
  const base = {
    ...restRaw,
    subtitleMethod,
    whisperModel,
    whisperDevice,
    blurMode: raw.blurMode === undefined ? 'manual' : raw.blurMode,
    ocrBlurProfile: raw.ocrBlurProfile === undefined ? 'accurate' : raw.ocrBlurProfile,
    subtitlePlacementMode: raw.subtitlePlacementMode === undefined ? 'manual' : raw.subtitlePlacementMode,
    voiceOverMode: typeof raw.voiceOverMode === 'boolean' ? raw.voiceOverMode : false,
    paceMode: raw.paceMode === 'fixed' ? 'fixed' : 'source-adaptive'
  }

  if (raw.audioMode === 'separate-vocals') {
    return {
      ...base,
      separationPreset: legacyPreset ?? 'balanced'
    }
  }

  return base
}

function validateConfig(raw: unknown): AutoShortConfig | string {
  if (!isRecord(raw)) return 'Cấu hình Auto Short không hợp lệ.'
  return validateConfigRecord(migrateLegacyConfig(raw))
}

function validateConfigRecord(raw: Record<string, unknown>): AutoShortConfig | string {
  let overlays: AutoShortConfig['overlays']
  try { overlays = normalizeAutoShortOverlays(raw.overlays) } catch (error) { return (error as Error).message }
  if (!METHODS.has(raw.subtitleMethod as AutoShortSubtitleMethod)) return 'Phương thức tạo phụ đề không hợp lệ.'
  if (typeof raw.whisperModel !== 'string' || !MODELS.has(raw.whisperModel)) return 'Mô hình Whisper không hợp lệ.'
  if (raw.whisperDevice !== 'cpu' && raw.whisperDevice !== 'cuda') return 'Thiết bị Whisper không hợp lệ.'
  if (raw.whisperLanguage != null && optionalString(raw.whisperLanguage, 'Ngôn ngữ Whisper', 32)) {
    return 'Ngôn ngữ Whisper không hợp lệ.'
  }
  if (raw.blurMode !== 'manual' && raw.blurMode !== 'ocr-auto' && raw.blurMode !== 'sttn') {
    return 'Chế độ làm mờ không hợp lệ.'
  }
  if (raw.ocrBlurProfile !== 'accurate' && raw.ocrBlurProfile !== 'fast') {
    return 'Hồ sơ quét OCR không hợp lệ.'
  }
  if (raw.subtitlePlacementMode !== 'manual' && raw.subtitlePlacementMode !== 'ocr-dominant') {
    return 'Chế độ đặt phụ đề không hợp lệ.'
  }
  if (raw.subtitlePlacementMode === 'ocr-dominant') {
    if (raw.lamMo !== true || (raw.blurMode !== 'ocr-auto' && raw.blurMode !== 'sttn')) {
      return 'Tự đặt phụ đề theo OCR cần bật Tự động OCR hoặc STTN.'
    }
    if (!isRecord(raw.ocrRegion) || region(raw.ocrRegion, 'Vùng OCR') !== null) {
      return 'Tự đặt phụ đề theo OCR cần một vùng OCR hợp lệ.'
    }
    if (!isRecord(raw.subRegion) || region(raw.subRegion, 'Vùng phụ đề') !== null) {
      return 'Tự đặt phụ đề theo OCR cần một vùng phụ đề dự phòng hợp lệ.'
    }
  }
  if (raw.lamMo === true && (raw.blurMode === 'ocr-auto' || raw.blurMode === 'sttn')) {
    if (!isRecord(raw.ocrRegion) || region(raw.ocrRegion, 'Vùng OCR') !== null) {
      return 'Tự động OCR cần một vùng OCR hợp lệ.'
    }
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
  if (raw.portraitBlur != null && typeof raw.portraitBlur !== 'boolean') return 'Cấu hình khung 9:16 không hợp lệ.'
  if (raw.videoAdjustments != null) {
    if (!isRecord(raw.videoAdjustments)) return 'Cấu hình chỉnh hình ảnh không hợp lệ.'
    try {
      normalizeVideoAdjustments(raw.videoAdjustments)
    } catch {
      return 'Cấu hình chỉnh hình ảnh không hợp lệ.'
    }
  }
  if (typeof raw.lamMo !== 'boolean' || typeof raw.ttsEnabled !== 'boolean' || typeof raw.voiceOverMode !== 'boolean') return 'Cấu hình bật/tắt không hợp lệ.'
  if (typeof raw.translateTarget !== 'string' || !raw.translateTarget.trim() || raw.translateTarget.length > 64) return 'Ngôn ngữ đích không hợp lệ.'
  if (raw.translateTarget !== 'none') {
    const targetLocale = raw.translateTarget.trim()
    if (/^(?:auto|mixed|unknown)$/iu.test(targetLocale)) return 'Ngôn ngữ đích phải là locale cụ thể, không dùng auto/mixed/unknown.'
    try {
      // Validate BCP47 at the IPC boundary so a malformed target cannot reach
      // a provider with an implicit auto-language request.
      new Intl.Locale(targetLocale)
    } catch {
      return 'Ngôn ngữ đích không phải locale BCP47 hợp lệ.'
    }
  }
  if (!PROVIDERS.has(raw.translateProvider as string)) return 'Nhà cung cấp dịch không hợp lệ.'
  const guidanceError = translationGuidanceError(raw.translationGuidance)
  if (guidanceError) return guidanceError
  if (raw.videoTitle != null) {
    const error = validateVideoTitleConfig(raw.videoTitle)
    if (error) return error
  }
  if (raw.translateServerUrl != null) {
    const error = url(raw.translateServerUrl, 'Server dịch')
    if (error) return error
  }
  if (raw.ttsServerUrl != null) {
    const error = url(raw.ttsServerUrl, 'Server TTS')
    if (error) return error
  }
  if (raw.ttsModel != null && (typeof raw.ttsModel !== 'string' || !raw.ttsModel.trim() || raw.ttsModel.length > 128)) {
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
  if (!PACE_MODES.has(raw.paceMode as string)) return 'Chế độ nhịp đọc không hợp lệ.'
  if (raw.ttsOptions != null && !isRecord(raw.ttsOptions)) return 'Tùy chọn TTS không hợp lệ.'
  if (raw.audioMode !== 'replace' && raw.audioMode !== 'mix' && raw.audioMode !== 'separate-vocals') {
    return 'Chế độ âm thanh không hợp lệ.'
  }
  if (raw.audioMode === 'separate-vocals') {
    if (raw.ttsEnabled !== true) return 'Tách thoại gốc cần bật lồng tiếng AI.'
    if (!isAutoShortSeparationPreset(raw.separationPreset)) {
      return 'Chất lượng tách thoại không hợp lệ.'
    }
    if (raw.backgroundMusic != null) {
      return 'Không dùng nhạc background riêng khi giữ nhạc và SFX từ video nguồn.'
    }
  }
  if (raw.backgroundMusic != null) {
    if (!isRecord(raw.backgroundMusic)) return 'Cấu hình nhạc background không hợp lệ.'
    const backgroundMusic = raw.backgroundMusic
    const folderError = absolutePath(backgroundMusic.folderPath, 'Folder nhạc background')
    if (folderError) return folderError
    if (!BACKGROUND_MUSIC_MODES.has(backgroundMusic.mode as AutoShortBackgroundMusicMode)) {
      return 'Chế độ nhạc background không hợp lệ.'
    }
    const volumeError = numberIn(backgroundMusic.volume, 'Âm lượng nhạc background', 0, 100)
    if (volumeError) return volumeError
    if (!isRecord(backgroundMusic.assignments)) return 'Danh sách nhạc background không hợp lệ.'
    for (const [id, path] of Object.entries(backgroundMusic.assignments)) {
      const pathError = absolutePath(path, `Nhạc background của video ${id}`)
      if (pathError) return pathError
    }
    if (raw.audioMode !== 'replace') return 'Nhạc background chỉ dùng khi thay thế toàn bộ âm thanh gốc.'
    if (raw.ttsEnabled !== true) return 'Nhạc background cần bật lồng tiếng AI.'
  }
  const outputError = absolutePath(raw.outputDir, 'Thư mục đầu ra')
  if (outputError) return outputError

  const { overlays: _rawOverlays, ...baseConfig } = raw
  return {
    ...(baseConfig as unknown as AutoShortConfig),
    videoAdjustments: normalizeVideoAdjustments(raw.videoAdjustments as any),
    ...(overlays ? { overlays } : {}),
    blurRegions: raw.lamMo === true && raw.blurMode === 'sttn' ? [] : raw.blurRegions as AutoShortBlurRegion[],
    ocrRegion: (raw.ocrRegion as AutoShortNormalizedRegion | null | undefined) ?? null,
    subRegion: (raw.subRegion as AutoShortNormalizedRegion | null | undefined) ?? null,
    subtitlePlacementMode: raw.subtitlePlacementMode as AutoShortConfig['subtitlePlacementMode'],
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
    let temporalEdit
    try {
      temporalEdit = normalizeAutoShortTemporalEdit(rawItem.temporalEdit)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : `Bản cắt video thứ ${index + 1} không hợp lệ.` }
    }
    items.push({ id, filePath, ...(temporalEdit ? { temporalEdit } : {}) })
  }
  const config = validateConfig(raw.config)
  if (typeof config === 'string') return { ok: false, error: config }
  const backgroundMusic = config.backgroundMusic
  if (backgroundMusic) {
    const itemIds = new Set(items.map((item) => item.id))
    const assignedIds = Object.keys(backgroundMusic.assignments)
    if (assignedIds.length !== items.length || items.some((item) => !backgroundMusic.assignments[item.id])) {
      return { ok: false, error: 'Phải chọn nhạc background cho mỗi video trong hàng đợi.' }
    }
    if (assignedIds.some((id) => !itemIds.has(id))) {
      return { ok: false, error: 'Danh sách nhạc có video không thuộc hàng đợi.' }
    }
  }
  return { ok: true, value: { config, items } }
}
