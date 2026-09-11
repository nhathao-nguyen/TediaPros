# Phân Hệ Tải Video & Douyin (Downloader & Douyin Subsystem)

- **Thư mục mã nguồn:** `src/main/ytdlp.ts`, `src/main/douyin.ts`, `src/main/cookies.ts`, `src/main/douyinCookies.ts`, `engines/douyin-engine/`
- **Tài liệu tham chiếu:** [engines/douyin-engine/AGENTS.md](file:///f:/Son/tool/TediaPros/engines/douyin-engine/AGENTS.md)

---

## 1. Trách Nhiệm Cốt Lõi
- Tích hợp công cụ `yt-dlp` để phân tích định dạng và tải video/audio từ hơn 1,000 website.
- Quản lý phiên Cookie trình duyệt tự động và thủ công cho các trang web yêu cầu đăng nhập.
- Điều phối engine crawler Douyin chuyên dụng (`dy-downloader` v2.0.0) bằng Python asyncio.
- Quản lý danh sách kênh tác giả Douyin, tải tăng dần (incremental download) và khử trùng lặp qua SQLite.

---

## 2. Douyin Engine Architecture
- Cấu trúc module Python:
  - `core/`: Client giải mã URL, gọi API Douyin, factory downloader.
  - `auth/`: Quản lý Cookie session từ Electron sang Python.
  - `storage/`: SQLite database lưu trữ `aweme_id` đã tải để tránh tải lại.
  - `control/`: Rate limiting, hàng đợi đồng thời, retry exponential backoff.
  - `cli/`: Progress display in ra stdout định dạng JSON/text.

---

## 3. Kiểm Thử Liên Quan
```powershell
python engines/douyin-engine/run.py --help
python -m unittest discover -s engines/douyin-engine/tests -p "test_*.py" -v
```
