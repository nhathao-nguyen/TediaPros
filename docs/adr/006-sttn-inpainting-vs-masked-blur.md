# ADR 006: Chiến Lược Lựa Chọn Giữa STTN Inpainting Và Timed Text Blur Khi Xóa Phụ Đề

- **Trạng thái:** Đã chấp thuận (Accepted)
- **Ngày quyết định:** 2026-09-05
- **Tác giả:** Kiến trúc sư TediaPros

---

## Bối Cảnh (Context)

Khi tái sản xuất video ngắn (AutoShort), việc che hoặc loại bỏ dòng phụ đề gốc hoặc logo bản quyền là bước tiên quyết trước khi in phụ đề dịch mới lên.
Trong xử lý video hiện đại, có hai hướng tiếp cận chính:
1. **Làm mờ theo dòng thời gian (Timed Text Blur):** Dùng bộ lọc không gian (spatial blur) của FFmpeg kết hợp mặt nạ thời gian sinh ra từ OCR.
2. **Xóa chữ bằng học sâu (Deep Video Inpainting - STTN):** Dùng mạng Spatio-Temporal Transformer để trích xuất các mảng ảnh nền từ các frame trước/sau đắp vào vùng bị che.

---

## So Sánh Kỹ Thuật

| Tiêu Chí | Timed Text Blur (FFmpeg Planar RGB) | Deep Inpainting (STTN PyTorch) |
| :--- | :--- | :--- |
| **Tốc độ xử lý** | Siêu nhanh (thời gian thực $\ge 1.0x$, vài giây cho 1 video ngắn) | Chậm (cần từ 1 đến 5 phút tùy độ phân giải và GPU) |
| **Tài nguyên** | Rất nhẹ, chạy tốt trên mọi CPU phổ thông | Đòi hỏi GPU có VRAM $\ge 4GB$, tiêu tốn nhiều RAM |
| **Chất lượng hình ảnh** | Tạo một dải mờ mịn (che chữ tốt nhưng thấy rõ vùng mờ) | Tái tạo hoàn hảo chi tiết ảnh nền (không còn dấu vết chữ) |
| **Độ ổn định** | 100% ổn định, không lo tràn bộ nhớ hay crash driver | Có thể gặp OOM trên GPU yếu nếu video dài |

---

## Quyết Định (Decision)

1. **Hỗ trợ đồng thời cả hai phương pháp** trong pipeline AutoShort dưới sự lựa chọn của người dùng.
2. **Chọn Timed Text Blur làm chế độ mặc định:**
   - Đảm bảo quy trình AutoShort chạy nhanh, ổn định và phù hợp với số đông người dùng máy tính phổ thông.
3. **Cung cấp STTN Inpainting như một tùy chọn cao cấp (High-Quality Option):**
   - Hỗ trợ tính năng xem trước vài giây ([AutoShortSttnPreviewRequest](file:///f:/Son/tool/TediaPros/src/shared/types.ts)) để người dùng thẩm định chất lượng trước khi quyết định chạy toàn bộ video.
   - Khi chạy STTN, áp dụng cơ chế chia nhỏ frame và giải phóng VRAM định kỳ.
4. **Phân biệt hợp đồng OCR thô và timeline đã ổn định:**
   - Dữ liệu trực tiếp từ OCR engine phải đi qua `validateOcrVisualTimeline`; engine không được tự chèn segment có prefix `gap-`.
   - Timeline nội bộ sau `stabilizeSingleSampleGaps`, kể cả timeline đọc lại từ cache, phải đi qua `validateStabilizedOcrVisualTimeline` trước khi giao cho STTN.
   - Validator timeline đã ổn định loại các gap tổng hợp, kiểm tra lại phần OCR thô, chạy lại stabilizer chuẩn và chỉ nhận kết quả khi toàn bộ timeline tái tạo khớp. Vì vậy gap bị thêm, thiếu hoặc sửa ID, frame, text, confidence hay box đều bị từ chối.

---

## Hệ Quả (Consequences)

### Tích cực:
- Cung cấp sự cân bằng tối ưu giữa tốc độ (speed) và chất lượng tuyệt hảo (quality).
- Người dùng không bị ép buộc phải có máy tính cấu hình khủng mới dùng được AutoShort.

### Tiêu cực / Đánh đổi:
- Cần duy trì hai pipeline xử lý hình ảnh song song (`src/main/ocrMask.ts` và `src/main/inpainting/*`).
- Hai ranh giới OCR cần validator riêng và fixture hồi quy để tránh dùng nhầm hợp đồng raw cho artifact nội bộ đã ổn định.
