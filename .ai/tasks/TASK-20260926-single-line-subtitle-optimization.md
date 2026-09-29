# [TASK-20260926-single-line-subtitle-optimization]: Tối Ưu Phụ Đề 1 Dòng (Social · Nhịp Nhanh)

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** ENI
- **Thời gian:** 2026-09-26

---

## 1. Mục Tiêu (Goal)

Trước đây, cả 3 chế độ bố cục trong "Tự tối ưu phụ đề" (`readable`, `social`, `vertical`) đều cố định `maxLines: 2`. Khi người dùng tạo video ngắn (Shorts/Reels/TikTok) và bật tính năng tự tối ưu phụ đề với nhịp hiển thị `Social · nhịp nhanh`, phụ đề vẫn bị ngắt và chia thành 2 dòng, gây che khuất nội dung video dọc.
Nhiệm vụ: Cập nhật chế độ `social` thành `maxLines: 1` để khi bật tự tối ưu phụ đề, hệ thống tự động ngắt và chia thành các đoạn phụ đề hiển thị đúng **1 dòng duy nhất** theo nhịp nói nhanh của video ngắn.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Hàm `subtitleLayoutRules('social')` trả về `maxLines: 1` trong [src/shared/subtitleLayout.ts](file:///f:/Son/tool/TediaPros/src/shared/subtitleLayout.ts).
- [x] Khi `autoOptimize` bật và chọn `social`, `planSubtitleLayout` chia các đoạn chữ dài thành các segment đúng 1 dòng duy nhất.
- [x] Cập nhật nhãn tùy chọn trong select box ở [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx) và [src/renderer/src/components/VideoEditor.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/VideoEditor.tsx) thành `Social · 1 dòng (nhịp nhanh)`.
- [x] Giữ nguyên tính tương thích hợp đồng IPC (`readable`, `social`, `vertical`).
- [x] `npm run test:subtitles` pass 100%.
- [x] Unit test `tests/subtitle-layout.test.ts` pass 100%.
- [x] `npm run typecheck` pass 100% không có lỗi.

---

## 3. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/shared/subtitleLayout.ts](file:///f:/Son/tool/TediaPros/src/shared/subtitleLayout.ts): Thiết lập `maxLines: 1` cho `social` profile.
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx): Cập nhật hiển thị tùy chọn `Social · 1 dòng (nhịp nhanh)`.
- `[MODIFY]` [src/renderer/src/components/VideoEditor.tsx](file:///f:/Son/tool/TediaPros/src/renderer/src/components/VideoEditor.tsx): Cập nhật hiển thị tùy chọn `Social · 1 dòng (nhịp nhanh)`.
- `[MODIFY]` [scripts/smoke-subtitles.ts](file:///f:/Son/tool/TediaPros/scripts/smoke-subtitles.ts): Bổ sung kiểm tra `subtitleLayoutRules('social').maxLines === 1`.
- `[NEW]` [tests/subtitle-layout.test.ts](file:///f:/Son/tool/TediaPros/tests/subtitle-layout.test.ts): Unit test kiểm tra phân đoạn phụ đề 1 dòng.
- `[MODIFY]` [scripts/run-local-runtime-tests.mjs](file:///f:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs): Đăng ký `subtitle-layout.test`.

---

## 4. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs subtitle-layout.test"
# ✔ subtitleLayoutRules assigns 1 maxLine for social and 2 for readable/vertical (0.64ms)
# ✔ planSubtitleLayout splits multiline cues into 1-line segments for social profile (11.59ms)
# ℹ tests 2, pass 2, fail 0

cmd.exe /c "npm run test:subtitles"
# [SUBTITLE TEST] Logic verified: 2 cues, 14 tokens, 6 beats
# subtitle smoke OK

cmd.exe /c "npm run typecheck"
# Exit code: 0
```
