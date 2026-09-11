# Luồng Lồng Tiếng & Đồng Bộ Nhịp Độ (Dubbing & TTS Flow Trace)

- **Module thực thi:** `src/main/dubbing/*`, `src/main/autoShortPolicy.ts`, `src/main/tts.ts`

---

## Trình Tự Thực Thi Chi Tiết

1. **Gom nhóm ngữ nghĩa (Semantic Grouping):**
   - Các câu phụ đề ngắn vụn vặt được gom thành các cụm câu hoàn chỉnh theo ngữ pháp (`buildSemanticGroups`), tránh tình trạng giọng đọc ngắt câu vô lý.

2. **Dự đoán thời lượng & Lập kế hoạch Source-Anchored:**
   - `durationPredictor.ts`: Ước lượng thời lượng tự nhiên của câu dịch tiếng Việt.
   - `buildDubbingPlan`: Lập cửa sổ âm thanh bám chặt theo thời điểm bắt đầu của câu gốc trong video (`window.start`), đảm bảo nhân vật mở miệng là giọng lồng tiếng cất lên.

3. **Tính toán nhịp độ & Áp dụng trần Tempo (1.10x - 1.45x):**
   - Nếu câu dịch dài hơn thời lượng video có sẵn:
     - Tăng tốc độ giọng đọc lên mức ưu tiên `1.10x` hoặc `1.25x`.
     - Nếu vẫn không vừa, tăng tối đa đến trần `1.45x`.
     - Nếu tại mức `1.45x` vẫn không thể vừa vặn: Tự động tách nhóm ngữ nghĩa tại ranh giới câu hợp lý; nếu là câu đơn lẻ thì ném lỗi yêu cầu rút gọn bản dịch, tuyệt đối không tự ý cắt cụt đuôi âm thanh.

4. **Tổng hợp giọng đọc & Lưu Cache:**
   - Tra cứu cache bằng khóa hash SHA-256 nội dung câu thoại và voice settings.
   - Nếu cache miss: Gọi API tổng hợp giọng đọc (Edge TTS, ElevenLabs hoặc Local TTS).
   - Cắt tỉa khoảng lặng thừa đầu/cuối bằng filter FFmpeg với ngưỡng `-50 dB`.
   - Ghép các đoạn audio đã căn chỉnh vào trục thời gian video (`stitchAudioTimeline`).
