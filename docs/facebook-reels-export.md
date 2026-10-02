# Quét và xuất Facebook Reels

## Thư viện kênh và lấy video mới

Trong vùng **Tải xuống**, thẻ **Thư viện kênh Facebook Reels** nằm dưới hàng đợi. Khi tải video từ danh sách profile/fanpage hoặc xuất có video, kênh được tự ghi nhận sau khi một video tải thành công. Thư viện lưu tên kênh, số video còn trên đĩa, ngày cập nhật và thư mục tải riêng qua các lần mở ứng dụng.

- **Lấy video mới:** quét lại từ đầu nguồn, loại ID có video đã tải còn trên đĩa, rồi mở danh sách chọn để thêm vào hàng đợi hoặc xuất dữ liệu. Bước lấy caption chỉ chạy cho phần chưa tải. **Quét tiếp** tiếp tục loại các ID cũ. Kết quả một phần không được diễn giải thành đã quét hết kênh.
- **Mở thư mục / Đổi thư mục:** đổi thư mục lưu cho các lần tải vào hàng đợi tiếp theo; không tự di chuyển file cũ. Xuất dữ liệu dùng thư mục xuất trong cửa sổ chọn và giữ nguyên thư mục tải của kênh đã lưu.
- **Bỏ theo dõi:** bỏ kênh khỏi danh sách, giữ video và lịch sử chống trùng. Có thể thêm kênh lại sau.
- **Thêm kênh từ thư mục:** nhập link profile/fanpage, tên tùy chọn rồi chọn thư mục đã tải. Nhận diện MP4/MKV/WebM/MOV/M4V/AVI có ID dạng `[123456789]`, `123456789.mp4` hoặc `001_123456789.mp4`; ưu tiên ID trong ngoặc vuông, không nhận nhầm ngày ở đầu tên. Quét tối đa hai cấp thư mục con và 20.000 mục, không đi theo symlink/junction. File tên không có ID cần lịch sử tải của ứng dụng để nhận diện.

Chống trùng dựa trên **Reel ID**, không dựa trên caption hay tên file. Hai yêu cầu tải đồng thời cùng ID chỉ chạy một lần. File rỗng, file tạm, lượt lỗi và lượt hủy chưa tải xong không được ghi nhận là thành công. Nếu các bản video đã lưu đều bị xóa hoặc mất truy cập, video đó được phép tải lại. Các mẫu tên tải Reels tự giữ ID để hai video trùng tiêu đề không dùng chung tên file.

Thư viện nằm tại `userData/facebook-reels-library/library.json`, ghi nguyên tử và giữ tối đa 20 đường dẫn bản sao bổ sung cho mỗi ID. Khi xuất lại, app dùng file có sẵn; MP4 được sao chép vào thư mục xuất khi cần, WebM/MKV được chuyển cục bộ sang MP4 bằng FFmpeg, giữ file gốc. Bản sao xuất thành công cũng được ghi nhận để tiếp tục chống trùng khi file ban đầu không còn. File đích có nội dung khác không bị ghi đè.

Với video Reels thuộc kênh trong hàng đợi, thư mục riêng của kênh được ưu tiên và chống trùng luôn bật. Tùy chọn lịch sử tải toàn máy cho những nền tảng khác vẫn hoạt động theo luồng tải thông thường. Tải link Reel riêng có thể dùng lịch sử ID đã ghi; nó không tự suy đoán kênh từ caption. Lấy mới vẫn phụ thuộc quyền truy cập và dữ liệu Facebook trả về.

Trong **Tải xuống**, đăng nhập Facebook và bật **Dùng tài khoản này** nếu nguồn yêu cầu phiên đăng nhập. Dán link profile/fanpage rồi bấm **Thêm**. Để trống số Reel để quét đến hết trong phạm vi mỗi lượt; khi còn dữ liệu, dùng **Quét tiếp**.

Sau khi tìm được danh sách, app tự bổ sung caption cho từng Reel còn thiếu trước khi mở cửa sổ chọn. Facebook có thể chỉ trả caption của nhóm đầu trong trang profile, còn các thẻ cuộn tiếp chỉ có link/ID. Bước bổ sung dùng yt-dlp và trang chi tiết đúng Reel khi cần, giữ kiểm tra ID/tài khoản; không dùng tiêu đề hoặc bản xem trước DOM làm caption đã xác minh. Bước này không dừng cả danh sách sau 60 giây; từng thao tác mạng vẫn có timeout và có thể bấm **Dừng**. Dừng giữ các caption hoàn tất và các Reel đã tìm thấy; không đồng nghĩa đã quét hết profile.

Trong **Chọn Facebook Reels**:

1. Tìm theo tiêu đề, caption hoặc ID; bấm vào một mục để đọc caption. Tích checkbox để chọn riêng. Tìm kiếm và phân trang không thay đổi lựa chọn; **Chọn tất cả** áp dụng cho toàn bộ danh sách.
2. Dòng **…/… Reel có caption** cho biết còn thiếu bao nhiêu mục. Bấm **Lấy … caption còn thiếu** để bổ sung các Reel đang chọn sau khi dừng/lỗi; app chia yêu cầu theo từng nhóm tối đa 1.000 ID và xử lý mọi nhóm. Mở **Chọn theo khoảng** khi cần chọn số thứ tự. **Chỉ chọn khoảng này** bỏ chọn các mục ngoài khoảng.
3. Chọn **Thư mục xuất**, mặc định dùng thư mục tải xuống đang chọn. Bật **Tải kèm MP4** nếu cần video.
4. Bấm **Xuất … Reels**. App chuyển sang **Kết quả Reels**, hiển thị tiến trình và nút **Dừng xuất**; bạn có thể đọc những mục đã có kết quả trong lúc chờ.
5. Trong kết quả, chọn một Reel rồi chuyển giữa **Caption Facebook** và **Bài viết website**. Dùng **Sao chép**, **Mở TXT**, **Mở MP4**, **Mở thư mục** hoặc **Mở Excel**. Bài viết dài hơn giới hạn bản xem trước vẫn đầy đủ trong TXT.

**Tải xuống** và **Kết quả Reels** là hai vùng riêng: chuyển qua lại không làm mất hàng đợi hoặc kết quả. **Danh sách đã quét** mở lại lựa chọn, kể cả sau khi thêm video vào hàng đợi. Đóng cửa sổ chọn Reels giữ danh sách; nhập nguồn mới bắt đầu một danh sách mới.

Danh sách chọn và kết quả phân trang 50 mục, có thể truy cập mọi dòng trong phạm vi lượt quét, không bỏ các dòng sau 500. Bộ lọc **Cần kiểm tra** hiển thị mục thiếu caption/link/bài viết, lỗi hoặc đã dừng. Thông báo lỗi hiện trong vùng đang thao tác. **Không tải** MP4 là lựa chọn chủ động, không phải lỗi.

Nếu dán đồng thời profile Facebook và playlist nền tảng khác, video playlist được đánh dấu **Chỉ thêm vào hàng đợi**. Nút xuất và số lượng xuất chỉ áp dụng cho Facebook Reels; nút thêm vào hàng đợi áp dụng cho tất cả mục đã chọn.

Mỗi lượt xuất dữ liệu được đặt trong thư mục theo định dạng `<tên page> - <id profile>` (ví dụ: `Woodard Baraka - 61593283816056`), nếu không nhận diện được tên hoặc ID sẽ dùng fallback `facebook-reels_<thời gian>_<mã lượt>`:

```text
<tên page> - <id profile>/
  video/001_<reel_id>.mp4
  caption/001_<reel_id>.txt
  article/001_<reel_id>.txt
  excel/reels_content.xlsx
  results.json
```

Số thứ tự và Reel ID liên kết các file của cùng một Reel. Caption TXT chứa caption Facebook; article TXT chứa văn bản bài viết của website được dẫn trong Reel. File article chỉ được tạo khi tách được nội dung. Excel ghi caption, vị trí link, URL web, nội dung, đường dẫn video/TXT, trạng thái từng bước và lỗi. Nội dung dài hơn giới hạn ô Excel được giữ đầy đủ trong TXT. `results.json` được cập nhật sau mỗi Reel, lưu trạng thái và bản xem trước nội dung; không phải cơ chế tự tải lại batch đã dừng.

Link được lấy từ message/ranges đúng video ID và bình luận của tác giả trong feedback gắn đúng `associated_video`. Giữ owner ID cho cả nguồn numeric và slug; không dùng link của người bình luận khác khi chưa biết tác giả. Nhận URL HTTP(S), www và domain/path phổ biến; tháo link chuyển hướng Facebook và bỏ `fbclid`. Nếu có nhiều link, hiện xử lý link hợp lệ đầu tiên theo thứ tự caption rồi bình luận tác giả.

Website được đọc bằng HTTP GET với kiểm tra DNS/redirect, không nhận cookie Facebook, không chạy JavaScript hoặc tải tài nguyên trang. Mozilla Readability tách phần bài viết; không thay nội dung bài viết bằng meta description. Trang chỉ tải nội dung qua JavaScript, trang yêu cầu đăng nhập, CAPTCHA, lỗi HTTP hoặc cấu trúc không đọc được sẽ có trạng thái lỗi/không tách được bài viết. Proxy trong màn hình tải áp dụng cho Facebook; bài viết website hiện dùng kết nối trực tiếp.

“Đủ danh sách” chỉ hiện khi có bằng chứng phân trang đúng nguồn đã hết, mọi ID có membership, không pending/loading/cảnh báo. DOM đứng yên, lỗi mạng hoặc giới hạn lượt quét vẫn là danh sách một phần. Một lượt quét giới hạn 120 giây/10.000 ID; lượt xuất xử lý tuần tự, tối đa 10.000 ID thuộc job, HTML tối đa 4 MiB, website tối đa 30 giây, video tối đa 180 giây mỗi mục. Dừng giữ file đã hoàn thành và ghi trạng thái các mục chưa chạy.

Số Reel tìm thấy và số caption đã lấy không tự xác nhận trang cuối. Trước bản sửa ngày 2026-10-02, phản hồi phân trang nhiều bản ghi vượt cache 4 MiB có thể làm app thấy đủ thẻ nhưng báo “không đọc được phản hồi mạng”. Bộ thu mới đọc từng bản ghi ngay khi Facebook trả dữ liệu, giữ giới hạn bộ nhớ và kiểm tra nguồn. Mở lại app để nạp mã main mới, rồi quét lại profile để lấy bằng chứng kết thúc; checkpoint cũ giữ dữ liệu nhưng không tự đổi trạng thái thành đủ.

Các thay đổi main/IPC cần mở lại TediaPros để được nạp. `npm run build` tạo bản trong `out/`; chưa tạo installer mới.

## Kiểm chứng ngày 2026-10-02

- Các suite Facebook kiểm tra ID/owner, recommendation đến trước DOM, Unicode/caption, cuộn đúng container, bootstrap mới, website redirects/DNS, xuất XLSX/TXT, huỷ và lỗi từng bước.
- Link website thực từ bình luận tác giả trên Reel `936934766124971`: bộ tách đọc được 6.623 ký tự/32 đoạn và ghi TXT/XLSX. Script `scripts/verify-facebook-reels-article.mjs <URL> <OUTPUT_ROOT> <REEL_ID>` kiểm tra phần website và writer; caption trong phép thử này là nhãn kiểm tra, video được tắt.
- Ảnh người dùng cung cấp báo một batch 28 link web, 28 bài viết đã lưu và 28 MP4 đã tải. Chưa đối soát nội dung các file hoặc xác nhận quét hết profile `61593895532705`. Chrome hiện 28 thẻ nhưng payload ban đầu còn `has_next_page: true`; không lấy 28 làm bằng chứng toàn bộ profile.
- Profile `61593283816056`: Chrome trả 20 thẻ và `has_next_page=false` trên phản hồi cuối gần 7 MB. Kiểm chứng bộ thu/controller bằng dữ liệu thật đã quan sát nhận đủ 20 membership và kết thúc hợp lệ; app đang mở cần nạp bản build mới và quét lại. Bằng chứng: `.ai/tasks/TASK-20261002-facebook-reels-completion.md`.

### Kiểm tra giao diện sau thiết kế lại

Script `node scripts/preview-facebook-reels-ui.mjs` chạy giao diện React thật với dữ liệu minh họa tại `http://127.0.0.1:4179`. Đây là môi trường kiểm tra renderer: không mở Electron, không đọc cookie, không kết nối Facebook và không xuất file thật. Thêm `?count=503`, `?mode=missing&count=3` hoặc `?mode=expired&count=3` để kiểm tra phân trang, dừng bằng bàn phím và lỗi lượt quét hết hạn. Bằng chứng và giới hạn kiểm tra được ghi trong `.ai/tasks/TASK-20261002-facebook-reels-ui.md`.

Thư viện tách nội dung theo [Mozilla Readability](https://github.com/mozilla/readability); Excel theo [ExcelJS](https://github.com/exceljs/exceljs). Quyết định kiến trúc: [ADR 012](adr/012-facebook-reels-scoped-discovery.md).
