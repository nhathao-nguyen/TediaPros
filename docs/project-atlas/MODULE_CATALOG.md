# MODULE_CATALOG.md — Danh Mục Các Module Hệ Thống

Tài liệu này tổng hợp toàn bộ 12 phân hệ chính cấu thành nên ứng dụng **TediaPros**, mô tả vai trò, tệp tin cốt lõi và liên kết đến tài liệu phân tích chi tiết của từng module.

---

## Bảng Tổng Hợp Danh Mục Phân Hệ

| STT | Mã Phân Hệ | Thư Mục Nguồn | Vai Trò & Trách Nhiệm Cốt Lõi | Tài Liệu Chi Tiết |
| :-: | :--- | :--- | :--- | :--- |
| 1 | **Shared Contract** | `src/shared/` | Nguồn sự thật duy nhất (Single Source of Truth) cho các types, interfaces IPC, thuật toán isomorphic thuần túy và schema validation. | [modules/shared.md](./modules/shared.md) |
| 2 | **Preload Bridge** | `src/preload/` | Cầu nối an toàn `contextBridge`, phơi bày interface `TblaoApi` cho Renderer, quản lý vòng đời listener IPC. | [modules/preload.md](./modules/preload.md) |
| 3 | **Main Core** | `src/main/` (core) | Quản lý vòng đời Electron app, custom protocol `tblao:`, cookie store, proxy test, logger và báo cáo sự cố (Support Report). | [modules/main-core.md](./modules/main-core.md) |
| 4 | **AutoShort Orchestrator** | `src/main/autoShort*` | Điều phối toàn bộ quy trình AutoShort, hàng đợi FIFO, quản lý item scope, ngân sách đĩa tạm (Disk Budget) và telemetry. | [modules/autoshort.md](./modules/autoshort.md) |
| 5 | **Dubbing & TTS** | `src/main/dubbing/` | Lập kế hoạch cửa sổ âm thanh source-anchored, dự đoán thời lượng câu nói, điều tiết nhịp độ (1.10x–1.45x), gọi TTS và cache. | [modules/dubbing.md](./modules/dubbing.md) |
| 6 | **Vocal Separation** | `src/main/separation/` & `engines/separator-engine/` | Tách Vocals và Instrumental bằng MDX-Net ONNX, tăng tốc phần cứng DirectML trên Windows, tự động fallback sang CPU. | [modules/separation.md](./modules/separation.md) |
| 7 | **STTN Inpainting** | `src/main/inpainting/` & `engines/sttn-engine/` | Xóa chữ và phụ đề cũ bằng mạng nơ-ron biến đổi không-thời gian (STTN), giao tiếp JSONL `sttn-engine/1`, an toàn file locking. | [modules/inpainting.md](./modules/inpainting.md) |
| 8 | **OCR & Vision** | `src/main/ocr.ts`, `whisper.ts` & engines | Quét chữ video RapidOCR 8 FPS, gom nhóm bounding boxes qua trục thời gian (Visual Timeline), nhận diện giọng nói Faster-Whisper. | [modules/ocr-vision.md](./modules/ocr-vision.md) |
| 9 | **Subtitles & Burn** | `src/main/burn.ts`, `fonts.ts` | Tính toán kích thước font bằng opentype.js, sinh kịch bản ASS hiệu ứng Karaoke (reveal/highlight), làm mờ Planar RGB FFmpeg. | [modules/subtitles-burn.md](./modules/subtitles-burn.md) |
| 10 | **Downloader & Douyin** | `src/main/ytdlp.ts`, `douyin.ts` & engines | Tải video đa nền tảng yt-dlp, crawler Douyin chuyên biệt không watermark, quản lý cookie đăng nhập và SQLite dedup. | [modules/downloader-douyin.md](./modules/downloader-douyin.md) |
| 11 | **Runtime & Provisioning**| `src/main/deps.ts`, `runtimeInstaller.ts` | Tải on-demand các binary và AI models, đối soát mã băm SHA-256 ghim chặt, giải nén và kích hoạt runtime. | [modules/runtime-infra.md](./modules/runtime-infra.md) |
| 12 | **Renderer UI** | `src/renderer/` | Giao diện người dùng React 19 + Vite 6, 10 Tabs tính năng, custom preview hooks, Error Boundary và styling responsive. | [modules/renderer.md](./modules/renderer.md) |
