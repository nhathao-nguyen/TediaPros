# Nhiều API key Gemini

Trong phần Gemini của Phụ đề/OCR, AutoShort và tạo tiêu đề video, nhập từng key vào ô mật khẩu rồi chọn **Lưu thêm khóa**. Có thể bấm **Thêm ô nhập** hoặc dán nhiều dòng để nhập cùng lúc. Danh sách dùng chung cho các chức năng Gemini, tối đa 20 key duy nhất. Key trùng được bỏ qua; nút **Xóa** chỉ xóa key tương ứng. **Kiểm tra kết nối** thử danh sách đã lưu, không kiểm tra các ô chưa lưu.

Khi một yêu cầu nhận HTTP 429, ứng dụng thử key tiếp theo với cùng nội dung, cue ID và timestamp. Key thành công được ưu tiên cho những yêu cầu sau. Key bị 429 tạm nghỉ theo `Retry-After`/Google `RetryInfo`; nếu không có thời gian do Google trả về thì nghỉ 60 giây, tối thiểu 1 giây. Trạng thái này chỉ nằm trong bộ nhớ và được đặt lại khi ứng dụng khởi động lại.

Thời gian nghỉ được theo dõi riêng cho từng model. Nếu mọi key đang bị giới hạn trên model hiện tại, vẫn thử model dự phòng trong danh sách chọn sẵn (tối đa hai model). Mỗi key/model chỉ được thử một lần trong một lượt chuyển key. Khi không còn lựa chọn, trả lỗi hạn mức; luồng dịch strict giữ cơ chế retry vận chuyển tối đa hai lần và hỗ trợ hủy trong bộ điều phối hiện có. Chuyển key không tạo vòng lặp retry vô hạn.

Chỉ HTTP 429 kích hoạt chuyển key. Key sai, thiếu quyền (400/401/403), lỗi mạng hoặc lỗi server không tự động đổi sang key khác. Cần xóa hoặc sửa key sai; xử lý retry/model dự phòng cho các lỗi khác giữ theo luồng hiện có.

Theo [tài liệu quota Gemini của Google](https://ai.google.dev/gemini-api/docs/rate-limits), hạn mức áp dụng theo Google project và thay đổi theo model. Nhiều key cùng một project dùng chung quota; thêm key không tự tăng hạn mức project.

## Lưu trữ và tương thích

- Main process đọc key cũ trong `gk.bin`, không yêu cầu nhập lại. Lần cập nhật sau ghi định dạng `{version: 1, keys: [...]}` bằng tệp tạm rồi đổi tên; các thao tác ghi được xếp hàng để tránh ghi đè khi hai màn hình cùng cập nhật.
- Giữ cơ chế `safeStorage` hiện có: mã hóa nếu hệ điều hành hỗ trợ, fallback văn bản nếu không có dịch vụ mã hóa. Không lưu key vào `localStorage`, cấu hình tác vụ hoặc preset thị trường.
- Renderer chỉ nhận ID và nhãn che key; chỉ bốn ký tự cuối được hiển thị. Key được gửi tới Gemini qua header `x-goog-api-key`, không đặt trong URL. Nội dung lỗi loại bỏ key đã gửi trước khi ghi log/trả lỗi.
- Nếu không đọc/giải mã được tệp key, giao diện báo lỗi và cung cấp **Thay danh sách lỗi bằng khóa mới**. Chỉ thao tác này ghi đè tệp lỗi; thao tác thêm thông thường không âm thầm bỏ dữ liệu cũ.
- API `saveKey`/`geminiSaveKey` cũ giữ nghĩa thay toàn bộ danh sách; giao diện mới dùng API thêm/xóa riêng. Chuỗi rỗng ở API lưu cũ xóa toàn bộ key.

## Kiểm chứng

`tests/gemini-keys.test.ts` kiểm thử bằng fetch và key giả: chuyển key, ưu tiên key thành công, đọc định dạng cũ, thêm đồng thời, loại trùng, xóa, hủy, cooldown, model dự phòng, lỗi tệp và bảo toàn yêu cầu dịch AutoShort. Không đọc key thật hoặc gọi dịch vụ trả phí khi chạy các fixture này.

Bằng chứng kiểm thử và harness giao diện offline: [review ngày 2026-09-10](reviews/2026-09-10-gemini-api-keys/verification.md). Chưa xác minh quota thật, DPAPI/Keychain thật hoặc bản ứng dụng đóng gói.
