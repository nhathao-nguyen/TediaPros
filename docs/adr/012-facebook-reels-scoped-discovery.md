# ADR 012: Discovery và caption Facebook Reels có định danh nguồn

- Ngày: 2026-10-02
- Trạng thái: Accepted

## Bối cảnh

Crawler cũ dừng sau 40 lần cuộn/250 ID và coi DOM đứng yên là hết danh sách. Nhãn preview/alt/card không chứng minh caption. Session persistent còn có thể giữ cookie/proxy từ lượt trước.

## Quyết định

Giữ Electron; mỗi lượt dùng session không persistent, proxy được đặt explicit và chỉ nạp cookie khi người dùng bật. Account digest đọc dưới cookie mutex, đối chiếu với `c_user` thực trong session trước navigation. Enrichment kiểm tra lại account và kiểm tra cookie dưới cùng mutex giữ suốt subprocess; đổi account không thể gắn caption mới vào context cũ.

CDP chỉ quan sát yêu cầu có sẵn của trang; không replay GraphQL/doc_id. Bắt đầu `Network.streamResourceContent` khi nhận response, ghép `bufferedData` trước các chunk `dataReceived`, xử lý từng bản ghi JSON/NDJSON và hoàn tất phần còn lại sau `loadingFinished`. Không đợi body nguyên khối bị loại khỏi inspector cache. Chromium không hỗ trợ streaming dùng `getResponseBody` dự phòng. Parser chỉ nhận collection `aggregated_fb_shorts` được gắn với profile bằng owner ID. Caption thuộc story/video ID tương ứng; không chọn văn bản dài nhất trên toàn payload. Bootstrap Relay được đọc một lần theo hash. DOM chỉ là dự phòng từ link `fb_shorts_profile`, không xác minh membership hay uploader.

Membership (`sourceVerified`) độc lập với caption: collection hợp lệ có thể chứa Reel không caption. `complete` cần connection đúng nguồn hết trang, không còn pending/loading, cuối trang ổn định và mọi entry có bằng chứng membership. DOM đứng yên, schema lạ, network/permission error, cancel/cap đều trả partial có lý do và giữ dữ liệu đã đọc.

IPC typed kiểm tra origin và owner cho start/result/cancel/enrichment. Checkpoint chỉ lưu dữ liệu Reel và digest context dưới userData, tên UUID do main cấp, containment, atomic rename, tối đa 8 MiB/file, 16 file, TTL 7 ngày. Tiếp tục mở lại nguồn và deduplicate ID; không dùng cursor sống lâu để replay request. Khi đủ 10.000 ID, không đưa nút tiếp tục không thể tiến triển.

## Giới hạn

### Bổ sung xuất bài viết website

Job owner-bound có thao tác export và trạng thái exporting trên cùng IPC typed. Mỗi lượt xuất tạo thư mục riêng chứa video/Excel/caption/article cùng checkpoint kết quả; filename dùng STT và Reel ID, mọi file nằm trong root đã chọn. Downloader sẵn có nhận AbortSignal và account digest dưới cookie mutex; hủy tiêu diệt process tree. Caption/link lookup dùng một session tạm riêng cho cả lượt, audio được tắt, navigation chỉ Facebook. Deadline đọc chi tiết bắt đầu sau navigation; dữ liệu đã nhận được merge trước khi trả.

Parser giữ owner ID của video và đọc link trong message/ranges; link bình luận chỉ thuộc creator trong feedback có associated_video ID khớp. Giữ exclusions bounded cho owner khác nguồn kể cả khi response đến trước DOM, xóa các thẻ đó khỏi kết quả/selection khi tiếp tục. Nguồn slug dùng owner ID đã xác minh trong entry hoặc video payload.

Website GET tách bằng Readability/jsdom, không script/resources/cookie Facebook. DNS và mọi redirect phải public, IP được pin vào request; tối đa 4 MiB/30 giây. ExcelJS tạo XLSX, full article TXT giữ nội dung vượt giới hạn ô Excel. Thiếu link, lỗi lookup, không có article, lỗi download và cancel là các trạng thái riêng. Giao diện có root output, MP4 toggle, bộ đếm và bảng mở file. Lượt xuất không tự replay các job đã dừng.

- Mỗi lượt discovery tối đa 120 giây/10.000 ID; mỗi bản ghi JSON hoặc phần chưa hoàn chỉnh tối đa 4 MiB, tổng dữ liệu một request tối đa 24 MiB. Bộ đệm stream đang giữ tối đa 24 MiB, metadata giữ trong observer tối đa 24 MiB, tối đa 32 request đang theo dõi. Request hết hạn sau 30 giây; timeout/dispose giải phóng bộ đệm và ngắt chờ CDP kể cả khi command không trả. Giới hạn/lỗi thật vẫn trả partial rõ ràng.
- Sau discovery, tự bổ sung caption cho những ID thuộc job còn thiếu; thao tác bổ sung thủ công chỉ áp dụng cho các mục đang chọn. Serial, tối đa 1.000 ID mỗi yêu cầu và renderer chia mọi nhóm. Không còn deadline tổng 60 giây gây bỏ phần sau của danh sách; metadata yt-dlp giữ timeout 20 giây/video và hủy tiêu diệt cây subprocess. Nếu thiếu caption, reuse browser tạm để đọc đúng Reel; caption-only chỉ thành công sớm với caption verified, không mở bình luận để chờ link. Khởi tạo browser lỗi được dọn ngay và không lặp lại cùng context. Mục không lấy được vẫn mang trạng thái missing/error.
- Tiêu đề preview dùng dòng đầu của caption thật; caption đầy đủ được giữ riêng và không cắt 90 ký tự. Khi nguồn không trả description/caption, giữ placeholder, không coi tên tự suy đoán là caption xác minh.
- Schema hiện được đối chiếu trên profile `61593895532705` ngày 2026-10-02. Feed `/reels` và schema chưa nhận biết không được tuyên bố complete.

## Kiểm chứng

Các suite `facebook-reels-{crawler,parser,lifecycle,jobs,selection}.test` kiểm tra URL, >250 ID, scope/owner, NDJSON, recommendation, slow loading, cancel, account/proxy isolation, checkpoint containment/context, metadata mismatch/concurrency và modal rỗng. Live Chrome xác nhận schema; test offline không chứng minh tất cả Reel ngoài đời đã quét đủ.

Profile `61593283816056` ngày 2026-10-02: Chrome có 20 thẻ, phản hồi phân trang cuối 6.965.837 byte/71 bản ghi, 10 edge đúng owner và `has_next_page=false`. `getResponseBody` với cache 4 MiB báo nội dung đã bị evict. Bộ thu mới xử lý dữ liệu thật đã quan sát cùng bootstrap: 20 membership, không pending/cảnh báo; controller trả `complete/end-of-list` với trạng thái DOM đã ổn định. Đây là kiểm chứng module bằng phản hồi thật, chưa phải một lượt chạy lại trong app Electron đã mở.

Tham chiếu lệnh/event streaming: [Chrome DevTools Protocol](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json).
