# TASK-20260915-WINLOCAL-FEATURE-UPDATE: Cập nhật WinLocal từ mã nguồn hiện tại

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-15

---

## 1. Mục Tiêu (Goal)

Đóng gói và cài đè bản Windows local để người dùng dùng được các chức năng mới có trong mã nguồn hiện tại. Bản build lấy từ `main` tại `d73db0378aabbca81969e0098cebac7ed70d2dfc` cùng các thay đổi local chưa commit đang có trong workspace.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Typecheck không có lỗi.
- [x] Bộ test local runtime hoàn tất thành công; một test STTN fixture được bỏ qua có chủ đích khi không cấu hình `TEDIAPROS_TEST_FFMPEG`.
- [x] Installer Windows v0.1.26 được tạo và các asset phát hành được xác minh.
- [x] Installer cài đè thành công vào WinLocal.
- [x] `app.asar` đã cài khớp SHA-256 với `win-unpacked` và ứng dụng khởi chạy được.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** build, package verification, cài đè và smoke launch WinLocal.
- **Nằm ngoài phạm vi (Out of Scope):** merge/push Git, commit các thay đổi local sẵn có, thay đổi runtime/profile người dùng, và chạy tác vụ AutoShort trên media thật.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Cài trực tiếp installer `TediaPros-0.1.26-setup.exe` sau toàn bộ gate source/package.
- *Lý do:* Bản WinLocal chỉ được xem là cập nhật khi artifact đã cài khớp với artifact vừa build, thay vì chỉ dựa vào exit code của installer.
- *Lưu ý:* Version package vẫn là `0.1.26`; nội dung mới được nhận diện bằng hash `app.asar`, không suy diễn chỉ từ version string.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/TASK-20260915-winlocal-feature-update.md`
- `[NEW/REPLACED]` `dist/TediaPros-0.1.26-setup.exe` và Windows package artifacts.
- `[REPLACED]` `C:\Users\PC\AppData\Local\Programs\TediaPros\resources\app.asar`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
cmd.exe /c "npm.cmd run typecheck"
cmd.exe /c "npm.cmd run test:local-runtime"
cmd.exe /c "npm.cmd run package:win"
cmd.exe /c "npm.cmd run release:verify-assets"
Start-Process dist\TediaPros-0.1.26-setup.exe -ArgumentList '/S' -Wait
Get-FileHash -Algorithm SHA256 dist\win-unpacked\resources\app.asar
Get-FileHash -Algorithm SHA256 C:\Users\PC\AppData\Local\Programs\TediaPros\resources\app.asar
```

### Kết quả thực tế:

- `Typecheck`: PASS.
- `test:local-runtime`: PASS; test STTN exact-frame fixture skip có chủ đích do `TEDIAPROS_TEST_FFMPEG` không được đặt.
- `package:win`: PASS; 4 bundled fonts verified và package verifier không phát hiện runtime/model bị cấm.
- `release:verify-assets`: PASS, `Windows-only cho v0.1.26`.
- Installer silent: exit code `0`.
- SHA-256 packaged/installed `app.asar`: `C12F69D99AEB0D886DD24DE1928DF84E24A5A2D8C6123ADB9024E18933B5ED6F` ở cả hai phía.
- Smoke launch: tiến trình `TediaPros.exe` khởi chạy từ thư mục cài đặt lúc 10:38:06 (UTC+7).

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Không chạy AutoShort/OCR/TTS trên media hoặc provider thật.
- Build bao gồm các thay đổi local chưa commit; chúng chưa được merge hoặc đẩy lên remote.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- WinLocal dùng profile production `%APPDATA%\tedia-pros`; source dev tiếp tục dùng profile riêng `%APPDATA%\tedia-pros-dev`.
- Nếu cần phát hành/đồng bộ Git, review và commit riêng các thay đổi Gateway đang dirty trước; không dùng bản cài local làm bằng chứng rằng code đã được merge/push.
