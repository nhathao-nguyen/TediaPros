# TASK-20260912-AUTOSHORT-TEMPORAL-CUT-IMPLEMENTATION: Core MVP cắt đoạn trong AutoShort

- **Trạng thái:** Đã kiểm chứng phạm vi MVP.
- **Người thực hiện:** Codex.
- **Thời gian:** 2026-09-12.

## 1. Mục Tiêu

Cho phép mỗi video AutoShort bỏ đầu, cuối hoặc nhiều khoảng theo thời gian trước khi OCR, ASR, dịch, TTS, STTN, tách thoại và render; giữ nguồn bất biến và giữ bản cắt qua batch resume.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Contract typed dùng khoảng half-open theo microsecond; reject payload sai, out-of-range và xóa toàn bộ.
- [x] UI Cắt đoạn nằm trong AutoShort, theo từng video; có đặt đầu/cuối, bỏ trước/sau và khôi phục một/toàn bộ.
- [x] FFmpeg cắt đồng bộ hình/tiếng, nối mọi phần giữ và probe lại metadata đầu ra.
- [x] Edited master được dùng trước OCR/ASR/STTN/separation/audio/render; no-edit không encode thêm.
- [x] Bản cắt tham gia checkpoint/config digest và lưu trong journal để resume đúng revision.
- [x] Typecheck và các test liên quan pass.

## 3. Phạm Vi

- **Đã làm:** ripple-delete theo timestamp; canonical ranges; source-to-edited map; UI cơ bản; coordinator integration; audit `cut-plan.json`; journal/resume/cache identity.
- **Còn mở theo spec:** frame index/step chính xác cho CFR/VFR, after-cut join preview, undo/redo history, cue semantic review/provenance qua seam, batch preset, hold-frame, suggestions và matrix nghiệm thu đa nền tảng.

## 4. Quyết Định Kiến Trúc

- Bản cắt nằm trên từng queue item vì các video có duration/timeline khác nhau.
- Main validate lại contract và tạo edited master trong item scratch scope. Mọi AI stage đọc cùng master để tránh hình, tiếng và phụ đề lệch nhau.
- FFV1 `yuv444p` và PCM được dùng cho intermediate để tránh thêm một encode lossy và hỗ trợ kích thước lẻ; disk budget/item cleanup hiện hữu quản lý vòng đời file.
- No-edit giữ nguyên đường cũ. Mọi thay đổi edit làm đổi checkpoint và per-item batch digest.

## 5. Tệp Chính

- `[NEW]` `src/shared/autoShortTemporalEdit.ts`
- `[NEW]` `src/main/autoShortCutMedia.ts`
- `[NEW]` `src/renderer/src/components/AutoShortCutPanel.tsx`
- `[MODIFY]` contract/types, AutoShort coordinator, batch journal, UI/CSS và test runner.
- `[NEW]` `tests/autoshort-temporal-edit-contract.test.ts`, `tests/autoshort-cut-media.test.ts`

## 6. Kiểm Chứng

- `npm run typecheck`: PASS trước vòng cập nhật tài liệu cuối.
- Scoped contract/filter/journal/cache/UI: 17 tests PASS, 0 fail.
- `autoshort-ocr-pipeline.test`: 12 tests PASS, gồm đường coordinator/render thật hiện hữu.
- `npm run test:local-runtime`: PASS toàn bộ runner, exit 0; có 1 test FFmpeg retime được suite hiện hữu đánh dấu SKIP.
- `npm run build`: PASS; chỉ có các cảnh báo chunk dynamic/static import đã tồn tại của Vite.
- Managed FFmpeg 9.0.1 synthetic smoke: nguồn 6 giây có video+audio, bỏ [2s,4s), output có đủ hai stream và duration `4.000000`.
- Chưa chạy live provider, GUI interaction harness, VFR/exact-frame, macOS hoặc installed build; không dùng bằng chứng trên để tuyên bố các phạm vi đó đã đạt.

## 7. Bàn Giao

MVP dùng timestamp hiển thị tới microsecond. Trước khi gắn nhãn exact-frame, triển khai T03 và phần còn lại của T05/T07/T09/T11 trong plan, kèm frame oracle và preview/export agreement.
