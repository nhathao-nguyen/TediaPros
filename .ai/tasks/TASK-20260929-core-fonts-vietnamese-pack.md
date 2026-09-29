# [TASK-20260929-CORE-FONTS-VIETNAMESE-PACK]: Triển Khai Bộ Core Fonts 24 Font Tiếng Việt & Đóng Gói Bộ Cài v0.1.28

- **Trạng thái:** Hoàn thành
- **Người thực hiện:** Antigravity Agent
- **Thời gian:** 2026-09-29

---

## 1. Mục Tiêu (Goal)

1. Đóng gói bộ cài mới (`TediaPros-0.1.28-setup.exe`) để các máy đã cài bản cũ có thể nâng cấp mượt mà.
2. Triển khai bộ Core Fonts chuẩn mực gồm 20 font tiếng Việt tuyển chọn (đã kiểm chứng 100% glyph tiếng Việt `ộ` và `Đ`) + 4 font đa ngôn ngữ (CJK, Thái, Ả Rập, Latin chuẩn), ghim SHA-256 vào `manifest.json`, phân nhóm chủ đề trực quan trên UI và tuân thủ bản quyền OFL-1.1 trong `NOTICES.md`.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Đóng gói thành công installer Windows NSIS: `dist/TediaPros-0.1.28-setup.exe`.
- [x] Tải và ghim chính xác mã băm SHA-256 cho 24 font trong `resources/fonts/manifest.json`.
- [x] Tự động sinh `resources/fonts/catalog.json` phân nhóm chủ đề:
  - `🔥 Shorts & Tiêu đề`: Anton, Oswald, Lobster
  - `✨ Hiện đại (Tối ưu TV)`: Be Vietnam Pro, Inter, Montserrat, Manrope, Space Grotesk, Plus Jakarta Sans, Lexend, Roboto
  - `🎨 Thân thiện & Sáng tạo`: Comfortaa, Nunito, Quicksand
  - `☕ Báo chí & Kể chuyện`: Playfair Display, Lora
  - `✍️ Viết tay & Nghệ thuật`: Dancing Script, Pacifico, Patrick Hand
  - `💻 Công nghệ & Tech`: JetBrains Mono
  - `🌐 Đa ngôn ngữ`: Noto Sans, Noto Sans CJK, Noto Sans Thai, Noto Sans Arabic
- [x] Cập nhật đầy đủ bản quyền và tác giả trong `resources/fonts/licenses/NOTICES.md`.
- [x] `verify-fonts.mjs` và `verify-packaged-fonts.mjs` pass 100% với 24 fonts (18.27 MiB).
- [x] `package:verify` pass 100% không vi phạm quy tắc đóng gói binary/model.
- [x] Bộ test `tests/burn-font-registry.test.ts` pass 100%.

---

## 3. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [package.json](file:///f:/Son/tool/TediaPros/package.json): Nâng version lên `0.1.28`.
- `[MODIFY]` [electron-builder.yml](file:///f:/Son/tool/TediaPros/electron-builder.yml): Cập nhật extraResources filter thành `*.ttf`, `*.otf` để tự động đóng gói toàn bộ font trong catalog.
- `[MODIFY]` [resources/fonts/manifest.json](file:///f:/Son/tool/TediaPros/resources/fonts/manifest.json): Bổ sung 18 font mới với SHA-256 ghim chặt, commit `73fc2ff52147e34a74804b500cf89ca219eac55d`, bản quyền OFL-1.1 và codepoints kiểm chứng.
- `[MODIFY]` [resources/fonts/catalog.json](file:///f:/Son/tool/TediaPros/resources/fonts/catalog.json): Cập nhật 24 fonts phân loại theo 7 nhóm chủ đề.
- `[MODIFY]` [resources/fonts/licenses/NOTICES.md](file:///f:/Son/tool/TediaPros/resources/fonts/licenses/NOTICES.md): Thêm thông tin bản quyền và tác giả của toàn bộ các font mới.
- `[MODIFY]` [tests/burn-font-registry.test.ts](file:///f:/Son/tool/TediaPros/tests/burn-font-registry.test.ts): Bổ sung assertions kiểm tra font mới (`be-vietnam-pro`, `oswald`, `inter`, `lobster`).

---

## 4. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
cmd.exe /c "npm run fonts:prepare && npm run fonts:verify"
# [font-pack] verified 24 bundled fonts (18.27 MiB), pack 2026.09.29.1

cmd.exe /c "node scripts/run-local-runtime-tests.mjs burn-font-registry.test"
# pass 2/2 tests (121ms)

cmd.exe /c "npm run typecheck"
# PASS (0 errors)

cmd.exe /c "npm run package:win"
# [font-pack] packaged verification passed: dist\win-unpacked\resources\fonts | 24 fonts | 18.27 MiB | pack 2026.09.29.1
# building target=nsis file=dist\TediaPros-0.1.28-setup.exe archs=x64 oneClick=false perMachine=false
# PASS: No prohibited core runtime binaries, CUDA DLLs, or model assets in packaged output.
```
