# TASK-20260925: Khắc Phục Rập Khuôn Tiêu Đề (Anti-Template & Diversity Prompt)

- **Trạng thái:** Đã hoàn thành & Đã kiểm chứng
- **Người thực hiện:** AI Assistant
- **Thời gian:** 2026-09-25

---

## 1. Mục Tiêu (Goal)

Khắc phục tình trạng tiêu đề và text thumbnail tạo tự động cho video ngắn (YouTube Shorts, TikTok, Reels) bị dính khuôn mẫu máy móc (100% video đều dùng câu hỏi tu từ và kết thúc bằng `?!` hoặc `?`/`!`, cấu trúc cú pháp lặp lại cùng một công thức, và thumbnail text bị lặp lại 1:1 với tiêu đề).

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tiêu chuẩn 1: CẤM tuyệt đối việc lạm dụng cụm dấu `?!` hoặc `???` ở cuối tiêu đề và thumbnail text.
- [x] Tiêu chuẩn 2: Đa dạng hóa các trường phái đặt tiêu đề: quy định 80% tiêu đề là câu trần thuật tự nhiên, khẳng định hoặc ngắt nhịp (không dùng dấu câu hoặc chỉ dùng 1 dấu chấm).
- [x] Tiêu chuẩn 3: Bổ sung 5 góc tiếp cận tiêu đề tự động (Phim tài liệu khách quan, Tương phản/Nghịch lý, Hành động/Bùng nổ, Cảnh báo/Điểm mù sinh tồn, Khoảng trống tò mò).
- [x] Tiêu chuẩn 4: Phân định rạch ròi Thumbnail Text (chỉ 2–4 từ mang tính đòn bẩy thị giác, cấm lặp lại nguyên văn tiêu đề và không được trùng quá 30% từ).
- [x] Tiêu chuẩn 5: Nâng phiên bản prompt từ `video-seo-short-v6` lên `video-seo-short-v7` để kích hoạt digest mới.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Toàn bộ test suites liên quan đến SEO & Title pass 100% (`video-seo.test`, `video-title.test`, `autoshort-video-title.test`, `burn-video-title.test`, `autoshort-title-overlap.test`).

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - [src/main/videoSeoPrompt.ts](file:///f:/Son/tool/TediaPros/src/main/videoSeoPrompt.ts): Cập nhật quy tắc chống rập khuôn, bổ sung 5 góc tiếp cận tiêu đề, siết chặt quy định dấu câu và tương quan giữa Title và Thumbnail Text.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không thay đổi schema IPC hoặc hợp đồng parser [src/shared/videoSeo.ts](file:///f:/Son/tool/TediaPros/src/shared/videoSeo.ts) hay validator [src/shared/videoSeoPolicy.ts](file:///f:/Son/tool/TediaPros/src/shared/videoSeoPolicy.ts).
  - Không thay đổi luồng điều phối AutoShort [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts).

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Xóa bỏ Anchoring Bias:* Trước đây các ví dụ mẫu (few-shot) đều kết thúc bằng `?!`, khiến mô hình AI mặc định rằng tiêu đề hợp lệ bắt buộc phải có `?!` và câu hỏi tu từ kịch tính. Bằng việc cấm `?!` và khuyến khích câu trần thuật tự nhiên không dấu câu, AI sẽ tạo ra các tiêu đề đa dạng, văn minh và giống người viết hơn.
- *Phối hợp Thumbnail - Title:* Ép Thumbnail Text thành cụm từ thị giác siêu ngắn (2-4 từ) và cấm trùng trên 30% chữ so với Title, giúp ảnh thumbnail đóng vai trò bắt mắt (visual hook) còn Title làm nhiệm vụ ngữ cảnh & SEO tìm kiếm.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/main/videoSeoPrompt.ts](file:///f:/Son/tool/TediaPros/src/main/videoSeoPrompt.ts)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs video-seo.test video-title.test autoshort-video-title.test burn-video-title.test autoshort-title-overlap.test"
```

### Kết quả thực tế:
- `Typecheck`: PASS (0 errors trên cả `node` và `web`).
- `video-seo.test`: PASS (14/14 tests).
- `video-title.test`: PASS (29/29 tests).
- `autoshort-video-title.test`: PASS (3/3 tests).
- `burn-video-title.test`: PASS (9/9 passed, 2 skipped as expected).
- `autoshort-title-overlap.test`: PASS (3/3 tests).

---

## 7. Ghi Chú Bàn Giao (Handoff Notes)

Từ bản v7 (`video-seo-short-v7`), AI sẽ:
- Không còn nhồi cụm dấu `?!` hoặc hỏi tu từ ở mọi video.
- Tự động luân chuyển giữa 5 góc tiếp cận (kể chuyện khách quan, nghịch lý tương phản, bùng nổ hành động, cảnh báo sinh tồn, cliffhanger).
- Sinh Thumbnail Text độc lập (2-4 từ) bổ trợ cho Title, không còn tình trạng Title và Thumbnail lặp lại cùng một câu chữ.
