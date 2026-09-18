# TASK-20260917-winlocal-feature-update: Cập nhật bản Windows local

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Antigravity
- **Thời gian:** 2026-09-17

---

## 1. Mục Tiêu (Goal)

Đóng gói và cập nhật bản TediaPros Windows local từ đúng trạng thái source hiện tại trong worktree (bao gồm các tính năng mới về autoShortThumbnail, videoTitle settings, translation checkpoint, gemini gateway và các cải tiến gần nhất), sau đó cài đặt silent qua installer NSIS, kiểm tra tính toàn vẹn artifact (hash `app.asar`) và khởi chạy bản đã cài.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] `npm.cmd run typecheck` hoàn tất với mã thoát 0 (cả Node & Web).
- [x] `npm.cmd run test:local-runtime` hoàn tất với mã thoát 0 và không có test thất bại.
- [x] `npm.cmd run package:win` hoàn tất; font và package policy được verify.
- [x] `npm.cmd run release:verify-assets` hoàn tất cho Windows-only artifact.
- [x] Installer NSIS cài silent thành công (exit code 0).
- [x] SHA-256 của `dist/win-unpacked/resources/app.asar` trùng khớp với `C:\Users\PC\AppData\Local\Programs\TediaPros\resources\app.asar`.
- [x] Executable installed khởi chạy thành công và các tiến trình TediaPros hoạt động bình thường trong phiên người dùng.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Typecheck và kiểm thử `test:local-runtime` trên source hiện tại.
  - Build và đóng gói Windows x64 từ worktree `F:\Son\tool\TediaPros`.
  - Cài đặt silent đè vào `C:\Users\PC\AppData\Local\Programs\TediaPros`.
  - Kiểm tra đối chiếu mã băm SHA-256 của artifact vừa đóng gói và artifact đã cài đặt.
  - Khởi chạy ứng dụng installed và xác nhận log khởi động.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không commit, merge hoặc push các thay đổi source chưa commit trong git.
  - Không can thiệp hay xóa file dữ liệu người dùng trong `%APPDATA%\tedia-pros`.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Đóng gói trực tiếp từ trạng thái worktree hiện tại để gom toàn bộ các tính năng mới đã sửa đổi.
- Dùng installer NSIS silent (`/S`) để cập nhật sạch sẽ các binary và tài nguyên ứng dụng.
- Dùng so sánh SHA-256 của `app.asar` giữa `dist/win-unpacked` và thư mục cài đặt thực tế để đảm bảo bản cài đặt chắc chắn mang mã nguồn mới nhất.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/TASK-20260917-winlocal-feature-update.md`
- Artifacts sinh ra trong phạm vi build:
  - `dist/TediaPros-0.1.26-setup.exe`
  - `dist/win-unpacked/`
  - `out/main/`, `out/preload/`, `out/renderer/`
- Tệp cài đặt đích được cập nhật:
  - `C:\Users\PC\AppData\Local\Programs\TediaPros\resources\app.asar`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
cmd.exe /c "npm.cmd run typecheck"
cmd.exe /c "npm.cmd run test:local-runtime"
cmd.exe /c "npm.cmd run package:win"
cmd.exe /c "npm.cmd run release:verify-assets"
$proc = Start-Process .\dist\TediaPros-0.1.26-setup.exe -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru; $proc.ExitCode
Get-FileHash -Algorithm SHA256 dist\win-unpacked\resources\app.asar
Get-FileHash -Algorithm SHA256 "C:\Users\PC\AppData\Local\Programs\TediaPros\resources\app.asar"
Start-Process -FilePath "explorer.exe" -ArgumentList "C:\Users\PC\AppData\Local\Programs\TediaPros\TediaPros.exe"
```

### Kết quả thực tế

- **Typecheck:** PASS (exit code 0; cả `tsc` cho node và web đều không có lỗi).
- **Test Local Runtime:** PASS (exit code 0; toàn bộ test suites đều pass; các fixture cần FFmpeg thật được skip có điều kiện như thiết kế).
- **Package Win:** PASS; font 5/5 bundle verified; package verifier không phát hiện binary/model bị cấm; NSIS installer tạo thành công.
- **Release Verify Assets:** PASS — `Release artifacts OK: Windows-only cho v0.1.26`.
- **Installer:** Exit code `0`.
- **Installer SHA-256:** `1A4A9722BE5F40ABBA1317FEAF3B9A41A9BEF74CC849B46F7FE4D4AE1FD92309`.
- **app.asar Packaged:** `F14CB2A38A36B5CCBD818D0FF41EDE7908C45057148E26DBCC69F5B56AEA8F1D`.
- **app.asar Installed:** `F14CB2A38A36B5CCBD818D0FF41EDE7908C45057148E26DBCC69F5B56AEA8F1D` (khớp hoàn toàn 100%).
- **Trạng thái khởi chạy:** Ứng dụng đã được khởi chạy trong phiên Windows tương tác của người dùng. Các tiến trình `TediaPros.exe` đang chạy ổn định. Nhật ký khởi động phiên mới tại `C:\Users\PC\AppData\Roaming\tedia-pros\logs\tblao-session-a6e48cc7-1c99-4d24-9637-4725e1b8668d.log` xác nhận:
  - TediaPros 0.1.26 khởi động ở win32
  - Kiểm tra môi trường: bộ tải xuống=có, ffmpeg=có
  - Quét GPU: NVIDIA GeForce GTX 1660 SUPER · CUDA 13.4 · tăng tốc=được

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Ứng dụng local đã được cập nhật bản build mới nhất chứa tất cả các tính năng và logic mới.
- Người dùng có thể mở và sử dụng ngay bản cài đặt tại `C:\Users\PC\AppData\Local\Programs\TediaPros\TediaPros.exe` hoặc biểu tượng shortcut trên Desktop / Start Menu.
