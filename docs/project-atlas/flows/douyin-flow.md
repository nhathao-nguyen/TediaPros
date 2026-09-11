# Luồng Tải Video Douyin Chuyên Biệt (Douyin Crawler Flow Trace)

- **Module thực thi:** `src/main/douyin.ts`, `engines/douyin-engine/`, `src/renderer/src/components/Douyin.tsx`

---

## Trình Tự Thực Thi Chi Tiết

1. **Quản lý Phiên & Cookie:**
   - Douyin áp dụng cơ chế chống crawler nghiêm ngặt.
   - Người dùng đăng nhập Douyin qua cửa sổ nhúng Chromium $\rightarrow$ Main process chụp Cookie session (`cookies:capture`) và đồng bộ vào `engines/douyin-engine/auth/`.

2. **Phân tích Kênh & Liên kết:**
   - User nhập liên kết kênh tác giả hoặc video Douyin $\rightarrow$ gọi `window.api.dyDownload(id, req)`.
   - Engine Python `engines/douyin-engine/run.py` được khởi chạy.
   - `core/url_parser.py`: Giải mã link rút gọn (v.douyin.com), bóc tách `sec_uid` của tác giả hoặc `aweme_id` của video.

3. **Khử trùng lặp qua SQLite & Tải không watermark:**
   - `storage/database.py`: Truy vấn cơ sở dữ liệu SQLite cục bộ để kiểm tra các video đã tải trước đó (chế độ tải tăng dần - incremental).
   - `core/api_client.py`: Gọi API lấy link video gốc chất lượng cao nhất (không có watermark đóng dấu logo Douyin).
   - `control/queue_manager.py`: Điều phối tải đa luồng có kiểm soát tốc độ (Rate Limiter) để không bị Douyin chặn IP.
   - Xuất file video kèm nhật ký `download_manifest.jsonl`.
