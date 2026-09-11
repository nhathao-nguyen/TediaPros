import type { VideoTitleConfig } from './types'
import { validateVideoSeoOptions } from './videoSeo'

/** Validate renderer-provided title settings without importing a Node module. */
export function validateVideoTitleConfig(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'Cấu hình tiêu đề không hợp lệ.'
  const config = raw as Partial<VideoTitleConfig>
  if (!['gemini', 'openai', 'local'].includes(config.provider || '')) return 'Nhà cung cấp AI tạo tiêu đề không hợp lệ.'
  if (typeof config.language !== 'string' || !config.language.trim() || config.language.length > 64) {
    return 'Ngôn ngữ tiêu đề không hợp lệ.'
  }
  if (config.language !== 'auto') {
    try {
      if (config.language !== config.language.trim()) return 'Ngôn ngữ tiêu đề không hợp lệ.'
      new Intl.Locale(config.language)
    } catch {
      return 'Ngôn ngữ tiêu đề không hợp lệ.'
    }
  }
  if (config.serverUrl !== undefined) {
    if (typeof config.serverUrl !== 'string' || !config.serverUrl.trim() || config.serverUrl.length > 2048) {
      return 'Địa chỉ AI tạo tiêu đề không hợp lệ.'
    }
    try {
      const url = new URL(config.serverUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        return 'Địa chỉ AI tạo tiêu đề không hợp lệ.'
      }
    } catch {
      return 'Địa chỉ AI tạo tiêu đề không hợp lệ.'
    }
  }
  const seoError = validateVideoSeoOptions(config.seo)
  if (seoError) return seoError
  return null
}
