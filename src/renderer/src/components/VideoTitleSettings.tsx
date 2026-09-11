import type { JSX } from 'react'
import { useEffect, useId, useState } from 'react'
import GeminiKeys from './GeminiKeys'
import { DICH_LANGS, type DichProvider, type VideoSeoOptions } from '../../../shared/types'
import { DEFAULT_VIDEO_SEO_OPTIONS, parseVideoSeoPreset, resolveVideoSeoConfig, serializeVideoSeoPreset } from '../../../shared/videoSeo'

const PRESET_KEY = 'tblao.videoSeo.preset.v1'
const COUNTRY_CODES = [
  'US', 'GB', 'CA', 'AU', 'VN', 'TH', 'ID', 'MY', 'SG', 'PH', 'JP', 'KR',
  'CN', 'TW', 'HK', 'IN', 'BR', 'PT', 'ES', 'MX', 'FR', 'DE', 'IT'
] as const
const REGION_DISPLAY_NAMES = (() => {
  try { return new Intl.DisplayNames(['vi'], { type: 'region' }) }
  catch { return undefined }
})()

interface Props {
  enabled: boolean
  onEnabledChange: (enabled: boolean) => void
  language: string
  onLanguageChange: (language: string) => void
  provider: DichProvider
  onProviderChange: (provider: DichProvider) => void
  serverUrl: string
  onServerUrlChange: (serverUrl: string) => void
  seo: VideoSeoOptions
  onSeoChange: (seo: VideoSeoOptions) => void
  disabled?: boolean
  unavailableReason?: string
}

export default function VideoTitleSettings(props: Props): JSX.Element {
  const { enabled, onEnabledChange, language, onLanguageChange, provider, onProviderChange,
    serverUrl, onServerUrlChange, seo, onSeoChange, disabled = false, unavailableReason } = props
  const [key, setKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [keyError, setKeyError] = useState('')
  const [presetStatus, setPresetStatus] = useState('')
  const localeListId = useId()
  const countryListId = useId()
  const unavailable = disabled || Boolean(unavailableReason)

  useEffect(() => {
    let cancelled = false
    setKey(''); setHasKey(false); setKeyError('')
    void window.api.translateHasKey(provider).then(
      (saved) => { if (!cancelled) setHasKey(saved) },
      () => { if (!cancelled) setKeyError('Không thể đọc trạng thái khóa API đã lưu.') }
    )
    return () => { cancelled = true }
  }, [provider])

  const updateSeo = <K extends keyof VideoSeoOptions>(field: K, value: VideoSeoOptions[K]): void => {
    onSeoChange({ ...seo, [field]: value }); setPresetStatus('')
  }
  const saveKey = async (): Promise<void> => {
    if (!key.trim() || savingKey) return
    setSavingKey(true); setKeyError('')
    try { await window.api.translateSaveKey(provider, key.trim()); setHasKey(true); setKey('') }
    catch { setKeyError('Không thể lưu khóa API. Hãy thử lại.') }
    finally { setSavingKey(false) }
  }
  const savePreset = (): void => {
    try {
      const resolved = resolveVideoSeoConfig({ provider, language, ...(provider === 'local' ? { serverUrl } : {}), seo })
      localStorage.setItem(PRESET_KEY, serializeVideoSeoPreset(resolved))
      setPresetStatus('Đã lưu bộ nhớ thị trường.')
    } catch (error) { setPresetStatus(error instanceof Error ? error.message : 'Không thể lưu bộ nhớ thị trường.') }
  }
  const loadPreset = (): void => {
    try {
      const raw = localStorage.getItem(PRESET_KEY)
      if (!raw) throw new Error('Chưa có bộ nhớ thị trường đã lưu.')
      const loaded = parseVideoSeoPreset(raw)
      onProviderChange(loaded.provider); onLanguageChange(loaded.language)
      if (loaded.serverUrl) onServerUrlChange(loaded.serverUrl)
      onSeoChange(loaded.seo); setPresetStatus('Đã nạp bộ nhớ thị trường.')
    } catch (error) { setPresetStatus(error instanceof Error ? error.message : 'Bộ nhớ thị trường không hợp lệ.') }
  }
  const resetPreset = (): void => {
    localStorage.removeItem(PRESET_KEY); onSeoChange({ ...DEFAULT_VIDEO_SEO_OPTIONS })
    setPresetStatus('Đã xóa bộ nhớ thị trường và đặt lại tùy chọn SEO.')
  }

  return <div className="card gk" style={{ padding: 12 }}>
    <label className="check"><input type="checkbox" checked={enabled} disabled={unavailable}
      onChange={(event) => onEnabledChange(event.target.checked)} /><span>Tạo tiêu đề, mô tả, tags và hashtags từ SRT</span></label>
    <p className="muted small">{unavailableReason || 'AI tạo một tiêu đề, description một đoạn, tags và hashtags; tất cả lưu chung trong tieude.txt.'}</p>
    {enabled && !unavailableReason && <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <label className="field editor-field"><span>AI tạo metadata</span><select value={provider} disabled={disabled || savingKey}
          onChange={(event) => onProviderChange(event.target.value as DichProvider)}>
          <option value="local">Local AI</option><option value="gemini">Gemini (AI ngoài)</option><option value="openai">OpenAI (AI ngoài)</option>
        </select></label>
        <label className="field editor-field"><span>Locale metadata</span><input list={localeListId} value={language}
          disabled={disabled} spellCheck={false} placeholder="auto hoặc en-US" onChange={(event) => onLanguageChange(event.target.value.trim())} />
          <datalist id={localeListId}><option value="auto">Theo phụ đề đầu ra</option>
            {DICH_LANGS.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            <option value="en-US"/><option value="en-GB"/><option value="pt-BR"/><option value="pt-PT"/><option value="zh-Hans"/><option value="zh-Hant"/>
          </datalist></label>
        <label className="field editor-field"><span>Quốc gia</span><input list={countryListId} value={seo.country} disabled={disabled} maxLength={4}
          spellCheck={false} placeholder="auto hoặc US" onChange={(event) => updateSeo('country', event.target.value.trim().toLowerCase() === 'auto' ? 'auto' : event.target.value.trim().toUpperCase())} />
          <datalist id={countryListId}><option value="auto">Tự động theo locale</option>
            {COUNTRY_CODES.map((code) => <option key={code} value={code}>{REGION_DISPLAY_NAMES?.of(code) || code}</option>)}
          </datalist></label>
        <SelectField label="Kiểu tiêu đề" value={seo.titleStyle} disabled={disabled} options={[
          ['auto', 'Tự động'], ['title-case', 'Title Case'], ['sentence-case', 'Sentence case'], ['native', 'Tự nhiên theo locale']
        ]} onChange={(value) => updateSeo('titleStyle', value as VideoSeoOptions['titleStyle'])} />
        <SelectField label="Độ dài description" value={seo.descriptionLength} disabled={disabled} options={[
          ['short', 'Ngắn · 2–3 câu'], ['medium', 'Trung bình'], ['long', 'Dài']
        ]} onChange={(value) => updateSeo('descriptionLength', value as VideoSeoOptions['descriptionLength'])} />
        <SelectField label="Phong cách description" value={seo.descriptionStyle} disabled={disabled} options={[
          ['balanced', 'Cân bằng'], ['seo', 'SEO'], ['storytelling', 'Kể chuyện'], ['conversion', 'Chuyển đổi'], ['educational', 'Giáo dục']
        ]} onChange={(value) => updateSeo('descriptionStyle', value as VideoSeoOptions['descriptionStyle'])} />
        <SelectField label="Giọng SEO" value={seo.keywordTone} disabled={disabled} options={[
          ['natural', 'Tự nhiên'], ['aggressive', 'Mạnh'], ['educational', 'Giáo dục'], ['entertainment', 'Giải trí']
        ]} onChange={(value) => updateSeo('keywordTone', value as VideoSeoOptions['keywordTone'])} />
        <SelectField label="Mật độ từ khóa" value={seo.keywordDensity} disabled={disabled} options={[
          ['light', 'Nhẹ'], ['normal', 'Bình thường'], ['strong', 'Mạnh']
        ]} onChange={(value) => updateSeo('keywordDensity', value as VideoSeoOptions['keywordDensity'])} />
        <SelectField label="Disclaimer" value={seo.disclaimerMode} disabled={disabled} options={[
          ['auto', 'Tự động'], ['none', 'Không'], ['medical', 'Y tế'], ['finance', 'Tài chính'], ['legal', 'Pháp lý'],
          ['affiliate', 'Tiếp thị liên kết'], ['safety', 'An toàn'], ['informational', 'Thông tin']
        ]} onChange={(value) => updateSeo('disclaimerMode', value as VideoSeoOptions['disclaimerMode'])} />
      </div>
      <label className="field editor-field"><span>Tên kênh</span><input value={seo.channelName} disabled={disabled} maxLength={200}
        onChange={(event) => updateSeo('channelName', event.target.value)} /></label>
      <label className="field editor-field"><span>Giọng thương hiệu</span><textarea value={seo.brandVoice} disabled={disabled} maxLength={2000} rows={2}
        placeholder="Ví dụ: ngắn gọn, trực tiếp, không cường điệu" onChange={(event) => updateSeo('brandVoice', event.target.value)} /></label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn ghost sm" disabled={disabled} onClick={savePreset}>Lưu bộ nhớ thị trường</button>
        <button type="button" className="btn ghost sm" disabled={disabled} onClick={loadPreset}>Nạp</button>
        <button type="button" className="btn ghost sm" disabled={disabled} onClick={resetPreset}>Đặt lại</button>
      </div>
      {presetStatus && <p className="muted small" role="status">{presetStatus}</p>}
      <details open={provider === 'local' || !hasKey ? true : undefined}><summary className="small">
        AI: {provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'Local AI'}{hasKey ? ' · Đã có khóa API' : provider !== 'local' ? ' · Chưa có khóa API' : ''}
      </summary><div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {provider === 'local' && <label className="field editor-field"><span>Địa chỉ Local AI</span><input type="text" value={serverUrl}
          disabled={disabled} spellCheck={false} onChange={(event) => onServerUrlChange(event.target.value)} /></label>}
        {provider === 'gemini' ? <GeminiKeys disabled={disabled} onChanged={setHasKey} /> : <><label className="field editor-field"><span>Khóa API{provider === 'local' ? ' (nếu có)' : ''}</span><input type="password" value={key}
          disabled={disabled || savingKey} placeholder={hasKey ? 'Đã lưu · nhập khóa mới để thay' : 'Nhập khóa API'} autoComplete="off"
          spellCheck={false} onChange={(event) => setKey(event.target.value)} /></label>
        <button type="button" className="btn" disabled={disabled || savingKey || !key.trim()} onClick={() => void saveKey()}>
          {savingKey ? 'Đang lưu…' : 'Lưu khóa API'}</button></>}
        <p className="muted small">SRT được gửi tới AI đã chọn; phí theo nhà cung cấp. Khóa API không nằm trong bộ nhớ thị trường.</p>
      </div></details>
      {keyError && <p className="dy-err small" role="alert">{keyError}</p>}
    </div>}
  </div>
}

function SelectField(props: {
  label: string
  value: string
  disabled: boolean
  options: Array<readonly [string, string]>
  onChange: (value: string) => void
}): JSX.Element {
  return <label className="field editor-field"><span>{props.label}</span><select value={props.value} disabled={props.disabled}
    onChange={(event) => props.onChange(event.target.value)}>{props.options.map(([value, label]) =>
      <option key={value} value={value}>{label}</option>)}</select></label>
}
