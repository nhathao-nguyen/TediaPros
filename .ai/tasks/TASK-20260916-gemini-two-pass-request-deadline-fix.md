# TASK-20260916-GEMINI-TWO-PASS-DEADLINE: Tách timeout cho hai lượt dịch và phản biện

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-16

---

## 1. Mục Tiêu (Goal)

Sửa lỗi AutoShort báo `quá thời gian chờ`/`Cần kiểm tra bản dịch` khi Gemini Gateway chạy quy trình hai lượt tuần tự: tạo bản dịch rồi phản biện độc lập. Mỗi HTTP request phải có đủ timeout riêng, thay vì lượt phản biện dùng phần thời gian còn sót lại của lượt tạo bản dịch.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Xác định nguyên nhân từ log của đúng phiên Dev gặp lỗi.
- [x] Mỗi lượt `restore-translate` và `independent-review` có deadline riêng.
- [x] Vẫn bảo toàn hủy tác vụ của người dùng và deadline toàn phiên khi ngân sách toàn phiên được bật.
- [x] Có regression test chứng minh tổng thời gian hai lượt có thể vượt timeout của một lượt mà không bị hủy sai.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Các test liên quan và toàn bộ local-runtime test pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Quyền sở hữu timeout giữa translation orchestrator và adapter.
  - Deadline riêng cho từng HTTP request của Gemini Gateway.
  - Regression test và tài liệu domain liên quan.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Thay đổi prompt/chất lượng nội dung dịch.
  - Đóng gói hoặc cập nhật bản Production đã cài.
  - Nghiệm thu trực tiếp với provider thật; việc này cần người dùng bấm thử lại vì UI native không được expose cho bộ điều khiển tự động trong phiên này.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Adapter Gemini Gateway sở hữu timeout cho từng outbound request; orchestrator tiếp tục sở hữu tín hiệu hủy của người dùng và ngân sách toàn phiên nếu được bật.
- *Lý do:* Một logical batch của adapter này gồm hai HTTP request tuần tự. Dùng một `AbortSignal.timeout(180_000)` ở orchestrator khiến lượt phản biện chỉ nhận phần thời gian còn lại sau lượt dịch, dù từng request riêng vẫn nằm trong giới hạn cho phép.
- *Bằng chứng nguyên nhân:* Trong `tblao-session-3d06f85d-123c-405c-a1dc-6c4e5ae6ca10.log`, lượt tạo bản dịch chạy từ `09:50:39.766Z` đến `09:53:10.175Z`, lượt phản biện bắt đầu `09:53:10.202Z` rồi timeout `09:53:40.134Z`; toàn logical request chạm đúng khoảng 180 giây.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/shared/translation.ts](file:///F:/Son/tool/TediaPros/src/shared/translation.ts)
- `[MODIFY]` [src/main/translation/orchestrator.ts](file:///F:/Son/tool/TediaPros/src/main/translation/orchestrator.ts)
- `[MODIFY]` [src/main/geminiGateway.ts](file:///F:/Son/tool/TediaPros/src/main/geminiGateway.ts)
- `[MODIFY]` [tests/gemini-gateway-contract.test.ts](file:///F:/Son/tool/TediaPros/tests/gemini-gateway-contract.test.ts)
- `[MODIFY]` [docs/domain.md](file:///F:/Son/tool/TediaPros/docs/domain.md)
- `[NEW]` [.ai/tasks/TASK-20260916-gemini-two-pass-request-deadline-fix.md](file:///F:/Son/tool/TediaPros/.ai/tasks/TASK-20260916-gemini-two-pass-request-deadline-fix.md)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
npm.cmd run typecheck:node
node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test
node scripts/run-local-runtime-tests.mjs translation-orchestrator.test
npm.cmd run typecheck
npm.cmd run test:local-runtime
git diff --check
```

### Kết quả thực tế:

- `typecheck:node`: PASS.
- `typecheck` (node + web): PASS, 0 lỗi.
- `gemini-gateway-contract.test`: PASS, 18/18.
- `translation-orchestrator.test`: PASS, 26/26.
- `test:local-runtime`: PASS, exit code 0; các case cần `TEDIAPROS_TEST_FFMPEG` vẫn được skip có chủ đích theo harness hiện có.
- `git diff --check`: PASS trước khi tạo bản ghi này; chạy lại ở bước bàn giao cuối.
- Phiên Dev đã được rebuild và khởi động lại: cửa sổ `TediaPros`, Electron PID `25852`, Vite `http://localhost:5173`, log mới ghi `TediaPros (Dev) 0.1.26 khởi động` lúc `2026-09-16T11:15:18.782Z`.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Chưa gửi lại nội dung tới Gemini Gateway thật sau bản sửa, nên chưa gọi đây là `LIVE_CONFIRMED`.
- Bản cài Production chưa được build/cập nhật; thay đổi hiện có trong source và phiên Dev.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Trên phiên Dev đang chạy, bấm `Thử lại dịch` hoặc thêm lại video để xác nhận provider thật.
- Khi xem log, hai stage vẫn có thể tốn gần 180 giây mỗi stage; điều quan trọng là lượt phản biện không còn bị giới hạn bởi thời gian còn sót của lượt dịch.
- Worktree có nhiều thay đổi tồn tại từ trước; bản sửa này không reset, clean, stash hay ghi đè các thay đổi đó.
