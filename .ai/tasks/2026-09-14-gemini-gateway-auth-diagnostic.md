# TASK-20260914-GATEWAY-AUTH: Phân biệt lỗi cookie và model gateway

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-14

---

## 1. Mục Tiêu (Goal)

Hiển thị đúng nguyên nhân khi Gemini Web từ chối cookie của CreateMediaTool, thay vì báo sai rằng gateway không cung cấp `gemini-advanced`.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Capabilities phân biệt provider chưa xác thực với model không tồn tại.
- [x] TediaPros ưu tiên thông báo lỗi cookie trước kiểm tra danh sách model.
- [x] Regression test được quan sát fail trước khi sửa và pass sau khi sửa.
- [ ] Cookie Gemini mới được cung cấp và kiểm tra live thành công.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** Hợp đồng `/gateway/capabilities`, kiểm tra gateway trong TediaPros và regression coverage.
- **Nằm ngoài phạm vi:** Tạo, trích xuất hoặc tự động làm mới cookie tài khoản Google của người dùng.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Gateway trả `provider_ready` và mã `provider_error` không chứa bí mật.
- Danh sách model rỗng khi chưa xác thực không được diễn giải thành model không được hỗ trợ.
- Không dùng danh sách model tĩnh vì điều đó có thể cho kiểm tra kết nối pass trong khi request thật vẫn thất bại.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/geminiGateway.ts`
- `[MODIFY]` `tests/gemini-gateway-contract.test.ts`
- `[NEW]` `.ai/tasks/2026-09-14-gemini-gateway-auth-diagnostic.md`
- CreateMediaTool: `internal/modules/openai/openai_controller.go`
- CreateMediaTool: `internal/modules/openai/openai_controller_test.go`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
node scripts/run-local-runtime-tests.mjs gemini-gateway-contract.test
go test ./internal/modules/openai
```

### Kết quả thực tế:

- RED: TediaPros báo nhầm `Gateway chưa cung cấp gemini-advanced`; CreateMediaTool thiếu `provider_error`.
- GREEN: 7/7 test gateway của TediaPros pass; package OpenAI của CreateMediaTool pass.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Cookie hiện tại đã bị Gemini Web từ chối. Cần cookie mới để kiểm chứng generation live.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Sau khi cập nhật `GEMINI_1PSID` và `GEMINI_1PSIDTS`, restart CreateMediaTool rồi dùng nút kiểm tra gateway trong TediaPros.
