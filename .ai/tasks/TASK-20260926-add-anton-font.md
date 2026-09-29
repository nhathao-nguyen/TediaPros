# [TASK-20260926-add-anton-font]: Thêm Font Bundled Anton Vào TediaPros

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** ENI
- **Thời gian:** 2026-09-26

---

## 1. Mục Tiêu (Goal)

Tích hợp font chữ **Anton** (Anton Regular) chuẩn OFL-1.1 từ Google Fonts vào danh mục font mặc định (bundled fonts) của TediaPros để người dùng có thể chọn làm phụ đề và tiêu đề video với kiểu dáng đậm, nổi bật.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Font Anton được cấu hình đầy đủ trong `resources/fonts/manifest.json` với URL ghim commit immutable từ Google Fonts repository (`73fc2ff52147e34a74804b500cf89ca219eac55d`).
- [x] Khớp mã băm SHA-256 (`a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab`).
- [x] Thêm thông tin bản quyền và tác giả Anton vào `resources/fonts/licenses/NOTICES.md`.
- [x] Đồng bộ tự động sang `resources/fonts/catalog.json` thông qua `npm run fonts:prepare`.
- [x] Hỗ trợ cả 2 alias ID `anton` và `anton-regular` trong `src/main/fonts.ts` để tương thích toàn diện.
- [x] Lệnh kiểm tra xác thực font `npm run fonts:verify` pass 100%.
- [x] Lệnh `npm run typecheck` pass 100%.
- [x] Unit test `tests/burn-font-registry.test.ts` pass 100%.

---

## 3. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [resources/fonts/manifest.json](file:///f:/Son/tool/TediaPros/resources/fonts/manifest.json): Thêm cấu hình font Anton (SHA256, sourceUrl, codepoints A và ệ).
- `[MODIFY]` [resources/fonts/catalog.json](file:///f:/Son/tool/TediaPros/resources/fonts/catalog.json): Cập nhật danh mục font hiển thị trên giao diện.
- `[MODIFY]` [resources/fonts/licenses/NOTICES.md](file:///f:/Son/tool/TediaPros/resources/fonts/licenses/NOTICES.md): Thêm mục ghi nhận bản quyền Anton Project Authors.
- `[MODIFY]` [src/main/fonts.ts](file:///f:/Son/tool/TediaPros/src/main/fonts.ts): Thêm ánh xạ tương thích giữa alias `anton` và `anton-regular`.
- `[NEW]` [tests/burn-font-registry.test.ts](file:///f:/Son/tool/TediaPros/tests/burn-font-registry.test.ts): Unit test kiểm tra nhận diện và resolve font Anton.
- `[MODIFY]` [scripts/run-local-runtime-tests.mjs](file:///f:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs): Đăng ký test suite mới.

---

## 4. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
cmd.exe /c "npm run fonts:prepare && npm run fonts:verify"
# [font-pack] ready: Anton-Regular.ttf
# [font-pack] verified 6 bundled fonts (13.53 MiB), pack 2026.08.14.1

cmd.exe /c "node scripts/run-local-runtime-tests.mjs burn-font-registry.test"
# ✔ listBurnFonts includes bundled fonts including Anton (18.687ms)
# ✔ findBurnFont and resolveBurnFont resolve both anton and anton-regular aliases (0.1715ms)
# ℹ tests 2, pass 2, fail 0

cmd.exe /c "npm run typecheck"
# Exit code: 0
```
