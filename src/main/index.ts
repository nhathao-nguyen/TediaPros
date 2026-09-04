import { app, shell, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { basename, extname, join } from 'node:path'

app.setName('tedia-pros')
app.setPath('userData', join(app.getPath('appData'), 'tedia-pros'))

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { APP_BRAND } from '../shared/brand'
import { migrateLegacyUserData } from './appIdentity'

// Kieu tep cho giao thuc tblao: — thieu Content-Type thi trinh phat doan mo, de sai.
const KIEU_MEDIA: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/mp4',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

// Giao thuc rieng de trinh phat doc duoc video TREN DIA CUA USER.
// Vi sao khong dung thang file:// — trang chay o http://localhost:5173 (dev)
// nen file:// la KHAC NGUON: vua bi CSP chan, vua bi webSecurity chan. Tat
// webSecurity thi chua duoc nhung mo toang ca app -> KHONG.
// stream:true la BAT BUOC — thieu no thi video khong tua duoc (khong ho tro
// range request), user keo thanh thoi gian se dung hinh.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tblao',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])
import {
  checkDependencies,
  runSetup,
  ytDlpVersion,
  updateYtDlp,
  hasLocalYtDlp
} from './deps'
import { readFile, writeFile } from 'node:fs/promises'
import { fetchInfo, fetchPlaylist, download, ytdlpErrorPayload } from './ytdlp'
import {
  captureDomainCookies,
  clearDomainCookies,
  domainCookieStatus,
  listDomainCookieStatuses,
  captureSiteCookies,
  clearSiteCookies,
  isCookieSite,
  siteCookieStatus
} from './cookies'
import { invalidateYtDlpCapabilities, ytdlpCapabilityStatus } from './sitePolicy'
import { testProxy } from './proxy'
import { initAutoUpdate, checkForUpdates, quitAndInstall } from './updater'
import { dyEngineStatus, installDyEngine, downloadDouyin, getChannels, removeChannel } from './douyin'
import {
  whisperEngineStatus,
  installWhisperEngine,
  transcribeAudio,
  whisperCudaStatus,
  installCudaPack,
  whisperModelStatus,
  installWhisperModel,
  shutdownWhisperRuntime
} from './whisper'
import { detectGpu } from './gpu'
import {
  checkKey as geminiCheckKey,
  hasKey as geminiHasKey,
  saveKey as geminiSaveKey,
  translateSrt as geminiTranslateSrt
} from './gemini'
import {
  checkKey as openaiCheckKey,
  hasKey as openaiHasKey,
  saveKey as openaiSaveKey,
  translateSrt as openaiTranslateSrt
} from './openai'
import {
  checkLocalTranslateKey,
  hasLocalKey,
  loadLocalKey,
  localTranslateSrt,
  saveLocalKey
} from './localTranslate'
import { cancelOcr, installOcrEngine, ocrEngineStatus, ocrVideo } from './ocr'
import { boCuc, burnSubtitle, cancelBurn, docFileSrt, probeBurnMedia, srtGiay } from './burn'
import { prepareAudioPreview } from './audioPreview'
import {
  importBurnFontFiles,
  listBurnFonts,
  readBurnFontPreview,
  removeCustomBurnFont
} from './fonts'
import { parseSrt, subtitleDuration } from '../shared/subtitles'
import { createMainSubtitlePlan } from './subtitlePlanner'
import {
  cancelVideo2x,
  installVideo2xEngine,
  listVideo2xDevices,
  runVideo2x,
  video2xEngineStatus
} from './video2x'
import {
  captureDyCookies,
  clearDyCookies,
  dyCookieStatus
} from './douyinCookies'
import {
  checkTtsServerHealth,
  getTtsModels,
  generateSpeech,
  generateVoiceClone,
  saveTtsAudio,
  selectReferenceAudioFile,
  fetchEdgeVoices
} from './tts'
import {
  cancelAutoShort,
  getAutoShortReadiness,
  installAutoShortDependencies,
  shutdownAutoShortRuntime,
  startAutoShortJob,
  selectAutoShortVideoFiles
} from './autoshort'
import type {
  DichProvider,
  DouyinRequest,
  SubtitleLayoutRequest,
  TtsCloneRequest,
  TtsSpeechRequest,
  AutoShortConfig,
  Video2xRunRequest,
  WhisperRequest,
  DownloadRequest,
  LogEntry,
  RendererIssueReport,
  SetupProgress,
  BurnReq
} from '../shared/types'
import {
  clearLogs,
  debugRaw,
  errLabel,
  getLogs,
  initializeLogSessionSync,
  logEmitter,
  logError,
  logWarn,
  logFilePath,
  logInfo,
  wipeLogFileSync
} from './logger'
import { createSupportReport, recordRendererIssue } from './support'

/** Nhat ky khong can biet user vao trang NAO — chi can biet tu dau. */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '(liên kết)'
  }
}

let mainWindow: BrowserWindow | null = null
const autoShortDependencyInstalls = new Map<number, AbortController>()
const isPrimaryInstance = app.requestSingleInstanceLock()

if (!isPrimaryInstance) app.quit()

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

import { isSafeExternalUrl } from '../shared/urlSafety'
export { isSafeExternalUrl }

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 1040,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: APP_BRAND.displayName,
    icon: join(__dirname, '../../build/icon.png'),
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // sandbox: false is required to permit the preload bridge to expose native Node IPC
      // and system dialog interfaces without bundling full Node in the renderer.
      // Security posture is strictly maintained by contextIsolation: true, nodeIntegration: false,
      // and webSecurity: true (enforcing same-origin restrictions and protocol handlers).
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Day nhat ky realtime len giao dien
  logEmitter.on('entry', (e: LogEntry) => mainWindow?.webContents.send('logs:entry', e))
  logEmitter.on('cleared', () => mainWindow?.webContents.send('logs:cleared'))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      void shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // electron-vite: dev server URL hoac file build
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Tu kiem tra cap nhat cong cu tai (yt-dlp) trong nen, toi da 1 lan/ngay.
// Chi ap dung khi da co ban rieng trong userData/bin (tranh tai ngam ~30MB tren may dev dung PATH).
async function maybeAutoUpdateYtDlp(): Promise<void> {
  try {
    if (!(await hasLocalYtDlp())) return
    const stampFile = join(app.getPath('userData'), 'update-check.json')
    let last = 0
    try {
      last = (JSON.parse(await readFile(stampFile, 'utf-8')) as { ytdlp?: number }).ytdlp ?? 0
    } catch {
      /* chua co */
    }
    const now = Date.now()
    if (now - last < 24 * 60 * 60 * 1000) return // moi kiem tra trong 24h -> bo qua
    await writeFile(stampFile, JSON.stringify({ ytdlp: now }), 'utf-8')
    logInfo('Tự kiểm tra cập nhật công cụ tải…')
    const r = await updateYtDlp()
    invalidateYtDlpCapabilities()
    logInfo(`Tự cập nhật công cụ tải: ${r.message}`)
  } catch {
    /* bo qua loi tu cap nhat */
  }
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return
  await migrateLegacyUserData()
  initializeLogSessionSync()

  protocol.handle('tblao', async (req) => {
    try {
      const ma = decodeURIComponent(new URL(req.url).pathname).replace(/^\//, '')
      if (!ma) return new Response('Bad Request', { status: 400 })
      const p = Buffer.from(ma, 'base64url').toString('utf8')
      if (!p || p.includes('\0')) return new Response('Bad Request', { status: 400 })
      const ext = extname(p).toLowerCase()
      const kieu = KIEU_MEDIA[ext]
      if (!kieu) return new Response('Forbidden media type', { status: 403 })
      const fileStat = await stat(p).catch(() => null)
      if (!fileStat || !fileStat.isFile()) return new Response('File Not Found', { status: 404 })
      const co = fileStat.size
      const dau = req.headers.get('Range')

      if (!dau) {
        return new Response(Readable.toWeb(createReadStream(p)) as ReadableStream, {
          status: 200,
          headers: {
            'Content-Type': kieu,
            'Content-Length': String(co),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*'
          }
        })
      }

      // Handle Range header: bytes=start-end, bytes=start-, bytes=-suffix
      const rangeMatch = /^bytes=(\d*)-(\d*)$/i.exec(dau.trim())
      if (!rangeMatch || (!rangeMatch[1] && !rangeMatch[2])) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: {
            'Content-Range': `bytes */${co}`,
            'Accept-Ranges': 'bytes'
          }
        })
      }

      let b = 0
      let k = co - 1

      if (!rangeMatch[1] && rangeMatch[2]) {
        // Suffix range: bytes=-500 -> last 500 bytes
        const suffixLen = Number(rangeMatch[2])
        if (suffixLen <= 0) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${co}`, 'Accept-Ranges': 'bytes' }
          })
        }
        b = Math.max(0, co - suffixLen)
        k = co - 1
      } else if (rangeMatch[1] && !rangeMatch[2]) {
        // Open-ended: bytes=500-
        b = Number(rangeMatch[1])
        k = co - 1
      } else {
        // Range: bytes=0-499
        b = Number(rangeMatch[1])
        k = Number(rangeMatch[2])
      }

      // Bounds validation: non-negative, start <= end, start < co
      if (b < 0 || k < b || b >= co || co === 0) {
        return new Response('Range Not Satisfiable', {
          status: 416,
          headers: {
            'Content-Range': `bytes */${co}`,
            'Accept-Ranges': 'bytes'
          }
        })
      }

      // Clamp k to file end
      k = Math.min(k, co - 1)
      const chunkLen = k - b + 1
      return new Response(Readable.toWeb(createReadStream(p, { start: b, end: k })) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': kieu,
          'Content-Length': String(chunkLen),
          'Content-Range': `bytes ${b}-${k}/${co}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*'
        }
      })
    } catch {
      return new Response('Internal Error', { status: 500 })
    }
  })
  registerIpc()
  logInfo(`${APP_BRAND.displayName} ${app.getVersion()} khởi động · ${process.platform}`)
  createWindow()
  void maybeAutoUpdateYtDlp()
  initAutoUpdate(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Đóng resident worker sạch trước khi Electron thoát.
let whisperShutdownStarted = false
app.on('before-quit', (event) => {
  if (whisperShutdownStarted) return
  whisperShutdownStarted = true
  event.preventDefault()
  wipeLogFileSync()
  void Promise.all([
    shutdownAutoShortRuntime(),
    shutdownWhisperRuntime()
  ]).finally(() => app.quit())
})

function registerIpc(): void {
  // Kiem tra phu thuoc luc khoi dong
  ipcMain.handle('deps:check', async () => {
    const s = await checkDependencies()
    logInfo(`Kiểm tra môi trường: bộ tải xuống=${s.ytdlp ? 'có' : 'thiếu'}, ffmpeg=${s.ffmpeg ? 'có' : 'thiếu'}`)
    return s
  })

  // Chay setup (tai cai con thieu), day tien do ve renderer
  ipcMain.handle('deps:setup', async (event) => {
    const send = (p: SetupProgress): void => event.sender.send('deps:setup-progress', p)
    try {
      await runSetup(send)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Lay thong tin video
  ipcMain.handle(
    'ytdlp:info',
    async (
      _e,
      url: string,
      proxy?: string | null,
      useCookies = false
    ) => {
      try {
        const info = await fetchInfo(url, proxy, useCookies)
        return { ok: true, info }
      } catch (err) {
        return { ok: false, ...ytdlpErrorPayload(err) }
      }
    }
  )

  // ---- Cookie dang nhap (Electron native) ----
  ipcMain.handle('cookies:status', async (_event, url: string) => domainCookieStatus(url))
  ipcMain.handle('cookies:list', async () => listDomainCookieStatuses())
  ipcMain.handle('cookies:clear', async (_event, url: string) => {
    logInfo('Xóa cookie đăng nhập.')
    return clearDomainCookies(url)
  })
  ipcMain.handle('cookies:capture', async (event, url: string) => {
    // Chi ghi TEN MIEN — nhat ky khong can biet user dang nhap vao trang nao cu the
    logInfo(`Mở cửa sổ đăng nhập lấy cookie${url ? ` (${domainOf(url)})` : ''}…`)
    const res = await captureDomainCookies(url, (e) => event.sender.send('cookies:capture-event', e))
    if (res.ok) logInfo(`Đã lưu ${res.count} cookie.`)
    else logError(`Lấy cookie thất bại: ${res.error ?? ''}`)
    return res
  })

  // Cookie rieng Facebook/Bilibili: file, partition va marker dang nhap tach biet.
  ipcMain.handle('cookies:siteStatus', async (_event, site: unknown) => {
    if (!isCookieSite(site)) throw new Error('Website cookie không được hỗ trợ.')
    return siteCookieStatus(site)
  })
  ipcMain.handle('cookies:siteClear', async (_event, site: unknown) => {
    if (!isCookieSite(site)) throw new Error('Website cookie không được hỗ trợ.')
    logInfo(`Xóa cookie đăng nhập ${site}.`)
    return clearSiteCookies(site)
  })
  ipcMain.handle('cookies:siteCapture', async (event, site: unknown, url?: string | null) => {
    if (!isCookieSite(site)) throw new Error('Website cookie không được hỗ trợ.')
    logInfo(`Mở cửa sổ đăng nhập ${site}…`)
    const res = await captureSiteCookies(site, url, (captureEvent) =>
      event.sender.send('cookies:site-capture-event', { site, ...captureEvent })
    )
    if (res.ok) logInfo(`Đã lưu cookie đăng nhập ${site}.`)
    else logError(`Lấy cookie ${site} thất bại.`)
    return res
  })

  // Kiem tra playlist
  ipcMain.handle(
    'ytdlp:playlist',
    async (
      _e,
      url: string,
      proxy?: string | null,
      useCookies = false
    ) => {
      try {
        const playlist = await fetchPlaylist(url, proxy, useCookies)
        return { ok: true, playlist }
      } catch (err) {
        return { ok: false, ...ytdlpErrorPayload(err) }
      }
    }
  )

  // Kiem tra proxy
  ipcMain.handle('proxy:test', async (_e, proxy: string) => {
    const r = await testProxy(proxy)
    logInfo(`Kiểm tra proxy: ${r.ok ? 'OK' : 'THẤT BẠI'} — ${r.message}`)
    return r
  })

  // Chon thu muc luu
  ipcMain.handle('dialog:chooseFolder', async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled ? null : res.filePaths[0]
  })

  // Chon file audio/video (cho tab Audio->Text)
  ipcMain.handle('dialog:chooseFiles', async () => {
    if (!mainWindow) return []
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Âm thanh / Video',
          extensions: [
            'mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aac', 'wma',
            'mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'ts', 'm4v'
          ]
        },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    })
    return res.canceled ? [] : res.filePaths
  })

  // Chon 1 tep phu de .srt co san (de ghep vao video ma khong can OCR)
  ipcMain.handle('dialog:chooseSrt', async (_e, defaultDir?: string | null) => {
    if (!mainWindow) return null
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'Phụ đề', extensions: ['srt'] },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    }
    // Mo dung thu muc xuat OCR neu co
    if (defaultDir && defaultDir.trim()) opts.defaultPath = defaultDir.trim()
    const res = await dialog.showOpenDialog(mainWindow, opts)
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Chon 1 tep am thanh
  ipcMain.handle('dialog:chooseAudio', async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Âm thanh', extensions: ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus'] },
        { name: 'Tất cả', extensions: ['*'] }
      ]
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Thu muc mac dinh (Downloads)
  ipcMain.handle('app:downloadsDir', async () => app.getPath('downloads'))

  // Phien ban ung dung
  ipcMain.handle('app:version', async () => app.getVersion())

  // Tu cap nhat app
  ipcMain.handle('update:check', async () => checkForUpdates())
  ipcMain.handle('update:install', async () => quitAndInstall())

  // Cong cu tai: phien ban + cap nhat thu cong
  ipcMain.handle('ytdlp:version', async () => ytDlpVersion())
  ipcMain.handle('ytdlp:capabilities', async () => ytdlpCapabilityStatus())
  ipcMain.handle('ytdlp:update', async () => {
    logInfo('Đang cập nhật công cụ tải…')
    const r = await updateYtDlp()
    invalidateYtDlpCapabilities()
    logInfo(`Cập nhật công cụ tải: ${r.ok ? 'OK' : 'LỖI'} — ${r.message}`)
    return r
  })

  // ---- Douyin ----
  ipcMain.handle('douyin:engineStatus', async () => dyEngineStatus())
  ipcMain.handle('douyin:installEngine', async (event) => {
    try {
      await installDyEngine((percent) => event.sender.send('douyin:install-progress', percent))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('douyin:download', async (event, id: string, req: DouyinRequest) =>
    downloadDouyin(id, req, (p) => event.sender.send('douyin:progress', p))
  )
  ipcMain.handle('douyin:cookieStatus', async () => dyCookieStatus())
  ipcMain.handle('douyin:cookieClear', async () => {
    logInfo('Douyin: xóa cookie đăng nhập.')
    return clearDyCookies()
  })
  ipcMain.handle('douyin:cookieCapture', async (event) => {
    logInfo('Douyin: mở cửa sổ đăng nhập lấy cookie.')
    const res = await captureDyCookies((e) => event.sender.send('douyin:cookie-event', e))
    if (res.ok) logInfo(`Douyin: đã lưu ${res.count} cookie.`)
    else logError(`Douyin: lấy cookie thất bại: ${res.error ?? ''}`)
    return res
  })
  ipcMain.handle('douyin:channels', async () => getChannels())
  ipcMain.handle('douyin:removeChannel', async (_e, url: string) => removeChannel(url))

  // ---- Audio -> Text (whisper) ----
  ipcMain.handle('whisper:engineStatus', async () => whisperEngineStatus())
  ipcMain.handle('whisper:installEngine', async (event) => {
    try {
      await installWhisperEngine((percent) => event.sender.send('whisper:install-progress', percent))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('whisper:transcribe', async (event, id: string, req: WhisperRequest) =>
    transcribeAudio(id, req, (p) => event.sender.send('whisper:progress', p))
  )
  ipcMain.handle('whisper:detectGpu', async () => {
    const g = await detectGpu()
    logInfo(
      `Quét GPU: ${g.hasNvidia ? `${g.name} · CUDA ${g.cudaVersion ?? '?'} · tăng tốc=${g.canAccelerate ? 'được' : 'không'}` : 'không có NVIDIA'}`
    )
    return g
  })
  // ---- Dich man hinh (doc chu chay tren video) ----
  ipcMain.handle('ocr:engineStatus', async () => ocrEngineStatus())
  ipcMain.handle('ocr:installEngine', async (event) => {
    try {
      await installOcrEngine((p) => event.sender.send('ocr:install-progress', p))
      return { ok: true }
    } catch (err) {
      debugRaw('ocr install', err)
      return { ok: false, error: errLabel(err) }
    }
  })
  ipcMain.handle(
    'ocr:video',
    async (event, input: string, outputDir: string, y0: number, y1: number, x0: number, x1: number, formats: string[]) =>
      ocrVideo(input, outputDir, y0, y1, x0, x1, formats, (p) => event.sender.send('ocr:progress', p))
  )
  ipcMain.handle('ocr:cancel', async () => cancelOcr())

  // ---- Ghep phu de vao video (buoc phu tab Dich man hinh) ----
  ipcMain.handle('burn:start', async (event, req: BurnReq) => {
    try {
      return await burnSubtitle(req, (p) => event.sender.send('burn:progress', p))
    } catch (error) {
      debugRaw('burn ipc', error)
      return { ok: false, error: 'Không thể bắt đầu xuất video. Hãy kiểm tra các file đã chọn rồi thử lại.' }
    }
  })
  ipcMain.handle('burn:cancel', async () => cancelBurn())
  ipcMain.handle('burn:probeMedia', async (_e, video: string) => {
    try {
      return { ok: true, meta: await probeBurnMedia(video) }
    } catch (error) {
      debugRaw('burn probe media', error)
      return { ok: false, error: 'Không thể kiểm tra âm thanh của video đã chọn.' }
    }
  })
  ipcMain.handle('audio:preparePreview', async (_e, input: string) => {
    try {
      return await prepareAudioPreview(input)
    } catch (error) {
      debugRaw('audio preview ipc', error)
      return { ok: false, error: 'Không thể chuẩn bị bản nghe thử.' }
    }
  })
  // Do do dai file .srt -> renderer canh bao khi lech han so voi video
  ipcMain.handle('burn:srtGiay', async (_e, duong: string) => srtGiay(duong))
  ipcMain.handle('subtitle:parse', async (_e, duong: string) => {
    if (typeof duong !== 'string' || extname(duong).toLowerCase() !== '.srt') {
      return { cues: [], duration: 0, warnings: [], error: 'Hãy chọn một file phụ đề .srt hợp lệ.' }
    }
    try {
      const info = await stat(duong)
      if (!info.isFile() || info.size > 20 * 1024 * 1024) {
        return {
          cues: [],
          duration: 0,
          warnings: [],
          error: 'File phụ đề không hợp lệ hoặc lớn hơn 20 MB.'
        }
      }
      const parsed = parseSrt(docFileSrt(duong))
      return {
        cues: parsed.cues,
        duration: subtitleDuration(parsed.cues),
        warnings: parsed.warnings.map((warning) => `Dòng ${warning.line}: ${warning.message}`),
        error: parsed.cues.length === 0 ? 'File phụ đề không có câu nào với mốc thời gian hợp lệ.' : undefined
      }
    } catch (error) {
      debugRaw('subtitle parse', error)
      return {
        cues: [],
        duration: 0,
        warnings: [],
        error: 'Không thể đọc file phụ đề này. Hãy kiểm tra lại file rồi thử lại.'
      }
    }
  })
  ipcMain.handle('subtitle:layout', async (_e, request: SubtitleLayoutRequest) => {
    if (!request || typeof request.path !== 'string' || extname(request.path).toLowerCase() !== '.srt') {
      throw new Error('Hãy chọn một file phụ đề .srt hợp lệ.')
    }
    const width = Number(request.videoWidth)
    const height = Number(request.videoHeight)
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 16 ||
      height < 16 ||
      width > 32_768 ||
      height > 32_768
    ) {
      throw new Error('Chưa xác định được kích thước video để căn phụ đề.')
    }
    const region = request.subRegion
    if (
      region &&
      (!Number.isFinite(region.x0) ||
        !Number.isFinite(region.y0) ||
        !Number.isFinite(region.x1) ||
        !Number.isFinite(region.y1) ||
        region.x0 < 0 ||
        region.y0 < 0 ||
        region.x1 <= region.x0 ||
        region.y1 <= region.y0 ||
        region.x1 > width ||
        region.y1 > height)
    ) {
      throw new Error('Vùng phụ đề không còn nằm trong video.')
    }
    if (
      request.profile != null &&
      request.profile !== 'readable' &&
      request.profile !== 'social' &&
      request.profile !== 'vertical'
    ) {
      throw new Error('Cấu hình tối ưu phụ đề không hợp lệ.')
    }
    if (
      (request.autoOptimize != null && typeof request.autoOptimize !== 'boolean') ||
      (request.bgEnabled != null && typeof request.bgEnabled !== 'boolean') ||
      (request.fontId != null && (typeof request.fontId !== 'string' || request.fontId.length > 100))
    ) {
      throw new Error('Cấu hình phụ đề không hợp lệ.')
    }

    let cues
    try {
      const info = await stat(request.path)
      if (!info.isFile() || info.size <= 0 || info.size > 20 * 1024 * 1024) {
        throw new Error('invalid subtitle file')
      }
      cues = parseSrt(docFileSrt(request.path)).cues
    } catch (error) {
      debugRaw('subtitle layout read', error)
      throw new Error('Không thể đọc file phụ đề này. Hãy chọn lại file rồi thử lại.')
    }
    if (cues.length === 0) throw new Error('File phụ đề không có đoạn nào với mốc thời gian hợp lệ.')

    const bc = boCuc(
      { w: width, h: height, giay: 0, hasAudio: false },
      region,
      false
    )
    const marginLeft = bc.x > 0 ? bc.x : Math.round(width * 0.08)
    const marginRight =
      bc.x > 0 && bc.bw > 0 ? Math.max(0, width - (bc.x + bc.bw)) : Math.round(width * 0.08)
    const boxWidth = Math.max(8, width - marginLeft - marginRight)
    const boxPadding = request.bgEnabled ? Math.max(8, Math.round(bc.fontSize * 0.26)) : 0

    try {
      return createMainSubtitlePlan(
        cues,
        {
          profile: request.profile ?? 'readable',
          autoOptimize: request.autoOptimize !== false,
          videoWidth: width,
          videoHeight: height,
          boxWidth,
          boxHeight:
            bc.tamY != null ? bc.bh : Math.max(bc.fontSize * 2.5, height * 0.2),
          fontSize: bc.fontSize,
          boxPadding
        },
        request.fontId
      ).plan
    } catch (error) {
      debugRaw('subtitle layout plan', error)
      if (error instanceof Error && error.message.startsWith('Font đã chọn')) throw error
      throw new Error('Không thể căn phụ đề bằng font đã chọn. Hãy thử một font khác.')
    }
  })
  ipcMain.handle('fonts:list', async () => listBurnFonts())
  ipcMain.handle('fonts:previewData', async (_e, fontId: string) => readBurnFontPreview(fontId))
  ipcMain.handle('fonts:import', async () => {
    const options = {
      title: 'Thêm font phụ đề',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Font chữ', extensions: ['ttf', 'otf'] }]
    }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return { ok: true, fonts: [] }
    try {
      const imported = await importBurnFontFiles(result.filePaths)
      const error = imported.errors.length
        ? `${imported.errors.length} file font không thể thêm. ${imported.errors[0]}`
        : undefined
      return {
        ok: imported.fonts.length > 0 || imported.errors.length === 0,
        fonts: imported.fonts,
        error
      }
    } catch (error) {
      return { ok: false, error: errLabel(error) }
    }
  })
  ipcMain.handle('fonts:removeCustom', async (_e, fontId: string) => {
    try {
      await removeCustomBurnFont(fontId)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errLabel(error) }
    }
  })

  // ---- Video2X (nang cap video) ----
  ipcMain.handle('video2x:engineStatus', async () => video2xEngineStatus())
  ipcMain.handle('video2x:installEngine', async (event) => {
    try {
      await installVideo2xEngine((p) => event.sender.send('video2x:install-progress', p))
      return { ok: true }
    } catch (err) {
      debugRaw('video2x install', err)
      return { ok: false, error: errLabel(err) }
    }
  })
  ipcMain.handle('video2x:listDevices', async () => listVideo2xDevices())
  ipcMain.handle('video2x:start', async (event, req: Video2xRunRequest) =>
    runVideo2x(req, (p) => event.sender.send('video2x:progress', p))
  )
  ipcMain.handle('video2x:cancel', async () => cancelVideo2x())

  // ---- Dich phu de bang API key cua user (Gemini | ChatGPT | AI noi bo) ----
  const isProvider = (p: unknown): p is DichProvider =>
    p === 'gemini' || p === 'openai' || p === 'local'

  ipcMain.handle('translate:hasKey', async (_e, provider: DichProvider) => {
    if (!isProvider(provider)) return false
    return provider === 'openai' ? openaiHasKey() : provider === 'local' ? hasLocalKey() : geminiHasKey()
  })
  ipcMain.handle('translate:saveKey', async (_e, provider: DichProvider, key: string) => {
    if (!isProvider(provider)) return
    return provider === 'openai'
      ? openaiSaveKey(key)
      : provider === 'local'
        ? saveLocalKey(key)
        : geminiSaveKey(key)
  })
  ipcMain.handle('translate:checkKey', async (_e, provider: DichProvider, key: string, serverUrl?: string, targetLanguage?: string, sourceLanguage?: string) => {
    if (!isProvider(provider)) return { ok: false, message: 'Nhà cung cấp không hợp lệ.' }
    return provider === 'openai'
      ? openaiCheckKey(key)
      : provider === 'local'
        ? checkLocalTranslateKey(serverUrl, key, targetLanguage, sourceLanguage)
        : geminiCheckKey(key)
  })
  ipcMain.handle(
    'translate:translateSrt',
    async (
      event,
      srtPath: string,
      outPath: string,
      dich: string,
      provider: DichProvider = 'gemini',
      serverUrl?: string
    ) => {
      const p: DichProvider = isProvider(provider) ? provider : 'gemini'
      if (p === 'local') {
        return localTranslateSrt(srtPath, outPath, dich, serverUrl, undefined, (d: number, t: number) =>
          event.sender.send('translate:progress', { done: d, total: t })
        )
      }
      const run = p === 'openai' ? openaiTranslateSrt : geminiTranslateSrt
      return run(srtPath, outPath, dich, (d, t) =>
        event.sender.send('translate:progress', { done: d, total: t })
      )
    }
  )

  // Alias cu — giu cho goi gemini:* van chay
  ipcMain.handle('gemini:hasKey', async () => geminiHasKey())
  ipcMain.handle('gemini:saveKey', async (_e, key: string) => geminiSaveKey(key))
  ipcMain.handle('gemini:checkKey', async (_e, key: string) => geminiCheckKey(key))
  ipcMain.handle(
    'gemini:translateSrt',
    async (event, srtPath: string, outPath: string, dich: string) =>
      geminiTranslateSrt(srtPath, outPath, dich, (d, t) => {
        event.sender.send('translate:progress', { done: d, total: t })
        event.sender.send('gemini:progress', { done: d, total: t })
      })
  )


  ipcMain.handle('whisper:cudaStatus', async () => whisperCudaStatus())
  ipcMain.handle('whisper:installCuda', async (event) => {
    try {
      await installCudaPack((percent) => event.sender.send('whisper:cuda-progress', percent))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Nhat ky hoat dong
  ipcMain.handle('logs:get', async () => getLogs())
  ipcMain.handle('logs:clear', async () => clearLogs())
  ipcMain.handle('logs:openFile', async () => {
    await shell.openPath(logFilePath())
  })
  ipcMain.handle('support:createReport', async () => createSupportReport())
  ipcMain.on('support:rendererIssue', (_event, issue: RendererIssueReport) => {
    recordRendererIssue(issue)
  })

  // Tai xuong
  ipcMain.handle('ytdlp:download', async (event, id: string, req: DownloadRequest) => {
    try {
      return await download(id, req, (p) => event.sender.send('ytdlp:progress', p))
    } catch (err) {
      const payload = ytdlpErrorPayload(err)
      logError(`Tải xuống thất bại: ${payload.error}`)
      return { id, ok: false, file: null, ...payload }
    }
  })

  // TTS Voice
  ipcMain.handle('tts:checkHealth', async (_e, serverUrl?: string, apiKey?: string) => checkTtsServerHealth(serverUrl, apiKey || await loadLocalKey()))
  ipcMain.handle('tts:getModels', async (_e, serverUrl?: string, apiKey?: string) => getTtsModels(serverUrl, apiKey || await loadLocalKey()))
  ipcMain.handle('tts:generateSpeech', async (_e, req: TtsSpeechRequest) => generateSpeech(req))
  ipcMain.handle('tts:generateClone', async (_e, req: TtsCloneRequest) => generateVoiceClone(req))
  ipcMain.handle('tts:saveAudio', async (_e, audioBase64: string, defaultName?: string) => saveTtsAudio(audioBase64, defaultName))
  ipcMain.handle('tts:selectRefAudio', async () => selectReferenceAudioFile())
  ipcMain.handle('tts:getEdgeVoices', async () => fetchEdgeVoices())

  // Auto Short
  ipcMain.handle('autoshort:selectVideos', async () => selectAutoShortVideoFiles())
  ipcMain.handle('autoshort:getReadiness', async (_event, raw: Pick<AutoShortConfig, 'subtitleMethod' | 'whisperModel' | 'whisperDevice'>) => {
    if (!raw || typeof raw !== 'object' || typeof raw.subtitleMethod !== 'string' || typeof raw.whisperModel !== 'string') {
      throw new Error('Yêu cầu kiểm tra dependency Auto Short không hợp lệ.')
    }
    return getAutoShortReadiness({ ...raw, whisperDevice: raw.whisperDevice || 'cpu' })
  })
  ipcMain.handle('whisper:modelStatus', async (_event, model: string) => whisperModelStatus(model))
  ipcMain.handle('whisper:installModel', async (event, model: string) => {
    try {
      await installWhisperModel(model, (progress) => event.sender.send('whisper:model-install-progress', progress))
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('whisper:stopWorker', async () => {
    await shutdownWhisperRuntime()
    return { ok: true }
  })
  ipcMain.handle('autoshort:installDependencies', async (event, raw: Pick<AutoShortConfig, 'subtitleMethod' | 'whisperModel' | 'whisperDevice'>) => {
    const key = event.sender.id
    if (autoShortDependencyInstalls.has(key)) return { ok: false, error: 'Đang tải dependency Auto Short.' }
    const controller = new AbortController()
    autoShortDependencyInstalls.set(key, controller)
    try {
      const readiness = await installAutoShortDependencies({ ...raw, whisperDevice: raw.whisperDevice || 'cpu' }, (progress) => {
        try { event.sender.send('autoshort:dependencyProgress', progress) } catch { /* renderer closed */ }
      }, controller.signal)
      return { ok: true, readiness }
    } catch (error) {
      return { ok: false, error: errLabel(error) }
    } finally {
      autoShortDependencyInstalls.delete(key)
    }
  })
  ipcMain.handle('autoshort:cancelDependencyInstall', async (event) => {
    const controller = autoShortDependencyInstalls.get(event.sender.id)
    if (!controller) return { ok: false, error: 'Không có lượt tải dependency đang chạy.' }
    controller.abort()
    return { ok: true }
  })
  ipcMain.handle('autoshort:start', async (event, raw: unknown) => {
    return startAutoShortJob(raw, (payload) => {
      try {
        event.sender.send('autoshort:event', payload)
      } catch (error) {
        logWarn(`Auto Short không gửi được event: ${errLabel(error)}`)
      }
    })
  })
  ipcMain.handle('autoshort:cancel', async (_event, jobId: unknown) => {
    if (typeof jobId !== 'string') return { ok: false, error: 'Job ID không hợp lệ.' }
    return cancelAutoShort(jobId)
  })

  // Mo file/thu muc sau khi tai
  ipcMain.handle('shell:showItem', async (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })
  ipcMain.handle('shell:openPath', async (_e, p: string) => {
    await shell.openPath(p)
  })
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && isSafeExternalUrl(url)) {
      await shell.openExternal(url)
    }
  })
}
