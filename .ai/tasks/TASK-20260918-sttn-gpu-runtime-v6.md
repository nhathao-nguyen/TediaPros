# TASK-20260918-STTN-GPU-RUNTIME-V6: Phát Hành STTN CUDA Cho Máy Khác

- **Trạng thái:** Đang làm
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-18

---

## 1. Mục Tiêu (Goal)

Thay runtime STTN Windows chỉ có CPU bằng bản PyTorch CUDA 11.8 có CPU fallback, phân phối an toàn cho máy khác qua runtime-v6 và app 0.1.27.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Workflow ghim `torch==2.7.1+cu118` và từ chối artifact không quảng bá `cuda`.
- [x] Gói STTN lớn được chia multipart, ghim SHA-256 từng part và toàn archive.
- [x] Installer ghép part theo thứ tự, kiểm tra checksum trước khi giải nén/probe/promote.
- [x] `npm run typecheck` pass 100% không có lỗi.
- [x] Test runtime/release liên quan pass.
- [ ] GitHub Actions phát hành và asset list runtime-v6 được xác minh.
- [ ] App v0.1.27 trỏ mặc định đến runtime-v6 và được phát hành.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** runtime manifest/installer, packer/verifier/publisher, workflow Windows, kênh runtime, metadata app, test hồi quy và tài liệu.
- **Nằm ngoài phạm vi:** thay model STTN, thay thuật toán inpainting, DirectML, cam kết hiệu năng trên GPU chưa chạy acceptance.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Chia byte stream của ZIP CUDA thành các asset tối đa 1.500.000.000 byte.
- *Lý do:* Bản GPU thực tế khoảng 4,81 GB sau giải nén và ZIP khoảng 2,73 GB, vượt giới hạn một GitHub Release asset; multipart giữ nguyên artifact đã probe thay vì loại bỏ DLL không có bằng chứng.
- *Lựa chọn:* Runtime-v6 là kênh immutable mới; không sửa runtime-v5 đã phát hành.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `distribution/runtime-inputs.json`
- `[MODIFY]` `.github/workflows/build-windows-runtime.yml`
- `[MODIFY]` `src/main/runtimeManifest.ts`
- `[MODIFY]` `src/main/runtimeInstaller.ts`
- `[MODIFY]` `scripts/pack-runtime-release.mjs`
- `[MODIFY]` `scripts/verify-runtime-release.mjs`
- `[MODIFY]` `scripts/publish-github-release.mjs`
- `[MODIFY]` cấu hình runtime-v6, metadata app, test và ADR liên quan.

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs canonical-runtime-migration.test
node scripts/run-local-runtime-tests.mjs release-tooling.test
npm.cmd run test:sttn-engine
npm.cmd run test:local-runtime
npm.cmd run build
git diff --check
```

### Kết quả thực tế:

- `Typecheck`: PASS (0 errors).
- `canonical-runtime-migration.test`: PASS (18/18).
- `release-tooling.test`: PASS (27/27 sau khi cập nhật fixture kênh runtime-v6).
- `test:sttn-engine`: PASS (26 tests; 9 pass, 17 skip có chủ đích vì Python hệ thống không có PyTorch/media dependencies).
- `test:local-runtime`: PASS toàn bộ suite; các case cần FFmpeg fixture được skip khi `TEDIAPROS_TEST_FFMPEG` chưa đặt.
- `build`: PASS; chỉ có cảnh báo Vite về module vừa static import vừa dynamic import đã tồn tại.
- `git diff --check`: PASS.
- GPU probe cục bộ hiện tại: STTN 1.1.1, provider `cuda`, GTX 1660 SUPER; đây là bằng chứng artifact cục bộ, chưa phải bằng chứng GitHub artifact mới.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Chưa có kết quả remote CI, asset list runtime-v6 hoặc app v0.1.27 tại thời điểm lập bản ghi này.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Chỉ đánh dấu Hoàn thành sau khi workflow runtime-v6 và release app v0.1.27 thành công, sau đó xác minh asset/manifest qua GitHub API.
