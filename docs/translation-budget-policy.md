# Chính sách ngân sách dịch tạm thời — 2026-09-08

Theo yêu cầu người dùng, `TRANSLATION_BUDGET_LIMITS_ENABLED = false` trong `src/main/translation/budget.ts`. Áp dụng mặc định cho Local, Gemini và OpenAI dùng `translateWithAdapter`.

- Không chặn theo tổng request, tổng recovery request, recovery request mỗi batch hoặc tổng thời gian dịch. Các bộ đếm vẫn được lưu để theo dõi.
- Checkpoint cũ đã hết hạn mức được đọc tiếp mà không đặt lại bộ đếm. Snapshot ghi `limitsEnforced: false`; các trường quota cũ chỉ còn là thông tin tham chiếu. JSON vẫn chứa số hữu hạn, không ghi `Infinity`.
- Giữ timeout từng request tối đa 180 giây, hủy tác vụ, tối đa 2 transport retry cho cùng request và 1 format repair cho cùng bộ ID. Khi quota tắt, batch lỗi được chia đôi đến singleton trên mọi nhánh; độ sâu ghi nhận của nhánh trước không chặn nhánh sau. Cây chia hữu hạn vì mỗi nhánh giảm số cue. Provider trả lặp lỗi hoặc không tiến triển ở singleton vẫn chuyển `needs-review`.
- Format repair gửi task sửa riêng với mã lỗi parser và đúng tập ID cần sửa cho cả Local, Gemini và OpenAI; không gửi lại nguyên prompt dịch ban đầu.
- Hạn mức token của provider và giới hạn batch theo khả năng model vẫn cần thiết để tránh đầu ra bị cắt. Thay đổi này không bỏ giới hạn do server/API áp dụng.
- Khi bỏ override tạm thời, bật lại hằng số trên. Bounded mode tiếp tục có test riêng; checkpoint đã vượt quota sẽ cần xử lý rõ ràng khi bật lại, không tự xóa lịch sử sử dụng.

Các item đã ở `needs-review` vẫn cần người dùng chọn thử lại. Bản build mới chỉ có hiệu lực khi ứng dụng được khởi động lại; tiến trình đang chạy giữ mã đã nạp.
