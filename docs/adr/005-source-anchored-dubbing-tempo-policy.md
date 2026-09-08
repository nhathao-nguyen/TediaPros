# ADR 005: Chính Sách Điều Chỉnh Nhịp Độ Lồng Tiếng Neo Theo Bản Gốc (Source-Anchored Dubbing Tempo Policy)

- **Trạng thái:** Đã chấp thuận (Accepted)
- **Ngày quyết định:** 2026-08-30
- **Tác giả:** Kiến trúc sư TediaPros

---

## Bối Cảnh (Context)

Trong bài toán lồng tiếng tự động cho video ngắn (AutoShort Dubbing), câu dịch (ví dụ: Tiếng Trung dịch sang Tiếng Việt) thường có số âm tiết dài hơn câu gốc từ 15% đến 40%.
Nếu xử lý ngây thơ:
- **Tăng tốc mù quáng (Blind Time-Stretching):** Ép tempo lên 1.7x – 2.5x làm giọng đọc bị méo mó, the thé, giống tiếng sóc chuột và không thể nghe hiểu.
- **Giữ nguyên thời lượng:** Khiến âm thanh câu trước đè lên âm thanh câu sau, tạo mớ hỗn độn (audio collision) hoặc làm lệch pha hoàn toàn hình ảnh - âm thanh (drift).
- **Nuốt chữ / Bỏ câu (Silent Dropping):** Tự ý ngắt âm thanh khi hết thời lượng làm mất thông tin quan trọng của video.

---

## Quyết Định (Decision)

Áp dụng chính sách **Neo theo nhịp thoại gốc với các ràng buộc vật lý nghiêm ngặt** ([src/main/autoShortPolicy.ts](file:///f:/Son/tool/TediaPros/src/main/autoShortPolicy.ts) và [src/main/dubbing/policy.ts](file:///f:/Son/tool/TediaPros/src/main/dubbing/policy.ts)):
1. **Thiết lập trần nhịp độ (Tempo Bounds):**
   - *Preferred Max:* `1.10x`
   - *Normal Max:* `1.25x`
   - *Hard Ceiling:* `1.45x` (Trần tối đa tuyệt đối, không cho phép vượt qua).
2. **Khoảng đệm bảo vệ (Protected Silence Gap):**
   - Duy trì tối thiểu `0.50s` khoảng lặng tự nhiên trước câu tiếp theo để tai người kịp nghỉ ngơi và tiếp nhận thông tin.
3. **Cắt tỉa khoảng lặng vật lý (Calibrated Silence Trimming):**
   - Sử dụng bộ lọc phát hiện âm thanh ở ngưỡng `-50 dB` với độ trễ bắt đầu `30ms` và độ trễ kết thúc `100ms` để loại bỏ phần thừa của tệp TTS sinh ra mà không làm mòn âm đầu/âm cuối.
4. **Cấp khe thoại đo được thay vì nuốt chữ (Measured Speech Slot vs. Silent Drop):**
   - `sourceStart`, `sourceEnd` và thứ tự source cue là ledger bất biến. Với chế độ thay thế audio hoặc tách thoại, nếu audio đo được chỉ thiếu một phần nhỏ để fit, lời đọc được bắt đầu sớm tối đa `0.35s` trong khoảng lặng dẫn đã xác minh. Cách này không làm thay đổi deadline của cue kế tiếp và vẫn giữ khoảng lặng bảo vệ `0.50s`.
   - Chế độ trộn với audio nguồn không được mượn khoảng lặng dẫn để tránh chồng tiếng nguồn. Start của phụ đề và clip luôn dùng start đã lập lịch, còn mốc nguồn vẫn được lưu riêng để kiểm tra.
5. **Quy tắc phân tách ngữ nghĩa thay vì nuốt chữ (Semantic Splitting vs. No Silent Drop):**
   - Khi câu thoại dài không thể nhét vừa ở mức tempo `1.45x`:
     - Nếu WAV đo được thuộc nhóm nhiều cues và lời đích có đủ câu hoàn chỉnh tương ứng: Tự động tách tại ranh giới source cue, sau đó tổng hợp lại từng phần trong cửa sổ riêng. Fallback này được giới hạn theo độ sâu và chỉ chạy sau lần đo thật, không dựa vào predictor để rewrite lời.
     - Nếu chỉ có 1 cue: Báo lỗi vượt quá dung lượng thời gian để người dùng hoặc AI tinh chỉnh bản dịch, **tuyệt đối không âm thầm cắt bỏ câu thoại**.

---

## Hệ Quả (Consequences)

### Tích cực:
- Giọng lồng tiếng giữ được âm sắc tự nhiên, tròn vành rõ chữ, nhịp điệu dễ nghe như người thật.
- Khớp nối hoàn hảo với chuyển động môi và hành động của nhân vật trong video gốc.
- Đảm bảo tính toàn vẹn nội dung của kịch bản dịch.

### Tiêu cực / Đánh đổi:
- Yêu cầu bản dịch ban đầu phải được rút gọn tương đối vừa vặn với độ dài câu gốc; nếu bản dịch quá dài, pipeline sẽ từ chối hoặc cần tách phân đoạn.
