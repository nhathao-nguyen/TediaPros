## TediaPros v0.1.24

### Auto Short theo vùng OCR

- Thêm chế độ tự đặt phụ đề riêng cho từng video từ OCR timeline hiện có. Vùng quét vẫn do người dùng chọn; hệ thống không quét toàn khung và không gọi OCR lần hai.
- Chỉ chọn vùng đạt đồng thời độ phủ thường xuyên và chiều cao chữ điển hình lớn, loại chữ/logo cố định; khi dữ liệu không rõ sẽ dùng khung phụ đề thủ công.
- Chuẩn hóa vùng phụ đề, OCR và blur theo tỷ lệ khung hình để batch 1080p/4K giữ cùng bố cục tương đối.

### Lồng tiếng và phục hồi render

- Giữ đủ lời trong trần tempo 1,80x, làm chậm hình có giới hạn và phát lại đoạn hình thuộc đúng cue khi cần thêm thời gian.
- Video lỗi được giữ kết quả chẩn đoán và thử lại một lần sau khi lượt đầu của hàng đợi hoàn tất; lượt phục hồi đo lại audio và bỏ cache TTS cũ.
- Parser metadata chấp nhận một object JSON hợp lệ được Gemini bọc bằng code fence hoặc lời dẫn mà vẫn giữ validation schema hiện có.

### Runtime tải theo nhu cầu

- Phát hành `runtime-v5` với FFmpeg, Faster-Whisper, CUDA runtime cho Whisper, RapidOCR DirectML, Video2X, Douyin, Separator và STTN CPU portable. STTN CUDA tiếp tục dùng build cục bộ cho máy chuyên dụng vì gói CUDA vượt giới hạn kích thước asset GitHub.
- Sửa OCR 1.2.1 nhận đúng model đã kiểm SHA-256 khi Windows AppContainer canonicalize đường dẫn qua `LocalCache`.
- Các engine vẫn được tải riêng, kiểm SHA-256 và capability trước khi kích hoạt; model STTN và Separator tiếp tục tải từ nguồn đã ghim riêng.

## TediaPros v0.1.23

### Độ tin cậy dịch và lồng tiếng AutoShort

- Bổ sung bộ điều phối dịch có ngân sách, checkpoint, kiểm tra ID/cấu trúc phản hồi và đánh giá ngôn ngữ để khôi phục phần cue còn thiếu mà không ghi đè phần đã hợp lệ.
- Gom các mảnh ASR liên tiếp thành đơn vị thoại trước TTS, giữ ledger cue nguồn và chỉ đặt khoảng bảo vệ 0,50 giây giữa các đơn vị thoại. Điều này loại bỏ các cửa sổ đọc 0,14–0,38 giây phát sinh khi một câu bị tách thành nhiều mảnh.
- Thêm preflight rút gọn có giới hạn và một lượt recovery TTS khi audio vượt cửa sổ. Mọi phương án vẫn phải giữ nội dung cần thiết; nếu không fit sẽ yêu cầu xem lại.
- Giữ nguyên trần tempo vật lý 1,45x; ứng dụng không tăng tốc quá trần hoặc cắt lời để ép khớp timeline.
- Phụ đề của đơn vị thoại được chia theo từ và gắn lại `sourceIndex` gốc để giữ đồng bộ với SRT sau khi gom cue.

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
