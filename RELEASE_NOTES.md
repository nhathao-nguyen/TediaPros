## TediaPros v0.1.22

### Sửa runtime phụ đề và Douyin

- Chấp nhận metadata file 0 byte hợp lệ trong archive Faster-Whisper, đồng thời vẫn bắt buộc entrypoint có dữ liệu.
- Bổ sung package `storage` bị thiếu trong engine Douyin và khóa kiểm tra hidden import khi build native.
- Native capability probe trên Windows giờ dừng workflow ngay khi bất kỳ engine nào trả mã lỗi.
- Chuyển kênh runtime bất biến sang `runtime-v3` để bản cài mới nhận đúng asset đã sửa.

## TediaPros v0.1.21

### Production Windows Auto Short

- Đóng gói runtime Windows `runtime-v2` từ các input đã pin và verify SHA-256.
- Sửa build engine để không phụ thuộc thư mục chạy PyInstaller; tăng cường kiểm tra archive trước khi giải nén.
- Giữ độc lập timeline nguồn/đích, không cắt speech khi căn TTS, và dọn child process Auto Short khi thoát ứng dụng.
- Release lần này tập trung vào bộ cài Windows; macOS không nằm trong phạm vi phát hành.

### Đổi thương hiệu

- Đổi tên hiển thị và bộ nhận diện ứng dụng thành TediaPros.
- Giữ nguyên App ID, protocol `tblao://`, storage namespace và kết nối TTS Server để không mất dữ liệu hoặc thay đổi luồng xử lý.
- Tự động di chuyển dữ liệu người dùng cũ sang profile mới khi cần.

### Sửa lỗi khởi động

- Khắc phục lỗi TediaPros nhận nhầm FFmpeg đã cài là đang bị thiếu trên Windows.
- Ứng dụng không còn tải và cài lại FFmpeg ở mỗi lần mở.
- Việc kiểm tra dùng đúng tham số phiên bản của FFmpeg và vẫn ưu tiên bản công cụ do TediaPros quản lý.

### Điều chỉnh giao diện

- Tiêu đề trong tab **Hệ sinh thái Neeyu** được trình bày thành hai dòng: “Một hành trình” và “nhiều công cụ sáng tạo.”
- Bỏ dấu phẩy giữa hai vế để nhịp đọc và bố cục tiêu đề rõ ràng hơn.

### Cập nhật

- Windows sẽ tự nhận, tải và cài đặt v0.1.21 khi kết nối được với GitHub.
- macOS không nằm trong phạm vi phát hành của v0.1.21; hướng dẫn DMG macOS sẽ được cập nhật cùng một release macOS riêng.
