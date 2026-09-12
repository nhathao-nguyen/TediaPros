# TASK-20260911-AUTOSHORT-RENDER-DIAGNOSTICS: Giữ nguyên nhân lỗi render Auto Short

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Điều tra các item Auto Short thất bại ở 85% và sửa đường truyền lỗi để nguyên nhân FFmpeg không còn bị thay bằng thông báo chung `Xử lý video thất bại.`. Đối chiếu bundle production xác nhận nó chưa có bản sửa reset cờ hủy giữa hai scope render.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Phân biệt lỗi render với lỗi dịch/TTS/thời lượng.
- [x] Lỗi không khởi chạy được FFmpeg được ghi vào nhật ký và trả về item hàng đợi.
- [x] Không đưa stderr thô hoặc đường dẫn thư mục tạm lên UI.
- [x] Có kiểm thử hồi quy tái hiện lỗi spawn FFmpeg.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Test Auto Short liên quan pass kèm bằng chứng log.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** `src/main/burn.ts`, kiểm thử render và chẩn đoán lỗi FFmpeg.
- **Nằm ngoài phạm vi (Out of Scope):** thay đổi thuật toán STTN, OCR, dịch hoặc TTS; khẳng định nguyên nhân hệ điều hành cụ thể của hai job cũ khi bản production đã bỏ mất stderr.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- `chay()` trả kết quả có cấu trúc gồm mã thoát, nhãn lỗi an toàn và dấu hiệu spawn thất bại.
- Dừng thử các encoder khác nếu chính tiến trình FFmpeg không thể khởi chạy; đổi encoder không thể sửa lỗi spawn.
- Dùng `errLabel()` để không ghi stderr thô hoặc đường dẫn nhạy cảm vào UI/log hỗ trợ.
- Bundle production 0.1.23 đặt `burnInFlight = true` trong `burnAutoShort()` nhưng không đặt lại `daHuy = false`; mã nguồn hiện tại đã có bản sửa vòng đời cờ hủy và kiểm thử render thật sau `cancelBurn()`.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/burn.ts`
- `[MODIFY]` `tests/burn-video-title.test.ts`
- `[NEW]` `.ai/tasks/TASK-20260911-autoshort-render-diagnostics.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs burn-video-title.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test"
cmd.exe /c "npm run typecheck"
git diff --check -- src/main/burn.ts tests/burn-video-title.test.ts .ai/tasks/TASK-20260911-autoshort-render-diagnostics.md
```

### Kết quả thực tế:

- RED: test mới thất bại vì nhận `Xử lý video thất bại.`.
- GREEN: `burn-video-title.test` pass 10/10, gồm render FFmpeg thật và lỗi spawn giả lập.
- `autoshort-ocr-pipeline.test` pass 12/12, gồm coordinator và render FFmpeg thật.
- `npm run typecheck` pass cả node và web.
- `git diff --check` pass.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Hai job cũ không giữ stderr chi tiết. Dấu vết 85%, thời gian thất bại rất ngắn, không có dòng FFmpeg, và bundle cũ thiếu reset cờ hủy cùng khớp với lỗi kế thừa `daHuy`; cần retry bằng build mới để xác nhận nghiệm thu trên chính hai input này.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Sau khi hàng đợi hiện tại dừng, chạy lại một item thất bại bằng build mới và đọc lỗi chi tiết trên item hoặc nhật ký.
