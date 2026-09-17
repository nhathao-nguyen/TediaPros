# TASK-20260916: Sửa hợp đồng font cho gói WinLocal

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-16

## 1. Mục tiêu

Cập nhật bản Windows local từ checkout hiện tại nhưng dừng phát hành khi kiểm tra font hậu đóng gói phát hiện thiếu font bắt buộc.

## 2. Tiêu chuẩn nghiệm thu

- [ ] `fonts:verify-packaged -- --platform win` xác thực toàn bộ font trong manifest.
- [ ] `package:verify` và `release:verify-assets` pass.
- [ ] Bản cài được cài im lặng; `app.asar` đóng gói và bản cài có SHA-256 trùng nhau.
- [ ] Ứng dụng cài đặt khởi động được.

## 3. Phạm vi và quyết định

- Chỉ đồng bộ `electron-builder.yml` với manifest font hiện tại: `NotoSans.ttf`, `Roboto.ttf`, và ba font script.
- Không sửa hay dọn các thay đổi tracked/untracked khác của checkout.
- Không xác nhận chạy AutoShort/OCR/TTS thật chỉ từ quy trình đóng gói.

## 4. Bằng chứng ban đầu

- `npm.cmd run typecheck`: pass.
- `npm.cmd run test:local-runtime`: không có failure; một STTN fixture skip vì `TEDIAPROS_TEST_FFMPEG` chưa đặt.
- `npm.cmd run fonts:verify-packaged -- --platform win`: fail trước sửa vì `NotoSans.ttf` không có trong `dist/win-unpacked/resources/fonts`.

## 5. Kiểm chứng sau sửa

- `npm.cmd run fonts:verify-packaged -- --platform win`: pass; 5 font, 13.37 MiB.
- `npm.cmd run package:verify`: pass; không có runtime/model bị cấm.
- `npm.cmd run release:verify-assets`: pass cho Windows-only v0.1.26.
- `npm.cmd run typecheck`: pass.
- Installer `dist/TediaPros-0.1.26-setup.exe /S`: exit code 0.
- SHA-256 `app.asar` packaged và installed: `B0025A44DD80829B5C58F3B5CA48698C2737F1D96378F9A8BFCE8F584D31E04F` (trùng nhau).
- `C:\\Users\\PC\\AppData\\Local\\Programs\\TediaPros\\TediaPros.exe` khởi động và vẫn chạy sau 5 giây.

## 6. Giới hạn bằng chứng

Quy trình này không chạy một job AutoShort, OCR, TTS, hay nhà cung cấp AI thật. Checkout vẫn có các thay đổi tracked/untracked khác không được commit, merge, dọn dẹp hoặc push bởi task này.
