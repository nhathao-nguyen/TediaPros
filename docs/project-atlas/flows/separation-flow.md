# Luồng Tách Thoại & Tự Phục Hồi GPU (Vocal Separation Flow Trace)

- **Module thực thi:** `src/main/separation/*`, `engines/separator-engine/`

---

## Trình Tự Thực Thi Chi Tiết

1. **Trích xuất Audio thô:**
   - FFmpeg trích xuất luồng âm thanh gốc từ video thành tệp WAV PCM 44.1kHz hoặc 48kHz uncompressed trong thư mục scratch.

2. **Khởi chạy MDX-Net Engine:**
   - Main process spawn tiến trình con `separator-engine` với tham số:
     `--separate --input <path.wav> --model <mdx.onnx> --provider auto --preset <fast|balanced|quality>`

3. **Tăng tốc phần cứng DirectML & Tự động Fallback CPU:**
   - Chế độ `--provider auto` kích hoạt DirectML trên DirectX 12.
   - Nếu DirectML gặp lỗi hết bộ nhớ đồ họa (`DIRECTML_OOM`) hoặc crash thiết bị:
     - Runner bắt được mã lỗi thoát khác 0.
     - Phân hệ tự động khởi động lượt chạy lại (Retry) với cờ `--provider cpu`.
     - Chuyển sang tính toán trên CPU đa luồng; ghi nhận cảnh báo vào audit log nhưng không làm hỏng tiến trình tổng thể của người dùng.

4. **Thu hồi Stems & Dọn dẹp:**
   - Engine trả về 2 tệp: `vocals.wav` (chứa tiếng nói/tiếng hát) và `instrumental.wav` (chứa nhạc nền và tiếng động).
   - Tệp `vocals.wav` được xóa bỏ (vì sẽ thay thế bằng giọng lồng tiếng AI mới).
   - Tệp `instrumental.wav` được giữ lại để chuẩn bị trộn cùng giọng đọc TTS.
