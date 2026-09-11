# ADR 004: Chuyển Đổi Sang Planar RGB Khi Làm Mờ Phụ Đề / Chữ Video (OCR Blur)

- **Trạng thái:** Đã chấp thuận (Accepted)
- **Ngày quyết định:** 2026-09-04
- **Tác giả:** Kiến trúc sư TediaPros

---

## Bối Cảnh (Context)

Tính năng làm mờ chữ cứng trên video (OCR Timed Text Blur) nhằm mục đích che đi phụ đề gốc hoặc các dòng chữ bản quyền trước khi đè phụ đề mới lên.
Hầu hết các nguồn video MP4/WebM từ mạng internet đều được nén dưới không gian màu **YUV 4:2:0 (Chroma Subsampling)**. Trong chuẩn này:
- Kênh độ sáng (Luma - Y) giữ nguyên độ phân giải đầy đủ.
- Hai kênh màu (Chroma - U và V) bị nén giảm độ phân giải xuống còn một nửa theo cả chiều dọc lẫn chiều ngang.

Khi áp dụng bộ lọc `maskedmerge` và `boxblur` trực tiếp trên video YUV 4:2:0:
1. Ranh giới của mặt nạ (mask) không khớp hoàn hảo với lưới điểm ảnh màu của kênh Chroma.
2. Dẫn đến hiện tượng lem màu (chroma bleeding), viền xanh đỏ hoặc để lại bóng mờ (ghosting silhouette) của chữ cũ sau khi làm mờ.

---

## Quyết Định (Decision)

1. Trong chuỗi filtergraph của FFmpeg ([src/main/ocrMask.ts](file:///f:/Son/tool/TediaPros/src/main/ocrMask.ts) và [src/main/ffmpegOcrMaskProbe.ts](file:///f:/Son/tool/TediaPros/src/main/ffmpegOcrMaskProbe.ts)), bắt buộc chèn bước chuyển đổi định dạng pixel sang **Planar RGB** (`format=gbrp`):
   ```
   [in] format=gbrp [rgb_in];
   [rgb_in] boxblur=... [blurred_rgb];
   [rgb_in][blurred_rgb][mask] maskedmerge [merged_rgb];
   [merged_rgb] format=yuv420p [out]
   ```
2. Độ mờ (sigma / radius) được tính toán động tỷ lệ thuận theo chiều cao khung hình (`frame_height`), áp dụng nhiều pass để làm mịn hoàn toàn các chi tiết văn bản bên trong vùng chọn.
3. Chỉ áp dụng làm mờ cho các bounding box đang hoạt động theo đúng timeline xuất hiện của chữ (`ocrVisualTimeline.ts`).

---

## Hệ Quả (Consequences)

### Tích cực:
- **Chất lượng hình ảnh hoàn hảo:** Loại bỏ hoàn toàn viền bóng ma và hiện tượng ám màu chữ cũ. Vùng làm mờ trông tự nhiên và hòa trộn êm dịu vào video nền.
- Tính xác định cao giữa các nền tảng phần cứng khác nhau.

### Tiêu cực / Đánh đổi:
- Quá trình chuyển đổi định dạng màu RGB trong FFmpeg tiêu tốn thêm một lượng nhỏ tài nguyên CPU/GPU và bộ nhớ đệm frame.
