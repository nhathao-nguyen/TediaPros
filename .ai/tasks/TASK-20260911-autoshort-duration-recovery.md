# TASK-20260911-AUTOSHORT-DURATION-RECOVERY: Phục hồi thời lượng Auto Short

- **Trạng thái:** Hoàn tất triển khai và kiểm chứng local
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

## 1. Mục Tiêu (Goal)

Cho phép Auto Short giữ đủ lời với tempo tối đa 1.80x, làm chậm hình tối đa 20% rồi replay phần nguồn tương ứng trong trần kéo dài 60%; video lỗi được lưu và tự chạy lại một lần cuối hàng đợi.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Timeline phân biệt segment chính và replay, không cộng dồn từ output cũ.
- [x] Video, mask và audio dùng cùng timeline; audio nguồn mix im lặng ở replay.
- [x] Lượt phục hồi thứ hai bỏ cache TTS và dùng prompt sửa lại từ nguồn.
- [x] Video lỗi không chặn hàng đợi và chỉ tự chạy lại một lần.
- [x] `npm run typecheck` và toàn bộ test liên quan pass bằng lần chạy cuối.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** planner dubbing, FFmpeg retime, prompt phục hồi, queue retry, typed result, UI và tài liệu.
- **Nằm ngoài phạm vi:** tăng tempo quá 1.80x, tự xuất video mất lời, thay đổi provider hoặc model người dùng chọn.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- **Lựa chọn:** làm chậm tối đa 20% rồi replay trong source interval; tổng thêm tối đa 60%.
- **Lý do:** giữ chuyển động dễ xem, đồng thời thêm đủ thời gian mà không lấy hình từ câu khác.
- **Lựa chọn:** dùng `sourceEnd` thật và giữ khoảng lặng giữa các cue thành segment riêng không có owner.
- **Lý do:** replay luôn lấy hình trong timestamp của đúng cue nguồn, kể cả sau khi các cue được nhóm theo câu nói.
- **Lựa chọn:** retry hai lượt, lượt hai sửa theo nguồn và bỏ cache TTS.
- **Lý do:** xử lý được lỗi voice và lệch nghĩa nhưng vẫn có điểm dừng hữu hạn.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/dubbing/timeMap.ts`, `retimeMedia.ts`, `synthesis.ts`
- `[MODIFY]` `src/main/autoShortQueueRunner.ts`, `autoshort.ts`, `autoShortItemCoordinator.ts`
- `[MODIFY]` `src/main/translation/prompts.ts`, `src/shared/types.ts`, UI Auto Short và tài liệu liên quan
- `[MODIFY]` các test dubbing, FFmpeg retime, prompt và queue

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

- `npm run test:local-runtime`: PASS, 758 test pass, 0 fail, 1 integration test mặc định skip.
- `npm run typecheck`: PASS (`typecheck:node` và `typecheck:web`).
- `npm run build`: PASS; chỉ có cảnh báo chunk do module vừa static import vừa dynamic import.
- `TEDIAPROS_RETIME_TEST_FFMPEG=...` + `TEDIAPROS_RETIME_TEST_FFPROBE=...` và `node scripts/run-local-runtime-tests.mjs dubbing-retime.test`: PASS 2/2, gồm FFmpeg thật.
- TDD đã quan sát test fail trước khi triển khai cho trần 60%, replay, retry cuối hàng đợi, bỏ cache lượt hai và sửa nội dung theo nguồn; các test này pass sau triển khai.
- Review độc lập không phát hiện lỗi Critical; các phát hiện Important về ranh giới replay và prompt nguồn đã được sửa và kiểm chứng lại.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Chạy lại video thực tế cần provider/TTS đang hoạt động trước khi phát hành bản cài đặt.
