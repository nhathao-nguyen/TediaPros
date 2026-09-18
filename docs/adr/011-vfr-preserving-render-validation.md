# ADR 011: Giữ VFR và xác thực FPS theo tốc độ trung bình

- Trạng thái: Đã chấp thuận (Accepted)
- Ngày quyết định: 2026-09-16
- Phạm vi: AutoShort metadata, STTN và cổng xác thực hậu render

## Bối cảnh

Một video nguồn có thể công bố `r_frame_rate` (nominal/container rate) là
30/1 nhưng có `avg_frame_rate` (tốc độ trung bình thực tế) thấp hơn do timestamp
VFR. Fixture lỗi thực tế có `r_frame_rate=30/1`,
`avg_frame_rate=20375/689` (~29.571843 fps), 4.075 frame trong 137.8 giây.
STTN đọc `avg_frame_rate` và giữ nó khi tạo stream FFV1. Cổng hậu render trước
đây chỉ đọc `r_frame_rate`, nên coi 29.57 là sai lệch 0.43 fps dù timestamp của
video vẫn hợp lệ.

## Quyết định

1. FFprobe metadata lưu riêng:
   - `frameRate`: nominal/container rate (`r_frame_rate`) để tương thích và chẩn
     đo.
   - `averageFrameRate`: tốc độ trung bình (`avg_frame_rate`) để xác thực VFR.
   - `isVariableFrameRate`: true khi hai giá trị lệch hơn 0.01 fps.
2. Coordinator truyền cả average rate và cờ VFR vào `validateRenderedMedia`.
3. Validator so sánh average-to-average khi nguồn là VFR; nominal chỉ là fallback
   cho caller cũ hoặc probe không có average. Nếu probe cũ không cung cấp
   average cho một nguồn VFR, bỏ qua riêng phép thử FPS (vẫn bắt buộc decode,
   số luồng và thời lượng).
4. Không thêm `fps=...`, `-r` hoặc ép CFR vào đường render. STTN tiếp tục dùng
   `-fps_mode passthrough`; các filter render không được dùng nominal FPS để
   tạo frame mới.
5. Với nguồn CFR, mismatch FPS vẫn là lỗi; tolerance hiện hành là 0.1 fps.

## Hệ quả

### Tích cực

- Video VFR hợp lệ không bị loại nhầm sau khi STTN hoặc burn subtitle.
- Mismatch thật ở average FPS vẫn bị phát hiện, nên không biến validator thành
  kiểm tra hình thức.
- Metadata giữ cả hai khái niệm FPS, tránh làm sai các caller legacy chỉ biết
  nominal rate.

### Đánh đổi và giới hạn

- FFprobe rất cũ/không trả `avg_frame_rate` cho nguồn VFR sẽ không được kiểm tra
  FPS; các cổng decode và duration vẫn bảo vệ artifact.
- Validator không chứng minh từng timestamp/frame ordinal. Exact-frame/VFR cut
  vẫn thuộc hợp đồng frame-index riêng.
- Đầu ra cũ đã thất bại không tự được sửa; cần chạy lại bằng bản build chứa
  thay đổi này.

## Kiểm chứng

- `tests/canonical-display-geometry.test.ts` kiểm tra metadata VFR thực tế
  30/1 + 20375/689.
- `tests/rendered-media-validation.test.ts` kiểm tra average-to-average cho VFR,
  drift rejection, CFR mismatch và fallback khi thiếu average.
- Chạy `node scripts/run-local-runtime-tests.mjs canonical-display-geometry.test`
  và `node scripts/run-local-runtime-tests.mjs rendered-media-validation.test`.
