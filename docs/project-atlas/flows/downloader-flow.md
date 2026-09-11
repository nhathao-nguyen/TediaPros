# Luồng Tải Video Đa Nền Tảng (Downloader Flow Trace)

- **Module thực thi:** `src/main/ytdlp.ts`, `src/renderer/src/components/Downloader.tsx`
- **Công cụ:** Binary `yt-dlp` và `ffmpeg`

---

## Trình Tự Thực Thi Chi Tiết

1. **Lấy thông tin video (Video Info Probe):**
   - User dán URL vào ô nhập liệu $\rightarrow$ UI gọi `window.api.getInfo(url, proxy, useCookies)`.
   - IPC handler gọi `fetchInfo(url)`: Thực thi lệnh `yt-dlp --dump-json --no-playlist <url>`.
   - Phân tích chuỗi JSON trả về: danh sách độ phân giải sẵn có (heights: 1080, 720, 480...), codec video (`vcodec`), audio (`acodec`), dung lượng ước tính.
   - Renderer nhận kết quả và cập nhật giao diện chọn chất lượng tải.

2. **Thực thi tải xuống (Download Execution):**
   - User chọn định dạng (Video MP4 hoặc Audio MP3), bấm "Tải xuống".
   - UI gọi `window.api.download(id, req)`.
   - Main process xây dựng tham số dòng lệnh `yt-dlp`:
     - Chọn định dạng: `-f bestvideo[height<=1080]+bestaudio/best` (hoặc định dạng audio).
     - Nhúng thumbnail: `--embed-thumbnail`.
     - Nhúng metadata: `--embed-metadata`.
     - Cookie: Nếu bật `useCookies`, nạp file cookie tương ứng với tên miền từ kho cookie của app.
     - Đầu ra H.264: Nếu bật `ensureH264`, cấu hình FFmpeg tự động chuyển mã sang chuẩn H.264/AAC.
   - Bắt luồng stdout của yt-dlp: phân tích phần trăm tiến độ, tốc độ tải (speed), thời gian còn lại (ETA).
   - Phát sự kiện `onProgress` về UI cập nhật thanh tiến trình theo thời gian thực.
