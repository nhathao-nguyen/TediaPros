# TASK-20260911: Tương thích JSON metadata từ CreateMediaTool Gemini

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

---

## 1. Mục Tiêu (Goal)

Ngăn Auto Short bỏ `tieude.txt` khi Gemini qua CreateMediaTool thêm lời dẫn hoặc code fence quanh một object metadata JSON hợp lệ, đồng thời giữ nguyên kiểm tra schema và giới hạn nội dung hiện có.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Parser nhận JSON trần, code fence và đúng một object JSON được bọc bởi lời dẫn.
- [x] Dấu ngoặc nhọn nằm trong chuỗi JSON không làm sai việc tách object.
- [x] Phản hồi có nhiều object JSON vẫn bị từ chối vì mơ hồ.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Các test title/metadata/burn liên quan pass.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Bộ phân tích phản hồi metadata trong `src/shared/videoSeo.ts`.
  - Regression test và tài liệu hợp đồng metadata.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Thay đổi server CreateMediaTool hoặc prompt sáng tạo metadata.
  - Ghi đè `tieude.txt` đã tồn tại.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* Thử parse toàn bộ phản hồi trước; khi thất bại mới quét object JSON cân bằng, có theo dõi chuỗi và escape.
- *Lý do:* CreateMediaTool chuyển nguyên văn Gemini về trường `message.content`; Gemini có thể thêm wrapper. Việc chỉ nhận đúng một object giữ phản hồi không mơ hồ và toàn bộ validation metadata vẫn chạy sau khi parse.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/shared/videoSeo.ts`
- `[MODIFY]` `tests/video-seo.test.ts`
- `[MODIFY]` `docs/domain.md`
- `[NEW]` `.ai/tasks/TASK-20260911-createmediatool-gemini-json-wrapper.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
node scripts/run-local-runtime-tests.mjs video-seo.test
node scripts/run-local-runtime-tests.mjs video-seo.test video-title.test burn-video-title.test autoshort-title-overlap.test autoshort-video-title.test autoshort-ui-contract.test
npm run typecheck
git diff --check
npm run test:local-runtime
```

### Kết quả thực tế:

- Regression ban đầu: FAIL đúng tại ca Gemini thêm lời dẫn quanh code fence.
- Regression sau sửa: PASS 9/9.
- Scoped title/metadata/burn/UI: PASS 46/46.
- Typecheck node + web: PASS.
- Live probe CreateMediaTool cổng 4982 với hai `translated.srt` gặp lỗi: cả hai trả object hợp lệ; một phản hồi có code fence và một phản hồi là JSON trần. Điều này xác nhận định dạng provider thay đổi giữa các lần gọi, nhưng không tái tạo được wrapper có lời dẫn trong hai probe này.
- Toàn bộ `test:local-runtime`: FAIL ở 2 test ngoài phạm vi và không đi qua `videoSeo.ts`: contract UI vùng OCR trong `local-runtime.test` và fixture tốc độ nói 17,5 từ/s trong `dubbing-grouping.test`. Các tệp liên quan đang có thay đổi dở từ công việc khác; không sửa gộp vào task metadata này.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Bản WinLocal đang chạy batch bằng `app.asar` cũ và chưa chứa bản sửa; không dừng tiến trình đang xử lý để tránh mất công việc.
- JSON sai cú pháp bên trong object vẫn bị từ chối đúng thiết kế.
- Repository chưa xanh toàn bộ do hai lỗi test ngoài phạm vi nêu trên; bằng chứng hoàn thành của task này là scoped suite 46/46 và typecheck.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Khởi động lại bản dev để nạp code main mới. Đóng gói/cài bản WinLocal mới sau khi batch hiện tại kết thúc.
