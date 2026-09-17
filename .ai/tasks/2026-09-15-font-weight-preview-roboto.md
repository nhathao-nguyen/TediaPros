# TASK-20260915: Bổ Sung Font Roboto, Chức Năng Chỉnh Font Weight & Live Preview

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Antigravity Agent
- **Thời gian:** 2026-09-15

---

## 1. Mục Tiêu (Goal)

1. Tích hợp font **Roboto** vào bộ font đóng gói của TediaPros tương tự như Noto Sans (giấy phép OFL-1.1, commit SHA ghim chặt, hỗ trợ đầy đủ tiếng Việt).
2. Thêm chức năng tùy chỉnh **Độ đậm chữ (Font Weight)** từ 300 (Light) đến 900 (Black).
3. Hỗ trợ **Xem trước trực quan (Live Preview)** tức thì trên khung video trong cả Video Editor và AutoShort, đồng bộ hóa giữa đo đạc canvas và tệp phụ đề ASS xuất ra bằng FFmpeg libass.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Font Roboto được thêm vào `manifest.json`, `catalog.json` và `NOTICES.md`, tải về và kiểm tra hợp lệ với SHA-256.
- [x] Bộ chọn độ đậm chữ (Font Weight) hiển thị rõ ràng trên UI của Video Editor và AutoShort.
- [x] Live Preview cập nhật độ đậm trực tiếp khi thay đổi, kích thước và ngắt dòng Canvas đo đạc chính xác theo font weight.
- [x] `taoAss` tạo đúng mã `Bold` cho cả `Style: D` và `Style: Box`.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Bộ test phụ đề (`npm run test:subtitles`) và runtime test (`npm run test:local-runtime`) pass 100%.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Tải & kiểm chứng font Roboto (`resources/fonts/*`).
  - Cập nhật hợp đồng IPC và kiểu dữ liệu (`src/shared/types.ts`, `src/shared/autoShortContract.ts`).
  - Sinh phụ đề ASS theo font weight (`src/main/burn.ts`).
  - IPC layout & đo glyph (`src/main/subtitlePlanner.ts`, `src/main/fontMeasure.ts`, `src/main/index.ts`).
  - Renderer UI & Live Preview (`src/renderer/src/components/RegionBox.tsx`, `VideoEditor.tsx`, `AutoShort.tsx`, `AutoShortOverlayPreview.tsx`).
  - Subtitle smoke tests (`scripts/smoke-subtitles.ts`).
- **Nằm ngoài phạm vi (Out of Scope):**
  - Thay đổi thuật toán nhận diện ngôn ngữ tự động (mặc định cho Latin vẫn là Noto Sans nếu chọn chế độ "Tự động theo nội dung").

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *FontFace range descriptor:* Cung cấp `{ weight: '100 900' }` khi khởi tạo `FontFace` để trình duyệt nhận diện font TTF variable và áp dụng trục `wght` tự nhiên, tránh hiện tượng faux-bold của Chromium.
- *Quy chuẩn ASS Bold:* Giá trị 400 ánh xạ thành `0` (Normal), 700 ánh xạ thành `-1` (Bold chuẩn ASS), các giá trị khác (300, 500, 600, 800, 900) được truyền dưới dạng số nguyên cho Libass/FreeType.
- *Đồng bộ Style Box & D:* Cả `Style: D` (chữ) và `Style: Box` (hộp nền) đều nhận chung giá trị `Bold` để kích thước hộp nền khớp tuyệt đối với chiều rộng chữ in đậm.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [resources/fonts/manifest.json](file:///f:/Son/tool/TediaPros/resources/fonts/manifest.json)
- `[MODIFY]` [resources/fonts/licenses/NOTICES.md](file:///f:/Son/tool/TediaPros/resources/fonts/licenses/NOTICES.md)
- `[MODIFY]` [resources/fonts/catalog.json](file:///f:/Son/tool/TediaPros/resources/fonts/catalog.json)
- `[MODIFY]` [src/shared/types.ts](file:///f:/Son/tool/TediaPros/src/shared/types.ts)
- `[MODIFY]` [src/shared/autoShortContract.ts](file:///f:/Son/tool/TediaPros/src/shared/autoShortContract.ts)
- `[MODIFY]` [src/main/burn.ts](file:///f:/Son/tool/TediaPros/src/main/burn.ts)
- `[MODIFY]` [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts)
- `[MODIFY]` [src/main/fontMeasure.ts](file:///f:/Son/tool/TediaPros/src/main/fontMeasure.ts)
- `[MODIFY]` [src/main/subtitlePlanner.ts](file:///f:/Son/tool/TediaPros/src/main/subtitlePlanner.ts)
- `[MODIFY]` [src/main/index.ts](file:///f:/Son/tool/TediaPros/src/main/index.ts)
- `[MODIFY]` [src/renderer/src/components/RegionBox.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/RegionBox.tsx)
- `[MODIFY]` [src/renderer/src/components/VideoEditor.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/VideoEditor.tsx)
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx)
- `[MODIFY]` [src/renderer/src/components/AutoShortOverlayPreview.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShortOverlayPreview.tsx)
- `[MODIFY]` [scripts/smoke-subtitles.ts](file:///f:/Son/tool/TediaPros/scripts/smoke-subtitles.ts)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run fonts:prepare"
cmd.exe /c "npm run fonts:verify"
cmd.exe /c "npm run typecheck"
cmd.exe /c "npm run test:subtitles"
cmd.exe /c "npm run test:local-runtime"
```

### Kết quả thực tế:
- `fonts:prepare` & `fonts:verify`: PASS (5 bundled fonts, 13.37 MiB, SHA-256 đối soát chính xác).
- `Typecheck`: PASS (0 errors trên cả `typecheck:node` và `typecheck:web`).
- `test:subtitles`: PASS (xác thực `taoAss` cho Roboto với Bold -1, SemiBold 600, Normal 0).
- `test:local-runtime`: PASS (toàn bộ local runtime suites pass).
