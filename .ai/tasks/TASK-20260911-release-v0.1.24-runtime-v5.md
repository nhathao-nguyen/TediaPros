# TASK-20260911: Phát hành TediaPros v0.1.24 và runtime-v5

- **Trạng thái:** Đang phát hành
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Tích hợp và phát hành các thay đổi Auto Short hiện tại dưới phiên bản ứng dụng `v0.1.24`, đồng thời xuất bản `runtime-v5` để máy khác tải đầy đủ các engine Windows theo nhu cầu.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Version, package lock và release notes đồng bộ ở `0.1.24`.
- [x] Runtime manifest chứa đủ FFmpeg, Whisper, Whisper CUDA, OCR, Video2X, Douyin, Separator và STTN.
- [x] STTN public asset dùng bản CPU portable nằm trong giới hạn GitHub; build CUDA cục bộ không bị xóa.
- [x] Typecheck, build, full local-runtime suite và các engine tests đều pass.
- [x] Installer Windows local qua package/release verification.
- [ ] Commit được fast-forward vào `main` và push.
- [ ] GitHub release `runtime-v5` được publish và đủ 8 asset đã verify.
- [ ] GitHub release `v0.1.24` được publish với installer, blockmap và `latest.yml`.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** commit/merge/push, Windows app release, runtime Windows x64 và các engine tải theo nhu cầu.
- **Nằm ngoài phạm vi:** macOS app release, STTN CUDA public asset lớn hơn 2 GiB, tự động nhúng model vào installer.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- `runtime-v5` là release bất biến mới, chưa tồn tại trên GitHub trước lần phát hành này.
- Workflow tạo từng ZIP engine từ input sạch, kiểm hash/capability rồi mới upload.
- STTN CUDA 1.1.1 đo thực tế: 4.809.810.691 byte giải nén và 3.481.046.931 byte ZIP, vượt giới hạn một asset GitHub Release. Workflow public vì vậy build PyTorch CPU; model STTN vẫn tải riêng với SHA-256 ghim sẵn.
- Lần publish đầu tiên dừng ở FFmpeg vì release BtbN `autobuild-2026-08-29-13-12` đã bị gỡ (HTTP 404). Đã re-pin sang asset tĩnh FFmpeg 9.0.1 còn tồn tại của `autobuild-2026-09-11-13-20`, kiểm tra qua GitHub API và ghim SHA-256 `af971817c209439bb0374b5e623aca894042aa435426217d0dd5cfd15fb69d1b`.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `.github/workflows/build-windows-runtime.yml`
- `[MODIFY]` `distribution/runtime-inputs.json`
- `[MODIFY]` `tests/release-tooling.test.ts`
- `[MODIFY]` `package.json`, `package-lock.json`, `RELEASE_NOTES.md`
- `[NEW]` `.ai/tasks/TASK-20260911-release-v0.1.24-runtime-v5.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
node scripts/verify-release.mjs v0.1.24
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:local-runtime
npm.cmd run test:ocr-engine
npm.cmd run test:sttn-engine
npm.cmd run test:separator-engine
npm.cmd run package:win
npm.cmd run release:verify-assets
git diff --check
```

- Release metadata, typecheck, build và full local-runtime suite: PASS, exit 0.
- Release tooling: 27/27 PASS, gồm STTN workflow và manifest 8 asset.
- OCR: 47 PASS, 10 environment-dependent skip.
- STTN: 26 test, 9 PASS và 17 dependency/media-dependent skip trên system Python; CI cài pinned build environment trước khi đóng gói.
- Separator: 13/13 PASS.
- Windows package verification: PASS; installer `TediaPros-0.1.24-setup.exe` có SHA-256 `951d512165c446f8f7e54248add4a1f177638094480a366273f08a7ae3d71aef`.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

Cập nhật checklist và URL release sau khi hai workflow GitHub kết thúc. Không gọi release thành công chỉ dựa trên việc push tag; phải xác nhận conclusion và danh sách asset từ GitHub API.
