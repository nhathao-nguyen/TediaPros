# AutoShort Worker và TTS Server Qualification

- **Ngày:** 2026-09-07
- **T15 resident Whisper worker:** `unqualified` / chưa bật mặc định
- **T16 TTS conditioning/warm server:** `unqualified` / chưa bật mặc định

## Vì sao chưa bật

Client hiện có protocol Faster-Whisper và TTS server riêng nhưng lượt này không
có benchmark cold/warm trên server thật, không có mã backend conditioning/reference
để review, và không có bằng chứng worker resident giảm tổng thời gian sau khi
tính startup, memory, cancel và restart. Tự tạo endpoint hoặc thay model để
lấy một con số đẹp sẽ làm mất ranh giới evidence.

## Điều kiện để mở qualification

1. Chốt commit backend, model/runtime hash, API schema và giới hạn concurrent
   request; không dùng URL/token tìm thấy tự động.
2. So sánh process hiện tại với resident worker trên cùng corpus, model,
   source hash và device ở cold, warm, restart và cancel. Đo startup, inference,
   IPC/upload, peak RAM/VRAM, orphan process và tổng wall time.
3. TTS phải chứng minh reference audio upload/conditioning được reuse đúng
   voice/model, cache key có content hash, server restart re-register đúng một
   lần, 401/403/billing không retry mù, và concurrent voices không vượt ngân
   sách đã chốt.
4. Chạy content/media quality matrix và rollback về path tuần tự nếu worker
   hoặc server không sẵn sàng.

Cho đến khi đủ các điều kiện trên, cache stage local, overlap sau ASR và TTS
lookahead một cue là các tối ưu duy nhất có thể thử độc lập; cả ba vẫn phải
được đo A/B trước khi đổi default.
