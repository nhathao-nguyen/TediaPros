# TASK-20260928: Hiệu ứng nhiễu hạt, bụi phim và analog trong AutoShort

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-28

## 1. Mục Tiêu (Goal)

Người dùng yêu cầu lớp phủ giống CapCut và xác nhận ưu tiên nhóm noise/bụi phim/analog trong ảnh tham chiếu. Thêm hiệu ứng có thể bật, chỉnh cường độ và ghép nhiều lớp trong AutoShort.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Có ba preset với cường độ riêng, thứ tự, bật/tắt/gỡ; lưu cấu hình local và áp dụng batch.
- [x] Preview minh họa đồng bộ theo thời gian video, có thông báo về độ chính xác so với export.
- [x] Config typed và kiểm tra IPC, không ảnh hưởng config cũ khi không bật hiệu ứng.
- [x] FFmpeg render trong graph hiện có, giữ audio/frame count/thời lượng, hỗ trợ manual blur/OCR/9:16/branding.
- [x] Typecheck, 54 test liên quan, smoke UI và build pass.
- [x] Tài liệu cập nhật.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** AutoShort, ba kiểu tự sinh offline, tối đa ba lớp khác kiểu, toàn thời lượng đầu ra, mức 1–100% trên UI. Contract chấp nhận 0% như no-op.
- **Ngoài phạm vi:** nhập preset/tài nguyên CapCut, video texture ngoài, keyframe/timeline từng đoạn, Video Editor, đóng gói/cài đè app đang cài.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Dùng `videoEffects` riêng với normalization dùng chung; không gộp state hiệu ứng vào ảnh/chữ để thao tác xóa ảnh/chữ không xóa nhầm hiệu ứng.
- Ghép sau phụ đề/khung chân dung và trước ảnh/chữ cố định. OCR vẫn thực hiện `maskedmerge` bằng planar RGB trước hiệu ứng.
- Grain/analog dùng noise và filter chuẩn; bụi dùng texture luma kích thước nhỏ rồi scale/blend, không ghi media scratch hay thêm nguồn vô hạn. Mọi nhánh giữ PTS và EOF video gốc.
- Renderer dùng canvas nhẹ với `requestVideoFrameCallback`, giải phóng callback/listener khi unmount/chuyển nguồn. Preview được mô tả rõ là gần đúng.
- Sửa finish path của manual blur để luôn áp dụng lớp phủ/hiệu ứng, kể cả khi không có ASS/portrait/color adjustment.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/shared/videoEffects.ts`, `src/main/videoEffects.ts`.
- `[NEW]` `src/renderer/src/components/VideoEffectsControl.tsx`, `VideoEffectsControl.css`, `VideoEffectsPreview.tsx`.
- `[MODIFY]` `src/shared/types.ts`, `src/shared/autoShortContract.ts`, `src/main/autoShortItemCoordinator.ts`, `src/main/burn.ts`, `src/renderer/src/components/AutoShort.tsx` — chỉ phần nối tính năng này.
- `[NEW]` `tests/video-effects.test.ts`, `scripts/smoke-video-effects-ui.mjs`.
- `[MODIFY]` `scripts/run-local-runtime-tests.mjs`, `tests/autoshort-ocr-pipeline.test.ts` — đăng ký suite, kiểm tra chuyển cấu hình đến burn; test coordinator thật hỗ trợ `TEDIAPROS_TEST_FFMPEG` và báo skip đúng nếu thiếu fixture.
- `[NEW]` `docs/autoshort-video-effects.md`; `[MODIFY]` `docs/architecture.md`.
- `[NEW]` `.ai/tasks/2026-09-28-video-effects/` — ảnh smoke UI và log kiểm chứng.

Repo có nhiều thay đổi chưa commit từ trước và thay đổi ngoài phạm vi xuất hiện trong lúc thực hiện. Không reset, stash, stage hay commit các thay đổi này.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
$env:TEDIAPROS_TEST_FFMPEG = Join-Path $env:APPDATA 'tedia-pros\bin\ffmpeg.exe'
node scripts/run-local-runtime-tests.mjs video-effects.test autoshort-overlays.test autoshort-ocr-burn.test video-adjustments.test portrait-blur.test autoshort-ocr-pipeline.test
node scripts/smoke-video-effects-ui.mjs
npm.cmd run typecheck
npm.cmd run build
```

- **TEST_CONFIRMED:** 54/54 test pass, 0 fail, 0 skip ở lượt cuối: effects 7, overlays 11, OCR burn 10, adjustments 9, portrait 5, OCR pipeline 12. Có FFmpeg thật cho hiệu ứng và coordinator/mask/burn integration.
- **TEST_CONFIRMED:** kiểm tra từng kiểu thực sự đổi pixel, chuyển động đầu/cuối, cùng seed cho kết quả xác định; stacked render bảo toàn 12 frame/1 giây/audio/kích thước; effects-only render thành công; scratch sạch, hủy không publish.
- **TEST_CONFIRMED:** OCR + 9:16 render có hiệu ứng chuyển động trên padding; branding đỏ vẫn nằm trên hiệu ứng.
- **TEST_CONFIRMED:** UI smoke chọn nhiều lớp, cường độ, đổi thứ tự, có pixel preview, panel không tràn, gỡ/tắt, khóa khi chạy. Ảnh `effects-ui.png` đã được xem trực tiếp.
- **TEST_CONFIRMED:** typecheck và build pass. Build có các warning dynamic/static import hiện hữu, không lỗi build.
- **CODE_CONFIRMED:** cấu hình được chuẩn hóa ở IPC và chuyển xuyên coordinator đến render; không thêm vòng encode thứ hai.
- **Chưa kiểm tra:** installer/app đã cài, video thực của người dùng, batch dịch/TTS live, benchmark hiệu năng video dài/4K và macOS.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Tính năng nằm trong source và build local hiện tại: **AutoShort → Hiệu ứng**. Chưa cập nhật bản cài ngoài workspace. Preview canvas và output FFmpeg khác thuật toán; không khẳng định giống từng pixel hoặc tái tạo chính xác preset CapCut.

Tài liệu người dùng: [autoshort-video-effects.md](../../docs/autoshort-video-effects.md).
