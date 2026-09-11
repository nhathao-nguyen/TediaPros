# TASK-20260910-local-windows-update: Cập nhật bản Windows local

- **Trạng thái:** Đã cập nhật; dọn phần lớn artifact cũ, còn một backup bị ACL khóa.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-10

## 1. Mục Tiêu (Goal)

Đóng gói mã hiện tại thành bản Windows local, cập nhật bản đang cài tại `C:\Users\PC\AppData\Local\Programs\TediaPros`, khởi động lại ứng dụng, và dọn artifact Windows local cũ không còn dùng.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Build Windows NSIS từ mã hiện tại.
- [x] Cài đè bản local và khởi động ứng dụng thành công.
- [x] Kiểm tra font, metadata updater, tệp cấm trong package và SHA-256 của bộ cài.
- [x] Dọn 16 thư mục `out-codex*` cũ ở root và renderer.
- [ ] Dọn `dist-preupdate-20260910` (3.25 GiB còn lại): bị khóa bởi ACL owner `DESKTOP-OJPN0OC\CodexSandboxOffline`; phiên hiện tại không có quyền elevated để xóa.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** package Windows local, cài đè local, output build cũ.
- **Không đụng tới:** source changes từ các task trước, profile `%APPDATA%\tedia-pros`, runtime/evidence trong `release-artifacts`, engine source/model, dữ liệu video người dùng.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

Lần đóng gói đầu tiên tạo `app.asar` 6.52 GiB và NSIS thất bại với `failed creating mmap`. Root cause: `electron-builder.yml` dùng danh sách loại trừ rộng, nên electron-builder lấy mặc định toàn bộ repository, bao gồm `dist`, các output `out-codex*` và evidence cũ; build sau lại tự đóng gói các build trước.

Đổi `files` thành allowlist `out/**/*` và `package.json`. Font vẫn được đưa vào qua `extraResources`. Build mới có `app.asar` 15,908,644 bytes và bộ cài 91,681,410 bytes; package chỉ có `out`, production `node_modules`, và `package.json`.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `electron-builder.yml`: allowlist production bundle để ngăn package lấy lại artifact build cũ.
- `[NEW/REPLACED]` `dist/`: artifact Windows local mới, gồm `TediaPros-0.1.23-setup.exe`, blockmap, `latest.yml`, và `win-unpacked`.
- `[DELETE]` 16 thư mục `out-codex*` cũ ở repository root và `src/renderer/`.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

Các lệnh đã chạy:

```powershell
npm.cmd run typecheck
npm.cmd run fonts:prepare
npm.cmd run fonts:verify
npm.cmd run build
.\node_modules\.bin\electron-builder.cmd --win -p never --config.directories.output=dist-local-20260910
npm.cmd run fonts:verify-packaged -- --fonts-dir dist-local-20260910\win-unpacked\resources\fonts
node scripts/verify-packaged-app.mjs dist-local-20260910
node scripts/verify-release-assets.mjs dist-local-20260910 --windows-only
```

Kết quả thực tế:

- `typecheck`: PASS.
- Build và electron-builder: PASS, sau sửa allowlist.
- Font package: PASS, 4 font / 12.90 MiB.
- Package scan: PASS, không có model, binary runtime, CUDA DLL hay asset cấm.
- Metadata release: PASS, `latest.yml` trỏ `TediaPros-0.1.23-setup.exe`.
- Installer silent: exit 0. `app.asar` đã cài khớp SHA-256 package: `D059425E262EE8A2D8D05B4E7342717C9DC1B0BC8C9401B7F3B9CACEA6A276E1`.
- App cài đặt được khởi động lại: process `TediaPros.exe`, cửa sổ `TediaPros`, `Responding=True`.
- SHA-256 bộ cài trong `dist`: `3112BCC9FB0D6C0089C578FDC7BB6CEAAE0C2FE99D97497B898F181695403AEA`.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Để xóa backup ACL-locked còn lại, chạy PowerShell **Run as administrator**:

```powershell
takeown /F "F:\Son\tool\TediaPros\dist-preupdate-20260910" /R /D Y
icacls "F:\Son\tool\TediaPros\dist-preupdate-20260910" /grant "PC:(OI)(CI)F" /T /C
Remove-Item -LiteralPath "F:\Son\tool\TediaPros\dist-preupdate-20260910" -Recurse -Force
```

Chỉ thư mục backup này bị tác động; `dist` là bản local mới cần giữ.
