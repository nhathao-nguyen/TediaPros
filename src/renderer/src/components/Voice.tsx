import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_AI_SERVER_URL,
  type ClonedVoice,
  type TtsCloneRequest,
  type TtsGenerateResult,
  type TtsModelInfo,
  type TtsServerHealth,
  type TtsSpeechRequest
} from '../../../shared/types'
import { localMediaSource } from '../lib/localMedia'
import { usePersistedState } from '../lib/persist'

export interface LanguageOption {
  code: string
  name: string
  flag: string
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'en', name: 'English (Tiếng Anh)', flag: '🇺🇸' },
  { code: 'zh', name: '中文 (Tiếng Trung)', flag: '🇨🇳' },
  { code: 'ja', name: '日本語 (Tiếng Nhật)', flag: '🇯🇵' },
  { code: 'ko', name: '한국어 (Tiếng Hàn)', flag: '🇰🇷' },
  { code: 'fr', name: 'Français (Tiếng Pháp)', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch (Tiếng Đức)', flag: '🇩🇪' },
  { code: 'es', name: 'Español (Tây Ban Nha)', flag: '🇪🇸' },
  { code: 'it', name: 'Italiano (Tiếng Ý)', flag: '🇮🇹' },
  { code: 'ru', name: 'Русский (Tiếng Nga)', flag: '🇷🇺' },
  { code: 'pt', name: 'Português (Bồ Đào Nha)', flag: '🇵🇹' },
  { code: 'ar', name: 'العربية (Tiếng Ả Rập)', flag: '🇸🇦' },
  { code: 'hi', name: 'हिन्दी (Tiếng Hindi)', flag: '🇮🇳' },
  { code: 'nl', name: 'Nederlands (Hà Lan)', flag: '🇳🇱' },
  { code: 'pl', name: 'Polski (Ba Lan)', flag: '🇵🇱' },
  { code: 'tr', name: 'Türkçe (Thổ Nhĩ Kỳ)', flag: '🇹🇷' },
  { code: 'ms', name: 'Bahasa Melayu (Mã Lai)', flag: '🇲🇾' },
  { code: 'sv', name: 'Svenska (Thụy Điển)', flag: '🇸🇪' },
  { code: 'no', name: 'Norsk (Na Uy)', flag: '🇳🇴' },
  { code: 'da', name: 'Dansk (Đan Mạch)', flag: '🇩🇰' },
  { code: 'fi', name: 'Suomi (Phần Lan)', flag: '🇫🇮' },
  { code: 'el', name: 'Ελληνικά (Hy Lạp)', flag: '🇬🇷' },
  { code: 'he', name: 'עברית (Do Thái)', flag: '🇮🇱' },
  { code: 'sw', name: 'Kiswahili (Swahili)', flag: '🇰🇪' }
]

const SAMPLE_TEXTS = [
  {
    label: '🇻🇳 Giới thiệu',
    text: 'Chào bạn! Chào mừng bạn đến với công cụ chuyển đổi văn bản thành giọng nói AI chất lượng cao.',
    lang: 'vi',
    model: 'tts-vietnamese',
    voice: 'Adam'
  },
  {
    label: '📰 Bản tin',
    text: 'Bản tin sáng nay: Dự báo thời tiết hôm nay trên cả nước có mây, trời nắng nhẹ, nhiệt độ dao động từ 24 đến 31 độ C.',
    lang: 'vi',
    model: 'tts-vietnamese',
    voice: 'Minh Đức'
  },
  {
    label: '🎬 Lồng tiếng',
    text: 'Trong cuộc hành trình khám phá thế giới hôm nay, chúng ta sẽ cùng bước vào một không gian vô cùng ấn tượng và cuốn hút.',
    lang: 'vi',
    model: 'tts-vietnamese',
    voice: 'Mai Anh'
  },
  {
    label: '🇺🇸 English sample',
    text: 'Hello and welcome to the high performance neural text to speech synthesizer.',
    lang: 'en',
    model: 'tts-multilingual',
    voice: 'default'
  }
]

interface HistoryItem {
  id: string
  text: string
  voice: string
  model: string
  durationMs: number
  generationMs: number
  audioBase64: string
  savedPath?: string
  createdAt: string
}

export default function Voice(): JSX.Element {
  // Server connection config
  const [serverUrl, setServerUrl] = usePersistedState('tblao.ai.serverUrl', DEFAULT_AI_SERVER_URL)
  const [apiKey, setApiKey] = useState('')
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const [healthData, setHealthData] = useState<TtsServerHealth | null>(null)
  const [models, setModels] = useState<TtsModelInfo[]>([])

  // Migrate legacy plaintext localStorage key to safeStorage
  useEffect(() => {
    let active = true
    const initKey = async (): Promise<void> => {
      const legacyKey = localStorage.getItem('tblao.tts.apiKey')
      if (legacyKey) {
        try {
          await window.api.translateSaveKey('local', legacyKey)
          localStorage.removeItem('tblao.tts.apiKey')
        } catch {
          /* ignore */
        }
      }
      const hasKey = await window.api.translateHasKey('local').catch(() => false)
      if (active) setHasStoredKey(hasKey)
    }
    void initKey()
    return () => {
      active = false
    }
  }, [])

  // Mode and form state
  const [mode, setMode] = useState<'speech' | 'clone'>('speech')
  const [selectedModel, setSelectedModel] = usePersistedState('tblao.tts.model', 'tts-vietnamese')
  const [selectedLanguage, setSelectedLanguage] = usePersistedState('tblao.tts.lang', 'vi')
  const [selectedVoice, setSelectedVoice] = usePersistedState('tblao.tts.voice', 'Adam')
  const [speed, setSpeed] = usePersistedState('tblao.tts.speed', 1.0)
  const [text, setText] = usePersistedState(
    'tblao.tts.text',
    'Chào bạn! Chúc bạn một ngày làm việc thật nhiều năng lượng và hiệu quả.'
  )

  // Voice clone state
  const [clonedVoices, setClonedVoices] = usePersistedState<ClonedVoice[]>('tblao.tts.clonedVoices', [])
  const [cloneVoiceName, setCloneVoiceName] = useState<string>('')
  const [refAudioPath, setRefAudioPath] = useState<string>('')
  const [refTranscript, setRefTranscript] = useState<string>('')

  // Advanced options
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [denoise, setDenoise] = usePersistedState('tblao.tts.denoise', true)
  const [temperature, setTemperature] = usePersistedState('tblao.tts.temp', 0.8)
  const [topP, setTopP] = usePersistedState('tblao.tts.topP', 0.95)
  const [repetitionPenalty, setRepetitionPenalty] = usePersistedState('tblao.tts.repPen', 1.2)

  // Execution state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<TtsGenerateResult | null>(null)
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [savingAudio, setSavingAudio] = useState(false)
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const ttsModels = models.filter(
    (m) =>
      m.provider !== 'ollama' &&
      (m.languages?.length ||
        m.voices?.length ||
        m.supports_named_voice ||
        m.supports_voice_clone ||
        m.id.startsWith('tts') ||
        m.provider === 'vieneu' ||
        m.provider === 'chatterbox' ||
        m.logical_model?.startsWith('tts'))
  )
  const selectedModelInfo = ttsModels.find((model) => model.id === selectedModel) || ttsModels[0]
  const modelLanguages = selectedModelInfo?.languages || []
  const modelVoices = selectedModelInfo?.voices || []
  const defaultModelVoice = selectedModelInfo?.default_voice || (modelVoices[0] || 'default')
  const displayedVoices =
    selectedModelInfo?.supports_named_voice === false
      ? [defaultModelVoice]
      : modelVoices.length > 0
        ? modelVoices
        : [defaultModelVoice]

  // Dynamic language options based on model capabilities
  const languageOptions = modelLanguages.map((code) => {
    const canonical = code.trim().toLowerCase().split(/[-_]/u)[0]
    const found = SUPPORTED_LANGUAGES.find(
      (l) => l.code === code || l.code === canonical || (canonical === 'vie' && l.code === 'vi')
    )
    if (found) return found
    return { code, name: code.toUpperCase(), flag: '🌐' }
  })

  // Check health and load models
  const checkConnection = async (targetUrl = serverUrl, targetKey = apiKey): Promise<void> => {
    const cleanUrl = targetUrl.trim()
    if (!cleanUrl) {
      setServerStatus('offline')
      setError('Vui lòng nhập địa chỉ AI Server')
      return
    }
    setServerStatus('checking')
    setError(null)
    setModels([])
    try {
      const health = await window.api.ttsCheckHealth(cleanUrl, targetKey.trim())
      setHealthData(health)
      if (health.ok) {
        setServerStatus('online')
        const mRes = await window.api.ttsGetModels(cleanUrl, targetKey.trim())
        if (mRes.ok && mRes.models.length > 0) {
          setModels(mRes.models)
          const availableTts = mRes.models.filter(
            (m) =>
              m.provider !== 'ollama' &&
              (m.languages?.length ||
                m.voices?.length ||
                m.supports_named_voice ||
                m.supports_voice_clone ||
                m.id.startsWith('tts') ||
                m.provider === 'vieneu' ||
                m.provider === 'chatterbox' ||
                m.logical_model?.startsWith('tts'))
          )
          const matching = availableTts.find((m) => m.id === selectedModel)
          if (!matching && availableTts.length > 0) {
            const fallbackModel = availableTts.find((m) => m.available !== false) || availableTts[0]
            setSelectedModel(fallbackModel.id)
            const langs = fallbackModel.languages || []
            if (langs.length > 0 && !langs.includes(selectedLanguage)) {
              setSelectedLanguage(langs[0])
            }
            const fallbackVoice = fallbackModel.default_voice || fallbackModel.voices?.[0] || 'default'
            setSelectedVoice(fallbackVoice)
          }
        } else {
          setError(mRes.error || 'Không tải được capability TTS từ server')
        }
      } else {
        setServerStatus('offline')
        if (health.error) {
          setError(health.error)
        }
      }
    } catch (err: any) {
      setServerStatus('offline')
      setError(err?.message || 'Không thể kết nối đến server')
    }
  }

  useEffect(() => {
    void checkConnection(serverUrl, apiKey)
  }, [])

  useEffect(() => {
    if (!selectedModelInfo) return
    const languages = selectedModelInfo.languages || []
    if (languages.length > 0 && !languages.includes(selectedLanguage)) {
      setSelectedLanguage(languages[0])
    }
    const voices = selectedModelInfo.voices || []
    const defaultVoice = selectedModelInfo.default_voice || (voices[0] || 'default')
    if (
      !selectedVoice.startsWith('clone:') &&
      !voices.includes(selectedVoice) &&
      selectedVoice !== defaultVoice
    ) {
      setSelectedVoice(defaultVoice)
    }
  }, [selectedModelInfo?.id])

  // Select reference audio file
  const handleSelectRefAudio = async (): Promise<void> => {
    const res = await window.api.ttsSelectRefAudio()
    if (res.ok && res.path) {
      setRefAudioPath(res.path)
      const base = res.path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'Giọng mẫu'
      if (!cloneVoiceName) {
        setCloneVoiceName(`Giọng ${base}`)
      }
    }
  }

  // Generate speech or clone
  const handleGenerate = async (): Promise<void> => {
    const cleanText = text.trim()
    if (!cleanText) {
      setError('Vui lòng nhập văn bản cần đọc')
      return
    }

    const activeClonedVoice = clonedVoices.find((cv) => `clone:${cv.id}` === selectedVoice)
    const isCloningMode = mode === 'clone'
    const isClonedVoiceSelected = !isCloningMode && !!activeClonedVoice

    if (isCloningMode && !refAudioPath) {
      setError('Vui lòng chọn file âm thanh mẫu (.wav, .mp3) để clone giọng')
      return
    }
    if (!selectedModelInfo) {
      setError('Chưa tải được capability model từ tts-server')
      return
    }
    if (selectedModelInfo.available === false) {
      setError('Model TTS hiện không khả dụng trên tts-server')
      return
    }
    if (!modelLanguages.includes(selectedLanguage)) {
      setError(`Ngôn ngữ ${selectedLanguage} không được model ${selectedModelInfo.id} công bố`)
      return
    }
    if (isCloningMode && selectedModelInfo.supports_voice_clone === false) {
      setError('Model hiện tại không hỗ trợ voice clone')
      return
    }

    setLoading(true)
    setError(null)
    setSaveSuccessMsg(null)

    try {
      const rawOptions: Record<string, any> = {
        denoise,
        temperature,
        top_p: topP,
        repetition_penalty: repetitionPenalty
      }

      const supported = selectedModelInfo?.supported_options
      const allowed = Array.isArray(supported) && supported.length > 0 ? new Set(supported) : null
      const options: Record<string, any> = {}

      for (const [key, value] of Object.entries(rawOptions)) {
        if (allowed) {
          if (allowed.has(key)) {
            options[key] = value
          }
        } else {
          if (key === 'denoise' && selectedModelInfo?.provider !== 'vieneu') {
            continue
          }
          options[key] = value
        }
      }

      let res: TtsGenerateResult
      if (isCloningMode || isClonedVoiceSelected) {
        const audioPath = isCloningMode ? refAudioPath : activeClonedVoice!.referenceAudioPath
        const transcript = isCloningMode
          ? refTranscript.trim() || undefined
          : (activeClonedVoice?.referenceTranscript || undefined)

        if (!audioPath) {
          setError('Không tìm thấy tệp âm thanh mẫu của giọng clone đã chọn.')
          setLoading(false)
          return
        }

        const req: TtsCloneRequest = {
          serverUrl,
          apiKey,
          text: cleanText,
          language: selectedLanguage,
          model: selectedModel,
          voice: isClonedVoiceSelected ? activeClonedVoice!.name : (cloneVoiceName || undefined),
          speed,
          referenceAudioPath: audioPath,
          referenceTranscript: transcript,
          options,
          supportedOptions: selectedModelInfo?.supported_options
        }
        res = await window.api.ttsGenerateClone(req)

        // Khi tạo thành công ở chế độ Clone, tự động lưu giọng vào danh sách chọn giọng!
        if (res.ok && isCloningMode) {
          const finalName =
            cloneVoiceName.trim() ||
            refAudioPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ||
            'Giọng Clone mới'
          const newClone: ClonedVoice = {
            id: crypto.randomUUID(),
            name: finalName,
            referenceAudioPath: refAudioPath,
            referenceTranscript: refTranscript.trim() || undefined,
            language: selectedLanguage,
            createdAt: new Date().toLocaleDateString('vi-VN')
          }
          setClonedVoices((prev) => [
            newClone,
            ...prev.filter((cv) => cv.referenceAudioPath !== refAudioPath && cv.name !== finalName)
          ])
          setSelectedVoice(`clone:${newClone.id}`)
        }
      } else {
        const isNamed = selectedModelInfo?.supports_named_voice !== false
        const req: TtsSpeechRequest = {
          serverUrl,
          apiKey,
          text: cleanText,
          language: selectedLanguage,
          model: selectedModel,
          voice: isNamed && selectedVoice !== 'default' ? selectedVoice : undefined,
          speed,
          options,
          supportedOptions: selectedModelInfo?.supported_options
        }
        res = await window.api.ttsGenerateSpeech(req)
      }

      if (!res.ok || !res.audioBase64) {
        setError(res.error || 'Quá trình tạo giọng nói thất bại.')
        return
      }

      setLastResult(res)
      const playUrl = res.savedPath
        ? localMediaSource(res.savedPath)
        : `data:${res.audioMimeType || 'audio/wav'};base64,${res.audioBase64}`
      setCurrentAudioUrl(playUrl)

      // Add to session history
      const voiceDisplay = isClonedVoiceSelected
        ? `✨ ${activeClonedVoice!.name}`
        : (res.voice || selectedVoice)

      const item: HistoryItem = {
        id: crypto.randomUUID(),
        text: cleanText.length > 70 ? `${cleanText.slice(0, 67)}…` : cleanText,
        voice: voiceDisplay,
        model: res.model || selectedModel,
        durationMs: res.durationMs || 0,
        generationMs: res.generationMs || 0,
        audioBase64: res.audioBase64,
        savedPath: res.savedPath,
        createdAt: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      }
      setHistory((prev) => [item, ...prev.slice(0, 19)])

      // Auto play audio
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.load()
          void audioRef.current.play().catch(() => {
            /* ignore autoplay block */
          })
        }
      }, 50)
    } catch (err: any) {
      setError(err?.message || 'Có lỗi không xác định xảy ra khi gọi tts-server.')
    } finally {
      setLoading(false)
    }
  }

  // Save current audio to disk
  const handleSaveAudio = async (base64Data?: string): Promise<void> => {
    const data = base64Data || lastResult?.audioBase64
    if (!data) return
    setSavingAudio(true)
    setSaveSuccessMsg(null)
    const fileName = `voice-${Date.now()}.wav`
    const res = await window.api.ttsSaveAudio(data, fileName)
    setSavingAudio(false)
    if (res.ok && res.path) {
      setSaveSuccessMsg(`Đã lưu file thành công tại: ${res.path}`)
      setTimeout(() => setSaveSuccessMsg(null), 6000)
    } else if (res.error) {
      setError(res.error)
    }
  }

  const applySample = (sample: typeof SAMPLE_TEXTS[0]): void => {
    setText(sample.text)
    setSelectedLanguage(sample.lang)
    const matchingModel = ttsModels.find((m) => m.id === sample.model)
    if (matchingModel) {
      setSelectedModel(matchingModel.id)
      const matchingVoice = matchingModel.voices?.find((v) => v === sample.voice)
      setSelectedVoice(matchingVoice || matchingModel.default_voice || 'default')
    }
    setError(null)
  }

  return (
    <div className="voice-container">
      {/* 1. SERVER CONNECTION STRIP */}
      <div className="voice-server-strip card">
        <div className="voice-server-grid">
          <div className="voice-server-field">
            <label className="voice-label">Địa chỉ AI Server (tts-server):</label>
            <div className="voice-input-group">
              <input
                type="text"
                className="voice-input"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://127.0.0.1:8000"
              />
            </div>
          </div>

          <div className="voice-server-field">
            <label className="voice-label">API Key (tùy chọn, lưu an toàn):</label>
            <div className="voice-input-group">
              <input
                type={showApiKey ? 'text' : 'password'}
                className="voice-input"
                value={apiKey}
                onChange={(e) => {
                  const val = e.target.value
                  setApiKey(val)
                  void window.api.translateSaveKey('local', val).then(() => window.api.translateHasKey('local')).then(setHasStoredKey)
                }}
                placeholder={hasStoredKey ? '•••••••• (Đã lưu an toàn)' : 'ai_sk_... (nếu bật bảo vệ)'}
              />
              <button
                type="button"
                className="btn voice-btn-icon"
                onClick={() => setShowApiKey(!showApiKey)}
                title={showApiKey ? 'Ẩn API Key' : 'Hiện API Key'}
              >
                {showApiKey ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          <div className="voice-server-actions">
            <button
              type="button"
              className="btn primary voice-btn-connect"
              onClick={() => void checkConnection(serverUrl, apiKey)}
              disabled={serverStatus === 'checking'}
            >
              {serverStatus === 'checking' ? '⏳ Đang kiểm tra…' : '🔄 Kết nối / Tải lại'}
            </button>
            <div className={`voice-status-badge is-${serverStatus}`}>
              <span className="status-dot" />
              {serverStatus === 'online' && 'Đang hoạt động (Online)'}
              {serverStatus === 'offline' && 'Chưa kết nối'}
              {serverStatus === 'checking' && 'Đang kết nối...'}
            </div>
          </div>
        </div>

        {healthData?.gpu && (
          <div className="voice-gpu-hint muted small">
            ⚡ GPU: <strong>{healthData.gpu}</strong> {healthData.vram ? `· VRAM: ${healthData.vram}` : ''}
          </div>
        )}
      </div>

      {/* 2. ERROR BANNER */}
      {error && (
        <div className="voice-alert-banner is-error card">
          <span>⚠️ {error}</span>
          <button type="button" className="voice-alert-dismiss" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {/* 3. SUCCESS TOAST */}
      {saveSuccessMsg && (
        <div className="voice-alert-banner is-success card">
          <span>✅ {saveSuccessMsg}</span>
          <button type="button" className="voice-alert-dismiss" onClick={() => setSaveSuccessMsg(null)}>
            ✕
          </button>
        </div>
      )}

      {/* 4. MAIN WORKSPACE */}
      <div className="voice-workspace-grid">
        {/* LEFT COLUMN: CONFIGURATION & SETTINGS */}
        <div className="voice-config-card card">
          <div className="voice-mode-toggle">
            <button
              type="button"
              className={`voice-mode-btn ${mode === 'speech' ? 'active' : ''}`}
              onClick={() => setMode('speech')}
            >
              🎙️ Văn bản thành giọng nói
            </button>
            <button
              type="button"
              className={`voice-mode-btn ${mode === 'clone' ? 'active' : ''}`}
              onClick={() => setMode('clone')}
            >
              ✨ Clone giọng nói (Tham chiếu)
            </button>
          </div>

          <div className="voice-form-section">
            <label className="voice-label">Mô hình AI (Model):</label>
            <select
              className="voice-select"
              value={selectedModelInfo?.id || ''}
              disabled={ttsModels.length === 0}
              onChange={(e) => {
                const next = e.target.value
                const nextInfo = ttsModels.find((model) => model.id === next)
                if (!nextInfo) return
                setSelectedModel(next)
                const nextLanguages = nextInfo.languages || []
                setSelectedLanguage(nextLanguages.includes(selectedLanguage) ? selectedLanguage : (nextLanguages[0] || ''))
                setSelectedVoice(nextInfo.default_voice || nextInfo.voices?.[0] || 'default')
              }}
            >
              {ttsModels.length === 0 ? (
                <option value="" disabled>Chưa tải capability từ tts-server</option>
              ) : (
                ttsModels.map((model) => (
                  <option key={model.id} value={model.id} disabled={model.available === false}>
                    {model.name || model.id}{model.available === false ? ' (không khả dụng)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="voice-form-row">
            <div className="voice-form-section flex-1">
              <label className="voice-label">
                Ngôn ngữ ({languageOptions.length} ngôn ngữ):
              </label>
              <select
                className="voice-select"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
              >
                {languageOptions.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name} ({lang.code})
                  </option>
                ))}
              </select>
            </div>

            {mode === 'speech' && (
              <div className="voice-form-section flex-1">
                <label className="voice-label">
                  Giọng đọc ({displayedVoices.length + clonedVoices.length}):
                </label>
                <select
                  className="voice-select"
                  value={selectedVoice}
                  onChange={(e) => setSelectedVoice(e.target.value)}
                >
                  {modelVoices.length > 0 ? (
                    <optgroup label={`Giọng mẫu (${selectedModelInfo?.name || selectedModelInfo?.id || 'Mô hình'})`}>
                      {modelVoices.map((voice) => (
                        <option key={voice} value={voice}>
                          {voice}
                        </option>
                      ))}
                    </optgroup>
                  ) : (
                    <optgroup label="Giọng mặc định">
                      <option value={defaultModelVoice}>
                        {defaultModelVoice} (Mặc định)
                      </option>
                    </optgroup>
                  )}

                  {clonedVoices.length > 0 && (
                    <optgroup label={`✨ Giọng Clone đã lưu (${clonedVoices.length})`}>
                      {clonedVoices.map((cv) => (
                        <option key={cv.id} value={`clone:${cv.id}`}>
                          ✨ {cv.name} ({cv.language || 'vi'} · Clone)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            )}
          </div>

          {/* VOICE CLONE INPUTS */}
          {mode === 'clone' && (
            <div className="voice-clone-box">
              <div className="voice-form-section">
                <label className="voice-label">Tên giọng Clone (để lưu vào danh sách chọn giọng):</label>
                <input
                  type="text"
                  className="voice-input"
                  value={cloneVoiceName}
                  onChange={(e) => setCloneVoiceName(e.target.value)}
                  placeholder="Ví dụ: Giọng MC Lan, Giọng Thuyết Minh..."
                />
              </div>

              <div className="voice-form-section">
                <label className="voice-label">File âm thanh mẫu (Reference Audio):</label>
                <div className="voice-file-picker">
                  <button type="button" className="btn" onClick={handleSelectRefAudio}>
                    📁 Chọn file âm thanh mẫu
                  </button>
                  <span className="voice-file-name" title={refAudioPath || 'Chưa chọn file'}>
                    {refAudioPath ? refAudioPath.split(/[\\/]/).pop() : 'Chưa chọn file (.wav, .mp3, .flac...)'}
                  </span>
                </div>
              </div>

              <div className="voice-clone-transcript">
                <label className="voice-label">Transcript của file mẫu (không bắt buộc):</label>
                <input
                  type="text"
                  className="voice-input"
                  value={refTranscript}
                  onChange={(e) => setRefTranscript(e.target.value)}
                  placeholder="Nhập nội dung lời nói trong file mẫu nếu có..."
                />
              </div>

              {/* DANH SÁCH GIỌNG CLONE ĐÃ LƯU */}
              {clonedVoices.length > 0 && (
                <div className="voice-cloned-library">
                  <div className="voice-cloned-head">
                    <span className="voice-label">✨ Danh sách giọng Clone đã lưu ({clonedVoices.length}):</span>
                  </div>
                  <div className="voice-cloned-grid">
                    {clonedVoices.map((cv) => (
                      <div key={cv.id} className="voice-cloned-card">
                        <div className="voice-cloned-card-info">
                          <span className="voice-cloned-card-title">✨ {cv.name}</span>
                          <span className="voice-cloned-card-meta muted small" title={cv.referenceAudioPath}>
                            📁 {cv.referenceAudioPath.split(/[\\/]/).pop()} · {cv.createdAt}
                          </span>
                        </div>
                        <div className="voice-cloned-card-actions">
                          <button
                            type="button"
                            className="btn small primary"
                            onClick={() => {
                              setSelectedVoice(`clone:${cv.id}`)
                              setMode('speech')
                            }}
                            title="Chọn giọng này để đọc văn bản"
                          >
                            Dùng giọng này
                          </button>
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() => {
                              setClonedVoices((prev) => prev.filter((item) => item.id !== cv.id))
                              if (selectedVoice === `clone:${cv.id}`) {
                                setSelectedVoice(defaultModelVoice)
                              }
                            }}
                            title="Xóa giọng clone"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ADVANCED COLLAPSIBLE */}
          <div className="voice-advanced-toggle">
            <button
              type="button"
              className="voice-link-btn"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? '▼ Thu gọn tùy chọn nâng cao' : '▶ Tùy chọn nâng cao (Khử ồn, Nhiệt độ...)'}
            </button>
          </div>

          {showAdvanced && (
            <div className="voice-advanced-panel">
              {(selectedModelInfo?.supported_options ? selectedModelInfo.supported_options.includes('denoise') : selectedModelInfo?.provider === 'vieneu') && (
                <div className="voice-form-row">
                  <label className="voice-checkbox-label">
                    <input
                      type="checkbox"
                      checked={denoise}
                      onChange={(e) => setDenoise(e.target.checked)}
                    />
                    <span>Khử nhiễu nền (Denoise - VieNeu)</span>
                  </label>
                </div>
              )}

              <div className="voice-form-row">
                <div className="voice-form-section flex-1">
                  <label className="voice-label">Temperature: {temperature}</label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.5"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  />
                </div>
                <div className="voice-form-section flex-1">
                  <label className="voice-label">Top-P: {topP}</label>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.05"
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )}

          {/* SAMPLE PRESETS BAR */}
          <div className="voice-samples-bar">
            <span className="voice-samples-label muted small">Mẫu nhanh:</span>
            <div className="voice-samples-btns">
              {SAMPLE_TEXTS.map((s) => (
                <button
                  type="button"
                  key={s.label}
                  className="voice-sample-chip"
                  onClick={() => applySample(s)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: TEXT EDITOR, GENERATOR & AUDIO PLAYER */}
        <div className="voice-main-card card">
          <div className="voice-editor-head">
            <label className="voice-label">Văn bản cần chuyển đổi thành giọng nói:</label>
            <div className="voice-char-count muted small">
              {text.length} ký tự
            </div>
          </div>

          <textarea
            className="voice-textarea"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nhập nội dung văn bản bạn muốn tạo giọng nói tại đây..."
          />

          <div className="voice-action-bar">
            <button
              type="button"
              className="btn primary voice-btn-generate"
              onClick={handleGenerate}
              disabled={loading || !text.trim()}
            >
              {loading ? (
                <>
                  <span className="spinner-small" /> Đang tạo âm thanh AI…
                </>
              ) : (
                <>🎙️ Tạo giọng nói ngay</>
              )}
            </button>
            {text.trim() && (
              <button
                type="button"
                className="btn voice-btn-clear"
                onClick={() => setText('')}
                title="Xóa văn bản"
              >
                ✕ Xóa
              </button>
            )}
          </div>

          {error && <div className="voice-alert-error">⚠️ {error}</div>}
          {saveSuccessMsg && <div className="voice-alert-success">✓ {saveSuccessMsg}</div>}

          {/* AUDIO PLAYER & RESULT STATS */}
          {currentAudioUrl && (
            <div className="voice-result-box">
              <div className="voice-result-head">
                <span className="voice-result-title">🎧 Âm thanh kết quả:</span>
                <div className="voice-result-badges">
                  {lastResult?.durationMs ? (
                    <span className="voice-stat-badge">
                      ⏱️ {(lastResult.durationMs / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                  {lastResult?.generationMs ? (
                    <span className="voice-stat-badge">
                      ⚡ {Math.round(lastResult.generationMs)}ms
                    </span>
                  ) : null}
                  {lastResult?.voice ? (
                    <span className="voice-stat-badge voice-name-badge">
                      🗣️ {lastResult.voice}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="voice-audio-wrapper">
                <audio ref={audioRef} controls src={currentAudioUrl} className="voice-audio-player" />
                <div className="voice-audio-actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => handleSaveAudio()}
                    disabled={savingAudio}
                  >
                    {savingAudio ? 'Đang lưu…' : '💾 Lưu file âm thanh (.wav)'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SESSION HISTORY */}
          {history.length > 0 && (
            <div className="voice-history-section">
              <div className="voice-history-head">
                <span className="muted small">Lịch sử trong phiên ({history.length}):</span>
                <button
                  type="button"
                  className="voice-link-btn small"
                  onClick={() => setHistory([])}
                >
                  Xóa lịch sử
                </button>
              </div>
              <div className="voice-history-list">
                {history.map((h) => (
                  <div key={h.id} className="voice-history-item">
                    <div className="voice-history-info">
                      <span className="voice-history-text">{h.text}</span>
                      <div className="voice-history-meta muted small">
                        <span>{h.voice}</span>
                        <span>·</span>
                        <span>{(h.durationMs / 1000).toFixed(1)}s</span>
                        <span>·</span>
                        <span>{h.createdAt}</span>
                      </div>
                    </div>
                    <div className="voice-history-actions">
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => {
                          const playUrl = h.savedPath
                            ? localMediaSource(h.savedPath)
                            : `data:audio/wav;base64,${h.audioBase64}`
                          setCurrentAudioUrl(playUrl)
                          setTimeout(() => {
                            if (audioRef.current) {
                              audioRef.current.load()
                              void audioRef.current.play().catch(() => {})
                            }
                          }, 50)
                        }}
                      >
                        ▶ Nghe
                      </button>
                      <button
                        type="button"
                        className="btn small"
                        onClick={() => handleSaveAudio(h.audioBase64)}
                      >
                        💾 Lưu
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
