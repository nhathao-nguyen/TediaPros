import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import SetupScreen from './components/SetupScreen'
import Downloader from './components/Downloader'
import Douyin from './components/Douyin'
import AudioText from './components/AudioText'
import ScreenText from './components/ScreenText'
import AutoShort from './components/AutoShort'
import VideoEditor, { type EditorDraft } from './components/VideoEditor'
import VideoEnhance from './components/VideoEnhance'
import Voice from './components/Voice'
import License from './components/License'
import Logs from './components/Logs'
import type { UpdateStatus } from '../../shared/types'
import { APP_BRAND } from '../../shared/brand'
import brandLogo from './assets/tediapros-logo.png'

type Stage = 'checking' | 'setup' | 'ready'
type TabKey =
  | 'download'
  | 'douyin'
  | 'audiotext'
  | 'screen'
  | 'autoshort'
  | 'editor'
  | 'enhance'
  | 'voice'
  | 'logs'
  | 'license'

interface Tab {
  key: TabKey
  label: string
  icon: string
  title: string
  subtitle: string
}

// Tab tinh nang chinh (o tren). Them tinh nang moi = them 1 entry vao day.
const TABS: Tab[] = [
  {
    key: 'download',
    label: 'Tải xuống',
    icon: '⬇',
    title: 'Tải xuống',
    subtitle: 'Video & âm thanh đa nền tảng'
  },
  {
    key: 'douyin',
    label: 'Douyin',
    icon: '🎬',
    title: 'Tải Douyin',
    subtitle: 'Video & kênh Douyin (không watermark)'
  },
  {
    key: 'audiotext',
    label: 'Tạo phụ đề',
    icon: '📝',
    title: 'Tạo phụ đề',
    subtitle: 'Chuyển lời nói trong video thành phụ đề'
  },
  {
    key: 'screen',
    label: 'Đọc chữ video',
    icon: '🔍',
    title: 'Đọc chữ trong video',
    // Anh em voi tab Phu de: mot ben tu TIENG, mot ben tu HINH.
    // Danh cho video chi co chu chay, khong co tieng -> tab Phu de bo tay.
    subtitle: 'Nhận diện chữ xuất hiện trong video và tạo phụ đề'
  },
  {
    key: 'autoshort',
    label: 'Auto Short',
    icon: '⚡',
    title: 'Auto Short',
    subtitle: 'Tự động tạo video ngắn'
  },
  {
    key: 'editor',
    label: 'Biên tập video',
    icon: '✦',
    title: 'Biên tập video',
    subtitle: 'Xem trước, tạo kiểu phụ đề và xuất video'
  },
  {
    key: 'enhance',
    label: 'Nâng cấp video',
    icon: '✨',
    title: 'Nâng cấp video',
    subtitle: 'Làm video rõ nét hoặc mượt hơn'
  },
  {
    key: 'voice',
    label: 'Voice',
    icon: '🎙️',
    title: 'Voice',
    subtitle: 'Tạo và chuyển đổi giọng nói'
  }
]

// Muc phu o day sidebar
const BOTTOM_TABS: Tab[] = [
  {
    key: 'logs',
    label: 'Hỗ trợ',
    icon: '🛟',
    title: 'Hỗ trợ & chẩn đoán',
    subtitle: 'Thông tin giúp kiểm tra khi ứng dụng gặp lỗi'
  },
  {
    key: 'license',
    label: 'Giấy phép',
    icon: '📜',
    title: 'Giấy phép & Điều khoản',
    subtitle: 'Bản quyền và trách nhiệm sử dụng'
  }
]

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('checking')
  // KHONG nho tab cuoi — moi lan mo app deu ve tab mac dinh (Tai xuong).
  // Chi nho cau hinh user setup cho tung tab (qua usePersistedState trong moi component).
  const [tab, setTab] = useState<TabKey>('download')
  const [version, setVersion] = useState('')
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  // "Hop thu" gui file tu tab Tai xuong sang tab Audio->Text (nut "Lay sub")
  const [subInbox, setSubInbox] = useState<{ path: string; id: string } | null>(null)
  const [editorDraft, setEditorDraft] = useState<EditorDraft | null>(null)

  const sendToSub = (filePath: string): void => {
    setSubInbox({ path: filePath, id: crypto.randomUUID() })
    setTab('audiotext')
  }

  const openInEditor = (draft: EditorDraft): void => {
    setEditorDraft(draft)
    setTab('editor')
  }

  const check = async (): Promise<void> => {
    setStage('checking')
    const status = await window.api.checkDeps()
    setStage(status.ytdlp && status.ffmpeg ? 'ready' : 'setup')
  }

  useEffect(() => {
    void check()
    void window.api.appVersion().then(setVersion)
    const offUpd = window.api.onUpdateStatus(setUpdate)
    return offUpd
  }, [])

  if (stage === 'checking') {
    return (
      <div className="boot">
        <div className="center">
          <div className="spinner" />
          <p>Đang chuẩn bị {APP_BRAND.displayName}…</p>
        </div>
      </div>
    )
  }

  if (stage === 'setup') {
    return (
      <div className="boot">
        <SetupScreen onDone={() => setStage('ready')} />
      </div>
    )
  }

  const active = [...TABS, ...BOTTOM_TABS].find((t) => t.key === tab) ?? TABS[0]
  const journeyTone =
    tab === 'download' || tab === 'douyin'
      ? 'ingest'
      : tab === 'audiotext' || tab === 'screen' || tab === 'autoshort' || tab === 'editor' || tab === 'enhance' || tab === 'voice'
        ? 'render'
        : 'neutral'

  const renderTab = (t: Tab): JSX.Element => (
    <button
      key={t.key}
      className={`side-item ${t.key === tab ? 'active' : ''}`}
      onClick={() => setTab(t.key)}
    >
      <span className="side-ico">{t.icon}</span>
      <span>{t.label}</span>
    </button>
  )

  return (
    <div className={`shell journey-${journeyTone}`}>
      <aside className="sidebar">
        <div className="side-brand">
          <img className="side-brand-mark" src={brandLogo} alt="" aria-hidden="true" />
          <span className="side-logo">{APP_BRAND.displayName}</span>
        </div>
        <nav className="side-nav">{TABS.map(renderTab)}</nav>
        <div className="side-hint muted small">Công cụ video gọn trong một nơi</div>

        <div className="side-bottom">
          {BOTTOM_TABS.map(renderTab)}

          <details className="side-about">
            <summary>Thông tin ứng dụng</summary>
            <div className="side-version">Phiên bản {version || '…'}</div>
          </details>

          {update?.state === 'downloaded' && (
            <button
              className="side-update ready"
              onClick={() => window.api.installAppUpdate()}
              title="Khởi động lại để cài bản mới"
            >
              🎉 Có bản mới {update.version} — Cập nhật ngay
            </button>
          )}
          {update?.state === 'downloading' && (
            <div className="side-update">Đang tải bản mới… {update.percent ?? 0}%</div>
          )}
          {update?.state === 'available' && (
            update.manual ? (
              <button
                className="side-update ready"
                onClick={() => window.api.installAppUpdate()}
                title="Mở trang tải bản cài đặt macOS"
              >
                🎉 Có bản mới {update.version} — Tải bản cài đặt
              </button>
            ) : (
              <div className="side-update">Đã có bản {update.version}, đang tải…</div>
            )
          )}
        </div>
      </aside>

      <main className="content">
        <header className="content-head">
          <div>
            <h1 className="content-title">{active.title}</h1>
            <p className="content-sub muted">{active.subtitle}</p>
          </div>
        </header>
        <div className="content-body">
          {/* Giu 2 tab tai luon SONG (khong unmount) de chay song song, khong mat hang doi/tien do */}
          <div className={`tab-pane ${tab === 'download' ? '' : 'hidden'}`}>
            <Downloader onGetSub={sendToSub} />
          </div>
          <div className={`tab-pane ${tab === 'douyin' ? '' : 'hidden'}`}>
            <Douyin />
          </div>
          <div className={`tab-pane ${tab === 'audiotext' ? '' : 'hidden'}`}>
            <AudioText subInbox={subInbox} onOpenEditor={openInEditor} />
          </div>
          {/* GIU SONG (khong unmount): user chon video + keo khung xong ma qua
              tab khac mot cai la mat sach, phai lam lai tu dau. Nho toi khi tat
              app — dung y user chot. */}
          <div className={`tab-pane ${tab === 'screen' ? '' : 'hidden'}`}>
            <ScreenText onOpenEditor={openInEditor} />
          </div>
          <div className={`tab-pane ${tab === 'autoshort' ? '' : 'hidden'}`}>
            <AutoShort />
          </div>
          {/* Editor luon mounted de khong mat video, vung chinh va tien do khi doi tab. */}
          <div className={`tab-pane ${tab === 'editor' ? '' : 'hidden'}`}>
            <VideoEditor draft={editorDraft} active={tab === 'editor'} />
          </div>
          <div className={`tab-pane ${tab === 'enhance' ? '' : 'hidden'}`}>
            <VideoEnhance />
          </div>
          <div className={`tab-pane ${tab === 'voice' ? '' : 'hidden'}`}>
            <Voice />
          </div>
          {tab === 'logs' && <Logs />}
          {tab === 'license' && <License />}
        </div>
      </main>
    </div>
  )
}
