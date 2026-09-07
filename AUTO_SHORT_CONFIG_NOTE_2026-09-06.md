# Ghi chú cấu hình Auto Short

Ngày ghi chú: 2026-09-06  
Nguồn chính: bảy ảnh chụp trực tiếp giao diện TediaPros do người dùng cung cấp.

## Video và tiến trình hiện tại

- Video đang chọn: `2026-06-01_这是重庆的...` (tên hiển thị bị rút gọn trên giao diện).
- Thời lượng hiển thị: `3:29`.
- Vị trí lưu: `F:\Son\49`.
- Hàng đợi: `1` video.
- Trạng thái lúc chụp: `Đang quét chữ trong video...`.
- Khung đọc chữ OCR đang bao phủ khu vực phụ đề ở phần dưới video.

## Phụ đề và dịch

- Nhận diện phụ đề: `Whisper`.
- OCR hình ảnh: **Tắt** ở phần phương thức nhận diện độc lập.
- Whisper + OCR: **Tắt**.
- Mô hình Whisper: `Small (Chính xác hơn)`.
- Ngôn ngữ đích: `Tiếng Anh`.
- Ngôn ngữ nguồn: `Tiếng Trung`.
- Thiết bị nhận diện đang hiển thị ở phần trên: `CPU (tương thích)`.
- Dịch phụ đề AI: `AI nội bộ (TTS-Server)`.
- Server AI: `http://192.168.1.16:8000`.
- Trạng thái kết nối AI nội bộ: `Kết nối AI nội bộ thành công`.
- Lưu ý khi kết hợp STTN: radio nhận diện đang chọn `Whisper`, nhưng STTN vẫn quét OCR chính xác trong vùng OCR để tạo mask xóa chữ.

## Tạo tiêu đề từ SRT

- `Tạo tiêu đề AI từ SRT`: **Bật**.
- Nội dung dùng để suy nghĩ tiêu đề: SRT do OCR/ASR tạo ra hoặc SRT đã dịch.
- AI tạo tiêu đề: `Gemini (AI ngoài)`.
- Ngôn ngữ tiêu đề: `Tiếng Anh`.
- Kết quả mong muốn: mỗi video có một tiêu đề phù hợp nhất và được lưu trong thư mục riêng cùng file `tieude.txt`.

## Tab Làm mờ

Các giá trị hiện được lưu trong cấu hình TediaPros:

- Xóa phụ đề AI: `STTN`.
- Xử lý phụ đề gốc: `Bật`.
- Hồ sơ OCR: `Chính xác (accurate)`.
- Trạng thái STTN: `STTN sẵn sàng (CUDA)`.
- Vùng xử lý: vùng OCR nét đứt đang bao phủ phụ đề ở phần dưới video.
- STTN dùng OCR theo khung hình và timestamp để xóa chữ; các vùng không có chữ không bị làm mờ toàn thời gian.
- Khi STTN hoạt động, làm mờ Gaussian/thủ công không được áp dụng thêm trong bước xuất cuối.

## Tab Lồng tiếng

Các giá trị hiện được lưu trong cấu hình TediaPros:

- Lồng tiếng AI: `Bật`.
- Server AI dùng cho dịch/TTS: `http://192.168.1.16:8000`.
- Trạng thái server: `Sẵn sàng`.
- Mô hình giọng đọc: `Chatterbox Multilingual V3`.
- Giọng đọc: `English Funny (en · Clone)`.
- Tốc độ đọc: `1.00x`.
- Nhịp đọc theo video: `Tự bám nhịp nguồn (khuyến nghị)`.
- Chế độ âm thanh xuất: `Thay thế toàn bộ âm thanh gốc` (`replace`).
- Nhạc background: `Bật`.
- Thư mục nhạc: `F:\Son\bgMusic funny`.
- Bài nhạc đang chọn: hiển thị bắt đầu bằng `YTSave_YouTube_Funny-Quirky-Comedy-Free-D...` (tên bị cắt ở mép giao diện).
- Âm lượng nhạc background: `40%`.
- Chế độ chọn nhạc đã lưu: `Một bài cho tất cả` (`single`).

Các giá trị sau chưa có dấu hiệu đang được áp dụng trong cấu hình hiện tại:

- `Trộn với âm thanh gốc` không hoạt động vì chế độ hiện tại là `replace`.
- `Tách thoại gốc, giữ nhạc & SFX` không hoạt động vì chế độ hiện tại là `replace`; preset đã lưu trước đó là `balanced`.
- Thanh âm lượng âm thanh gốc chỉ có tác dụng ở chế độ `mix`.
- Hai chế độ `Trộn với âm thanh / nhạc nền gốc` và `Tách thoại gốc, giữ nhạc & SFX` đang **tắt**.

## Kiểu hiển thị phụ đề

- Kiểu hiển thị: `Hiển thị cả câu`.
- Tự tối ưu phụ đề: `Bật`.
- Nhịp hiển thị: `Video dọc - tối đa 2 dòng`.
- Hiện vùng an toàn trên bản xem trước: `Bật`.
- Font: `Tự động theo nội dung`.
- Cỡ chữ: `Tự động theo khung`.
- Màu chữ: `Trắng`.
- Màu viền: `Đen`.
- Độ dày viền: `6.5px`.
- Thêm nền sau chữ: `Tắt`.

## Các mục chưa xác định từ ảnh

Các ảnh đã bao phủ phần hiển thị của ba tab `Phụ đề`, `Làm mờ` và `Lồng tiếng`. Tên bài nhạc background bị cắt trong ảnh nên được giữ nguyên dạng hiển thị một phần, không tự đoán phần còn lại.

## Ghi chú vận hành

1. OCR/ASR tạo SRT trước.
2. SRT được dùng cho dịch phụ đề và suy nghĩ tiêu đề.
3. AI tiêu đề dùng Gemini bên ngoài, ngôn ngữ đầu ra là tiếng Anh.
4. Khi xử lý xong, kiểm tra trong thư mục video tương ứng dưới `F:\Son\49` có `tieude.txt`.
