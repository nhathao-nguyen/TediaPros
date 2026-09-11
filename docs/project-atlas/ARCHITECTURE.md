# ARCHITECTURE.md — Kiến Trúc Tổng Thể Hệ Thống TediaPros

Tài liệu này phân tích chi tiết cấu trúc kiến trúc của **TediaPros**: mô hình Hybrid Desktop Shell, ranh giới tiến trình, giao tiếp IPC, cơ chế an toàn và quy trình khởi tạo/hủy bỏ.

---

## 1. Mô Hình Kiến Trúc Tổng Thể

TediaPros được thiết kế theo mô hình **Hybrid Desktop Shell + Multi-Engine Python Orchestrator**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    LỚP GIAO DIỆN (Renderer Process)                    │
│             React 19 + TypeScript + Vite 6 (Tailwind/CSS Modules)       │
│               10 Tabs: Downloader, Douyin, AutoShort, Voice...          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ window.api (Typed contextBridge)
┌────────────────────────────────────▼────────────────────────────────────┐
│                  CẦU NỐI BẢO MẬT (Preload Process)                      │
│        src/preload/index.ts  <────>  src/shared/types.ts                │
│             (Cô lập hoàn toàn DOM khỏi Node.js APIs)                   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ IPC Channels (invoke / on)
┌────────────────────────────────────▼────────────────────────────────────┐
│                 TIẾN TRÌNH CHÍNH (Electron Main Process)                │
│                                                                         │
│  ┌─────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │   AutoShort Coordinator │  │         Subsystem Managers           │  │
│  │  - ItemCoordinator     │  │  - Dubbing & TTS Engine (synthesis)  │  │
│  │  - QueueRunner (FIFO)   │  │  - Vocal Separation (MDX-Net)        │  │
│  │  - DiskBudgetLedger     │  │  - STTN Inpainting Runner            │  │
│  │  - ResourceManager      │  │  - FFmpeg Libass Subtitle Burner     │  │
│  │  - ItemScope (Abort)    │  │  - yt-dlp & Douyin Crawler           │  │
│  └─────────────────────────┘  └──────────────────────────────────────┘  │
│                                                                         │
│  Cơ chế an toàn:                                                        │
│  - safeContainedPath (Chống path traversal)                             │
│  - Protocol 'tblao:' (Stream Range Request cho local media)             │
│  - ProcessTree (Hủy sạch cây tiến trình con khi Cancel)                 │
└───────────────┬───────────────────────────────┬─────────────────────────┘
                │ Stdio JSON / CLI              │ Pipes / Direct Process
┌───────────────▼──────────────┐ ┌──────────────▼─────────────────────────┐
│     PYTHON SIDECAR ENGINES   │ │         NATIVE CLI BINARIES            │
│  - engines/ocr-engine        │ │  - FFmpeg & FFprobe                    │
│  - engines/separator-engine  │ │  - yt-dlp                              │
│  - engines/sttn-engine       │ │  - Video2X Engine                      │
│  - engines/whisper-engine    │ └────────────────────────────────────────┘
│  - engines/douyin-engine     │
└──────────────────────────────┘
```

---

## 2. Ranh Giới Tiến Trình & Ranh Giới An Toàn (Trust Boundaries)

### 2.1. Ranh giới Renderer $\leftrightarrow$ Main (Preload Isolation)
- **Renderer:** Chạy trong môi trường web sandbox của Chromium, `nodeIntegration: false`, `contextIsolation: true`. Tuyệt đối không có quyền gọi trực tiếp `fs`, `child_process`, `os`.
- **Preload (`src/preload/index.ts`):** Sử dụng `contextBridge.exposeInMainWorld('api', api)` để phơi bày duy nhất interface `TblaoApi`. Mọi payload gửi qua IPC đều được tiền kiểm kiểu TypeScript.
- **Bộ nghe sự kiện có thu hồi (Cleanup Guarantee):** Mọi hàm lắng nghe sự kiện (`onAutoShortEvent`, `onProgress`, `onLog`) đều trả về một callback hủy (`unsubscribe`), đảm bảo component React unmount không bị rò rỉ bộ nhớ.

### 2.2. Giao thức cục bộ an toàn `tblao:`
- **Vấn đề:** Khi Renderer chạy ở chế độ dev (`http://localhost:5173`), trình duyệt sẽ chặn việc nạp video từ đường dẫn `file://` do chính sách Same-Origin Policy (CORS) và Content Security Policy (CSP).
- **Giải pháp TediaPros:** Tại [src/main/index.ts#L40-L45](file:///f:/Son/tool/TediaPros/src/main/index.ts#L40-L45), hệ thống đăng ký scheme đặc quyền `tblao:` với các cờ `standard: true, secure: true, stream: true, supportFetchAPI: true`.
- **Hỗ trợ Range Request:** Hàm xử lý stream đọc file bằng `createReadStream(filePath, { start, end })`, tính toán mã phản hồi HTTP `206 Partial Content`. Nhờ đó, trình phát video trong React có thể tua thời gian mượt mà mà không cần nạp toàn bộ file lớn vào RAM.

### 2.3. Ranh giới Main $\leftrightarrow$ Python Sidecars & Binaries
- Main Process điều khiển các engine qua `child_process.spawn`.
- Tất cả tiến trình con được bọc qua [src/main/processTree.ts](file:///f:/Son/tool/TediaPros/src/main/processTree.ts) (`trackChildProcess`).
- Trên Windows, việc dừng tiến trình cha không tự động tiêu diệt tiến trình con. TediaPros sử dụng cơ chế duyệt cây tiến trình (Process Tree) để đảm bảo khi người dùng bấm Hủy (Cancel) hoặc app đóng lại, toàn bộ tiến trình Python, FFmpeg, ONNX Runtime đều bị tiêu diệt sạch sẽ, không để lại tiến trình ma (zombie process) chiếm dụng GPU hoặc khóa file.

---

## 3. Khởi Tạo, Đấu Nối Phụ Thuộc & Vòng Đời Ứng Dụng

1. **Khởi động ứng dụng (Startup):**
   - Đặt định danh ứng dụng: `app.setName('tedia-pros')`.
   - Cấu hình thư mục dữ liệu người dùng: `app.setPath('userData', join(app.getPath('appData'), 'tedia-pros'))`.
   - Thực hiện di trú dữ liệu cũ: `migrateLegacyUserData()` chuyển đổi cấu hình từ thương hiệu cũ `tblao` nếu tồn tại.
   - Đăng ký giao thức `tblao:` trước khi app sẵn sàng (`whenReady`).
2. **Tạo cửa sổ chính (`createWindow`):**
   - Tạo BrowserWindow với cấu hình kích thước chuẩn 1280x800, icon ứng dụng.
   - Cấu hình `webPreferences`: nạp `src/preload/index.ts`, tắt `nodeIntegration`.
3. **Đăng ký IPC Handlers:**
   - Nạp toàn bộ các phân hệ: `deps`, `ytdlp`, `cookies`, `douyin`, `whisper`, `ocr`, `burn`, `tts`, `autoshort`, `logs`.
4. **Kiểm tra phụ thuộc lần đầu (Setup Phase):**
   - Nếu thiếu FFmpeg hoặc yt-dlp, Renderer hiển thị màn hình `SetupScreen` hướng dẫn tải on-demand và giải nén an toàn.
5. **Dọn dẹp khi tắt app (Shutdown / Termination):**
   - Bắt sự kiện `before-quit`: dừng hàng đợi AutoShort, hủy các worker Whisper/OCR/Separation, dọn sạch thư mục tạm và đóng BrowserWindow.
