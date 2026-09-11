import type {
  DichProvider,
  ResolvedVideoSeoConfig,
  VideoSeoMetadata,
  VideoSeoOptions,
  VideoTitleConfig
} from './types'

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
const TITLE_CONTROL = /[\r\n\u2028\u2029\u0000-\u001f\u007f]/u
const LIST_OR_QA_LINE = /^\s*(?:[-*•#]|\d+[.)]\s|(?:q|a|hỏi|đáp)\s*:)/imu
const HASHTAG_CHAR = /[\p{L}\p{N}_]/u
const HASHTAG_MAX_CHARS = 500

export const DEFAULT_VIDEO_SEO_OPTIONS: Readonly<VideoSeoOptions> = Object.freeze({
  country: 'auto',
  titleStyle: 'auto',
  channelName: '',
  brandVoice: '',
  descriptionLength: 'short',
  descriptionStyle: 'balanced',
  keywordTone: 'natural',
  keywordDensity: 'normal',
  disclaimerMode: 'auto'
})

const OPTION_KEYS = Object.keys(DEFAULT_VIDEO_SEO_OPTIONS) as Array<keyof VideoSeoOptions>

function codePoints(value: string): number {
  return Array.from(value).length
}

function normalize(value: string): string {
  return value.normalize('NFC').trim()
}

function normalizeHashtag(value: string): string {
  const source = normalize(value).replace(/^#+/u, '')
  const compact = Array.from(source).filter((character) => HASHTAG_CHAR.test(character)).join('')
  if (!compact || CONTROL.test(source)) throw new Error('Hashtag không hợp lệ.')
  return `#${compact}`
}

function normalizeHashtags(raw: unknown, fallbackTags: readonly string[]): string[] {
  if (raw !== undefined && !Array.isArray(raw)) throw new Error('Hashtags phải là danh sách chuỗi.')
  const source = raw === undefined || (Array.isArray(raw) && raw.length === 0) ? fallbackTags : raw as unknown[]
  const hashtags: string[] = []
  const seen = new Set<string>()
  for (const item of source) {
    if (typeof item !== 'string') throw new Error('Hashtags phải là danh sách chuỗi.')
    const hashtag = normalizeHashtag(item)
    const key = hashtag.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      hashtags.push(hashtag)
    }
  }
  const total = hashtags.reduce((sum, hashtag) => sum + codePoints(hashtag), 0) + Math.max(0, hashtags.length - 1)
  if (total > HASHTAG_MAX_CHARS) throw new Error('Tổng hashtags dài quá 500 ký tự.')
  return hashtags
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

export function validateVideoSeoOptions(raw: unknown): string | null {
  if (raw === undefined) return null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Cấu hình SEO không hợp lệ.'
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some((key) => !OPTION_KEYS.includes(key as keyof VideoSeoOptions))) {
    return 'Cấu hình SEO chứa trường không được hỗ trợ.'
  }
  if (value.country !== undefined && (!oneOf(value.country, ['auto']) &&
    !(typeof value.country === 'string' && /^[A-Z]{2}$/u.test(value.country)))) {
    return 'Quốc gia SEO không hợp lệ.'
  }
  if (value.titleStyle !== undefined && !oneOf(value.titleStyle, ['auto', 'title-case', 'sentence-case', 'native'])) {
    return 'Kiểu tiêu đề không hợp lệ.'
  }
  if (value.channelName !== undefined && (typeof value.channelName !== 'string' || codePoints(value.channelName) > 200 || CONTROL.test(value.channelName))) {
    return 'Tên kênh không hợp lệ.'
  }
  if (value.brandVoice !== undefined && (typeof value.brandVoice !== 'string' || codePoints(value.brandVoice) > 2_000 || CONTROL.test(value.brandVoice))) {
    return 'Giọng thương hiệu không hợp lệ.'
  }
  if (value.descriptionLength !== undefined && !oneOf(value.descriptionLength, ['short', 'medium', 'long'])) {
    return 'Độ dài mô tả không hợp lệ.'
  }
  if (value.descriptionStyle !== undefined && !oneOf(value.descriptionStyle, ['balanced', 'seo', 'storytelling', 'conversion', 'educational'])) {
    return 'Phong cách mô tả không hợp lệ.'
  }
  if (value.keywordTone !== undefined && !oneOf(value.keywordTone, ['natural', 'aggressive', 'educational', 'entertainment'])) {
    return 'Giọng SEO không hợp lệ.'
  }
  if (value.keywordDensity !== undefined && !oneOf(value.keywordDensity, ['light', 'normal', 'strong'])) {
    return 'Mật độ từ khóa không hợp lệ.'
  }
  if (value.disclaimerMode !== undefined && !oneOf(value.disclaimerMode,
    ['auto', 'none', 'medical', 'finance', 'legal', 'affiliate', 'safety', 'informational'])) {
    return 'Chế độ lưu ý không hợp lệ.'
  }
  return null
}

function validateLanguage(language: string): void {
  if (!language.trim() || language !== language.trim() || language.length > 64) throw new Error('Ngôn ngữ metadata không hợp lệ.')
  if (language === 'auto') return
  try {
    new Intl.Locale(language)
  } catch {
    throw new Error('Ngôn ngữ metadata không hợp lệ.')
  }
}

function regionOf(language: string): string | undefined {
  if (language === 'auto') return undefined
  try {
    return new Intl.Locale(language).region
  } catch {
    return undefined
  }
}

export function resolveVideoSeoConfig(config: VideoTitleConfig, outputLanguage?: string): ResolvedVideoSeoConfig {
  if (!oneOf(config.provider, ['gemini', 'openai', 'local'])) throw new Error('Nhà cung cấp AI metadata không hợp lệ.')
  if (config.serverUrl !== undefined) {
    try {
      const url = new URL(config.serverUrl)
      if (!config.serverUrl.trim() || config.serverUrl !== config.serverUrl.trim() || config.serverUrl.length > 2_048 ||
        !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('invalid')
      }
    } catch {
      throw new Error('Địa chỉ AI metadata không hợp lệ.')
    }
  }
  const suppliedError = validateVideoSeoOptions(config.seo)
  if (suppliedError) throw new Error(suppliedError)
  const language = config.language === 'auto' && outputLanguage ? outputLanguage : config.language
  validateLanguage(language)
  const supplied = config.seo || {}
  const seo: VideoSeoOptions = { ...DEFAULT_VIDEO_SEO_OPTIONS, ...supplied }
  seo.channelName = normalize(seo.channelName)
  seo.brandVoice = normalize(seo.brandVoice)
  if (seo.country === 'auto') seo.country = regionOf(language) || 'auto'
  return {
    provider: config.provider,
    language,
    ...(config.serverUrl ? { serverUrl: config.serverUrl } : {}),
    seo
  }
}

function unwrapJson(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/iu, '$1').trim()
}

function normalizeMetadata(raw: unknown): VideoSeoMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('AI trả về metadata không hợp lệ.')
  const record = raw as Record<string, unknown>
  if (typeof record.title !== 'string' || typeof record.description !== 'string' || !Array.isArray(record.tags)) {
    throw new Error('AI trả về metadata không đúng cấu trúc.')
  }
  const title = normalize(record.title)
  const sourceDescription = record.description.normalize('NFC').trim()
  if (!title || codePoints(title) > 100 || TITLE_CONTROL.test(title) || LIST_OR_QA_LINE.test(title) || /[<>]/u.test(title)) {
    throw new Error('Tiêu đề metadata không hợp lệ hoặc dài quá 100 ký tự.')
  }
  if (!sourceDescription || CONTROL.test(sourceDescription) || /[<>]/u.test(sourceDescription) || LIST_OR_QA_LINE.test(sourceDescription)) {
    throw new Error('Description phải là một đoạn văn hợp lệ.')
  }
  const description = sourceDescription.replace(/\s+/gu, ' ')
  if (new TextEncoder().encode(description).length > 5_000) throw new Error('Description dài quá 5.000 byte UTF-8.')
  const tags: string[] = []
  const seen = new Set<string>()
  for (const item of record.tags) {
    if (typeof item !== 'string') throw new Error('Tags phải là danh sách chuỗi.')
    const tag = normalize(item).replace(/\s+/gu, ' ')
    if (!tag || CONTROL.test(tag) || /[,<>\r\n]/u.test(tag)) throw new Error('Tag không hợp lệ.')
    const key = tag.toLocaleLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      tags.push(tag)
    }
  }
  if (countYouTubeTagCharacters(tags) > 500) throw new Error('Tổng tags dài quá 500 ký tự.')
  const hashtags = normalizeHashtags(record.hashtags, tags)
  return { title, description, tags, hashtags }
}

/**
 * Normalize metadata that may have come from persisted renderer state.
 * Older AutoShort tasks predate the hashtags field, so this must be safe at
 * the UI boundary instead of trusting the current TypeScript shape at runtime.
 */
export function normalizeVideoSeoMetadata(raw: unknown): VideoSeoMetadata | null {
  try {
    return normalizeMetadata(raw)
  } catch {
    return null
  }
}

export function parseVideoSeoMetadata(raw: string): VideoSeoMetadata {
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapJson(raw))
  } catch {
    throw new Error('AI trả về metadata không đúng định dạng JSON.')
  }
  return normalizeMetadata(parsed)
}

export function countYouTubeTagCharacters(tags: readonly string[]): number {
  return tags.reduce((sum, tag) => sum + codePoints(tag) + (/\s/u.test(tag) ? 2 : 0), 0) + Math.max(0, tags.length - 1)
}

export function formatVideoSeoMetadata(value: VideoSeoMetadata): string {
  const metadata = normalizeMetadata(value)
  return `${metadata.title}\n\nDescription:\n${metadata.description}\n\nTags:\n${metadata.tags.join(', ')}\n\nHashtags:\n${metadata.hashtags.join(' ')}\n`
}

interface VideoSeoPresetV1 {
  version: 1
  provider: DichProvider
  language: string
  serverUrl?: string
  seo: VideoSeoOptions
}

export function serializeVideoSeoPreset(config: ResolvedVideoSeoConfig): string {
  const resolved = resolveVideoSeoConfig(config)
  const preset: VideoSeoPresetV1 = {
    version: 1,
    provider: resolved.provider,
    language: resolved.language,
    ...(resolved.serverUrl ? { serverUrl: resolved.serverUrl } : {}),
    seo: resolved.seo
  }
  return JSON.stringify(preset)
}

export function parseVideoSeoPreset(raw: string): ResolvedVideoSeoConfig {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Bộ nhớ thị trường không đúng định dạng JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Bộ nhớ thị trường không hợp lệ.')
  const record = parsed as Record<string, unknown>
  const allowed = new Set(['version', 'provider', 'language', 'serverUrl', 'seo'])
  if (Object.keys(record).some((key) => !allowed.has(key)) || record.version !== 1 ||
    !oneOf(record.provider, ['gemini', 'openai', 'local']) || typeof record.language !== 'string' ||
    (record.serverUrl !== undefined && typeof record.serverUrl !== 'string')) {
    throw new Error('Bộ nhớ thị trường chứa trường không hợp lệ.')
  }
  const seoError = validateVideoSeoOptions(record.seo)
  if (seoError || !record.seo || Object.keys(record.seo as object).length !== OPTION_KEYS.length) {
    throw new Error(seoError || 'Bộ nhớ thị trường thiếu cấu hình SEO.')
  }
  return resolveVideoSeoConfig({
    provider: record.provider,
    language: record.language,
    ...(record.serverUrl ? { serverUrl: record.serverUrl } : {}),
    seo: record.seo as VideoSeoOptions
  })
}
