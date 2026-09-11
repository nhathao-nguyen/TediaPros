# TediaPros Project Atlas — Bản Đồ Kỹ Thuật Toàn Diện Của Dự Án

Chào mừng bạn đến với **TediaPros Project Atlas**.
Tài liệu này được biên soạn độc lập dựa trên việc khảo sát và kiểm chứng 100% mã nguồn thực tế tại repository `F:\Son\tool\TediaPros` vào ngày **07/09/2026**.

Mục tiêu của bộ tài liệu: giúp một kỹ sư phần mềm mới có thể hiểu sâu sắc bản chất sản phẩm, làm chủ kiến trúc hybrid Electron–Python, lần theo từng thao tác từ UI đến disk/sidecar, chạy kiểm thử, chẩn đoán sự cố, tự tin mở rộng tính năng và đóng gói ứng dụng mà không gây thoái lui (regression).

---

## 1. Lộ Trình Đọc Tài Liệu Theo Nhu Cầu (Reading Paths)

Tùy theo mục tiêu công việc, bạn hãy chọn lộ trình tương ứng:

```
[Bắt đầu] ────────────────────────────────────────────────────────┐
   │                                                              │
   ├─► Muốn hiểu tổng quan sản phẩm & nghiệp vụ:                  │
   │   └─► PRODUCT.md ─► GLOSSARY.md ─► ARCHITECTURE.md           │
   │                                                              │
   ├─► Muốn lần theo luồng xử lý thực tế (End-to-End Trace):     │
   │   └─► flows/autoshort-e2e.md ─► flows/dubbing-tts-flow.md    │
   │       ─► flows/separation-flow.md ─► flows/blur-inpaint-flow │
   │                                                              │
   ├─► Muốn sửa lỗi hoặc phát triển tính năng mới:                │
   │   └─► MODULE_CATALOG.md ─► modules/<tên-module>.md           │
   │       ─► CONTRACTS.md ─► DEVELOPMENT.md ─► TESTING.md        │
   │                                                              │
   ├─► Muốn xem sơ đồ kiến trúc & luồng trực quan (Archify):      │
   │   └─► diagrams/README.md ─► Mở trực tiếp các tệp *.html      │
   │                                                              │
   └─► Muốn đóng gói, phát hành & kiểm tra an toàn:               │
       └─► BUILD_AND_RELEASE.md ─► SECURITY_AND_LICENSE.md        │
           ─► GAPS_AND_DOC_DRIFT.md ─► EVIDENCE.md                │
```

---

## 2. Mục Lục Toàn Bộ Hệ Thống Tài Liệu

### A. Tổng Quan Dự Án & Phạm Vi
1. [SCOPE.md](./SCOPE.md) — Bối cảnh snapshot khảo sát, phương pháp luận, phạm vi và lý do loại trừ.
2. [FILE_INVENTORY.tsv](./FILE_INVENTORY.tsv) — Bảng kiểm kê chi tiết toàn bộ 470 tệp trong dự án.
3. [COVERAGE.md](./COVERAGE.md) — Báo cáo độ bao phủ mã nguồn, thống kê tỷ lệ đọc và bằng chứng kiểm thử.
4. [PRODUCT.md](./PRODUCT.md) — Bản đồ sản phẩm: mục đích, người dùng mục tiêu, 10 tab chức năng, giới hạn kỹ thuật và kết quả người dùng nhận được.
5. [ARCHITECTURE.md](./ARCHITECTURE.md) — Kiến trúc tổng thể: mô hình Hybrid Electron Shell + Multi-Engine Python Orchestrator, ranh giới tiến trình, custom streaming protocol `tblao:`, cơ chế khởi tạo và dọn dẹp.

### B. Danh Mục Module & Phân Hệ Chi Tiết
6. [MODULE_CATALOG.md](./MODULE_CATALOG.md) — Danh mục tổng thể 12 phân hệ chính trong hệ thống.
7. [modules/shared.md](./modules/shared.md) — Hợp đồng dùng chung isomorphic (`src/shared/`).
8. [modules/preload.md](./modules/preload.md) — Cầu nối an toàn `contextBridge` và `TblaoApi` (`src/preload/`).
9. [modules/main-core.md](./modules/main-core.md) — Tiến trình chính Electron, quản lý cửa sổ, cookies, logger và shell (`src/main/`).
10. [modules/autoshort.md](./modules/autoshort.md) — Bộ điều phối AutoShort Pipeline, Queue Runner, Item Scope và Disk Budget (`src/main/autoShort*`).
11. [modules/dubbing.md](./modules/dubbing.md) — Phân hệ lồng tiếng, source-anchored timing, tempo ceiling, duration predictor và cache (`src/main/dubbing/`).
12. [modules/separation.md](./modules/separation.md) — Phân hệ tách thoại MDX-Net, DirectML GPU runner và auto-fallback CPU (`src/main/separation/`, `engines/separator-engine/`).
13. [modules/inpainting.md](./modules/inpainting.md) — Phân hệ xóa chữ AI bằng mạng Spatio-Temporal Transformer (`src/main/inpainting/`, `engines/sttn-engine/`).
14. [modules/ocr-vision.md](./modules/ocr-vision.md) — Phân hệ nhận diện chữ RapidOCR, Visual Timeline, và Whisper ASR (`src/main/ocr.ts`, `src/main/whisper.ts`, `engines/ocr-engine/`, `engines/whisper-engine/`).
15. [modules/subtitles-burn.md](./modules/subtitles-burn.md) — Phân hệ phụ đề ASS, đo đạc font opentype.js và Planar RGB FFmpeg burning (`src/main/burn.ts`, `src/main/fonts.ts`).
16. [modules/downloader-douyin.md](./modules/downloader-douyin.md) — Trình tải video đa nền tảng yt-dlp và crawler Douyin chuyên dụng (`src/main/ytdlp.ts`, `src/main/douyin.ts`, `engines/douyin-engine/`).
17. [modules/runtime-infra.md](./modules/runtime-infra.md) — Quản lý runtime, on-demand downloading, kiểm tra tính toàn vẹn SHA-256 (`src/main/deps.ts`, `src/main/runtimeInstaller.ts`).
18. [modules/renderer.md](./modules/renderer.md) — Giao diện người dùng React 19, các Tab chức năng, custom hooks, styles và Error Boundary (`src/renderer/`).

### C. Luồng Nghiệp Vụ Thực Tế (End-to-End Traces)
19. [flows/autoshort-e2e.md](./flows/autoshort-e2e.md) — Toàn bộ quy trình 11 bước AutoShort từ lúc bấm Start đến khi xuất thành phẩm.
20. [flows/downloader-flow.md](./flows/downloader-flow.md) — Quy trình phân tích định dạng và tải video/audio qua yt-dlp.
21. [flows/douyin-flow.md](./flows/douyin-flow.md) — Quy trình quét kênh, giải mã video và tải không watermark Douyin.
22. [flows/ocr-asr-flow.md](./flows/ocr-asr-flow.md) — Quy trình bóc băng âm thanh (Whisper) và quét chữ hình ảnh (OCR), thuật toán hợp nhất (Fusion).
23. [flows/dubbing-tts-flow.md](./flows/dubbing-tts-flow.md) — Quy trình gom nhóm ngữ nghĩa, lập kế hoạch nhịp độ, gọi TTS và ghép timeline audio.
24. [flows/separation-flow.md](./flows/separation-flow.md) — Quy trình trích xuất audio, tách Vocals/Instrumental qua MDX DirectML và fallback CPU.
25. [flows/blur-inpaint-flow.md](./flows/blur-inpaint-flow.md) — Quy trình làm mờ Planar RGB đa tầng và xóa chữ AI bằng STTN.
26. [flows/burn-subtitles-flow.md](./flows/burn-subtitles-flow.md) — Quy trình tính toán hình học font, sinh kịch bản ASS (standard/reveal/highlight) và muxing video.
27. [flows/runtime-provisioning-flow.md](./flows/runtime-provisioning-flow.md) — Quy trình kiểm tra, tải on-demand và kích hoạt sidecar engines/models.

### D. Hợp Đồng, Dữ Liệu & Vận Hành
28. [CONTRACTS.md](./CONTRACTS.md) — Đặc tả hợp đồng IPC, giao thức stdio/JSONL với sidecar, cấu trúc events và error payload.
29. [DATA_AND_STORAGE.md](./DATA_AND_STORAGE.md) — Bản đồ lưu trữ: userData, scratch scopes, checkpoints, cache TTS, model stores và disk budgets.
30. [CONFIGURATION.md](./CONFIGURATION.md) — Cấu hình hệ thống, biến môi trường, giá trị mặc định, cơ chế migration cấu hình cũ.
31. [SECURITY_AND_LICENSE.md](./SECURITY_AND_LICENSE.md) — Giấy phép PolyForm Noncommercial 1.0.0, an toàn đường dẫn (`safeContainedPath`), chống path traversal, bảo vệ API keys.
32. [DEVELOPMENT.md](./DEVELOPMENT.md) — Hướng dẫn cài đặt môi trường, quy chuẩn code, lệnh dev/test/build, hướng dẫn "Muốn sửa X thì tìm ở đâu".
33. [TESTING.md](./TESTING.md) — Hệ thống kiểm thử tự động, danh mục test suite, hướng dẫn chạy test cục bộ và khoảng trống kiểm thử.
34. [OPERATIONS_AND_TROUBLESHOOTING.md](./OPERATIONS_AND_TROUBLESHOOTING.md) — Nhật ký hệ thống, chẩn đoán sự cố, cơ chế tự phục hồi lỗi GPU/Disk/API và tạo Support Report.
35. [BUILD_AND_RELEASE.md](./BUILD_AND_RELEASE.md) — Quy trình đóng gói Electron NSIS/DMG, PyInstaller sidecar spec, ghim SHA-256 trong release manifests.
36. [GLOSSARY.md](./GLOSSARY.md) — Từ điển thuật ngữ kỹ thuật và khái niệm nghiệp vụ chuẩn hóa.
37. [GAPS_AND_DOC_DRIFT.md](./GAPS_AND_DOC_DRIFT.md) — Phân tích mâu thuẫn giữa tài liệu cũ và code thực tế, các giới hạn kỹ thuật và phần chưa xác minh.
38. [EVIDENCE.md](./EVIDENCE.md) — Bảng bằng chứng đối soát kỹ thuật (CODE_CONFIRMED, TEST_CONFIRMED, DOCUMENTED_ONLY, INFERRED).
39. [PROGRESS.md](./PROGRESS.md) — Nhật ký tiến độ và các mốc hoàn thành công việc.

### E. Bộ Sơ Đồ Archify Tương Tác
40. [diagrams/README.md](./diagrams/README.md) — Hướng dẫn tra cứu 5 sơ đồ tương tác, bảng ánh xạ node/edge vào mã nguồn và receipts:
    - **Architecture Diagram:** [diagrams/tediapros-architecture.html](./diagrams/tediapros-architecture.html)
    - **Workflow Diagram:** [diagrams/autoshort-pipeline.workflow.html](./diagrams/autoshort-pipeline.workflow.html)
    - **Sequence Diagram:** [diagrams/autoshort-execution.sequence.html](./diagrams/autoshort-execution.sequence.html)
    - **Data Flow Diagram:** [diagrams/autoshort-media.dataflow.html](./diagrams/autoshort-media.dataflow.html)
    - **Lifecycle Diagram:** [diagrams/autoshort-item.lifecycle.html](./diagrams/autoshort-item.lifecycle.html)

---

## 3. Bằng Chứng Xác Nhận Tình Trạng Kỹ Thuật Dự Án

- **Phiên bản:** `0.1.22` (xác nhận tại [package.json](file:///f:/Son/tool/TediaPros/package.json#L3)).
- **TypeScript Typecheck:** Đạt tuyệt đối 0 lỗi (`npm run typecheck` $\rightarrow$ Node + Web PASS).
- **Kiểm thử Contract & Policy:**
  - `autoshort-ocr-contract.test.ts`: 10/10 PASS.
  - `dubbing-plan.test.ts`: 16/16 PASS.
  - `separator-contract.test.ts`: 6/6 PASS.
  - `sttn-contract.test.ts`: 5/5 PASS.
