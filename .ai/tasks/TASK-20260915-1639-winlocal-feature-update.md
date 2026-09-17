# TASK-20260915-1639-WINLOCAL-FEATURE-UPDATE: Cập nhật WinLocal từ mã nguồn hiện tại

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-15

---

## 1. Mục Tiêu (Goal)

Đóng gói và cài đè WinLocal bằng mã nguồn workspace hiện tại, đồng thời giữ nguyên profile runtime production và toàn bộ thay đổi Git chưa commit.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] `npm.cmd run typecheck` hoàn tất không lỗi.
- [x] `npm.cmd run test:local-runtime` pass; một fixture STTN exact-frame được skip có chủ đích khi `TEDIAPROS_TEST_FFMPEG` không được đặt.
- [x] Gói Windows v0.1.26 và asset release được xác minh.
- [x] Installer cài đè thành công và artifact đã cài khớp artifact vừa package.
- [x] Ứng dụng đã cài khởi chạy từ thư mục WinLocal.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** build, package verification, cài đè, hash verification và smoke launch.
- **Nằm ngoài phạm vi:** commit/push, sửa mã nguồn, thay đổi profile/runtime, và chạy AutoShort trên media hay provider thật.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Dùng `TediaPros-0.1.26-setup.exe` được tạo từ worktree hiện tại, cài silent vào thư mục ứng dụng production.
- *Lý do:* Xác nhận bằng SHA-256 của `app.asar` đã cài thay vì suy luận từ exit code hay package version.
- *Bảo toàn:* Không đụng tới worktree dirty/untracked; production profile `%APPDATA%\tedia-pros` vẫn tồn tại tách biệt với Dev.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/TASK-20260915-1639-winlocal-feature-update.md`
- `[NEW/REPLACED]` `dist/TediaPros-0.1.26-setup.exe` và Windows package artifacts.
- `[REPLACED]` `C:\Users\PC\AppData\Local\Programs\TediaPros\resources\app.asar`.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime
npm.cmd run package:win
npm.cmd run release:verify-assets
Start-Process dist\TediaPros-0.1.26-setup.exe -ArgumentList '/S' -Wait
Get-FileHash -Algorithm SHA256 dist\win-unpacked\resources\app.asar
Get-FileHash -Algorithm SHA256 "$env:LOCALAPPDATA\Programs\TediaPros\resources\app.asar"
```

### Kết quả thực tế

- `typecheck`: PASS.
- `test:local-runtime`: PASS; 0 failed, 1 skipped fixture có điều kiện.
- `package:win`: PASS; 4 bundled fonts và packaged-app verifier đều pass.
- `release:verify-assets`: PASS, Windows-only v0.1.26.
- Installer silent: exit code `0`.
- SHA-256 packaged/installed `app.asar`: `E07A62AFA5C6AB94024FFCD2A42083FDCE273C2DE6ADA8D250008542F1C3415C` ở cả hai phía.
- Smoke launch: các tiến trình `TediaPros.exe` khởi chạy từ `C:\Users\PC\AppData\Local\Programs\TediaPros\TediaPros.exe` lúc 16:39 (UTC+7).

### Những phần chưa kiểm tra / Rủi ro còn lại

- Không chạy AutoShort/OCR/TTS trên media hoặc provider thật sau cài đặt.
- Bản build gồm worktree dirty hiện tại; chưa có commit, merge hoặc push nào được thực hiện.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- WinLocal dùng `%APPDATA%\tedia-pros`; Dev dùng `%APPDATA%\tedia-pros-dev`.
- Review và commit các thay đổi local riêng nếu muốn tái lập chính xác build này ở máy/branch khác.
