# TASK-20260915-GATEWAY-ANY-MODEL: Cho phép model Gemini thực tế do Google phục vụ

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-15

## 1. Mục tiêu

Bỏ yêu cầu Gemini Gateway phải trả đúng Gemini 3.1 Pro theo thay đổi trực tiếp
của người dùng. Giữ hai lượt khôi phục/dịch và review, đồng thời giữ toàn bộ
kiểm tra completion, JSON, cue ID và timestamp.

## 2. Nguyên nhân

Catalog của Gateway vẫn resolve alias `gemini-advanced` tới route `3.1 Pro`,
nhưng response thật của Google quan sát `3.5 Flash-Lite`. Chính sách cũ gửi
`require_verified_model=true`, nên Gateway chặn response trước khi TediaPros có
thể kiểm tra nội dung. Nhiều item trong cùng batch gặp cùng lỗi.

## 3. Thay đổi

- Request vẫn dùng alias tương thích `gemini-advanced`, nhưng gửi
  `require_verified_model=false` và `require_complete_response=true`.
- TediaPros chấp nhận trạng thái model `matched`, `mismatch` hoặc `unverified`;
  observed model vẫn được ghi vào audit.
- Preflight chỉ đọc capabilities, không dùng thêm một generation để probe model.
- UI hiển thị model tự động và nút `Kiểm tra gateway`.
- Không nới lỏng strict JSON, completion evidence, route fingerprint,
  upstream-attempt cap hoặc đối chiếu cue ID.

## 4. Kiểm chứng

- `gemini-gateway-contract.test`: PASS 17/17.
- `translation-rephrase.test`: PASS 21/21.
- `dubbing-plan.test`: PASS 53/53.
- `npm.cmd run typecheck`: PASS Node/Web.
- `local-runtime.test`: PASS 158/158.
- `npm.cmd run build`: PASS; chỉ còn cảnh báo Vite về import động/tĩnh đã có sẵn.
- `npm.cmd run package:win`: PASS; font package 4/4 và packaged-app verification
  đều đạt.
- Live one-request probe: HTTP success, observed `3.5 Flash-Lite`,
  `model_verification=mismatch`, `completion_state=complete`,
  `upstream_attempts=1`, content JSON hợp lệ.
- Installer `dist/TediaPros-0.1.26-setup.exe` có SHA-256
  `D6AD586B780918364BC1A7AADF3A423AD20F5EB24AB4A1F0F0244CD2A12EA6BB`.
- Đã đóng instance bản cài cũ, cài đè thành công với exit code 0 và khởi động
  lại TediaPros từ `C:\Users\PC\AppData\Local\Programs\TediaPros\TediaPros.exe`.
- Kiểm tra trực tiếp `resources/app.asar`: có nhãn model tự động mới và không
  còn nhãn `Model cố định: Gemini 3.1 Pro`.
- CreateMediaTool đang nghe tại `0.0.0.0:4982`; TediaPros bản cài mới đang phản hồi.

## 5. Tệp thay đổi chính

- `src/main/geminiGateway.ts`
- `src/main/autoshort.ts`
- `src/renderer/src/components/AutoShort.tsx`
- `tests/gemini-gateway-contract.test.ts`
- `tests/local-runtime.test.ts`
- `docs/domain.md`
- `docs/architecture.md`

## 6. Bằng chứng và giới hạn

- Probe live xác nhận chính xác nhánh `mismatch` mới được chấp nhận khi response
  hoàn tất và JSON hợp lệ.
- Chưa chạy lại toàn bộ video thật trong task này để tránh tự ý tiêu thêm hai
  generation dịch. Các card lỗi cũ là trạng thái terminal đã lưu; người dùng có
  thể bấm `Thử lại dịch` để chạy lại trên code mới.
