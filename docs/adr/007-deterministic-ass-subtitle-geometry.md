# ADR 007: Tính Toán Tọa Độ Hình Học Phụ Đề ASS Xác Định Bằng Opentype.js

- **Trạng thái:** Đã chấp thuận (Accepted)
- **Ngày quyết định:** 2026-08-28
- **Tác giả:** Kiến trúc sư TediaPros

---

## Bối Cảnh (Context)

TediaPros hỗ trợ các kiểu hiển thị phụ đề hiện đại cho video ngắn (Reels, TikTok, Shorts):
- **Word-Reveal:** Từng từ hiện dần theo giọng đọc.
- **Word-Highlight:** Từng từ được đổi màu nhấn (karaoke style) trong khi cả câu đã hiển thị.
- Hộp nền bo góc (Box background) bám sát kích thước thực tế của dòng chữ.

Nếu phó mặc cho thư viện Libass của FFmpeg tự động xuống dòng (auto-wrapping):
1. Khi đổi màu hoặc chèn hiệu ứng override tags (`{\k...}` hoặc `{\c&H...&}`), Libass có thể ngắt dòng bất ngờ giữa chừng làm chữ bị nhảy dòng (jittering/layout shifting).
2. Chiều rộng của hộp nền không thể khớp chính xác từng pixel với độ dài câu chữ.
3. Không thể đoán trước được vị trí phụ đề trên các độ phân giải màn hình khác nhau (9:16 dọc vs 16:9 ngang).

---

## Quyết Định (Decision)

1. **Tính toán trước hình học phụ đề (Pre-calculated Geometry):**
   - Sử dụng thư viện [opentype.js](file:///f:/Son/tool/TediaPros/src/main/fontMeasure.ts) để phân tích trực tiếp file font `.ttf`/`.otf`, đo đạc chiều rộng, chiều cao, ascender/descender của từng glyph ký tự theo cỡ chữ (`fontSize`).
2. **Ngắt dòng tường minh (Explicit Line Breaking):**
   - Bộ lập kế hoạch layout ([src/shared/subtitleLayout.ts](file:///f:/Son/tool/TediaPros/src/shared/subtitleLayout.ts)) tự động tính toán điểm ngắt dòng tối ưu theo quy tắc từ ngữ tiếng Việt/ngoại ngữ và chèn ký tự ngắt dòng cứng `\N`.
3. **Cố định tọa độ từng từ:**
   - Khi áp dụng hiệu ứng Word-Highlight hoặc Word-Reveal, toàn bộ vị trí tương đối của từng từ được tính toán cố định trước, Libass chỉ việc render theo đúng tọa độ pixel đã định mà không cần tính toán lại layout.

---

## Hệ Quả (Consequences)

### Tích cực:
- **Ổn định tuyệt đối:** Triệt tiêu 100% hiện tượng chữ bị nhảy dòng, giật cục hoặc lệch hộp nền khi phát video.
- **Tính xác định cao (Deterministic):** Kết quả hiển thị giống hệt nhau trên cả bản xem trước (React Canvas/HTML) và bản xuất FFmpeg Libass.

### Tiêu cực / Đánh đổi:
- Yêu cầu phải nạp và phân tích file font thật bằng `opentype.js` trước khi xuất phụ đề.
