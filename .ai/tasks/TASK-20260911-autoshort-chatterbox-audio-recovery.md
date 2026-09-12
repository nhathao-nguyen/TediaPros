# TASK-20260911-AUTOSHORT-CHATTERBOX-AUDIO-RECOVERY: Phục hồi lỗi audio Chatterbox

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Sửa hai lỗi TTS trong batch Auto Short: WAV hợp lệ về container nhưng lặp/dài bất thường làm vượt trần kéo dài hình, và server trả `chatterbox_generation_failed` làm hỏng cả item ngay lập tức.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Phát hiện audio dài bất thường trước khi lập kế hoạch tempo/kéo dài hình.
- [x] Làm mới đúng cache key một lần và đo lại audio; không cắt lời hoặc nới trần `1.80x`/`40%`.
- [x] Chỉ retry một lần cho mã `chatterbox_generation_failed`; không retry lỗi 403 hay lỗi khác.
- [x] Typecheck pass 100% không có lỗi.
- [x] Test liên quan pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** policy kiểm tra thời lượng TTS, measured synthesis/cache refresh, transport voice clone Chatterbox, test và tài liệu.
- **Nằm ngoài phạm vi:** thay đổi server Chatterbox, tăng tempo, tăng giới hạn kéo dài hình hoặc bỏ cue.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Dùng số đo WAV sau trim làm bằng chứng. Ngưỡng `max(6s, 2.5s × số từ)` đủ rộng cho cách đọc biểu cảm nhưng loại trường hợp thật `Oh my! = 8.76s`.
- Audio chính không hợp lệ được tạo lại đúng một lần với `cacheMode=bypass`; kết quả thứ hai vẫn phải qua cùng kiểm tra.
- Transport chỉ nhận diện mã lỗi có cấu trúc `chatterbox_generation_failed`; lỗi quyền truy cập, timeout và mã khác giữ nguyên để tránh che lỗi cấu hình.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/autoShortPolicy.ts`
- `[MODIFY]` `src/main/dubbing/synthesis.ts`
- `[MODIFY]` `src/main/tts.ts`
- `[MODIFY]` `tests/dubbing-plan.test.ts`
- `[MODIFY]` `tests/autoshort-tts-pipeline.test.ts`
- `[MODIFY]` `docs/adr/005-source-anchored-dubbing-tempo-policy.md`
- `[MODIFY]` `docs/architecture.md`
- `[MODIFY]` `docs/project-atlas/modules/dubbing.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs dubbing-plan.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-tts-pipeline.test"
cmd.exe /c "npm run typecheck"
```

### Kết quả thực tế

- `dubbing-plan.test`: PASS, 46/46.
- `autoshort-tts-pipeline.test`: PASS, 6/6; fixture HTTP xác nhận request đầu trả `chatterbox_generation_failed`, request thứ hai trả WAV, và lỗi 403 không thuộc nhóm retry.
- `Typecheck`: PASS, 0 lỗi.
- Media evidence: cache thật `952695...13bd.wav` dài `8.760000s`; nội dung mục tiêu `Oh my!`; lỗi cũ yêu cầu kéo dài `52.1%` vượt giới hạn `40%`.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Server thật đã tái hiện nhiều request Chatterbox kéo dài `90–96s` nhưng trong lượt kiểm tra này chúng trả WAV thành công. Lượt media được dừng sau khi xác nhận đặc tính bất ổn để tránh chờ toàn bộ 32 request; không tuyên bố video 3 đã render hoàn tất.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Hàng đợi 90 video đã được phục hồi sau lượt chạy riêng video 3.
- App Dev cần chạy lại bundle mới sau khi hoàn tất kiểm tra.
