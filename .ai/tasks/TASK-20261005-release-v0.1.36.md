# TASK-20261005-release-v0.1.36: Phát hành TediaPros v0.1.36 với bộ xác thực thời lượng render video linh hoạt

- **Trạng thái:** Hoàn thành; v0.1.36 đã xuất bản
- **Người thực hiện:** Antigravity
- **Thời gian:** 2026-10-05

## 1. Mục Tiêu

Phát hành phiên bản TediaPros v0.1.36 lên GitHub với cải tiến xác thực thời lượng video xuất (`validateDurationMeasurement`), hỗ trợ dung sai an toàn cho trường hợp video có đuôi âm thanh (audio tail) do padding AAC và ghim `outputDuration` chính xác theo thời lượng luồng video thực tế.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Triển khai `validateDurationMeasurement` trong `src/main/burn.ts` hỗ trợ so khớp cả `streamDuration` và `containerDuration` trong dung sai cho phép.
- [x] Ghim `outputDuration` trong `src/main/autoShortItemCoordinator.ts` theo `visualDurationSeconds`.
- [x] Bộ kiểm thử đơn vị `tests/rendered-media-validation.test.ts` (8/8 pass) và tích hợp `tests/autoshort-ocr-pipeline.test.ts` (11/11 pass).
- [x] Toàn bộ test suite `npm run test:local-runtime` vượt qua không có lỗi nào.
- [x] Typecheck `npm run typecheck` vượt qua cả node và web.
- [x] Kiểm tra cổng phát hành `node scripts/verify-release.mjs v0.1.36` thành công.
- [x] Kiểm tra khói phụ đề `npm run test:subtitles` và font `npm run fonts:prepare && npm run fonts:verify` thành công.
- [x] Commit các thay đổi, tạo tag `v0.1.36` và push lên nhánh `SonVersion` cùng tag lên GitHub.
- [x] Giám sát GitHub Actions pipeline build và xuất bản GitHub Release v0.1.36 thành công.

## 3. Phạm Vi

- `src/main/burn.ts`
- `src/main/autoShortItemCoordinator.ts`
- `docs/adr/011-vfr-preserving-render-validation.md`
- `tests/rendered-media-validation.test.ts`
- `tests/autoshort-ocr-pipeline.test.ts`
- `package.json`, `package-lock.json`, `RELEASE_NOTES.md`

## 4. Quyết Định

- Nâng phiên bản từ `0.1.35` lên `0.1.36` theo quy chuẩn semver và giữ phiên bản `v0.1.35` đã phát hành bất biến.
- Đẩy tag `v0.1.36` để kích hoạt workflow `.github/workflows/release-app.yml` tự động build trên runner sạch, đóng gói và phát hành release chính thức.

## 5. Bàn Giao

[Release v0.1.36](https://github.com/nhathao-nguyen/TediaPros/releases/tag/v0.1.36) đã được xuất bản tự động qua GitHub Actions CI run [#37253611378](https://github.com/nhathao-nguyen/TediaPros/actions/runs/37253611378).

| Asset | Trạng thái |
| --- | --- |
| `TediaPros-0.1.36-setup.exe` | Đã xuất bản |
| `TediaPros-0.1.36-setup.exe.blockmap` | Đã xuất bản |
| `latest.yml` | Đã xuất bản |

