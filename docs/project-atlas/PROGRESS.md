# PROGRESS.md — Tiến Trình Khảo Sát & Xây Dựng Bản Đồ Kỹ Thuật TediaPros

**Thời điểm cập nhật:** 2026-09-07T13:22:00+07:00
**Snapshot khảo sát:**
- **Git Branch:** `main`
- **HEAD Commit:** `6291184eddc6df893ef13eaae68bdd1d27736812` (`fix(ci): pin DirectML separator build dependency`)
- **Working tree:** Sạch sẽ đối với mã nguồn (không có uncommitted source changes; chỉ có untracked test build bundles `out-codex-check*`).
- **Hệ điều hành:** Windows 10/11 x64 (DirectML, PowerShell, Node.js v24.19.0).

---

## 1. Trạng Thái Các Pha Công Việc

| Pha Thực Hiện | Trạng Thái | Mô Tả & Bằng Chứng Đã Xác Minh |
| :--- | :--- | :--- |
| **Pha 1: Kiểm kê & Phân loại** | **HOÀN THÀNH** | Quét 470 tệp; lập `FILE_INVENTORY.tsv` và `COVERAGE.md`; phân loại 100% tệp dự án. |
| **Pha 2: Kiểm chứng Runtime & Test** | **HOÀN THÀNH** | `npm run typecheck` (Node + Web) **PASS**; `autoshort-ocr-contract.test` **PASS 10/10**; `dubbing-plan.test` **PASS 16/16**; `separator-contract.test` **PASS 6/6**; `sttn-contract.test` **PASS 5/5**. |
| **Pha 3: Đọc sâu & Khảo sát mã nguồn** | **HOÀN THÀNH** | Đọc toàn bộ các AGENTS.md, `src/shared/*`, `src/preload/*`, `src/main/*`, `src/renderer/*`, `engines/*`. |
| **Pha 4: Soạn thảo Bộ Tài Liệu Kỹ Thuật** | **HOÀN THÀNH** | Lập toàn bộ tài liệu tổng quan, kiến trúc, danh mục module, luồng nghiệp vụ, hợp đồng và vận hành. |
| **Pha 5: Xây dựng Sơ Đồ Archify** | **HOÀN THÀNH** | Tạo 5 sơ đồ chuẩn (Architecture, Workflow, Sequence, Data Flow, Lifecycle), validate showcase và deliver HTML. |
| **Pha 6: Hậu kiểm & Bàn giao** | **HOÀN THÀNH** | Đối soát chéo, xác nhận không có placeholder, lập task record theo mẫu `.ai/tasks/TASK_TEMPLATE.md`. |

---

## 2. Checkpoint Chi Tiết Từng Phân Hệ Đã Xác Minh

1. **Shared Contract (`src/shared/`):** Đã đọc `types.ts`, `autoShortContract.ts`, `ocrVisualTimeline.ts`, `subtitles.ts`, `autoShortSeparation.ts`, `autoShortOcrBlur.ts`, v.v. Xác nhận tính Isomorphic tuyệt đối.
2. **Preload Security Bridge (`src/preload/`):** Đã đọc `index.ts`, `index.d.ts`. Toàn bộ kênh IPC và types `TblaoApi` đã được lập bản đồ.
3. **Electron Main Orchestrator (`src/main/`):**
   - Vòng đời ứng dụng, custom protocol `tblao:` (streaming range requests).
   - AutoShort Coordinator (`autoshort.ts`, `autoShortItemCoordinator.ts`, `autoShortQueueRunner.ts`).
   - Dubbing Subsystem (`src/main/dubbing/*`): Source-anchored timing, tempo 1.10x–1.45x, protected gap 0.50s, audio trim thresholds (-50dB, 30ms/100ms).
   - Vocal Separation Subsystem (`src/main/separation/*`): MDX-Net ONNX, DirectML với auto-fallback CPU, scratch audio extraction.
   - Inpainting Subsystem (`src/main/inpainting/*`): STTN Transformer, protocol `sttn-engine/1`, an toàn file lock khi hủy.
   - OCR & Mask Subsystem (`src/main/ocr.ts`, `ocrMask.ts`, `ffmpegOcrMaskProbe.ts`): RapidOCR ONNX, Planar RGB (`gbrp`) masked blur chống lem màu Chroma.
   - Subtitle & Burning Subsystem (`src/main/burn.ts`, `fonts.ts`, `fontMeasure.ts`): Opentype.js metrics, libass font directory isolation.
   - Downloader & Crawlers (`ytdlp.ts`, `douyin.ts`, `cookies.ts`): yt-dlp cookie management, Douyin asyncio engine.
   - Runtime Infrastructure (`deps.ts`, `runtimeInstaller.ts`, `runtimeManifest.ts`): Checksum SHA-256 ghim cứng, on-demand provision.
4. **Renderer Frontend (`src/renderer/`):**
   - React 19 + TypeScript + Vite 6.
   - 10 Tab điều hướng: Downloader, Douyin, AudioText, ScreenText, AutoShort, VideoEditor, VideoEnhance, Voice, Logs, License.
   - Custom Hooks: `useAudioMixPreview`, `useSubtitlePreview`, `useVideoTransport`.
   - Error Boundary: `SupportErrorBoundary.tsx`.
5. **Python Sidecars (`engines/`):**
   - `ocr-engine`: RapidOCR + visual timeline grouping.
   - `separator-engine`: MDX-Net + DirectML ONNX runtime.
   - `sttn-engine`: PyTorch STTN Inpainting.
   - `whisper-engine`: Faster-Whisper CTranslate2.
   - `douyin-engine`: Crawler + FastAPI local server + SQLite dedup.
