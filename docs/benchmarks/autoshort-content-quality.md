# AutoShort Content Quality Gate

- **Ngày:** 2026-09-07
- **Phạm vi:** kiểm tra rẻ chạy trên mọi job sau khi source/target cues đã được tạo
- **Giới hạn:** đây là structural QA, không phải chứng minh bản dịch đúng nghĩa

`validateAutoShortContentQuality()` kiểm tra:

- source cue ID bị lặp, target ID bị lặp, thiếu hoặc không có source tương ứng;
- target cue rỗng;
- số, đơn vị và dấu phủ định quan trọng bị thay đổi.

Số và đơn vị được chuẩn hóa giữa các ngôn ngữ, ví dụ `15%` và `15 percent`,
`2 phút` và `2 minutes` cùng một lớp bảo vệ. Dấu phủ định được so theo số lần
xuất hiện thay vì so chuỗi tiếng Việt/tiếng Anh. Một mismatch là lỗi để tránh
xuất nội dung có nguy cơ sai; không tự sửa text hoặc âm thanh.

Sau translation, coordinator chạy gate trước separation/TTS. Nếu gate lỗi, job
dừng với cue ID và lý do cụ thể; checkpoint/output cũ không bị ghi đè. Rephrase
TTS vẫn phải giữ cue ID, số/đơn vị/phủ định và đi qua giới hạn tempo/gap của
policy. Audio nonempty, duration, tempo và gap tiếp tục được validator dubbing
kiểm tra riêng.

Các kiểm tra cấu trúc không thể phát hiện paraphrase làm mất chủ thể, quan hệ,
ngữ cảnh hoặc từ ngữ không được đánh dấu trong bộ token bảo vệ. Những trường
hợp đó phải đưa vào corpus có bản tham chiếu và human review; không gắn nhãn
`semantic fidelity` chỉ từ việc ID khớp.

## Bằng chứng hiện có

`tests/autoshort-content-quality.test.ts` bao phủ duplicate/missing/unexpected
ID, số/đơn vị sai, phủ định sai và bản dịch đổi cách viết đơn vị nhưng vẫn đúng
nghĩa. Đây là fixture local; chưa phải đánh giá trên corpus live nhiều ngôn
ngữ.
