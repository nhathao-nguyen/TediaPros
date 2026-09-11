# TASK-20260911: Chỉnh hình ảnh khi xuất Auto Short

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

## 1. Mục Tiêu (Goal)

Thêm bảng điều chỉnh zoom, độ sáng, độ bão hòa và tương phản cho Auto Short, có preview trực tiếp và dùng cùng cấu hình trong lần render FFmpeg cuối.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Có nút **Chỉnh hình ảnh** và bảng bốn thông số chỉ trong Auto Short.
- [x] Preview cập nhật ngay; vùng OCR/blur theo zoom trong khi phụ đề mới giữ nguyên.
- [x] Filter chạy sau che chữ nguồn, trước phụ đề và khung 9:16.
- [x] Cấu hình cũ dùng giá trị mặc định; IPC từ chối input sai.
- [x] Typecheck, build, smoke test phụ đề, test runtime liên quan và kiểm tra renderer Electron pass.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** zoom tâm 100–120%, độ sáng -20..20, bão hòa 0–200%, tương phản 50–150%, lưu cấu hình Auto Short.
- **Nằm ngoài phạm vi:** lật hình, đổi tốc độ, hook ba giây đầu, Video Editor, tuyên bố tránh hệ thống nhận diện của nền tảng.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Ghép filter vào render cuối để không tạo MP4 trung gian.
- Mask OCR/blur chạy trước adjustment để giữ tọa độ nguồn; ASS chạy sau adjustment để phụ đề mới không bị crop hoặc đổi màu.
- Dùng helper isomorphic chung cho giới hạn và ánh xạ preview/FFmpeg.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/shared/videoAdjustments.ts`
- `[NEW]` `src/renderer/src/components/VideoAdjustmentsControl.tsx`, `VideoAdjustmentsControl.css`
- `[MODIFY]` `src/main/burn.ts`, `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `src/shared/types.ts`, `src/shared/autoShortContract.ts`
- `[MODIFY]` `src/renderer/src/components/AutoShort.tsx`, `RegionBox.tsx`, `PortraitFramePreview.tsx`
- `[TEST]` `tests/video-adjustments.test.ts`, `tests/autoshort-ocr-contract.test.ts`
- `[TEST]` `scripts/test-video-adjustments-preview.mjs`
- `[DOC]` `docs/video-adjustments.md`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

- `npm.cmd run typecheck`: PASS.
- 7 bộ test đúng phạm vi: 61 PASS, 0 FAIL, gồm filter, pixel đầu ra FFmpeg, contract, geometry, OCR burn/pipeline, portrait và UI contract.
- `npm.cmd run test:subtitles` với managed FFmpeg trong `PATH`: PASS; render ASS kiểm tra frame standard/reveal/highlight tại 2/10/24.
- `node scripts/test-video-adjustments-preview.mjs docs/reviews/2026-09-11-video-adjustments`: PASS; nhập từng ký tự lưu đúng `110`, `-5`, `103`; Escape hủy giá trị nhập dở; ở Zoom 112% khung phụ đề bám thao tác kéo 60 px; bảng không bị clip ở cửa sổ rộng 1040 px; localStorage và request render trùng nhau; nút bị khóa khi batch chạy.
- `npm.cmd run build`: PASS.
- `git diff --check`: PASS; chỉ có cảnh báo line ending ở tệp dịch đã sửa từ trước.
- Toàn bộ `npm.cmd run test:local-runtime` còn 1 lỗi ngoài phạm vi tại `release-tooling.test`: bản `electron-builder.yml` đã sửa sẵn thiếu mẫu loại trừ separator assets. Tệp này không thuộc thay đổi của chức năng.

Test media dùng managed FFmpeg cục bộ và xác nhận crop tâm bằng pixel đầu ra. Ảnh và JSON kiểm chứng renderer nằm tại `docs/reviews/2026-09-11-video-adjustments/`.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Đánh giá màu cuối cùng nên dựa trên video xuất. Preview dùng CSS và chỉ nhằm phản ánh hướng/mức điều chỉnh gần đúng.

Review sau triển khai phát hiện ba lỗi P2 ở ô số, phép kéo phụ đề và bảng bị clip. Cả ba đã được sửa; chi tiết trước/sau nằm tại `.ai/tasks/TASK-20260911-autoshort-video-adjustments-review.md`.
