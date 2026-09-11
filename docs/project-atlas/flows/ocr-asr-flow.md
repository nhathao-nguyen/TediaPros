# Luồng Bóc Băng & Quét Chữ Phụ Đề (OCR & ASR Flow Trace)

- **Module thực thi:** `src/main/ocr.ts`, `src/main/whisper.ts`, `engines/ocr-engine/`, `engines/whisper-engine/`, `src/shared/autoShortAlignment.ts`

---

## Trình Tự Thực Thi Chi Tiết

1. **Bóc băng giọng nói Faster-Whisper (ASR):**
   - Trích xuất audio từ video sang định dạng WAV 16kHz mono.
   - Khởi chạy engine Python `whisper-engine` với mô hình đã chọn (`base`, `small`, `medium`).
   - Tận dụng card đồ họa rời NVIDIA qua CUDA (CTranslate2) nếu khả dụng, hoặc chạy trên đa luồng CPU.
   - Bóc tách từng câu nói kèm timestamp bắt đầu, kết thúc và danh sách từ vựng chi tiết (`words: [{text, start, end, probability}]`).

2. **Quét chữ màn hình RapidOCR (Visual OCR):**
   - Trích xuất khung hình video ở tần số cố định **8 FPS** trong vùng quét chữ (`ocrRegion`).
   - RapidOCR ONNX nhận diện các khối văn bản và bounding box trên từng frame.
   - Thuật toán IoU gom nhóm các bounding box liên tiếp thành `OcrVisualTimeline`.

3. **Thuật toán Hợp Nhất Phụ Đề (`fuseWhisperAndOcr`):**
   - Khi người dùng chọn phương thức `whisper-ocr`:
     - Phụ đề giọng nói (Whisper) có độ chính xác cao về timestamp phát âm nhưng có thể sai chính tả tên riêng hoặc thuật ngữ.
     - Phụ đề hình ảnh (OCR) có độ chính xác tuyệt đối về mặt chữ hiển thị trên màn hình nhưng timestamp có thể bị trễ.
     - Hàm `fuseWhisperAndOcr` so khớp ngữ nghĩa và căn chỉnh mốc thời gian: Lấy timestamp chuẩn xác của Whisper kết hợp với nội dung văn bản chuẩn xác của OCR, tạo ra bản phụ đề nguồn tối ưu nhất.
