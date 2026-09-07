import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { DEFAULT_AI_SERVER_URL, DICH_LANGS, type DichProvider } from '../../../shared/types'
import { usePersistedState } from '../lib/persist'

interface Props {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  language: string
  onLanguageChange?: (language: string) => void
  disabled?: boolean
  unavailableReason?: string
}

/** Title provider and server are independent of subtitle extraction, translation and TTS. */
export default function VideoTitleSettings({
  enabled,
  onEnabledChange,
  language,
  onLanguageChange,
  disabled = false,
  unavailableReason
}: Props): JSX.Element {
  const [provider, setProvider] = usePersistedState<DichProvider>('tblao.videoTitle.provider', 'gemini')
  const [serverUrl, setServerUrl] = usePersistedState('tblao.videoTitle.serverUrl', DEFAULT_AI_SERVER_URL)
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [keyError, setKeyError] = useState('')
  const unavailable = disabled || Boolean(unavailableReason)

  useEffect(() => {
    let cancelled = false
    setKey('')
    setHasKey(false)
    setKeyError('')
    void window.api.translateHasKey(provider).then(
      (saved) => { if (!cancelled) setHasKey(saved) },
      () => { if (!cancelled) setKeyError('Không thể đọc trạng thái khóa API đã lưu.') }
    )
    return () => { cancelled = true }
  }, [provider])

  const saveKey = async (): Promise<void> => {
    if (!key.trim() || savingKey) return
    setSavingKey(true)
    setKeyError('')
    try {
      await window.api.translateSaveKey(provider, key.trim())
      setHasKey(true)
      setKey('')
    } catch {
      setKeyError('Không thể lưu khóa API. Hãy thử lại.')
    } finally {
      setSavingKey(false)
    }
  }

  return (
    <div className="card gk" style={{ padding: 12 }}>
      <label className="check">
        <input
          type="checkbox"
          checked={enabled}
          disabled={unavailable}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        <span>Tạo tiêu đề AI từ SRT</span>
      </label>
      <p className="muted small">
        {unavailableReason || 'AI chọn một tiêu đề phù hợp nhất từ nội dung phụ đề. Mỗi video được lưu trong thư mục riêng cùng tieude.txt.'}
      </p>
      {enabled && !unavailableReason && (
        <div style={{ display: 'grid', gap: 10 }}>
          <label className="field editor-field">
            <span>AI tạo tiêu đề</span>
            <select value={provider} disabled={disabled || savingKey}
              onChange={(event) => setProvider(event.target.value as DichProvider)}>
              <option value="local">Local AI</option>
              <option value="gemini">Gemini (AI ngoài)</option>
              <option value="openai">OpenAI (AI ngoài)</option>
            </select>
          </label>
          <p className="muted small">Chọn riêng cho tiêu đề. Nội dung vẫn lấy từ SRT do OCR/ASR tạo ra, hoặc bản SRT đã dịch.</p>
          <label className="field editor-field">
            <span>Ngôn ngữ tiêu đề</span>
            <select
              value={language}
              disabled={disabled || !onLanguageChange}
              onChange={(event) => onLanguageChange?.(event.target.value)}
            >
              <option value="auto">Theo ngôn ngữ phụ đề</option>
              {DICH_LANGS.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>
          {onLanguageChange && <p className="muted small">
            Nếu lồng tiếng khác ngôn ngữ SRT, chọn ngôn ngữ của video đầu ra.
          </p>}
          <details open={provider === 'local' || !hasKey ? true : undefined}>
            <summary className="small">
              AI: {provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'Local AI'}
              {hasKey ? ' · Đã có khóa API' : provider !== 'local' ? ' · Chưa có khóa API' : ''}
            </summary>
            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              {provider === 'local' && (
                <label className="field editor-field">
                  <span>Địa chỉ Local AI tạo tiêu đề</span>
                  <input
                    type="text"
                    value={serverUrl}
                    disabled={disabled}
                    spellCheck={false}
                    onChange={(event) => setServerUrl(event.target.value)}
                  />
                </label>
              )}
              <label className="field editor-field">
                <span>Khóa API{provider === 'local' ? ' (nếu có)' : ''}</span>
                <input
                  type="password"
                  value={key}
                  disabled={disabled || savingKey}
                  placeholder={hasKey ? 'Đã lưu · nhập khóa mới để thay' : 'Nhập khóa API'}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setKey(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="btn"
                disabled={disabled || savingKey || !key.trim()}
                onClick={() => void saveKey()}
              >
                {savingKey ? 'Đang lưu…' : 'Lưu khóa API'}
              </button>
              <p className="muted small">
                Nhà cung cấp và địa chỉ AI được chọn riêng cho tiêu đề; dùng khóa đã lưu của nhà cung cấp tương ứng. Khi xuất video,
                nội dung SRT được gửi tới AI đã chọn; phí sử dụng theo nhà cung cấp.
              </p>
            </div>
          </details>
          {keyError && <p className="dy-err small" role="alert">{keyError}</p>}
        </div>
      )}
    </div>
  )
}
