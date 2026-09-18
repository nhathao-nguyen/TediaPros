# TASK-20260916-winlocal-feature-update: Cập nhật bản Windows local

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-16

---

## 1. Mục Tiêu (Goal)

Đóng gói và cập nhật bản TediaPros Windows local từ đúng trạng thái source hiện tại, bao gồm các thay đổi tính năng đang có trong worktree (trong đó có pipeline render giữ VFR), sau đó cài đặt, kiểm tra tính toàn vẹn artifact và khởi chạy bản đã cài.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] `npm.cmd run typecheck` hoàn tất với mã thoát 0.
- [x] `npm.cmd run test:local-runtime` hoàn tất với mã thoát 0 và không có test thất bại.
- [x] `npm.cmd run package:win` hoàn tất; font và package policy được verify.
- [x] `npm.cmd run release:verify-assets` hoàn tất cho Windows-only artifact.
- [x] Installer NSIS cài silent thành công.
- [x] SHA-256 của `dist/win-unpacked/resources/app.asar` trùng với bản installed.
- [x] Executable installed khởi chạy và có cửa sổ `TediaPros`.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Build/package Windows x64 từ worktree `F:\Son\tool\TediaPros` hiện tại.
  - Cài local per-user tại `C:\Users\PC\AppData\Local\Programs\TediaPros`.
  - Kiểm tra artifact, hash `app.asar` và process/window sau khi cài.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không commit, merge, push hoặc dọn các thay đổi dirty/untracked có trước task.
  - Không chứng nhận provider Gemini/Edge-TTS, GPU/FFmpeg runtime, hay một video thực tế end-to-end.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Đóng gói trực tiếp từ `main` worktree hiện tại để không làm mất các feature mới chưa commit.
- Dùng installer NSIS hiện có với `/S`, sau đó so sánh hash `app.asar` packaged/installed để chứng minh bản local đang chạy đúng artifact vừa build.
- Giữ nguyên profile production mặc định; không trộn dữ liệu profile dev vào bước cài đặt.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `.ai/tasks/TASK-20260916-winlocal-feature-update.md`
- Artifact sinh/ghi đè trong phạm vi build: `out/`, `dist/` (không phải source feature mới).
- Toàn bộ source dirty/untracked trước task được giữ nguyên; task không sửa/xóa chúng.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime
npm.cmd run package:win
npm.cmd run release:verify-assets
Start-Process .\dist\TediaPros-0.1.26-setup.exe -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
```

### Kết quả thực tế

- `typecheck`: PASS (exit 0; node + web typecheck).
- `test:local-runtime`: PASS (exit 0; không có failure). Các test cần fixture FFmpeg thật được skip có điều kiện vì `TEDIAPROS_TEST_FFMPEG` chưa đặt.
- `package:win`: PASS; electron-builder 25.1.8, Electron 34.5.8, Windows x64; bundled fonts 5/5 và package policy PASS.
- `release:verify-assets`: PASS — `Windows-only cho v0.1.26`.
- Installer: PASS, exit code 0.
- Installer SHA-256: `70E0388DBF2407499EB89E96667A008F2A5B76DB0BF8AA820EF9ED8462861417`.
- `app.asar` packaged: `CE21B2899AC44CE0634273F19C3D37B713F47D5D813ED5D9F51FA14D4B593575`.
- `app.asar` installed: `CE21B2899AC44CE0634273F19C3D37B713F47D5D813ED5D9F51FA14D4B593575` — trùng hash.
- Installed executable: `C:\Users\PC\AppData\Local\Programs\TediaPros\TediaPros.exe`; process tồn tại và một process có `MainWindowTitle=TediaPros`.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa chạy job video thật hoặc gọi provider từ bản installed; kết quả trên chứng minh build/install/launch và test contract/local-runtime, không phải chứng nhận production media/provider.
- Các thay đổi dirty/untracked là trạng thái người dùng có sẵn; cần commit/branch riêng theo quy trình Git khi muốn phát hành chính thức.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Có thể dùng bản installed hiện tại để kiểm tra UI và chạy thử video.
- Nếu cần kiểm tra FFmpeg media thật, đặt `TEDIAPROS_TEST_FFMPEG` trỏ tới binary được phép rồi chạy lại các suite integration tương ứng.
