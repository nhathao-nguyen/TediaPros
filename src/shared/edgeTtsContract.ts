import type { EdgeVoiceDefinition, TtsProvider } from './types'

export const EDGE_VOICE_ID_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8}){1,3}-[A-Za-z0-9]+Neural$/u

export function resolveTtsProvider(value?: TtsProvider): TtsProvider {
  if (value === undefined || value === 'local-tts') return 'local-tts'
  if (value === 'edge-tts') return value
  throw new Error(`TTS provider không được hỗ trợ: ${String(value)}`)
}

function languageParts(value: string): { locale: string; base: string } {
  const locale = value.trim().replace(/_/gu, '-').toLowerCase()
  return { locale, base: locale.split('-')[0] || '' }
}

export function compatibleEdgeVoices(
  voices: readonly EdgeVoiceDefinition[],
  language: string
): EdgeVoiceDefinition[] {
  const wanted = languageParts(language)
  if (!wanted.base) return []
  return voices.filter((voice) => {
    if (!EDGE_VOICE_ID_PATTERN.test(voice.id)) return false
    const voiceLanguage = languageParts(voice.locale || voice.language)
    return voiceLanguage.locale === wanted.locale || voiceLanguage.base === wanted.base
  })
}

export function resolveEdgeVoice(
  voices: readonly EdgeVoiceDefinition[],
  language: string,
  requestedVoice?: string
): EdgeVoiceDefinition {
  const wanted = languageParts(language)
  if (!wanted.base) throw new Error('Ngôn ngữ Edge-TTS không được để trống')

  const compatible = compatibleEdgeVoices(voices, language)
  if (compatible.length === 0) {
    throw new Error(`Edge-TTS không có giọng phù hợp với ngôn ngữ ${language}`)
  }
  if (requestedVoice) {
    const exact = compatible.find((voice) => voice.id === requestedVoice)
    if (!exact) throw new Error(`Giọng Edge-TTS ${requestedVoice} không hợp lệ cho ${language}`)
    return exact
  }
  const exactLocale = compatible.filter((voice) => languageParts(voice.locale || voice.language).locale === wanted.locale)
  const preferred = exactLocale.length > 0 ? exactLocale : compatible
  return preferred.find((voice) => voice.isDefault) || preferred[0]
}

export function resolveEdgeVoiceForPreflight(
  voices: readonly EdgeVoiceDefinition[],
  language: string,
  requestedVoice?: string
): EdgeVoiceDefinition {
  if (language.trim().toLowerCase() !== 'auto') return resolveEdgeVoice(voices, language, requestedVoice)
  if (!requestedVoice || !EDGE_VOICE_ID_PATTERN.test(requestedVoice)) {
    throw new Error('Hãy chọn một giọng Edge-TTS khi ngôn ngữ nguồn được tự động nhận diện')
  }
  const selected = voices.find((voice) => voice.id === requestedVoice)
  if (!selected) throw new Error(`Giọng Edge-TTS ${requestedVoice} không tồn tại trong catalog trực tuyến`)
  return selected
}

export function validateEdgeProsody(
  input: { speed?: number; pitch?: string },
  context: 'voice' | 'autoshort'
): { speed: number; pitch?: string } {
  const speed = input.speed ?? 1
  if (!Number.isFinite(speed)) throw new Error('Tốc độ Edge-TTS phải là số hữu hạn')
  if (context === 'autoshort' && speed !== 1) {
    throw new Error('AutoShort phải tổng hợp Edge-TTS ở tốc độ 1x')
  }
  if (context === 'voice' && (speed < 0.5 || speed > 2)) {
    throw new Error('Tốc độ Edge-TTS Voice phải nằm trong khoảng 0.5x–2.0x')
  }
  if (context === 'autoshort' && input.pitch !== undefined) {
    throw new Error('AutoShort không nhận pitch ở provider Edge-TTS')
  }
  const pitch = input.pitch?.trim()
  if (pitch !== undefined && pitch !== '') {
    const match = /^([+-]?\d+)Hz$/u.exec(pitch)
    if (!match || Math.abs(Number(match[1])) > 100) {
      throw new Error('Pitch Edge-TTS phải là số nguyên từ -100Hz đến +100Hz')
    }
    return { speed, pitch: `${Number(match[1]) >= 0 ? '+' : ''}${Number(match[1])}Hz` }
  }
  return { speed }
}
