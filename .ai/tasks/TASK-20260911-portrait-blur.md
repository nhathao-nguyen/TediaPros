# TASK-20260911-portrait-blur: Nút 9:16 nền mờ cho preview và video xuất

- **Trạng thái:** Đã kiểm chứng local
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10 → 2026-09-11

## 1. Mục Tiêu (Goal)

Theo yêu cầu mới của người dùng, thêm một nút đổi khung 9:16 cho preview và xuất video, giữ đủ hình gốc và lấp khoảng trống bằng nền video làm mờ. Yêu cầu lần này cho phép triển khai mới sau bản ghi hoàn tác TASK-20260910-revert-portrait-blur; không sửa lịch sử bản ghi cũ.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Nút bật/tắt trên Auto Short và Video Editor, lưu riêng từng màn hình, mặc định tắt.
- [x] Preview đặt hình chính trong 9:16, nền đồng bộ tua/play/pause/rate; cỡ chữ theo tỷ lệ hình chính.
- [x] Bản xuất 1080×1920, SAR 1:1, giữ nội dung, âm thanh, số frame và thời lượng trong fixture thực.
- [x] Cấu hình cũ tương thích; trường sai kiểu bị từ chối.
- [x] Typecheck và build thành công.
- [x] 51 tests liên quan đạt, không fail, không skip trên máy này; acceptance Electron hai màn hình đạt.
- [x] Tài liệu chức năng và bằng chứng được lưu.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

Thuộc phạm vi: tùy chọn framing, contract, coordinator→burn, FFmpeg manual/OCR, preview và font preview khi thu nhỏ. Giữ nguyên các thay đổi dịch/TTS/Gemini/SEO đã có trong workspace. Không commit, merge, phát hành installer, chỉnh video nguồn hoặc cập nhật profile ứng dụng người dùng.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Chia sẻ hàm hình học thuần giữa renderer và main; giữ mọi vùng chọn trong tọa độ nguồn để tránh lệch OCR/phụ đề.
- Phụ đề mới chỉ nằm trên hình chính; nền lấy trước ASS để tránh bản sao chữ phóng lớn.
- Canvas preview lấy frame từ video hiện tại thay vì dùng player thứ hai; không phát trùng audio, không tạo clock phụ.
- Chế độ portrait bỏ floor font preview 12px và scale padding/radius/outline theo video. Kiểm thử đã tái hiện lỗi 12px so với 9.15px kỳ vọng trước khi sửa.
- CSS mới nằm riêng cạnh component để không tạo diff toàn bộ `editor.css` vốn có xuống dòng hỗn hợp.
- Review độc lập đã báo hai vấn đề: media tests phụ thuộc đường dẫn FFmpeg Windows và font preview floor. Cả hai đã sửa/kiểm chứng. Reviewer bị giới hạn usage trước khi kết thúc toàn bộ review; không coi đây là review hoàn chỉnh.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/shared/portraitFrame.ts`, `src/main/portraitFrame.ts`.
- `[NEW]` `src/renderer/src/components/PortraitFramePreview.tsx`, `PortraitFramePreview.css`.
- `[MODIFY]` `src/shared/types.ts`, `src/shared/autoShortContract.ts`, `src/main/burn.ts`, `src/main/autoShortItemCoordinator.ts`.
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`, `VideoEditor.tsx`, `RegionBox.tsx`.
- `[NEW]` `tests/portrait-blur.test.ts`, `scripts/test-portrait-preview.mjs`.
- `[MODIFY]` `tests/autoshort-ocr-contract.test.ts`, `scripts/run-local-runtime-tests.mjs`.
- `[NEW]` `docs/portrait-blur.md`, `docs/reviews/2026-09-10-portrait-blur/*`, bản bàn giao này.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Lệnh thực tế và phạm vi xem [docs/portrait-blur.md](../../docs/portrait-blur.md). Log/JSON/PNG nằm tại `docs/reviews/2026-09-10-portrait-blur/`.

- `npm.cmd run typecheck`: PASS main và renderer.
- `npm.cmd run build`: PASS; có các cảnh báo dynamic/static imports hiện hữu.
- Sáu suites runtime: 5 + 12 + 8 + 10 + 12 + 4 = **51 PASS**, 0 FAIL, 0 SKIP.
- Video FFmpeg thực: kiểm tra RGB hình chính/nền, automatic mask trước composition, manual blur + ASS, portrait-only qua validation và `burnAutoShort`, MP4 đúng kích thước/SAR/audio/frame count.
- Electron acceptance: actual AutoShort và VideoEditor components, dữ liệu/media tổng hợp và IPC giả lập. Kiểm tra kích thước, không remount video khi toggle, giữ playhead, seek, play/pause ở 1.5x, resize, font preview và payload xuất của Editor.
- `git diff --check`: PASS; chỉ có cảnh báo EOL ở test translation có trước task.
- Subtitle smoke: lần đầu logic PASS nhưng render SKIP do FFmpeg không ở PATH; đã chạy lại với runtime quản lý trong PATH của process, kết quả ghi tại `subtitles.log`.

Giới hạn: chưa chạy batch thực của người dùng, chưa test macOS hoặc installer mới; preview nền dùng CSS blur nên không cam kết pixel-identical với FFmpeg. Không coi các log encoder GPU thử thất bại là lỗi output nếu fallback đã xuất và probe thành công.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Mở bản dev/build mới, nạp video và bật **9:16 · Nền mờ** trên preview. Cấu hình Auto Short dùng chung cho batch tiếp theo. Bản cài đang mở không được tự thay thế bởi task này. Khi commit, chỉ stage phần task vì repo có nhiều công việc chưa commit từ trước.
