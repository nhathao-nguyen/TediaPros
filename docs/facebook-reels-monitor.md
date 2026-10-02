# Theo dõi và tự tải Facebook Reels hằng ngày

Trong **Tải xuống → Thư viện kênh Facebook Reels**, bật **Theo dõi hằng ngày** cho từng kênh muốn tự tải. Các kênh mặc định chưa bật. Thư mục của kênh là thư mục tải tự động; thay đổi thư mục chỉ áp dụng cho các lượt tiếp theo.

- Lịch mặc định **09:00 giờ Việt Nam**, có thể đổi giờ và bấm **Lưu giờ**. Lịch không phụ thuộc múi giờ của Windows.
- Main process kiểm tra lịch mỗi phút khi ứng dụng chạy, kể cả khi chuyển tab. Nếu đóng ứng dụng hoặc máy ngủ qua lịch, khi mở lại/thức dậy chạy bù một lượt cho lịch gần nhất; không quét lại từng ngày bỏ lỡ.
- Mỗi kênh có một lượt tự động mỗi ngày. Bật lần đầu trước 09:00 sẽ đợi 09:00; bật sau 09:00 sẽ chạy ở lần kiểm tra lịch kế tiếp. **Kiểm tra & tải ngay** cho phép chủ động chạy thêm và ghi nhận đã kiểm tra hôm nay.
- Chỉ tải các ID mới đã xác minh thuộc profile/fanpage. ID từng tải thành công hoặc nhập từ thư mục được giữ trong lịch sử ngay cả khi file bị xóa. Vì thế tải tự động không khôi phục các file cũ đã xóa. Nút **Lấy video mới** thủ công vẫn dùng danh sách file còn tồn tại và cho phép lấy lại chúng.
- Các ID tải lỗi không được ghi nhận thành công, nên được xét lại ở ngày tiếp theo. Sau ba lỗi tải trong một lượt, dừng phần còn lại. Mỗi video tải tối đa ba phút; lượt quét dùng giới hạn sẵn có của crawler. Một lượt quét chưa hết vẫn có thể tải những ID mới đã xác minh và báo **Chưa hoàn tất**.
- Khi bật, lựa chọn tài khoản Facebook hiện tại được gắn với kênh bằng digest tài khoản. Nếu tài khoản đổi/hết phiên, thông báo yêu cầu đăng nhập và tắt/bật lại theo dõi. Không lưu cookie vào dữ liệu lịch. Theo dõi nền hiện dùng kết nối trực tiếp và video MP4 chất lượng tốt nhất, không dùng proxy hay các tùy chọn xuất caption/bài viết của lượt tải thủ công.

**🔔 Thông báo** ở đầu ứng dụng hiển thị lượt kiểm tra, số video đã tải/bỏ qua/lỗi, danh sách tên video, trạng thái quét và nút mở thư mục. Có thể đánh dấu đã đọc hoặc dừng lượt đang chạy. Giữ tối đa 100 thông báo; danh sách chi tiết giữ tối đa 100 video mỗi lượt, số tổng vẫn phản ánh toàn lượt.

Nút **Xóa** xóa từng thông báo đã kết thúc; **Xóa tất cả** xóa các thông báo đã kết thúc đang hiển thị. Thông báo lượt đang chạy được giữ để cập nhật kết quả. Xóa thông báo không xóa video, lịch sử chống trùng, cấu hình theo dõi hay lượt lịch ngày đã ghi nhận; mở lại app vẫn giữ kết quả xóa. Không có thời hạn xóa theo ngày: thông báo cũ chỉ tự bỏ khi vượt giới hạn 100.

## Lưu trữ và vòng đời

`userData/facebook-reels-monitor/monitor.json` lưu lịch, watch và thông báo v1. Main singleton chạy tuần tự giữa các kênh, dùng crawler session riêng và downloader/library hiện có. Lượt được claim vào store bằng ghi temp + rename trước khi truy cập mạng; reload renderer không ảnh hưởng lịch. Crash sau claim tạo thông báo gián đoạn ở lần khởi động sau và không tự replay lượt đó trong cùng ngày; người dùng có thể bấm kiểm tra ngay.

Tắt theo dõi, bỏ kênh, đổi thư mục và thoát app gửi AbortSignal. Khi bỏ kênh, downloader hoàn tất muộn chỉ giữ lịch sử video, không tự thêm lại kênh. Lưu/đọc file sử dụng containment guard; typed IPC được kiểm tra sender tin cậy. Cookie mutex được giữ theo downloader hiện có; bước kiểm tra tài khoản có timeout và hủy được khi chờ mutex.

Thiết kế tham khảo lịch theo múi giờ và watch/notification của [changedetection.io](https://github.com/dgtlmoon/changedetection.io). Đây là bộ theo dõi ID Reels được triển khai trong Electron, không bổ sung dịch vụ changedetection.io hay so sánh HTML toàn trang.

## Kiểm chứng

`node scripts/run-local-runtime-tests.mjs facebook-reels-monitor.test facebook-reels-library.test` kiểm tra ngày Việt Nam, chạy bù, restart, tài khoản, chống trùng lịch sử, hủy và lỗi tải. Preview UI tại `scripts/preview-facebook-reels-ui.mjs` dùng dữ liệu minh họa. Test/preview không chứng minh tải từ Facebook thật; cần thử với một kênh/tài khoản đã đăng nhập trong ứng dụng.
