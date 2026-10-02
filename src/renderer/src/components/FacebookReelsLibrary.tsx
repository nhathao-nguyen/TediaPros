import { useEffect, useState, type JSX } from 'react'
import { useReelsMonitor } from './useReelsMonitor'
import type { FacebookReelsChannel, FacebookReelsLibraryResult } from '../../../shared/facebookReels'

// --- SVG Icons ---
function IconReels(): JSX.Element {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="4" />
      <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
    </svg>
  )
}

function IconRefresh({ spinning }: { spinning?: boolean }): JSX.Element {
  return (
    <svg className={spinning ? 'spin-anim' : ''} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  )
}

function IconPlus(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconClock(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function IconFolder(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  )
}

function IconFolderOpen(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

function IconEdit(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  )
}

function IconTrash(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

function IconDownload(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function IconCheck(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function IconAlert(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  )
}

function IconZap(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function IconVideo(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  )
}

export function FacebookReelsLibrary({ channels, busy, error, message, onRefresh, onChange, onNew, useCookies }: {
  channels: FacebookReelsChannel[]; busy: boolean; error: string; message: string
  onRefresh: () => Promise<void>
  onChange: (result: FacebookReelsLibraryResult) => void
  onNew: (channel: FacebookReelsChannel) => Promise<void>
  useCookies: (url: string) => boolean
}): JSX.Element {
  const monitor = useReelsMonitor()
  const [time, setTime] = useState('09:00')
  useEffect(() => { if (monitor.state) setTime(monitor.state.settings.time) }, [monitor.state?.settings.time])
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [working, setWorking] = useState(false)
  const locked = busy || working

  const act = async (operation: () => Promise<void>): Promise<void> => {
    setWorking(true)
    try { await operation() }
    catch (err) { onChange({ ok: false, error: err instanceof Error ? err.message : 'Không cập nhật được thư viện Reels.' }) }
    finally { setWorking(false) }
  }

  const watchingCount = channels.filter(c => !!monitor.state?.watches.find(w => w.key === c.key)?.enabled).length
  const timeChanged = !!(monitor.state && time !== monitor.state.settings.time)

  return (
    <section className="card reels-library-card" aria-label="Thư viện kênh Facebook Reels">
      {/* 1. Header */}
      <header className="reels-lib-header">
        <div className="reels-lib-header-left">
          <div className="reels-lib-icon-badge">
            <IconReels />
          </div>
          <div className="reels-lib-title-block">
            <div className="reels-lib-title-row">
              <h3 className="reels-lib-title">Thư viện kênh Facebook Reels</h3>
              <span className="reels-badge reels-badge-count">{channels.length} kênh</span>
              {watchingCount > 0 && (
                <span className="reels-badge reels-badge-watching">
                  <span className="reels-status-dot pulse" />
                  {watchingCount} đang theo dõi
                </span>
              )}
            </div>
            <p className="reels-lib-subtitle">
              Tự động lưu lịch sử video đã tải (chống tải trùng) và hỗ trợ quét video mới theo lịch.
            </p>
          </div>
        </div>
        <div className="reels-lib-header-actions">
          <button
            type="button"
            className="reels-btn reels-btn-secondary"
            disabled={locked}
            onClick={() => setAdding(!adding)}
          >
            <IconPlus />
            <span>{adding ? 'Đóng form' : 'Thêm kênh'}</span>
          </button>
          <button
            type="button"
            className="reels-btn reels-btn-subtle"
            disabled={locked}
            onClick={() => void act(onRefresh)}
            title="Làm mới danh sách"
          >
            <IconRefresh spinning={working} />
            <span>Làm mới</span>
          </button>
        </div>
      </header>

      {/* 2. Automation & Daily Schedule Toolbar */}
      <div className="reels-schedule-toolbar">
        <div className="reels-schedule-left">
          <div className="reels-schedule-icon">
            <IconClock />
          </div>
          <div className="reels-schedule-text">
            <strong>Lịch quét tự động hằng ngày</strong>
            <span>Tự kiểm tra & tải video mới cho các kênh đang bật. Chạy bù nếu lỡ giờ khi đóng ứng dụng.</span>
          </div>
        </div>

        <form
          className="reels-schedule-form"
          onSubmit={e => {
            e.preventDefault()
            void act(() => monitor.act(window.api.setFacebookReelsMonitorTime(time)))
          }}
        >
          <div className="reels-time-input-wrap">
            <input
              aria-label="Giờ kiểm tra Reels"
              type="time"
              className="reels-time-input"
              value={time}
              onInput={e => setTime(e.currentTarget.value)}
              required
              disabled={!monitor.state || locked}
            />
            <span className="reels-time-tz">Giờ VN</span>
          </div>
          <button
            type="submit"
            className={`reels-btn small-btn ${timeChanged ? 'primary' : 'reels-btn-subtle'}`}
            disabled={!monitor.state || locked || !timeChanged}
          >
            <IconCheck />
            <span>Lưu giờ</span>
          </button>
        </form>
      </div>

      {/* 3. Alerts & Notices */}
      {monitor.error && (
        <div className="reels-alert-card reels-alert-warn" role="alert">
          <IconAlert />
          <div className="reels-alert-text">
            <strong>Thông báo theo dõi tự động:</strong> {monitor.error}
          </div>
        </div>
      )}

      {error && (
        <div className="reels-alert-card reels-alert-error" role="alert">
          <IconAlert />
          <div className="reels-alert-text">{error}</div>
        </div>
      )}

      {message && (
        <div className="reels-alert-card reels-alert-info" role="status">
          <IconCheck />
          <div className="reels-alert-text">{message}</div>
        </div>
      )}

      {/* 4. Add Channel Expandable Panel */}
      {adding && (
        <form
          className="reels-add-panel"
          onSubmit={event => {
            event.preventDefault()
            void act(async () => {
              const folder = await window.api.chooseFolder()
              if (!folder) return
              const result = await window.api.trackFacebookReelsChannel({ url: url.trim(), name: name.trim() }, folder)
              onChange(result)
              if (result.ok) {
                setAdding(false)
                setUrl('')
                setName('')
              }
            })
          }}
        >
          <div className="reels-add-panel-head">
            <strong>Thêm kênh Facebook Reels từ thư mục đã có</strong>
            <button
              type="button"
              className="reels-icon-btn subtle"
              onClick={() => setAdding(false)}
              title="Đóng form"
            >
              ✕
            </button>
          </div>
          <div className="reels-add-fields">
            <div className="reels-field-group">
              <label>Đường dẫn profile / fanpage Reels</label>
              <input
                className="url-input"
                value={url}
                onChange={event => setUrl(event.target.value)}
                placeholder="Ví dụ: https://www.facebook.com/profile.php?id=61593895532705 hoặc https://www.facebook.com/ten-kenh"
                required
                disabled={locked}
              />
            </div>
            <div className="reels-field-group">
              <label>Tên kênh (tùy chọn)</label>
              <input
                className="url-input"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="Để trống nếu muốn hệ thống tự nhận diện"
                disabled={locked}
              />
            </div>
          </div>
          <div className="reels-add-tip">
            💡 Hệ thống sẽ tự động quét các file video sẵn có trong thư mục bạn chọn để ghi nhận ID đã tải (tránh tải trùng các video cũ).
          </div>
          <div className="reels-add-actions">
            <button
              type="button"
              className="reels-btn reels-btn-subtle"
              disabled={locked}
              onClick={() => setAdding(false)}
            >
              Hủy
            </button>
            <button
              type="submit"
              className="reels-btn primary"
              disabled={locked || !url.trim()}
            >
              <IconFolderOpen />
              <span>Chọn thư mục lưu & Lưu kênh</span>
            </button>
          </div>
        </form>
      )}

      {/* 5. Channel List or Empty State */}
      {channels.length === 0 ? (
        <div className="reels-empty-panel">
          <div className="reels-empty-icon">
            <IconReels />
          </div>
          <strong>Chưa có kênh Facebook Reels nào trong thư viện</strong>
          <p>
            Kênh sẽ tự động xuất hiện ở đây sau khi bạn tải video từ Reels, hoặc bạn có thể thêm kênh từ thư mục video đã có trước đây.
          </p>
          {!adding && (
            <button
              type="button"
              className="reels-btn primary"
              disabled={locked}
              onClick={() => setAdding(true)}
            >
              <IconPlus />
              <span>Thêm kênh từ thư mục có sẵn</span>
            </button>
          )}
        </div>
      ) : (
        <div className="reels-channel-grid">
          {channels.map(channel => {
            const watch = monitor.state?.watches.find(w => w.key === channel.key)
            const isWatching = !!watch?.enabled
            const initial = channel.name.trim().charAt(0).toUpperCase() || 'F'
            const isActiveWorking = monitor.state?.active?.key === channel.key

            return (
              <div className={`reels-channel-card ${isWatching ? 'is-watching' : ''}`} key={channel.key}>
                {/* Left side: Avatar + Info */}
                <div className="reels-channel-main">
                  <div className="reels-channel-avatar" title={channel.name}>
                    {initial}
                  </div>

                  <div className="reels-channel-details">
                    <div className="reels-channel-header-row">
                      <h4 className="reels-channel-title" title={channel.url}>
                        {channel.name}
                      </h4>
                      <span className="reels-badge reels-badge-videos">
                        <IconVideo />
                        <span>{channel.downloaded} video</span>
                      </span>
                      <span className="reels-badge reels-badge-date">
                        Cập nhật {new Date(channel.lastUpdated).toLocaleDateString('vi-VN')}
                      </span>
                      {isWatching ? (
                        <span className="reels-badge reels-badge-active">
                          <span className="reels-status-dot" />
                          Tự động quét
                        </span>
                      ) : (
                        <span className="reels-badge reels-badge-inactive">
                          Thủ công
                        </span>
                      )}
                    </div>

                    <div
                      className="reels-channel-path-row"
                      title={`${channel.outputDir}\n(Bấm để mở thư mục)`}
                      onClick={() => void act(async () => { await window.api.openPath(channel.outputDir) })}
                    >
                      <IconFolder />
                      <span className="reels-channel-path-text">{channel.outputDir}</span>
                      <span className="reels-path-open-hint">Mở thư mục</span>
                    </div>

                    <div className="reels-channel-meta-row">
                      <label className="reels-switch-label">
                        <input
                          type="checkbox"
                          className="reels-switch-input"
                          checked={isWatching}
                          disabled={working || !monitor.state}
                          onChange={e => {
                            const enabled = e.target.checked
                            void act(() =>
                              monitor.act(
                                window.api.setFacebookReelsWatch({
                                  url: channel.url,
                                  enabled,
                                  useCookies: useCookies(channel.url)
                                })
                              )
                            )
                          }}
                        />
                        <span className="reels-switch-slider" />
                        <span className="reels-switch-text">Tự động theo dõi & tải video mới</span>
                      </label>

                      {watch?.lastChecked && (
                        <span className="reels-last-checked">
                          Đã kiểm tra: {new Date(watch.lastChecked).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                        </span>
                      )}
                    </div>

                    {isActiveWorking && (
                      <div className="reels-channel-working-status" role="status">
                        <span className="reels-spinner" />
                        <span>{monitor.state?.active?.message || 'Đang kiểm tra video mới…'}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side: Action buttons */}
                <div className="reels-channel-action-col">
                  <div className="reels-action-primary-group">
                    <button
                      type="button"
                      className="reels-btn reels-btn-fetch"
                      disabled={locked}
                      onClick={() => void act(() => onNew(channel))}
                      title="Kiểm tra và lấy các video Reels mới chưa tải về máy"
                    >
                      <IconDownload />
                      <span>Lấy video mới</span>
                    </button>

                    {isWatching && (
                      <button
                        type="button"
                        className="reels-btn reels-btn-check-now"
                        disabled={working || !!monitor.state?.active}
                        onClick={() => void act(() => monitor.act(window.api.checkFacebookReelsWatchNow(channel.url)))}
                        title="Chạy lượt quét tự động cho kênh này ngay bây giờ"
                      >
                        <IconZap />
                        <span>Quét ngay</span>
                      </button>
                    )}
                  </div>

                  <div className="reels-action-icons-group">
                    <button
                      type="button"
                      className="reels-icon-btn"
                      aria-label={`Mở thư mục ${channel.name}`}
                      title="Mở thư mục lưu video"
                      disabled={locked}
                      onClick={() => void act(async () => { await window.api.openPath(channel.outputDir) })}
                    >
                      <IconFolderOpen />
                    </button>

                    <button
                      type="button"
                      className="reels-icon-btn"
                      aria-label={`Đổi thư mục ${channel.name}`}
                      title="Đổi thư mục lưu cho các lần tải tiếp theo"
                      disabled={locked}
                      onClick={() =>
                        void act(async () => {
                          const folder = await window.api.chooseFolder()
                          if (folder) onChange(await window.api.updateFacebookReelsChannelFolder(channel.url, folder))
                        })
                      }
                    >
                      <IconEdit />
                    </button>

                    <button
                      type="button"
                      className="reels-icon-btn danger"
                      aria-label={`Bỏ theo dõi ${channel.name}`}
                      title="Bỏ theo dõi kênh (giữ nguyên video đã tải)"
                      disabled={locked}
                      onClick={() =>
                        void act(async () => {
                          onChange(await window.api.removeFacebookReelsChannel(channel.url))
                        })
                      }
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
