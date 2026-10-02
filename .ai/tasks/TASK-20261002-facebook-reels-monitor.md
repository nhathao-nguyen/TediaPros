# TASK-20261002-facebook-reels-monitor: Theo dõi và tự tải Reels hằng ngày

- **Trạng thái:** Đã kiểm chứng local
- **Người thực hiện:** Codex
- **Thời gian:** 2026-10-02

## 1. Mục Tiêu

Thêm lịch theo dõi kênh Reels mỗi ngày, tải ID mới so với các lượt tải trước và hiển thị kết quả trong thông báo. Người dùng xác nhận 09:00 giờ Việt Nam, chạy bù khi mở app. Giữ các thay đổi Reels và worktree có sẵn.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Bật/tắt riêng từng kênh, giờ mặc định 09:00 Việt Nam có thể thay đổi.
- [x] Chạy bù lượt gần nhất, claim mỗi ngày bền vững qua restart; không replay từng ngày offline.
- [x] Chỉ tải ID mới đã xác minh, giữ lịch sử chống trùng kể cả file đã xóa.
- [x] Hiển thị trạng thái, số tải/bỏ qua/lỗi, video thành công, mở thư mục và đã đọc.
- [x] Hủy khi tắt theo dõi/bỏ kênh/đổi thư mục/thoát; bind digest tài khoản.
- [x] Typecheck và test liên quan pass, build thành công.

## 3. Phạm Vi

Main service và persistent store, typed IPC, thư viện Reels, chuông thông báo toàn app. Chạy khi Electron mở; không cài Windows Task Scheduler/autostart hay changedetection.io. Tải nền MP4 tốt nhất qua kết nối trực tiếp; không xuất caption/article hoặc nhận proxy từ cấu hình tải thủ công.

## 4. Quyết Định Kiến Trúc

- Tham khảo watch/schedule/notification của changedetection.io, triển khai độc lập bằng ID Reels và downloader/crawler hiện có.
- Claim trước scan vào store riêng v1. Crash giữ lịch ngày, lần mở sau đánh dấu gián đoạn; kiểm tra ngay là hành động chủ động để chạy thêm.
- Scheduler tuần tự giữa các kênh; library khóa theo Reel ID tránh xung đột với tải thủ công. Membership, completion và tải thành công được xét riêng.
- Lịch tự động dùng toàn bộ ID từng thành công; thao tác lấy mới thủ công vẫn cho tải lại file cũ đã mất.

## 5. Tệp Thay Đổi

- Mới: `src/shared/facebookReelsMonitor.ts`, `src/main/facebookReelsMonitor{,Store,Runtime}.ts`.
- Mới: `src/renderer/src/components/{useReelsMonitor.ts,ReelsNotifications.tsx}`, `tests/facebook-reels-monitor.test.ts`, `docs/facebook-reels-monitor.md`.
- Sửa: Main index/preload; library history API và late-cancel recording; Downloader/library/App; Reels CSS; registry tests, fixture preview; architecture/domain và library regression tests.

## 6. Kiểm Chứng

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/run-local-runtime-tests.mjs facebook-reels-monitor.test facebook-reels-library.test facebook-reels-lifecycle.test facebook-reels-export.test facebook-reels-jobs.test facebook-reels-crawler.test facebook-reels-parser.test facebook-reel-details.test facebook-reels-selection.test
```

- Typecheck: PASS, node + web.
- Build: PASS; các cảnh báo static/dynamic imports thuộc pipeline hiện có.
- Test: **92 pass, 0 fail** (13 monitor, 10 library và 69 related). Log: `.ai/qa/facebook-reels-library/daily-monitor-tests.txt`.
- UI preview synthetic tại port 4179: bật checkbox → nút kiểm tra ngay; đổi 09:00 → 18:30 → lưu → thông báo hiển thị giờ mới; đánh dấu tất cả đã đọc → badge biến mất; reset fixture về 09:00. Ô time dùng onInput để cập nhật ngay. Ảnh 1298×807: `.ai/qa/facebook-reels-library/daily-monitor.png`.
- Chưa thử download Facebook thật, chưa package/install hoặc khởi động lại ứng dụng đang dùng. Preview không dùng cookie/download thật.

## 7. Bàn Giao

Bật theo dõi cho các kênh cần chạy sau khi mở bản app chứa preload/Main mới. Nếu đăng nhập đổi tài khoản, tắt/bật lại theo dõi để bind lại. Thông báo đọc trong khi đang chạy sẽ trở thành chưa đọc khi lượt hoàn tất. Store lỗi được báo thay vì ghi đè/xóa lịch sử.
