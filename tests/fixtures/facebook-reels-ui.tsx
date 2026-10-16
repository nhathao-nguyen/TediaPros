import { createRoot } from 'react-dom/client'
import Downloader from '../../src/renderer/src/components/Downloader'
import { ReelsNotifications } from '../../src/renderer/src/components/ReelsNotifications'
import type { ReelsMonitorState, ReelsWatchRequest } from '../../src/shared/facebookReelsMonitor'
import { facebookReelEntry, type FacebookReelsExportRow, type FacebookReelsProgress } from '../../src/shared/facebookReels'
import '../../src/renderer/src/styles.css'

const captions = [
  '“Congratulations on your engagement. I quit.” Clara expected Gabriel to accept her resignation, but the words he said next made everyone at the table fall silent.',
  'Leo had destroyed three crystal glasses and bitten a bodyguard, but one waitress understood exactly why he refused to speak.',
  'Grace tried to hide her struggle behind quiet work and a borrowed coat, until her grandmother recognized the necklace she wore.',
  'I thought my husband had betrayed me with another woman until he confessed the truth about the letter hidden in his desk.',
  'Every woman in Boston feared Rafe Calder, but when a combat nurse helped his daughter, the city saw a different side of him.',
  'Fourteen years after losing three months of his memory, Adrian discovered the photograph that connected two forgotten lives.'
]
const count = Number(new URLSearchParams(location.search).get('count')) || 28
const mode = new URLSearchParams(location.search).get('mode')
const entries = Array.from({ length: count }, (_, i) => facebookReelEntry(String(936934766124971n + BigInt(i)),
  captions[i % captions.length] + '\n\nA long caption remains readable here, including the final sentence and the website link.\nhttps://example.com/stories/' + (i + 1), 'graphql', 'Sandee Viar'))
const summary = { sourceUrl: 'https://www.facebook.com/profile.php?id=61593895532705', completion: 'partial',
  stopReason: 'stalled', discoveredCount: count, resumeKey: 'qa-resume', warnings: ['Lượt quét minh họa chưa xác nhận hết danh sách.'] }
const playlist = { isPlaylist: true, title: 'Sandee Viar · Facebook Reels', entries, facebook: summary }
if (mode === 'missing' || mode === 'captions') for (let i = mode === 'captions' ? Math.min(10, entries.length) : 0; i < entries.length; i++) entries[i] = facebookReelEntry(entries[i].id)
let resultReads = 0
let listener: ((p: FacebookReelsProgress) => void) | null = null
let cancelled = false
const notice = (message: string) => { const el = document.getElementById('qa-notice'); if (el) el.textContent = message }
const monitor: ReelsMonitorState = { settings: { time: '09:00', timezone: 'Asia/Ho_Chi_Minh' }, watches: [], active: null, notices: [{
  id: 'qa-notice-1', channelKey: 'profile:61593895532705', channelName: 'Sandee Viar', createdAt: '2026-10-02T02:00:00Z', read: false,
  status: 'success', found: 2, downloaded: 2, skipped: 0, failed: 0, message: '2 video mới đã tải · 0 bỏ qua · 0 lỗi.', outputDir: 'F:\\Reels\\Sandee Viar',
  videos: entries.slice(0,2).map(e => ({ id:e.id, title:e.title, file:`F:\\Reels\\Sandee Viar\\${e.id}.mp4` })) }] }
const monitorListeners = new Set<() => void>()
const changed = () => { monitorListeners.forEach(cb => cb()); return { ok:true, state:structuredClone(monitor) } }
const api = {
  facebookReelsMonitorState: async () => ({ ok:true, state:structuredClone(monitor) }),
  onFacebookReelsMonitorChanged: (cb: () => void) => { monitorListeners.add(cb); return () => monitorListeners.delete(cb) },
  setFacebookReelsMonitorTime: async (time:string) => { monitor.settings.time=time; return changed() },
  setFacebookReelsWatch: async (request:ReelsWatchRequest) => { monitor.watches=[{ ...request, key:'profile:61593895532705', name:'Sandee Viar', account:'guest', enabledAt:'2026-10-02T01:00:00Z' }]; return changed() },
  checkFacebookReelsWatchNow: async () => { notice('Xem trước: kiểm tra và tải video mới'); return changed() },
  cancelFacebookReelsMonitor: async () => changed(),
  readFacebookReelsNotices: async (ids:string[]) => { monitor.notices.forEach(n => { if(ids.includes(n.id)) n.read=true }); return changed() },
  deleteFacebookReelsNotices: async (ids:string[]) => { monitor.notices=monitor.notices.filter(n => n.status === 'running' || !ids.includes(n.id)); return changed() },
  facebookReelsChannels: async () => ({ ok: true, channels: [{ key: 'profile:61593895532705', url: 'https://www.facebook.com/profile.php?id=61593895532705&sk=reels_tab',
    name: 'Sandee Viar', outputDir: 'F:\\Reels\\Sandee Viar', downloaded: 10, downloadedIds: entries.slice(0, 10).map(e => e.id), lastUpdated: '2026-10-02T01:00:00Z' }] }),
  trackFacebookReelsChannel: async () => api.facebookReelsChannels(),
  updateFacebookReelsChannelFolder: async () => api.facebookReelsChannels(),
  removeFacebookReelsChannel: async () => ({ ok: true, channels: [] }),
  downloadsDir: async () => 'F:\\Reels', ytdlpVersion: async () => '2026.10.02', ytdlpCapabilities: async () => null,
  cookieList: async () => [], siteCookieStatus: async (site: string) => ({ site, has: site === 'facebook', loggedIn: site === 'facebook', missingLoginMarkers: [], count: site === 'facebook' ? 1 : 0, expiredCount: 0 }),
  onProgress: () => () => {}, onFacebookReelsProgress: (fn: typeof listener) => { listener = fn; return () => { listener = null } },
  startFacebookReels: async () => ({ ok: true, jobId: 'qa-reels-job' }),
  facebookReelsResult: async () => mode === 'expired' && ++resultReads > 1 ? { ok: false, error: 'Lượt Reels đã hết hạn. Hãy quét lại.' } : { ok: true, playlist },
  facebookReelsMetadata: async (_job: string, ids: string[]) => {
    cancelled = false
    for (const [n, id] of ids.entries()) {
      if (cancelled) break
      listener?.({ jobId: 'qa-reels-job', phase: 'metadata', discoveredCount: count, message: `Đang lấy caption ${n + 1}/${ids.length} · Reel ${id}…` })
      await new Promise(resolve => setTimeout(resolve, mode === 'missing' ? 2000 : mode === 'captions' ? 80 : 1))
      if (cancelled) break
      const i = entries.findIndex(e => e.id === id)
      if (i >= 0) entries[i] = facebookReelEntry(id, captions[i % captions.length] + '\n\nFull caption for Reel ' + (i + 1) + '\nhttps://example.com/stories/' + (i + 1), 'ytdlp')
    }
    return { ok: true, entries: entries.filter(e => ids.includes(e.id)) }
  },
  getPlaylist: async () => ({ ok: true, playlist: { isPlaylist: true, title: 'Playlist minh họa', entries: [{ id: 'ordinary-video', url: 'https://www.youtube.com/watch?v=QA_preview', title: 'Video playlist · chỉ thêm vào hàng đợi', isPlaylist: false }] } }),
  cancelFacebookReels: async () => { cancelled = true; return { ok: true } },
  chooseFolder: async () => 'F:\\Reels', openPath: async (path: string) => notice('Xem trước thao tác mở: ' + path),
  openExternal: async (url: string) => notice('Xem trước liên kết: ' + url),
  exportFacebookReels: async (_job: string, request: { ids: string[]; downloadVideos: boolean }) => {
    cancelled = false
    const rows: FacebookReelsExportRow[] = []
    for (const [i, entry] of entries.filter(e => request.ids.includes(e.id)).entries()) {
      if (cancelled) break
      const issue = i % 9 === 8
      const noLink = i % 11 === 10
      const row: FacebookReelsExportRow = { index: i + 1, id: entry.id, reelUrl: entry.url, title: entry.title,
        caption: entry.facebook!.caption!, targetUrl: noLink ? null : 'https://example.com/stories/' + (i + 1), foundIn: 'comment',
        articleTitle: 'The letter that changed everything',
        content: noLink || issue ? '' : Array.from({ length: 30 }, (_, n) => `Paragraph ${n + 1}. Clara stopped at the doorway. The afternoon light fell across the old photographs, and she finally understood why her grandmother had kept every letter. The story continues without truncating its paragraphs.`).join('\n\n'),
        captionPath: `F:\\Reels\\caption\\${entry.id}.txt`, articlePath: noLink || issue ? null : `F:\\Reels\\article\\${entry.id}.txt`,
        videoPath: request.downloadVideos ? `F:\\Reels\\video\\${entry.id}.mp4` : null,
        captionStatus: 'success', articleStatus: noLink ? 'no-link' : issue ? 'error' : 'success',
        videoStatus: request.downloadVideos ? 'success' : 'disabled', errors: issue ? ['Website không phản hồi. Video và caption vẫn đã lưu.'] : [] }
      rows.push(row)
      listener?.({ jobId: 'qa-reels-job', phase: 'exporting', discoveredCount: count, message: `Đang xuất ${i + 1}/${request.ids.length} Reels…`, exportRow: row })
      await new Promise(resolve => setTimeout(resolve, count > 100 ? 1 : 45))
    }
    return { ok: true, result: { rows, directory: 'F:\\Reels\\facebook-reels_sample', excelPath: 'F:\\Reels\\excel\\reels.xlsx', manifestPath: 'manifest.json', cancelled } }
  }
}
Object.assign(window, { api })
localStorage.setItem('tblao.dl.useFacebookCookies', 'true')
createRoot(document.getElementById('root')!).render(<div className="shell">
  <aside className="sidebar"><div className="side-brand"><span className="side-logo">TediaPros</span></div>
    <nav className="side-nav">{['Tải xuống', 'Douyin', 'Tạo phụ đề', 'Đọc chữ video', 'Auto Short', 'Biên tập video', 'Nâng cấp video', 'Voice'].map((label, i) => <div key={label} className={'side-item ' + (i === 0 ? 'active' : '')}>{label}</div>)}</nav>
    <p className="muted small" style={{ padding: 16 }}>Dữ liệu minh họa<br/>Chỉ kiểm tra giao diện</p></aside>
  <main className="content"><header className="content-head" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><h1 className="content-title">Tải xuống</h1><p className="content-sub muted">Video &amp; âm thanh đa nền tảng</p></div><ReelsNotifications/></header>
    <div className="content-body"><div className="tab-pane"><Downloader onGetSub={() => {}}/></div></div>
    <div id="qa-notice" role="status" style={{ fontSize: 11, padding: '4px 24px', minHeight: 22 }}>Bản xem trước UI · không kết nối Facebook, không tải hoặc ghi file thật</div>
  </main></div>)
