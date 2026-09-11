# CONTRACTS.md — Đặc Tả Hợp Đồng Giao Tiếp & Giao Thức (Contracts Specification)

Tài liệu này định nghĩa toàn bộ các hợp đồng giao tiếp trong TediaPros: IPC giữa Renderer và Main, giao thức Stdio JSONL với các Python Sidecar Engines, và các định dạng dữ liệu truyền nhận.

---

## 1. Hợp Đồng IPC (Renderer Process $\leftrightarrow$ Main Process)

Mọi giao tiếp đều tuân thủ nguyên tắc gõ kiểu một chiều (Typed Bridge) thông qua `contextBridge` tại [src/preload/index.ts](file:///f:/Son/tool/TediaPros/src/preload/index.ts) và [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts).

### 1.1. Bảng Kênh IPC Invoke (Request - Response)

| Kênh IPC | Tham Số Đầu Vào | Kiểu Trả Về | Mô Tả Chức Năng |
| :--- | :--- | :--- | :--- |
| `autoshort:start` | `request: AutoShortStartRequest` | `Promise<AutoShortStartResult>` | Khởi tạo job AutoShort mới; trả về `jobId` nếu hợp lệ hoặc thông báo lỗi tiếng Việt. |
| `autoshort:cancel` | `jobId: string` | `Promise<{ ok: boolean; error?: string }>` | Hủy bỏ job đang chạy, kích hoạt dọn dẹp tiến trình con và file tạm. |
| `autoshort:getReadiness` | `config: AutoShortDependencyConfig` | `Promise<AutoShortReadiness>` | Kiểm tra tính sẵn sàng của các runtime/model cần thiết cho cấu hình đã chọn. |
| `auto-short:sttn-preview` | `request: AutoShortSttnPreviewRequest` | `Promise<AutoShortSttnPreviewResult>` | Chạy xem thử xóa chữ STTN trên một đoạn ngắn (mặc định 3-5 giây). |
| `ytdlp:info` | `url, proxy?, useCookies?` | `Promise<{ ok: boolean; info?: VideoInfo }>` | Phân tích metadata và danh sách chất lượng video từ URL qua yt-dlp. |
| `ytdlp:download` | `id: string, req: DownloadRequest` | `Promise<DownloadResult>` | Bắt đầu tải video/âm thanh qua yt-dlp. |
| `douyin:download` | `id: string, req: DouyinRequest` | `Promise<DouyinResult>` | Kích hoạt crawler tải video hoặc kênh Douyin không watermark. |
| `whisper:transcribe` | `id: string, req: WhisperRequest` | `Promise<WhisperResult>` | Bóc băng giọng nói thành phụ đề SRT bằng Faster-Whisper. |
| `ocr:video` | `input, outputDir, y0, y1, x0, x1` | `Promise<OcrResult>` | Quét chữ trên video bằng RapidOCR. |
| `burn:start` | `req: BurnReq` | `Promise<BurnResult>` | Render phụ đề ASS và làm mờ chữ cũ vào video qua FFmpeg. |
| `fonts:list` | *(không)* | `Promise<BurnFontEntry[]>` | Liệt kê danh sách phông chữ an toàn có sẵn trong app. |
| `support:createReport` | *(không)* | `Promise<SupportReport>` | Thu thập logs và issue reports để tạo báo cáo sự cố ẩn danh. |

### 1.2. Bảng Kênh IPC Event (Main $\rightarrow$ Renderer Push Events)

| Kênh Event | Payload Type | Mục Đích |
| :--- | :--- | :--- |
| `autoshort:event` | `AutoShortEvent` | Cập nhật tiến trình từng video (`item-progress`), hoàn tất (`item-done`), lỗi (`item-error`), hoặc xong cả mẻ (`batch-done`). |
| `ytdlp:progress` | `DownloadProgress` | Cập nhật phần trăm tải, tốc độ mạng (speed) và thời gian còn lại (ETA). |
| `douyin:progress` | `DouyinProgress` | Cập nhật số lượng video Douyin đã tải trong danh sách quét. |
| `burn:progress` | `BurnProgress` | Cập nhật thời gian đã render của FFmpeg so với tổng thời lượng video. |
| `logs:entry` | `LogEntry` | Đẩy dòng nhật ký mới lên giao diện xem log thời gian thực. |

---

## 2. Giao Thức Stdio Với Các Python Sidecar Engines

Các engine Python được đóng gói độc lập và giao tiếp qua luồng chuẩn `stdin` / `stdout` / `stderr`.

### 2.1. Giao Thức STTN Inpainting (`sttn-engine/1`)
- **Tài liệu tham chiếu:** [src/main/inpainting/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/inpainting/AGENTS.md)
- Mỗi thông điệp trên `stdout` là một dòng JSON hợp lệ (JSONL):
  ```json
  {"protocol":"sttn-engine/1","type":"progress","percent":42.5,"phase":"inpainting"}
  {"protocol":"sttn-engine/1","type":"done","outputPath":"C:/.../cleaned.mkv","provider":"cuda","elapsedMs":3200}
  ```
- Lỗi và cảnh báo nội bộ in ra `stderr` và được hàm `diagnostic()` thu thập tối đa 16 KB để hiển thị trong báo cáo lỗi.

### 2.2. Giao Thức Tách Thoại MDX Separation
- **Tài liệu tham chiếu:** [src/main/separation/AGENTS.md](file:///f:/Son/tool/TediaPros/src/main/separation/AGENTS.md)
- Tham số dòng lệnh:
  `--separate --input <in.wav> --output-dir <outDir> --model <model.onnx> --provider <auto|cpu> --batch-size <n> --overlap <f>`
- Trả về sự kiện tiến trình:
  ```json
  {"type":"progress","percent":50.0,"phase":"separating"}
  {"type":"result","vocals":".../vocals.wav","instrumental":".../instrumental.wav","provider":"directml"}
  ```
- Nếu DirectML lỗi, trả về JSON: `{"type":"error","code":"DIRECTML_OOM","message":"Out of memory"}` để Main Process bắt và retry bằng CPU.

### 2.3. Giao Thức Visual OCR (`ocr-local/1`)
- RapidOCR quét khung hình video theo kịch bản và xuất ra cấu trúc `OcrVisualTimeline`:
  ```json
  {
    "schemaVersion": 1,
    "protocol": "ocr-visual-cues/1",
    "video": { "width": 1080, "height": 1920, "sampleFps": 8, "frameCount": 240 },
    "scanRegion": { "x0": 0, "y0": 1380, "x1": 1080, "y1": 1800 },
    "segments": [
      {
        "id": "seg_0",
        "startFrame": 16,
        "endFrameExclusive": 48,
        "start": 2.0,
        "end": 6.0,
        "text": "chào mừng các bạn",
        "boxes": [{ "x0": 120, "y0": 1400, "x1": 960, "y1": 1520, "confidence": 0.98 }]
      }
    ]
  }
  ```
