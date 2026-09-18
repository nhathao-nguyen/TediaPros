import type { TranslationTone } from './translation'
import type { AutoShortThumbnailStyle, TtsProvider, VideoSeoOptions } from './types'

export interface AutoShortChannelPreset {
  id: string
  name: string
  createdAt: number
  updatedAt: number

  // 1. Translation & Tone
  translationTone: TranslationTone
  customToneInstruction?: string
  translationSynopsis?: string
  translationGlossaryText?: string

  // 2. TTS & Audio
  ttsEnabled: boolean
  ttsProvider: TtsProvider
  edgeVoice?: string
  ttsVoice?: string
  ttsSpeed: number
  paceMode?: 'source-adaptive' | 'fixed'
  originalAudioVolume: number
  backgroundMusicEnabled?: boolean
  backgroundMusicVolume?: number

  // 3. Subtitles Style
  fontId?: string | null
  fontSize?: number
  fontWeight?: number
  textColor?: string
  outlineColor?: string
  highlightColor?: string

  // 4. Video SEO & Title
  titleEnabled?: boolean
  channelName?: string
  brandVoice?: string
  descriptionStyle?: VideoSeoOptions['descriptionStyle']
  keywordTone?: VideoSeoOptions['keywordTone']
  descriptionLength?: VideoSeoOptions['descriptionLength']
  thumbnailStyle?: AutoShortThumbnailStyle
  thumbnailPosition?: 'ocr' | 'top' | 'center' | 'bottom'
}

export const DEFAULT_CHANNEL_PRESET_ID = 'default'

export function createDefaultChannelPreset(name = 'Kênh Mặc định'): AutoShortChannelPreset {
  return {
    id: DEFAULT_CHANNEL_PRESET_ID,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    translationTone: 'neutral',
    customToneInstruction: '',
    translationSynopsis: '',
    translationGlossaryText: '',
    ttsEnabled: true,
    ttsProvider: 'local-tts',
    edgeVoice: 'vi-VN-HoaiMyNeural',
    ttsVoice: '',
    ttsSpeed: 1.0,
    paceMode: 'source-adaptive',
    originalAudioVolume: 20,
    backgroundMusicEnabled: false,
    backgroundMusicVolume: 15,
    fontId: 'auto',
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    highlightColor: '#FFD700',
    titleEnabled: true,
    channelName: '',
    brandVoice: '',
    descriptionStyle: 'balanced',
    keywordTone: 'natural',
    descriptionLength: 'short',
    thumbnailStyle: 'douyin_yellow',
    thumbnailPosition: 'ocr'
  }
}

export function validateChannelPreset(value: unknown): AutoShortChannelPreset | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<AutoShortChannelPreset>
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null

  const validTones: TranslationTone[] = ['neutral', 'storytelling', 'humorous', 'documentary', 'custom']
  const translationTone = validTones.includes(raw.translationTone as TranslationTone)
    ? (raw.translationTone as TranslationTone)
    : 'neutral'

  return {
    id: raw.id.trim(),
    name: raw.name.trim().slice(0, 100),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    translationTone,
    customToneInstruction: typeof raw.customToneInstruction === 'string' ? raw.customToneInstruction.slice(0, 500) : '',
    translationSynopsis: typeof raw.translationSynopsis === 'string' ? raw.translationSynopsis.slice(0, 2000) : '',
    translationGlossaryText: typeof raw.translationGlossaryText === 'string' ? raw.translationGlossaryText.slice(0, 10000) : '',
    ttsEnabled: raw.ttsEnabled !== false,
    ttsProvider: raw.ttsProvider === 'edge-tts' ? 'edge-tts' : 'local-tts',
    edgeVoice: typeof raw.edgeVoice === 'string' ? raw.edgeVoice : 'vi-VN-HoaiMyNeural',
    ttsVoice: typeof raw.ttsVoice === 'string' ? raw.ttsVoice : '',
    ttsSpeed: typeof raw.ttsSpeed === 'number' && raw.ttsSpeed >= 0.5 && raw.ttsSpeed <= 2.0 ? raw.ttsSpeed : 1.0,
    paceMode: raw.paceMode === 'fixed' ? 'fixed' : 'source-adaptive',
    originalAudioVolume: typeof raw.originalAudioVolume === 'number' ? raw.originalAudioVolume : 20,
    backgroundMusicEnabled: Boolean(raw.backgroundMusicEnabled),
    backgroundMusicVolume: typeof raw.backgroundMusicVolume === 'number' ? raw.backgroundMusicVolume : 15,
    fontId: raw.fontId ?? null,
    fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : undefined,
    fontWeight: typeof raw.fontWeight === 'number' ? raw.fontWeight : undefined,
    textColor: typeof raw.textColor === 'string' ? raw.textColor : '#FFFFFF',
    outlineColor: typeof raw.outlineColor === 'string' ? raw.outlineColor : '#000000',
    highlightColor: typeof raw.highlightColor === 'string' ? raw.highlightColor : '#FFD700',
    titleEnabled: raw.titleEnabled !== false,
    channelName: typeof raw.channelName === 'string' ? raw.channelName.slice(0, 200) : '',
    brandVoice: typeof raw.brandVoice === 'string' ? raw.brandVoice.slice(0, 2000) : '',
    descriptionStyle: raw.descriptionStyle || 'balanced',
    keywordTone: raw.keywordTone || 'natural',
    descriptionLength: raw.descriptionLength || 'short',
    thumbnailStyle: raw.thumbnailStyle || 'douyin_yellow',
    thumbnailPosition: raw.thumbnailPosition || 'ocr'
  }
}

export function serializeChannelPresets(presets: AutoShortChannelPreset[]): string {
  return JSON.stringify({ version: 1, presets }, null, 2)
}

export function parseChannelPresets(rawJson: string): AutoShortChannelPreset[] {
  try {
    const data = JSON.parse(rawJson)
    const list = Array.isArray(data) ? data : Array.isArray(data?.presets) ? data.presets : []
    const results: AutoShortChannelPreset[] = []
    for (const item of list) {
      const valid = validateChannelPreset(item)
      if (valid) results.push(valid)
    }
    return results.length > 0 ? results : [createDefaultChannelPreset()]
  } catch {
    return [createDefaultChannelPreset()]
  }
}
