# TASK-20260912-AUTOSHORT-OVERLAYS: Ảnh/chữ cố định trong AutoShort

- **Trạng thái:** Đã kiểm chứng source/build, media fixture và UI component.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.

## 1. Mục Tiêu

Thêm một ảnh hoặc chữ, hoặc cả hai, chạy xuyên suốt video AutoShort và áp dụng chung cho batch, để tránh bước chèn thủ công sau khi xuất.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Nút Ảnh / Chữ trong AutoShort, chọn PNG/JPG, nhập chữ, chỉnh vị trí/kích thước/độ đậm và màu chữ; xem ngay thay đổi.
- [x] Lưu lựa chọn trên máy, bỏ từng lớp hoặc toàn bộ, khóa điều khiển trong lúc chạy.
- [x] Chèn ảnh/chữ lên toàn khung cuối, gồm nền 9:16, từ đầu tới hết video; giữ audio/thời lượng.
- [x] Validation typed, checksum ảnh, containment, legacy config không thêm field rỗng.
- [x] Dọn scratch và giữ cancellation hiện có.
- [x] `npm.cmd run typecheck`, media tests, UI component smoke và build pass.
- [x] Tài liệu sử dụng và kiến trúc được cập nhật.

## 3. Phạm Vi Triển Khai

AutoShort: một PNG/JPG + một dòng chữ cố định. Không triển khai template CapCut, nhiều lớp/timeline, chữ riêng theo video, Video Editor hoặc đóng gói cập nhật WinLocal.

## 4. Quyết Định Kiến Trúc

- Overlay là execution option main-only cho `burnAutoShort`; config public ở `AutoShortConfig`. Không mở rộng BurnReq/Video Editor IPC ngoài scope.
- Tọa độ 0..1 là vị trí trong khoảng trống còn lại trên canvas cuối. Điều này cho phép logo đặt sát mép mà không ra khỏi hình, đồng thời dùng được trên phần nền portrait.
- Ảnh được fingerprint khi chọn, kiểm tra preflight và chụp bytes vào scratch trước render, giúp phát hiện thay đổi khi batch/resume.
- Ghép sau source blur/zoom/color/subtitle/portrait trong filter graph đang render; không có bước re-encode hậu kỳ riêng.
- Đã tái hiện và sửa sai khác cỡ font CSS/ASS bằng OS/2 Win metrics; kiểm thử pixel độ rộng font và sát mép phải ngăn tái phát.

## 5. Tệp Thay Đổi

- Mới: `src/shared/autoShortOverlays.ts`, `src/main/autoShortOverlays.ts`.
- Mới: `AutoShortOverlayControl.tsx`, CSS và `AutoShortOverlayPreview.tsx` trong renderer components.
- Nối UI: `AutoShort.tsx`, `PortraitFramePreview.tsx`, renderer CSP.
- Nối main/IPC: `index.ts`, `autoshort.ts`, `autoShortItemCoordinator.ts`, `burn.ts`, preload/index.ts.
- Contract: `types.ts`, `autoShortContract.ts`.
- Kiểm thử: `tests/autoshort-overlays.test.ts`, runner registration, `scripts/smoke-autoshort-overlays-ui.mjs`.
- Tài liệu: `docs/autoshort-overlays.md`, `docs/architecture.md`, task record này.

## 6. Kiểm Chứng Và Bằng Chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-overlays.test
node scripts/run-local-runtime-tests.mjs autoshort-ocr-contract.test autoshort-ocr-burn.test autoshort-ocr-pipeline.test portrait-blur.test video-adjustments.test autoshort-ui-contract.test autoshort-batch-resume.test autoshort-item-scope.test ipc-origin-validation.test
node scripts/smoke-autoshort-overlays-ui.mjs
npm.cmd run build
git diff --check
```

- Typecheck: PASS.
- Overlay tests: 11/11 PASS, 0 skipped; FFmpeg thực trên Windows.
- Các suite liên quan: 69/69 PASS, 0 skipped. Tổng 80 tests.
- UI smoke: PASS chọn fixture ảnh dưới CSP thực, font tự động, bật/tắt chữ, xóa ảnh, containment, khóa khi đang chạy.
- Production build: PASS. Vite có cảnh báo dynamic/static import đã tồn tại ở module khác.
- Đã xem trực tiếp [ảnh UI fixture](2026-09-12-autoshort-overlays/overlay-ui.png), [khung hình xuất](2026-09-12-autoshort-overlays/overlay-first-frame.png); [video smoke](2026-09-12-autoshort-overlays/overlay-smoke.mp4).

### Giới hạn bằng chứng

Chưa chạy batch OCR/ASR/TTS live với media người dùng và chưa cập nhật bản WinLocal đã cài. Smoke UI dùng phiên Electron riêng cùng component thật; IPC chọn ảnh/font nhận fixture, không phải thao tác dialog trong phiên ứng dụng đang dùng. Reviewer subagent bị lỗi capacity trước khi hoàn tất; đã tiếp nhận cảnh báo font, xác minh và sửa bằng kiểm thử media, nhưng không ghi nhận review độc lập là hoàn tất.

## 7. Bàn Giao

Mở bản build/dev mới, vào AutoShort → Ảnh / Chữ. Ảnh gốc phải còn ở vị trí đã chọn và giữ nguyên nội dung; đổi hoặc di chuyển ảnh cần chọn lại. Các thay đổi temporal-cut và công việc khác có sẵn trong checkout được giữ nguyên; không commit/reset/rebase hoặc ghi đè chúng trong task này.
