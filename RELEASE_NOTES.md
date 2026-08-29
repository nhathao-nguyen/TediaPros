## TediaPros v0.1.20

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

- Windows sẽ tự nhận, tải và cài đặt v0.1.20 khi kết nối được với GitHub.
- macOS từ v0.1.18 trở lên sẽ thông báo bản mới và mở trang tải DMG để người dùng cài thủ công.
- Bản macOS yêu cầu Apple Silicon và hiện chưa ký/notarize; macOS có thể yêu cầu cấp quyền trong **Privacy & Security** khi mở lần đầu.
