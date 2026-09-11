# Phân Hệ Cầu Nối An Toàn (Preload Security Bridge)

- **Thư mục mã nguồn:** `src/preload/`
- **Tệp cốt lõi:** `src/preload/index.ts`, `src/preload/index.d.ts`
- **Cơ chế:** Electron `contextBridge.exposeInMainWorld`

---

## 1. Trách Nhiệm Cốt Lõi
- Đóng vai trò cầu nối bảo mật độc quyền giữa Renderer Process (Chromium Sandbox) và Main Process (Node.js runtime).
- Ngăn chặn việc lộ đối tượng `ipcRenderer` thô ra ngoài cửa sổ trình duyệt (ngăn chặn XSS leo thang đặc quyền).
- Định nghĩa kiểu interface `TblaoApi` chuẩn xác, đảm bảo Renderer có autocomplete và typecheck đầy đủ khi gọi `window.api.*`.

---

## 2. Nhóm Các Kênh Giao Tiếp IPC Được Phơi Bày
1. **Kiểm tra phụ thuộc & cài đặt:**
   - `checkDeps()` $\rightarrow$ IPC `deps:check`
   - `runSetup()` $\rightarrow$ IPC `deps:setup`
   - `onSetupProgress(cb)` $\rightarrow$ IPC event `deps:setup-progress`
2. **Tải video yt-dlp & quản lý Cookie:**
   - `getInfo(url, proxy, useCookies)` $\rightarrow$ IPC `ytdlp:info`
   - `download(id, req)` $\rightarrow$ IPC `ytdlp:download`
   - `onProgress(cb)` $\rightarrow$ IPC event `ytdlp:progress`
   - `cookieCapture(url)`, `cookieStatus(url)` $\rightarrow$ IPC `cookies:*`
3. **Douyin Crawler:**
   - `dyEngineStatus()`, `dyDownload(id, req)` $\rightarrow$ IPC `douyin:*`
   - `onDyProgress(cb)` $\rightarrow$ IPC event `douyin:progress`
4. **Whisper ASR & OCR:**
   - `whisperTranscribe(id, req)` $\rightarrow$ IPC `whisper:transcribe`
   - `ocrVideo(input, outputDir, ...)` $\rightarrow$ IPC `ocr:video`
5. **AutoShort Pipeline:**
   - `autoShortStart(request)` $\rightarrow$ IPC `autoshort:start`
   - `autoShortCancel(jobId)` $\rightarrow$ IPC `autoshort:cancel`
   - `onAutoShortEvent(cb)` $\rightarrow$ IPC event `autoshort:event`
   - `autoShortGetReadiness(config)` $\rightarrow$ IPC `autoshort:getReadiness`
   - `autoShortSttnPreview(request)` $\rightarrow$ IPC `auto-short:sttn-preview`

---

## 3. Cơ Chế Thu Hồi Listener (Cleanup Guarantee)
Mọi hàm đăng ký listener (bắt đầu bằng `on*`) đều trả về một hàm hủy:
```typescript
onAutoShortEvent: (cb: (event: AutoShortEvent) => void): (() => void) => {
  const listener = (_e: unknown, event: AutoShortEvent): void => cb(event)
  ipcRenderer.on('autoshort:event', listener)
  return () => ipcRenderer.removeListener('autoshort:event', listener)
}
```
Nhờ đó, các React Hooks (`useEffect`) có thể return hàm này trong cleanup phase, triệt tiêu hoàn toàn rủi ro memory leak hoặc callback gọi vào component đã unmount.
