import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createDefaultChannelPreset,
  validateChannelPreset,
  serializeChannelPresets,
  parseChannelPresets,
  DEFAULT_CHANNEL_PRESET_ID,
  type AutoShortChannelPreset
} from '../src/shared/channelPreset'
import {
  vietnameseToneInstruction,
  vietnameseNarrativeInstruction
} from '../src/main/translation/viStyleProfile'
import { buildGatewayDraftMessages } from '../src/main/geminiGatewayPrompts'
import { planTranslation } from '../src/main/translation/planner'
import type { TranslationInput } from '../src/shared/translation'

test('Channel Preset: createDefaultChannelPreset returns standard defaults', () => {
  const preset = createDefaultChannelPreset('Kênh Review Phim')
  assert.equal(preset.id, DEFAULT_CHANNEL_PRESET_ID)
  assert.equal(preset.name, 'Kênh Review Phim')
  assert.equal(preset.translationTone, 'neutral')
  assert.equal(preset.ttsEnabled, true)
  assert.equal(preset.ttsProvider, 'local-tts')
  assert.equal(preset.edgeVoice, 'vi-VN-HoaiMyNeural')
  assert.equal(preset.ttsSpeed, 1.0)
  assert.equal(preset.paceMode, 'source-adaptive')
  assert.equal(preset.originalAudioVolume, 20)
  assert.equal(preset.textColor, '#FFFFFF')
})

test('Channel Preset: validateChannelPreset parses valid preset and sanitizes corrupted input', () => {
  const valid = validateChannelPreset({
    id: 'ch-1',
    name: 'Kênh Khoa Học',
    translationTone: 'documentary',
    ttsEnabled: true,
    ttsProvider: 'edge-tts',
    edgeVoice: 'vi-VN-NamMinhNeural',
    ttsSpeed: 1.1,
    textColor: '#00FF00',
    brandVoice: 'Chuyên gia khoa học'
  })
  assert.ok(valid)
  assert.equal(valid.id, 'ch-1')
  assert.equal(valid.name, 'Kênh Khoa Học')
  assert.equal(valid.translationTone, 'documentary')
  assert.equal(valid.ttsProvider, 'edge-tts')
  assert.equal(valid.edgeVoice, 'vi-VN-NamMinhNeural')
  assert.equal(valid.brandVoice, 'Chuyên gia khoa học')

  // Invalid tones fall back to neutral
  const invalidTone = validateChannelPreset({
    id: 'ch-2',
    name: 'Kênh Test',
    translationTone: 'alien-talk'
  })
  assert.ok(invalidTone)
  assert.equal(invalidTone.translationTone, 'neutral')

  // Malformed input returns null
  assert.equal(validateChannelPreset(null), null)
  assert.equal(validateChannelPreset('invalid string'), null)
  assert.equal(validateChannelPreset({ id: '' }), null)
})

test('Channel Preset: round-trip serialization and parsing', () => {
  const presets: AutoShortChannelPreset[] = [
    createDefaultChannelPreset('Kênh 1'),
    {
      id: 'ch-story',
      name: 'Kênh Drama',
      createdAt: 1000,
      updatedAt: 2000,
      translationTone: 'storytelling',
      customToneInstruction: 'Hồi hộp, kịch tính',
      ttsEnabled: true,
      ttsProvider: 'edge-tts',
      edgeVoice: 'vi-VN-HoaiMyNeural',
      ttsSpeed: 1.15,
      paceMode: 'source-adaptive',
      originalAudioVolume: 15,
      textColor: '#FFD700',
      outlineColor: '#000000',
      highlightColor: '#00FFFF',
      titleEnabled: true,
      channelName: 'Drama Plus',
      brandVoice: 'Giọng kể lôi cuốn'
    }
  ]

  const json = serializeChannelPresets(presets)
  const parsed = parseChannelPresets(json)
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0]?.name, 'Kênh 1')
  assert.equal(parsed[1]?.id, 'ch-story')
  assert.equal(parsed[1]?.translationTone, 'storytelling')
  assert.equal(parsed[1]?.customToneInstruction, 'Hồi hộp, kịch tính')
  assert.equal(parsed[1]?.ttsSpeed, 1.15)
  assert.equal(parsed[1]?.channelName, 'Drama Plus')

  // Malformed JSON parsing gracefully returns fallback default preset
  const fallbackFromInvalid = parseChannelPresets('{ invalid json }')
  assert.equal(fallbackFromInvalid.length, 1)
  assert.equal(fallbackFromInvalid[0]?.id, DEFAULT_CHANNEL_PRESET_ID)
})

test('Vietnamese Tone Instruction: generates tone-specific guidance', () => {
  assert.equal(vietnameseToneInstruction('neutral'), '')
  assert.equal(vietnameseToneInstruction(undefined), '')

  const storytelling = vietnameseToneInstruction('storytelling')
  assert.match(storytelling, /Storytelling \/ Drama/i)
  assert.match(storytelling, /kịch tính/i)

  const humorous = vietnameseToneInstruction('humorous')
  assert.match(humorous, /hài hước/i)
  assert.match(humorous, /hóm hỉnh/i)

  const documentary = vietnameseToneInstruction('documentary')
  assert.match(documentary, /tài liệu/i)
  assert.match(documentary, /trang trọng/i)

  const custom = vietnameseToneInstruction('custom', 'Khẩu khí dí dỏm miền Tây')
  assert.match(custom, /Khẩu khí dí dỏm miền Tây/)

  // When custom instruction is provided even with standard tone
  const mixed = vietnameseToneInstruction('storytelling', 'Nhấn mạnh sự rùng rợn')
  assert.match(mixed, /Storytelling/i)
  assert.match(mixed, /Nhấn mạnh sự rùng rợn/)
})

test('Vietnamese Narrative Instruction: embeds tone into style profile', () => {
  const neutral = vietnameseNarrativeInstruction('neutral')
  assert.match(neutral, /vi-narrative-neutral-v1/)

  const storytelling = vietnameseNarrativeInstruction('storytelling')
  assert.match(storytelling, /vi-narrative-neutral-v1/)
  assert.match(storytelling, /kịch tính/i)
})

test('Gemini Gateway Prompts: embeds tone instruction when provided in TranslationInput', () => {
  const inputWithTone: TranslationInput = {
    sourceLanguage: 'zh',
    targetLocale: 'vi',
    mode: 'subtitle',
    cues: [{ id: '1', sourceIndex: 0, start: 0, end: 2, text: '你好世界', groupId: 'g-1' }],
    contextBefore: [],
    contextAfter: [],
    glossary: [],
    tone: 'storytelling',
    customToneInstruction: 'Kịch tính và lôi cuốn'
  }

  const capability = {
    provider: 'gemini-gateway' as const,
    modelIdentity: 'gemini-gateway:gemini-advanced',
    revisionKnown: false,
    format: 'json-items' as const,
    contextTokens: null,
    outputTokens: 16_384,
    wholeDocument: true,
    independentContentReview: true
  }

  const plan = planTranslation(inputWithTone, capability)
  const draftMessages = buildGatewayDraftMessages(plan.batches[0]!)
  const systemContent = draftMessages.find((m) => m.role === 'system')?.content || ''
  assert.match(systemContent, /Narrative tone: Storytelling/i)
  assert.match(systemContent, /kịch tính/i)
  assert.match(systemContent, /Custom channel narrative guidance: Kịch tính và lôi cuốn/)
})
