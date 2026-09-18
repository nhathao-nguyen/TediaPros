# TASK-20260916-local-title-gateway-422-recovery: Khôi phục có giới hạn cho title Local Gateway

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-16

---

## 1. Mục Tiêu (Goal)

Khoanh vùng lỗi `AI tạo tiêu đề phản hồi lỗi HTTP 422` của các item đã render thành công nhưng chưa có `tieude.txt`, rồi sửa client source mà không dừng batch, restart Electron, build, package hoặc cài đè bản Windows đang chạy.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tái hiện 422 `invalid-json` từ Local Gateway bằng test cô lập.
- [x] Chỉ thử lại đúng một lần, chỉ với mã normalization an toàn đã allowlist.
- [x] Giữ `response_format` ở request đầu; fallback bỏ field này nhưng vẫn qua parser/validator hiện hữu.
- [x] Không retry mã Gateway không rõ và không đưa raw error body vào UI.
- [x] Typecheck pass 100% không có lỗi (`npm.cmd run typecheck`).
- [x] Test cases liên quan pass kèm bằng chứng log.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** `src/main/videoTitle.ts`, regression tests title, và tài liệu contract metadata.
- **Nằm ngoài phạm vi (Out of Scope):** Chỉnh Gateway CreateMediaTool, retry vô hạn, thay đổi Gemini/OpenAI provider, khởi động lại app, build/release/cài đặt Windows, hay sửa các output đang chạy.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Quan sát code-confirmed:* Gateway Local trả HTTP 422 khi đã exhaust quá trình normalize structured response; error body có `error.code`. Client cũ hủy body và ném lỗi status chung nên không có recovery path.
- *Lựa chọn:* Chỉ đọc body có `Content-Length` hợp lệ không quá 4 KiB và chỉ chấp nhận bốn code `invalid-json`, `ambiguous-json`, `duplicate-key`, `wrong-root`.
- *Lý do:* Đó là đúng nhóm normalization retryable của Gateway. Fallback không dùng schema request, nhưng giữ nguyên system/user input và code-side strict parse/validation. Các lỗi auth, rate-limit, upstream/server, transport, body không bounded và mã lạ vẫn fail ngay.
- *Bảo mật:* Không hiển thị hoặc lưu raw `error.message`, URL, khóa, hay source text trong lỗi người dùng.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/main/videoTitle.ts](file:///F:/Son/tool/TediaPros/src/main/videoTitle.ts)
- `[MODIFY]` [tests/video-title.test.ts](file:///F:/Son/tool/TediaPros/tests/video-title.test.ts)
- `[MODIFY]` [docs/domain.md](file:///F:/Son/tool/TediaPros/docs/domain.md)
- `[NEW]` [TASK-20260916-local-title-gateway-422-recovery.md](file:///F:/Son/tool/TediaPros/.ai/tasks/TASK-20260916-local-title-gateway-422-recovery.md)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
node scripts/run-local-runtime-tests.mjs video-title.test
npm.cmd run typecheck
```

### Kết quả thực tế:

- RED trước sửa: test `local title retries once without a schema after a bounded Gateway invalid-json response` fail với `AI tạo tiêu đề phản hồi lỗi HTTP 422.`
- GREEN sau sửa: `video-title.test` pass 29/29.
- `Typecheck`: PASS, cả `typecheck:node` và `typecheck:web` không có lỗi.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Không gửi request live tới Gateway/AI trong task này; kết quả live còn phụ thuộc model trả JSON hợp lệ ở fallback.
- Những item cũ đã fail không tự ghi lại `tieude.txt`; bản Windows đang chạy không bị thay đổi theo yêu cầu.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Bản source này chỉ có hiệu lực khi một bản build mới được chủ động phát hành và ứng dụng được khởi động lại sau đó. Không thực hiện các bước đó trong task hiện tại.
- Nếu 422 vẫn xảy ra sau khi có bản mới, UI vẫn sẽ chỉ hiện HTTP 422 cho mã lạ; cần thu thập error code đã redacted từ Gateway để quyết định một recovery policy mới, không mở allowlist đoán mò.
