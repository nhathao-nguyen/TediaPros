# Luồng Render Phụ Đề ASS & Muxing Video (Subtitle Burning Flow Trace)

- **Module thực thi:** `src/main/burn.ts`, `src/main/fonts.ts`, `src/main/fontMeasure.ts`, `src/shared/subtitleEffects.ts`

---

## Trình Tự Thực Thi Chi Tiết

1. **Phân tích Đo Đạc Font Ký Tự (`opentype.js`):**
   - Đọc tệp font `.ttf` tương ứng trong kho font an toàn.
   - Đo đạc bề rộng, chiều cao glyph của từng từ tiếng Việt có dấu.
   - Đảm bảo câu dài tự động xuống dòng hợp lý, không tràn viền màn hình điện thoại 9:16.

2. **Khởi tạo Kịch Bản Phụ Đề ASS Nâng Cao:**
   - **Kiểu Standard:** Hiển thị tĩnh từng câu theo khung thời gian.
   - **Kiểu Word-Reveal:** Từng từ xuất hiện đồng bộ theo tiến trình đọc của audio (`{\alpha&HFF&}` $\rightarrow$ `{\alpha&H00&}`).
   - **Kiểu Word-Highlight:** Cả câu hiển thị sẵn, từ đang đọc được tô màu nhấn (Highlight Color).
   - Tích hợp tiêu đề video (`videoTitle`) ở góc trên màn hình nếu người dùng bật tùy chọn.

3. **Tổng Hợp FFmpeg Libass Burning:**
   - Gắn bộ lọc phụ đề: `ass=sub.ass:fontsdir=<safeFontsDir>`.
   - Ghép luồng âm thanh đã trộn (giọng đọc + instrumental).
   - Mã hóa đầu ra video chuẩn H.264 (libx264, preset medium, crf 20) và AAC audio (192kbps).
   - Kiểm tra tính toàn vẹn của file đầu ra trước khi công bố hoàn tất.
