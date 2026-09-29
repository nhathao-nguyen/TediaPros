# TASK-20260925: Tối Ưu Prompt Tiêu Đề & Mô Tả Chống Spoiler / Recap (Mystery & Cliffhanger)

- **Trạng thái:** Đã hoàn thành & Đã kiểm chứng
- **Người thực hiện:** AI Assistant
- **Thời gian:** 2026-09-25

---

## 1. Mục Tiêu (Goal)

Khắc phục triệt để tình trạng tiêu đề và mô tả (description) trong tệp `tieude.txt` bị spoil toàn bộ diễn biến/kết cục của video, viết theo kiểu "recap" tóm tắt sự việc khiến người xem mất tò mò và giảm mạnh tỷ lệ nhấp (CTR) cũng như thời lượng xem (Retention) trên các nền tảng video ngắn (YouTube Shorts, TikTok, Reels).

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Tiêu chuẩn 1: Bổ sung nguyên tắc cấm spoiler bất khả xâm phạm vào prompt tạo Title (cấm đưa chấn thương, kết cục, thủ phạm, đáp án vào title; tập trung vào Curiosity Gap, câu hỏi tu từ, nghịch lý).
- [x] Tiêu chuẩn 2: Định hình lại cấu trúc Description thành Hook + Cliffhanger (Dừng lại ở cao trào/nghịch lý thay vì recap A -> B -> C; xóa bỏ tư duy tóm tắt "đọc độc lập vẫn biết video nói về gì").
- [x] Tiêu chuẩn 3: Cập nhật các phong cách mô tả (`DESCRIPTION_STYLE`) và Thumbnail Text nhằm bảo toàn tính bí ẩn và kích thích người xem xem hết video.
- [x] Tiêu chuẩn 4: Nâng phiên bản prompt từ `video-seo-short-v5` lên `video-seo-short-v6`.
- [x] Typecheck pass 100% không có lỗi (`npm run typecheck`).
- [x] Toàn bộ test suites liên quan đến SEO & Title pass 100% (`video-seo.test`, `video-title.test`, `autoshort-video-title.test`, `burn-video-title.test`, `autoshort-title-overlap.test`).

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - [src/main/videoSeoPrompt.ts](file:///f:/Son/tool/TediaPros/src/main/videoSeoPrompt.ts): Cập nhật system prompt tạo metadata SEO video ngắn.
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không thay đổi schema IPC hoặc hợp đồng parser [src/shared/videoSeo.ts](file:///f:/Son/tool/TediaPros/src/shared/videoSeo.ts) hay validator [src/shared/videoSeoPolicy.ts](file:///f:/Son/tool/TediaPros/src/shared/videoSeoPolicy.ts).
  - Không thay đổi luồng điều phối AutoShort [src/main/autoShortItemCoordinator.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortItemCoordinator.ts).

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Nguyên tắc "Show The Spark, Hide The Fire":* Thay vì để AI tóm tắt diễn biến theo trình tự thời gian hoặc bổ sung chi tiết giải thích cho người đọc hiểu ngay, prompt ép AI chỉ nhen nhóm đốm lửa (mâu thuẫn, tình thế ngặt nghèo) và giấu ngọn lửa (kết quả, giải pháp, số phận nhân vật) sau một cliffhanger kết thúc bằng dấu `...` hoặc câu hỏi bỏ ngỏ.
- *Nâng phiên bản prompt:* Nâng `VIDEO_SEO_PROMPT_VERSION` lên `video-seo-short-v6` giúp hàm `buildVideoSeoInputDigest` tự động cập nhật digest, tránh dùng lại cache tiêu đề của phiên bản prompt cũ.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` [src/main/videoSeoPrompt.ts](file:///f:/Son/tool/TediaPros/src/main/videoSeoPrompt.ts)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "npm run typecheck"
cmd.exe /c "npm run test:local-runtime video-seo.test"
cmd.exe /c "npm run test:local-runtime video-title.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs autoshort-video-title.test burn-video-title.test autoshort-title-overlap.test"
```

### Kết quả thực tế:
- `Typecheck`: PASS (0 errors trên cả `node` và `web`).
- `video-seo.test`: PASS (14/14 tests).
- `video-title.test`: PASS (29/29 tests).
- `autoshort title integration tests`: PASS (14/14 tests).

---

## 7. Ghi Chú Bàn Giao (Handoff Notes)

Từ lần chạy tiếp theo (AutoShort hoặc tạo tiêu đề thủ công), AI sẽ tuân theo prompt v6:
- Title sẽ không còn tiết lộ thương tích hay kết quả cụ thể (ví dụ: không còn đặt kiểu *"Đứt lìa chân sau liệu có sống nổi?!"* mà chuyển sang *"Thoát khỏi miệng tử thần nhưng cái giá quá đắt?!"*).
- Description sẽ dừng lại ở tình huống ngặt nghèo (cliffhanger), kích thích người xem xem hết video thay vì đọc caption là biết hết.
