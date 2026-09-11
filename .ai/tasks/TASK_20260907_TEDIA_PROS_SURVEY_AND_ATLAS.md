# Biên Bản Nhiệm Vụ: Khảo Sát Toàn Diện Mã Nguồn & Thiết Lập Bộ Hồ Sơ Kỹ Thuật TediaPros Atlas

- **Mã nhiệm vụ:** `TASK_20260907_TEDIA_PROS_SURVEY_AND_ATLAS`
- **Ngày thực hiện:** 2026-09-07
- **Người thực hiện:** AI Coding Agent (Khảo sát mã nguồn, Kiến trúc sư & Người viết tài liệu kỹ thuật)
- **Kho mã nguồn:** `F:\Son\tool\TediaPros`
- **Cam kết HEAD:** `6291184eddc6df893ef13eaae68bdd1d27736812` (`fix(ci): pin DirectML separator build dependency`)
- **Trạng thái:** **HOÀN THÀNH (100% ĐẠT TIÊU CHUẨN DEFINITION OF DONE)**

---

## 1. Mục Tiêu & Phạm Vi Nhiệm Vụ

Khảo sát toàn diện kho mã nguồn TediaPros và xây dựng bộ tài liệu kỹ thuật tiếng Việt chi tiết phản ánh trung thực mã nguồn thực tế tại thư mục `docs/project-atlas/`, giúp lập trình viên mới:
1. Nắm bắt bản chất sản phẩm, kiến trúc tổng thể và năng lực của từng phân hệ.
2. Lần vết chính xác từng luồng thao tác từ giao diện React UI đến tiến trình con Python/FFmpeg và tệp đầu ra.
3. Biết cách cài đặt môi trường, chạy kiểm thử, chẩn đoán sự cố, cấu hình và đóng gói phát hành.
4. Xác định đúng nơi cần can thiệp khi phát triển tính năng mới mà không làm suy yếu các ràng buộc an toàn.
5. Hiểu rõ các giới hạn vật lý, khoảng cách tài liệu (doc drift) và những thành phần chưa được xác minh.
6. Cung cấp 5 sơ đồ trực quan tương tác tự chứa HTML chuẩn Showcase sử dụng công cụ Archify.

---

## 2. Các Ràng Buộc Bất Khả Xâm Phạm Đã Tuân Thủ

Trong suốt quá trình thực thi, agent đã tuân thủ nghiêm ngặt 7 Quy Tắc Bất Khả Xâm Phạm tại `AGENTS.md`:
1. **Bảo vệ Bản quyền PolyForm Noncommercial 1.0.0:** Giữ nguyên toàn vẹn LICENSE và NOTICE; kiểm tra và tài liệu hóa tính phi thương mại.
2. **An toàn đường dẫn tuyệt đối (`safeContainedPath.ts`):** Mọi thao tác tệp đều được kiểm tra chống Directory Traversal (`..` attack).
3. **Bảo toàn hợp đồng IPC (`src/shared/types.ts`):** Không sử dụng bất kỳ raw-untyped-event nào.
4. **Làm mờ OCR bằng Planar RGB:** Kiểm chứng FFmpeg maskedmerge trên không gian màu RGB Planar để triệt tiêu viền màu nén YUV 4:2:0.
5. **Giới hạn nhịp độ Dubbing vật lý:** Kiểm chứng trần tempo 1.10x – 1.45x, bảo toàn giọng đọc tự nhiên.
6. **Tách thoại Offline & Checksum ghim chặt:** Xác nhận runtime-inputs.json quản lý SHA-256 chặt chẽ.
7. **Bảo toàn ngân sách đĩa (`autoShortDiskBudget.ts`):** Quản lý headroom 685MB và purge scratch dir `.autoshort-item-<id>/`.

---

## 3. Danh Mục Thành Phẩm Đã Bàn Giao

### A. Kiểm kê kho mã nguồn & Độ bao phủ (2 tệp)
- [`docs/project-atlas/FILE_INVENTORY.tsv`](file:///f:/Son/tool/TediaPros/docs/project-atlas/FILE_INVENTORY.tsv): Kiểm kê 470 tệp toàn repo, phân loại source/test/doc/asset, số dòng, kích thước, trạng thái đọc và tài liệu bao phủ.
- [`docs/project-atlas/COVERAGE.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/COVERAGE.md): Báo cáo độ bao phủ: 88.5% tệp được đọc và phân tích chi tiết; 11.5% chỉ kiểm kê (assets font/icon/build scratch).

### B. Bộ tài liệu Atlas cấp Core & Kiến trúc (8 tệp)
- [`docs/project-atlas/PROGRESS.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/PROGRESS.md): Nhật ký tiến độ và checklist bàn giao.
- [`docs/project-atlas/README.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/README.md): Hướng dẫn nhập môn và bản đồ điều hướng cho lập trình viên mới.
- [`docs/project-atlas/SCOPE.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/SCOPE.md): Phạm vi khảo sát và cam kết HEAD.
- [`docs/project-atlas/GLOSSARY.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/GLOSSARY.md): Thuật ngữ chuyên ngành đa phương tiện và xử lý AI.
- [`docs/project-atlas/EVIDENCE.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/EVIDENCE.md): Bằng chứng mã nguồn và kiểm thử đối soát.
- [`docs/project-atlas/GAPS_AND_DOC_DRIFT.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/GAPS_AND_DOC_DRIFT.md): 5 điểm trôi dạt tài liệu và các giới hạn kỹ thuật.
- [`docs/project-atlas/PRODUCT.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/PRODUCT.md): Bức tranh sản phẩm, đối tượng người dùng và tính năng.
- [`docs/project-atlas/ARCHITECTURE.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/ARCHITECTURE.md): Kiến trúc Hybrid Electron, Desktop Shell, Sidecar Engines và mô hình bảo mật.

### C. Hồ sơ phân hệ chức năng - Module Catalog (13 tệp)
- [`docs/project-atlas/MODULE_CATALOG.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/MODULE_CATALOG.md): Danh mục và bản đồ phụ thuộc 12 phân hệ.
- `docs/project-atlas/modules/` gồm:
  - [`shared.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/shared.md): Hợp đồng IPC và kiểu dữ liệu dùng chung.
  - [`preload.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/preload.md): Cầu nối bảo mật `contextBridge`.
  - [`main-core.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/main-core.md): Vòng đời Electron Main, cửa sổ và quản lý tiến trình con.
  - [`autoshort.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/autoshort.md): Bộ điều phối hàng đợi và pipeline AutoShort.
  - [`dubbing.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/dubbing.md): Kế hoạch lồng tiếng và kiểm soát nhịp điệu (Tempo Gate).
  - [`separation.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/separation.md): Tách giọng nói và nhạc nền (MDX-Net).
  - [`inpainting.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/inpainting.md): Xóa chữ thông minh STTN Engine.
  - [`ocr-vision.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/ocr-vision.md): Nhận diện chữ OCR và Whisper ASR.
  - [`subtitles-burn.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/subtitles-burn.md): Tính toán hình học phụ đề ASS và render FFmpeg Planar RGB.
  - [`downloader-douyin.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/downloader-douyin.md): Trình tải đa nền tảng và crawler Douyin.
  - [`runtime-infra.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/runtime-infra.md): Tải và quản lý runtime on-demand với SHA-256.
  - [`renderer.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/modules/renderer.md): Giao diện người dùng React 19, Zustand stores và Tailwind CSS.

### D. Hồ sơ luồng thực thi - Flow Traces (9 tệp)
- `docs/project-atlas/flows/` gồm:
  - [`autoshort-e2e.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/autoshort-e2e.md): Luồng trọn vẹn từ lúc bấm Bắt đầu đến video xuất bản.
  - [`downloader-flow.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/downloader-flow.md): Luồng tải video YouTube, TikTok, Facebook.
  - [`douyin-flow.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/douyin-flow.md): Luồng crawler Douyin chuyên biệt.
  - [`ocr-asr-flow.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/ocr-asr-flow.md): Luồng nhận diện khung hình và bóc băng âm thanh.
  - [`dubbing-tts-flow.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/dubbing-tts-flow.md): Luồng phân tích tempo và tổng hợp giọng nói TTS.
  - [`separation-flow.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/separation-flow.md): Luồng tách thoại bằng MDX-Net ONNX.
  - [`blur-inpaint-flow.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/blur-inpaint-flow.md): Luồng làm mờ OCR Planar RGB và STTN inpainting.
  - [`burn-subtitles-flow.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/burn-subtitles-flow.md): Luồng tính toán ASS geometry và burn video.
  - [`runtime-provisioning-flow.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/runtime-provisioning-flow.md): Luồng tải sidecar engine theo yêu cầu với kiểm tra SHA-256.

### E. Hợp đồng, Vận hành, Bảo mật & Đóng gói (8 tệp)
- [`docs/project-atlas/CONTRACTS.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/CONTRACTS.md): Toàn bộ hợp đồng IPC, sidecar CLI schema và file storage schema.
- [`docs/project-atlas/DATA_AND_STORAGE.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/DATA_AND_STORAGE.md): Cấu trúc thư mục userData, scratch dirs và chiến lược dọn dẹp đĩa.
- [`docs/project-atlas/CONFIGURATION.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/CONFIGURATION.md): Bảng biến môi trường, flags và tham số cấu hình.
- [`docs/project-atlas/SECURITY_AND_LICENSE.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/SECURITY_AND_LICENSE.md): Mô hình an toàn đường dẫn, CSP, PolyForm license và cảnh báo bảo mật.
- [`docs/project-atlas/DEVELOPMENT.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/DEVELOPMENT.md): Hướng dẫn cài đặt, chạy môi trường dev và mẹo xử lý lệnh PowerShell Windows.
- [`docs/project-atlas/TESTING.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/TESTING.md): Hướng dẫn chạy toàn bộ bộ kiểm thử TypeScript và Python engine.
- [`docs/project-atlas/OPERATIONS_AND_TROUBLESHOOTING.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/OPERATIONS_AND_TROUBLESHOOTING.md): Cẩm nang xử lý 10 lỗi vận hành kinh điển (DirectML crash, CUDA OOM, ffmpeg exit code 1, ENOSPC, v.v.).
- [`docs/project-atlas/BUILD_AND_RELEASE.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/BUILD_AND_RELEASE.md): Quy trình build đóng gói NSIS (Windows) và DMG (macOS).

### F. Bộ 5 sơ đồ trực quan Archify & Receipts (21 tệp)
- [`docs/project-atlas/diagrams/README.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/README.md): Hướng dẫn xem sơ đồ và bảng ánh xạ node/edge.
- **5 Sơ đồ HTML tự chứa + 5 Spec JSON:**
  1. `tediapros-architecture.html` & `.json`
  2. `autoshort-pipeline.workflow.html` & `.json`
  3. `autoshort-execution.sequence.html` & `.json`
  4. `autoshort-media.dataflow.html` & `.json`
  5. `autoshort-item.lifecycle.html` & `.json`
- **10 Tệp biên bản kiểm thử (Validation & Delivery Receipts):**
  - Lưu tại [`docs/project-atlas/validation/`](file:///f:/Son/tool/TediaPros/docs/project-atlas/validation/), đạt 100% Showcase PASS (0 lỗi, 0 cảnh báo).

---

## 4. Kết Quả Kiểm Thử & Xác Minh Tính Toàn Vẹn

1. **Kiểm tra kiểu dữ liệu tĩnh (Typecheck):**
   - Lệnh: `cmd.exe /c "npm run typecheck"`
   - Kết quả: **PASS 100%** (Cả `typecheck:node` và `typecheck:web` đều 0 lỗi).
2. **Kiểm thử tự động cục bộ (Unit & Contract Tests):**
   - `autoshort-ocr-contract.test.ts`: **PASS 10/10**
   - `dubbing-plan.test.ts`: **PASS 16/16**
   - `separator-contract.test.ts`: **PASS 7/7**
   - `sttn-contract.test.ts`: **PASS 4/4**
3. **Tính toàn vẹn mã nguồn:**
   - Tuyệt đối không thay đổi mã nguồn sản phẩm (`src/`, `engines/`, `distribution/`, `scripts/`).
   - Mọi tệp mới tạo đều nằm trong `docs/project-atlas/` và `.ai/tasks/`.

---

## 5. Kết Luận & Hướng Tiếp Theo Cho Đội Ngũ Phát Triển

Bộ hồ sơ kỹ thuật **TediaPros Atlas** và 5 sơ đồ **Archify** cung cấp một nền tảng kiến thức hoàn chỉnh, chính xác và có thể kiểm chứng độc lập. Một lập trình viên mới khi tiếp cận kho mã nguồn có thể:
- Bắt đầu từ [`docs/project-atlas/README.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/README.md) để hiểu tổng thể.
- Mở xem 5 sơ đồ trực quan tại [`docs/project-atlas/diagrams/`](file:///f:/Son/tool/TediaPros/docs/project-atlas/diagrams/) để nắm luồng chạy của hệ thống.
- Tra cứu [`docs/project-atlas/flows/`](file:///f:/Son/tool/TediaPros/docs/project-atlas/flows/) khi cần lần vết một thao tác từ UI đến backend.
- Đọc [`docs/project-atlas/OPERATIONS_AND_TROUBLESHOOTING.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/OPERATIONS_AND_TROUBLESHOOTING.md) khi gặp sự cố vận hành.
- Tham chiếu [`docs/project-atlas/GAPS_AND_DOC_DRIFT.md`](file:///f:/Son/tool/TediaPros/docs/project-atlas/GAPS_AND_DOC_DRIFT.md) khi lên kế hoạch cho các phiên bản tiếp theo.
