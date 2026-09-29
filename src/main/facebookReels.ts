import { BrowserWindow, session as electronSession } from 'electron'
import type { PlaylistEntry, PlaylistProbe } from '../shared/types'
import { populateSessionFromDomainCookies, sitePartition } from './cookies'
import { logInfo, logWarn } from './logger'

/**
 * Kiểm tra xem URL có phải là trang / tab danh sách Facebook Reels hay không.
 * Ví dụ:
 * - https://www.facebook.com/profile.php?id=61580381841572&sk=reels_tab
 * - https://www.facebook.com/username/reels/
 * - https://www.facebook.com/username/reels
 * Không khớp với video Reel đơn lẻ (dạng /reel/<id>).
 */
export function isFacebookReelsTabUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    if (!hostname.endsWith('facebook.com') && !hostname.endsWith('fb.watch')) {
      return false
    }

    const sk = parsed.searchParams.get('sk')?.toLowerCase()
    if (sk === 'reels_tab' || sk === 'reels') {
      return true
    }

    const segments = parsed.pathname
      .toLowerCase()
      .split('/')
      .filter(Boolean)

    if (
      segments.length >= 1 &&
      (segments[segments.length - 1] === 'reels' || segments[segments.length - 1] === 'reel_tab')
    ) {
      return true
    }

    return false
  } catch {
    return false
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface ExtractedReel {
  id: string
  url: string
  title: string
}

/**
 * Cào danh sách video Facebook Reels từ tab Reels của Profile / Trang cá nhân / Fanpage
 * bằng cách tạo trình duyệt ngầm Electron (nạp session và cookie Facebook đã lưu),
 * tự động cuộn trang (infinite scroll) và trích xuất các liên kết /reel/<id>.
 */
export async function crawlFacebookReelsTab(
  url: string,
  proxy?: string | null,
  useCookies = false
): Promise<PlaylistProbe> {
  const partition = sitePartition('facebook')
  const ses = electronSession.fromPartition(partition)

  if (proxy) {
    try {
      await ses.setProxy({ proxyRules: proxy })
    } catch (err) {
      logWarn(
        `[FacebookReels] Không thể thiết lập proxy: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // Luôn nạp cookies nếu có sẵn file cookie Facebook
  try {
    const loadedCount = await populateSessionFromDomainCookies('facebook.com', ses)
    if (loadedCount > 0) {
      logInfo(`[FacebookReels] Đã nạp ${loadedCount} cookie Facebook vào phiên trình duyệt ngầm.`)
    }
  } catch (err) {
    logWarn(
      `[FacebookReels] Không thể nạp cookie Facebook: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    })

    const browserUserAgent = win.webContents
      .getUserAgent()
      .replace(/\sElectron\/[\d.]+/gi, '')
      .replace(/\s(?:T-blao|TediaPros)\/[\d.]+/gi, '')
    win.webContents.setUserAgent(browserUserAgent)

    logInfo(`[FacebookReels] Đang mở liên kết Reels trong trình duyệt ngầm: ${url}`)
    try {
      await win.loadURL(url)
    } catch (err) {
      throw new Error(`Không thể kết nối đến Facebook: ${err instanceof Error ? err.message : String(err)}`)
    }

    // Đợi trang nạp DOM và React render danh sách Reels ban đầu
    let initialFound = 0
    for (let wait = 0; wait < 6; wait++) {
      await sleep(1000)
      if (win.isDestroyed()) break
      initialFound = await win.webContents
        .executeJavaScript(`document.querySelectorAll('a[href*="/reel/"]').length`)
        .catch(() => 0)
      if (initialFound > 0) break
    }

    // Lấy tiêu đề trang / người tạo
    let pageTitle = await win.webContents
      .executeJavaScript(`
        (() => {
          const h1 = document.querySelector('h1');
          if (h1 && h1.innerText && h1.innerText.trim()) return h1.innerText.trim();
          const t = document.title || '';
          return t.replace(/\\s*[|•-]\\s*Facebook/gi, '').trim();
        })()
      `)
      .catch(() => '')

    if (!pageTitle || pageTitle.toLowerCase() === 'facebook') {
      pageTitle = 'Facebook Reels'
    }

    const reelsMap = new Map<string, PlaylistEntry>()
    const MAX_SCROLLS = 40
    const MAX_ENTRIES = 250
    const SCROLL_DELAY_MS = 1400

    let consecutiveNoNew = 0
    let lastCount = 0

    for (let i = 0; i < MAX_SCROLLS; i++) {
      if (win.isDestroyed()) break

      // Bỏ qua popups / banners cookie nếu có
      await win.webContents
        .executeJavaScript(`
          (() => {
            const closeBtns = document.querySelectorAll(
              'div[aria-label="Đóng"], div[aria-label="Close"], [aria-label="Decline optional cookies"], [aria-label="Allow all cookies"], button[data-cookiebanner="accept_button"]'
            );
            for (const btn of closeBtns) {
              try { btn.click(); } catch {}
            }
          })()
        `)
        .catch(() => {})

      // Trích xuất các thẻ Reel hiện có trong DOM
      const extracted: ExtractedReel[] = await win.webContents
        .executeJavaScript(`
          (() => {
            const items = [];
            const seen = new Set();
            const anchors = document.querySelectorAll('a[href*="/reel/"]');
            for (const a of anchors) {
              const href = a.getAttribute('href') || a.href || '';
              const m = href.match(/\\/reel\\/(\\d{6,})/);
              if (!m) continue;
              const id = m[1];
              if (seen.has(id)) continue;
              seen.add(id);

              const img = a.querySelector('img');
              const imgAlt = img ? (img.getAttribute('alt') || '').trim() : '';
              const aria = (a.getAttribute('aria-label') || '').trim();
              const card = a.closest('div[role="article"]') ||
                           a.closest('div[role="gridcell"]') ||
                           a.closest('div[data-visualcompletion]') ||
                           a.parentElement;
              const cardText = card ? (card.innerText || '').trim() : '';

              const isGeneric = (txt) => {
                if (!txt) return true;
                const lower = txt.toLowerCase();
                return lower.startsWith('hình ảnh có thể có') ||
                       lower.startsWith('may be an image') ||
                       lower.includes('bản xem trước ô thước phim') ||
                       lower.includes('reel preview') ||
                       lower.includes('reels preview');
              };

              let candidate = '';
              if (imgAlt && !isGeneric(imgAlt)) {
                candidate = imgAlt;
              } else if (aria && !isGeneric(aria)) {
                candidate = aria;
              } else if (cardText) {
                const lines = cardText.split('\\n').map(s => s.trim()).filter(Boolean);
                candidate = lines.join(' - ');
              }

              candidate = candidate.replace(/\\s+/g, ' ').trim();
              if (candidate.length > 90) {
                candidate = candidate.slice(0, 87) + '...';
              }

              items.push({
                id,
                url: 'https://www.facebook.com/reel/' + id,
                title: candidate || ('Facebook Reel ' + id)
              });
            }
            return items;
          })()
        `)
        .catch(() => [])

      for (const item of extracted) {
        if (!reelsMap.has(item.id)) {
          reelsMap.set(item.id, {
            id: item.id,
            title: item.title,
            url: item.url,
            uploader: pageTitle,
            duration: null,
            durationString: null,
            isPlaylist: false,
            count: null
          })
        }
      }

      if (reelsMap.size > lastCount) {
        consecutiveNoNew = 0
        lastCount = reelsMap.size
        logInfo(`[FacebookReels] Đã quét được ${reelsMap.size} video reels…`)
      } else {
        consecutiveNoNew++
      }

      if (reelsMap.size >= MAX_ENTRIES) {
        logInfo(`[FacebookReels] Đã đạt ngưỡng tối đa ${MAX_ENTRIES} video reels.`)
        break
      }

      if (consecutiveNoNew >= 4) {
        // 4 nhịp cuộn liên tiếp không xuất hiện reel mới -> đã đến cuối danh sách
        break
      }

      // Cuộn xuống
      await win.webContents
        .executeJavaScript(`
          (() => {
            window.scrollTo(0, document.body.scrollHeight || document.documentElement.scrollHeight);
            const scrollers = document.querySelectorAll('div[role="main"], div[role="feed"]');
            for (const s of scrollers) {
              s.scrollTop = s.scrollHeight;
            }
          })()
        `)
        .catch(() => {})

      await sleep(SCROLL_DELAY_MS)
    }

    const entries = Array.from(reelsMap.values())

    if (entries.length === 0) {
      const pageText: string = await win.webContents
        .executeJavaScript(`document.body.innerText || ''`)
        .catch(() => '')
      const currentUrl = win.webContents.getURL()

      if (
        pageText.includes('Đăng nhập') ||
        pageText.includes('Log In') ||
        pageText.includes('Bạn phải đăng nhập') ||
        currentUrl.includes('/login')
      ) {
        throw new Error(
          'Facebook yêu cầu đăng nhập để xem tab Reels này. Vui lòng vào Cài đặt kết nối tài khoản Facebook rồi thử lại.'
        )
      }

      throw new Error(
        'Không tìm thấy video Reel nào trong trang. Hãy kiểm tra lại liên kết hoặc kết nối tài khoản Facebook.'
      )
    }

    logInfo(`[FacebookReels] Hoàn tất quét: tổng cộng ${entries.length} video reels.`)
    return {
      isPlaylist: true,
      title: `${pageTitle} - Reels`,
      count: entries.length,
      entries
    }
  } finally {
    if (win && !win.isDestroyed()) {
      try {
        win.destroy()
      } catch {}
      win = null
    }
  }
}
