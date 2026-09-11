import type { JSX } from 'react'
import { useState } from 'react'
import type { VideoSeoMetadata } from '../../../shared/types'
import { formatVideoSeoMetadata, normalizeVideoSeoMetadata } from '../../../shared/videoSeo'

export default function VideoSeoResult({ metadata, titlePath }: { metadata: VideoSeoMetadata; titlePath?: string }): JSX.Element {
  const [copyStatus, setCopyStatus] = useState('')
  const copy = async (value: string): Promise<void> => {
    try { await navigator.clipboard.writeText(value); setCopyStatus('Đã sao chép.') }
    catch { setCopyStatus('Không thể sao chép. Bạn có thể mở tieude.txt để lấy nội dung.') }
  }
  const normalized = normalizeVideoSeoMetadata(metadata)
  if (!normalized) {
    return <div className="card" style={{ display: 'grid', gap: 8, padding: 10 }}>
      <span className="dy-err small">Metadata SEO cũ không thể hiển thị. Hãy tạo lại tiêu đề cho video này.</span>
      {titlePath && <button type="button" className="btn ghost sm" onClick={() => void window.api.openPath(titlePath)}>Mở tieude.txt</button>}
    </div>
  }
  const { title, description, tags, hashtags } = normalized
  return <div className="card" style={{ display: 'grid', gap: 8, padding: 10 }}>
    <strong>{title}</strong>
    <p className="small" style={{ margin: 0 }}>{description}</p>
    <p className="muted small" style={{ margin: 0, overflowWrap: 'anywhere' }}>Tags: {tags.join(', ')}</p>
    <p className="muted small" style={{ margin: 0, overflowWrap: 'anywhere' }}>Hashtags: {hashtags.join(' ')}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button type="button" className="btn ghost sm" onClick={() => void copy(title)}>Copy tiêu đề</button>
      <button type="button" className="btn ghost sm" onClick={() => void copy(description)}>Copy description</button>
      <button type="button" className="btn ghost sm" onClick={() => void copy(tags.join(', '))}>Copy tags</button>
      <button type="button" className="btn ghost sm" onClick={() => void copy(hashtags.join(' '))}>Copy hashtags</button>
      <button type="button" className="btn ghost sm" onClick={() => void copy(formatVideoSeoMetadata(normalized))}>Copy toàn bộ</button>
      {titlePath && <button type="button" className="btn ghost sm" onClick={() => void window.api.openPath(titlePath)}>Mở tieude.txt</button>}
    </div>
    {copyStatus && <span className="muted small" role="status">{copyStatus}</span>}
  </div>
}
