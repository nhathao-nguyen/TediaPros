# TASK-20260911-AUTOSHORT-RENDER-CANCEL-RESET-FIX: Không Kế Thừa Cờ Hủy Sang Lần Render Sau

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Sửa trường hợp Auto Short đi qua TTS và audio nhưng stage render thất bại tức thì với `Xử lý video thất bại.` sau khi một job trước đó đã gọi `cancelBurn()`.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tái hiện chuỗi `cancelBurn()` rồi gọi `burnAutoShort()` trong cùng tiến trình.
- [x] Render mới khởi động FFmpeg và tạo MP4 thay vì kế thừa trạng thái hủy cũ.
- [x] Cơ chế hủy tiến trình đang chạy và render lock được giữ nguyên.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Test TTS, OCR mask và render liên quan đều pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** Vòng đời trạng thái hủy của `burnAutoShort`, regression test hủy rồi render lại, tài liệu vòng đời main process.
- **Nằm ngoài phạm vi (Out of Scope):** Không thay đổi encoder, filter planar RGB, quy tắc blur, subtitle, audio mix hoặc chính sách tempo.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Đặt `daHuy = false` sau khi render mới chiếm `burnInFlight` lock.
- *Lý do:* `daHuy` biểu diễn trạng thái của scope render hiện tại. `cancelBurn()` phải dừng scope đang chạy, nhưng scope mới không được kế thừa cờ hủy đã hoàn tất.
- *Bảo toàn cạnh tranh:* Reset diễn ra sau kiểm tra lock và sau khi lock được chiếm, nên không mở đường cho hai render chạy đồng thời.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/burn.ts`
- `[MODIFY]` `tests/burn-video-title.test.ts`
- `[MODIFY]` `docs/architecture.md`
- `[NEW]` `.ai/tasks/TASK-20260911-autoshort-render-cancel-reset-fix.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
node scripts/run-local-runtime-tests.mjs burn-video-title.test
node scripts/run-local-runtime-tests.mjs dubbing-plan.test autoshort-tts-pipeline.test
node scripts/run-local-runtime-tests.mjs autoshort-ocr-burn.test autoshort-ocr-pipeline.test
npm.cmd run typecheck
```

### Kết quả thực tế:

- RED: test `cancelBurn()` rồi `burnAutoShort()` lỗi `Xử lý video thất bại.` trước bản sửa.
- GREEN: `burn-video-title.test` PASS 9/9; MP4 sau hủy được tạo và tồn tại.
- Dubbing/TTS PASS 44/44 và 5/5.
- OCR burn/pipeline PASS 10/10 và 12/12, gồm render FFmpeg thật với timed OCR mask, ASS và planar RGB.
- Typecheck node + web PASS, 0 lỗi.
- Electron Dev chạy lại video thật `7490083913512045863`: TTS PASS 45/45, audio PASS 45/45, render PASS và publish PASS.
- MP4 cuối có H.264 `1080x1920`, `yuv420p`, 30 fps, AAC và thời lượng video/audio cùng 211.733s; output 343,972,939 byte. `tieude.txt` và audit summary `status=succeeded` được ghi cùng thư mục item.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Không còn rủi ro đã biết trong phạm vi vòng đời cờ hủy render.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Dev đã được restart với bundle mới và vẫn để mở sau khi kiểm chứng; batch được dừng sau item đầu để không xử lý ngoài phạm vi thêm 89 video.
