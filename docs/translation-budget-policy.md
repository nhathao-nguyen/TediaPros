# Chính sách ngân sách dịch tạm thời — 2026-09-08

Theo yêu cầu người dùng, `TRANSLATION_BUDGET_LIMITS_ENABLED = false` trong `src/main/translation/budget.ts`. Áp dụng mặc định cho Local, Gemini và OpenAI dùng `translateWithAdapter`.

- Không chặn theo tổng request, tổng recovery request, recovery request mỗi batch hoặc tổng thời gian dịch. Các bộ đếm vẫn được lưu để theo dõi.
- Checkpoint cũ đã hết hạn mức được đọc tiếp mà không đặt lại bộ đếm. Snapshot ghi `limitsEnforced: false`; các trường quota cũ chỉ còn là thông tin tham chiếu. JSON vẫn chứa số hữu hạn, không ghi `Infinity`.
- Giữ timeout từng request tối đa 180 giây, hủy tác vụ, tối đa 2 transport retry cho cùng request và 1 format repair cho cùng bộ ID. Khi quota tắt, batch lỗi được chia đôi đến singleton trên mọi nhánh; độ sâu ghi nhận của nhánh trước không chặn nhánh sau. Cây chia hữu hạn vì mỗi nhánh giảm số cue. Provider trả lặp lỗi hoặc không tiến triển ở singleton vẫn chuyển `needs-review`.
- Format repair gửi task sửa riêng với mã lỗi parser và đúng tập ID cần sửa cho cả Local, Gemini và OpenAI; không gửi lại nguyên prompt dịch ban đầu.
- Hạn mức token của provider và giới hạn batch theo khả năng model vẫn cần thiết để tránh đầu ra bị cắt. Thay đổi này không bỏ giới hạn do server/API áp dụng.
- Khi bỏ override tạm thời, bật lại hằng số trên. Bounded mode tiếp tục có test riêng; checkpoint đã vượt quota sẽ cần xử lý rõ ràng khi bật lại, không tự xóa lịch sử sử dụng.

Prompt dịch hiện dùng `translation-v11` và parser contract `translation-parser-v4`. Wire payload bỏ timing/source-index lặp nhưng giữ ID, source-group và speaking-duration cần thiết. Mọi request/recovery vẫn được charge trước dispatch; tắt quota không cho phép response có unknown/duplicate ID đi vào accepted/checkpoint state. Checkpoint schema v2 được parse theo giới hạn 2 MiB và validate sâu trước resume hoặc publication.

Các item đã ở `needs-review` vẫn cần người dùng chọn thử lại. Bản build mới chỉ có hiệu lực khi ứng dụng được khởi động lại; tiến trình đang chạy giữ mã đã nạp.

## Tự phục hồi cảnh báo chất lượng

- Sau khi nhận đủ cue hợp lệ, pipeline tự chọn các cue có cảnh báo `protected-token-suspect` hoặc `language-suspect`, gửi đúng các cue đó qua một lượt repair và đánh giá lại toàn bộ bản dịch.
- Lượt repair dùng recovery accounting, bị giới hạn ở một vòng và dừng khi phản hồi không cải thiện để tránh lặp vô hạn.
- Cảnh báo tương thích do provider không công bố giới hạn token không được hiển thị như việc người dùng phải xử lý; planner vẫn dùng ước lượng hữu hạn để chia batch.
- Checkpoint/cache còn cảnh báo phải đi qua scheduler để được tự phục hồi. Cảnh báo heuristic còn lại sau lượt repair được giữ trong assessment/log phục vụ chẩn đoán nhưng không hiện trong hàng đợi và không chặn video tiếp tục.
- Các lỗi cấu trúc chắc chắn như thiếu cue, trùng ID, nội dung rỗng hoặc phản hồi sai protocol vẫn chuyển `needs-review` và chặn xuất bản kết quả không đầy đủ.
