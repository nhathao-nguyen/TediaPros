# TASK-20260911-WINLOCAL-FEATURE-UPDATE: Cập nhật WinLocal từ mã nguồn hiện tại

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Đóng gói mã nguồn hiện tại, gồm các thay đổi Auto Short, OCR, dịch, lồng tiếng và giao diện, rồi cài đè bản WinLocal để người dùng sử dụng các tính năng mới.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Typecheck không có lỗi.
- [x] Toàn bộ test runtime hoàn tất với exit code 0.
- [x] Installer Windows được tạo và qua kiểm tra gói, fonts và release assets.
- [x] Installer được cài đè thành công vào WinLocal.
- [x] `app.asar` đã cài trùng SHA-256 với gói vừa build và ứng dụng khởi động ổn định.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** build, kiểm tra, cài đè và khởi động bản Windows local.
- **Nằm ngoài phạm vi (Out of Scope):** không sửa mã nguồn tính năng, không thay runtime managed trong `%APPDATA%\\tedia-pros`.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Dùng `package:win` với allowlist production trong `electron-builder.yml`.
- *Lý do:* Gói chỉ lấy `out/**/*` và `package.json`, tránh đưa artifacts cũ vào `app.asar`.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/TASK-20260911-winlocal-feature-update.md`
- `[BUILD]` `dist/TediaPros-0.1.23-setup.exe`
- `[INSTALL]` `C:/Users/PC/AppData/Local/Programs/TediaPros/`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime
npm.cmd run package:win
npm.cmd run release:verify-assets
TediaPros-0.1.23-setup.exe /S
```

### Kết quả thực tế:

- `typecheck`: PASS.
- `test:local-runtime`: PASS, exit code 0.
- `package:win`: PASS; bundled-font check và packaged-app verification PASS.
- `release:verify-assets`: PASS cho Windows v0.1.23.
- NSIS installer: exit code 0.
- SHA-256 `app.asar` installed/package: `AB7491CA5001F6516F7158651A59B68F828E1C0487FA876300048AB290A5BC0E`.
- Installed `TediaPros.exe` vẫn chạy sau 8 giây; phát hiện 4 process của app.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Chưa chạy một batch Auto Short thật từ bản cài sau cập nhật; bộ runtime test và package verification là bằng chứng tự động hiện có.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Runtime production tiếp tục dùng profile độc lập `%APPDATA%\\tedia-pros`; Dev dùng `%APPDATA%\\tedia-pros-dev`.
