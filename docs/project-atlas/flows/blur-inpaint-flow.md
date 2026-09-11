# Luồng Làm Mờ & Xóa Chữ Video (Blur & Inpainting Flow Trace)

- **Module thực thi:** `src/main/ocrMask.ts`, `src/main/burn.ts`, `src/main/inpainting/*`, `engines/sttn-engine/`

---

## Trình Tự Thực Thi Chi Tiết

### Nhánh 1: Làm Mờ Phụ Đề Đa Tầng Planar RGB (Masked Blur)
1. **Tạo Video Mask Nhị Phân:**
   - Từ `OcrVisualTimeline`, các bounding box được vẽ lên khung hình 8-bit grayscale (0x00 đen, 0xFF trắng).
   - Pipe trực tiếp vào FFmpeg để tạo file video mask nhị phân `ocr-mask.mkv`.
2. **Bộ lọc FFmpeg Planar RGB (`format=gbrp`):**
   - Video nguồn được chuyển sang không gian màu Planar RGB: `[0:v]null,format=gbrp[display]`.
   - Tách luồng làm mờ: `[blur_source]gblur=sigma=...:steps=6[blurred]`.
   - Trộn vùng mờ qua mặt nạ: `[base][blurred][mask]maskedmerge[masked]`.
   - Kết quả: Vùng chữ cũ bị làm mờ tự nhiên, hoàn toàn không có viền lem màu YUV.

### Nhánh 2: Xóa Chữ Bằng AI Spatio-Temporal Transformer (STTN Inpainting)
1. **Chuẩn bị Dữ Liệu:**
   - Xuất kịch bản mặt nạ bounding box từ OCR sang tệp JSON giao thức `sttn-engine/1`.
2. **Khởi chạy Mạng STTN:**
   - Spawn `sttn-engine` chạy mô hình học sâu PyTorch Transformer.
   - STTN phân tích thông tin bối cảnh từ các khung hình trước và sau (Temporal Attention) để điền đầy các điểm ảnh tại vùng chữ bị xóa.
   - Xuất ra file video sạch bóng phụ đề cũ: `sttn-cleaned.mkv`.
3. **Chuyển giao cho bộ Burner:** Video đã xóa chữ được chuyển tiếp sang bước đóng phụ đề mới.
