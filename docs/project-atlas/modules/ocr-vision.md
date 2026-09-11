# Phân Hệ Nhận Diện Chữ & Thị Giác (OCR & Vision Subsystem)

- **Thư mục mã nguồn:** `src/main/ocr.ts`, `src/main/ocrMask.ts`, `src/main/ffmpegOcrMaskProbe.ts`, `src/main/whisper.ts`, `engines/ocr-engine/`, `engines/whisper-engine/`
- **Tài liệu tham chiếu:** [docs/adr/004-planar-rgb-for-ocr-blurring.md](file:///f:/Son/tool/TediaPros/docs/adr/004-planar-rgb-for-ocr-blurring.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Nhận diện chữ xuất hiện trên màn hình video bằng RapidOCR ONNX Runtime (`engines/ocr-engine/`).
- Bóc băng lời nói thành phụ đề bằng Faster-Whisper CTranslate2 (`engines/whisper-engine/`).
- Tính toán kịch bản biến thiên hình học của chữ qua thời gian (Visual Timeline) ở tần số **8 FPS**.
- Hợp nhất phụ đề giọng nói và phụ đề hình ảnh (`fuseWhisperAndOcr`).
- Sinh video mask nhị phân (`ocr-mask.mkv`) phục vụ làm mờ đa tầng Planar RGB.

---

## 2. Quy Trình Visual Timeline & Sinh Mặt Nạ
1. **Quét khung hình 8 FPS:**
   - Video được trích xuất khung hình ở tần số 8 FPS trong vùng quét chữ (`ocrRegion`).
   - RapidOCR nhận diện text, tọa độ bounding box và confidence score.
2. **Theo dõi hộp chữ qua thời gian (Tracking & Fusion):**
   - Thuật toán so khớp IoU ghép các bounding box trên các frame liên tiếp thành các Visual Segments liên tục.
   - Lọc bỏ các box nhấp nháy dưới 3 frame (flicker removal).
3. **Sinh Video Mask nhị phân (`rasterizeOcrMaskFrame`):**
   - Vẽ các hộp chữ thành ảnh grayscale nhị phân (0x00: đen/trong suốt, 0xFF: trắng/làm mờ).
   - Pipe trực tiếp vào FFmpeg để tạo file stream `ocr-mask.mkv`.

---

## 3. Kiểm Thử Liên Quan
```powershell
cmd.exe /c "npm run test:ocr-engine"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs ocr-mask.test"
cmd.exe /c "node scripts/run-local-runtime-tests.mjs ocr-visual-timeline.test"
```
