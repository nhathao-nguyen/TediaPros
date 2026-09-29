# [TASK-20260926-facebook-reels-crawler]: Tích Hợp Tự Động Cào & Tải Toàn Bộ Video Facebook Reels Tab

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** ENI
- **Thời gian:** 2026-09-26

---

## 1. Mục Tiêu (Goal)

Giải quyết hạn chế của `yt-dlp` khi tải từ Facebook: `yt-dlp` chỉ hỗ trợ URL video Reel đơn lẻ (`/reel/<id>`), và báo lỗi `Unsupported URL` khi gặp các đường link tab Reels trang cá nhân hoặc fanpage (ví dụ: `https://www.facebook.com/profile.php?id=...&sk=reels_tab` hoặc `https://www.facebook.com/.../reels`).
Triển khai cơ chế trình duyệt ngầm Electron (nạp session cookie Facebook), tự động cuộn trang (infinite scroll) bóc tách toàn bộ danh sách các link video Reels con và trả về đối tượng `PlaylistProbe` để giao diện Downloader hiển thị hộp thoại chọn tải hàng loạt như một playlist thông thường.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Nhận diện chính xác URL tab Reels của Facebook (`profile.php?...&sk=reels_tab`, `.../reels`, `.../reels/`, `...&sk=reels`).
- [x] Phân biệt rõ video đơn lẻ (`/reel/<id>`) và tab Reels để không làm gián đoạn luồng tải trực tiếp của video đơn.
- [x] Tạo `BrowserWindow` ngầm (`show: false`, `backgroundThrottling: false`), nạp cookies phiên đăng nhập Facebook đã lưu từ `facebook.com.txt` / session partition.
- [x] Thực hiện vòng lặp cuộn trang trích xuất các link `/reel/<id>` và caption/tiêu đề, có cơ chế dừng an toàn (`maxScrolls`, `maxEntries`, `consecutiveNoNew`).
- [x] Tự động giải phóng tài nguyên cửa sổ (`win.destroy()`) trong khối `finally`.
- [x] Trả về dữ liệu kiểu `PlaylistProbe` chuẩn tương thích 100% với IPC `ytdlp:playlist` và modal `PlaylistSel` trong `Downloader.tsx`.
- [x] `npm run typecheck` vượt qua 100% (cả Node và Web).
- [x] Bộ test suite unit test `facebook-reels-crawler.test.ts` pass 100%.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - Tạo module [src/main/facebookReels.ts](file:///f:/Son/tool/TediaPros/src/main/facebookReels.ts).
  - Xuất hàm `sitePartition` và `populateSessionFromDomainCookies` trong [src/main/cookies.ts](file:///f:/Son/tool/TediaPros/src/main/cookies.ts).
  - Tích hợp hook phân nhánh trong `fetchPlaylist` và `fetchInfo` tại [src/main/ytdlp.ts](file:///f:/Son/tool/TediaPros/src/main/ytdlp.ts).
  - Viết bộ test [tests/facebook-reels-crawler.test.ts](file:///f:/Son/tool/TediaPros/tests/facebook-reels-crawler.test.ts) và đăng ký vào [scripts/run-local-runtime-tests.mjs](file:///f:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs).
- **Nằm ngoài phạm vi (Out of Scope):**
  - Không thay đổi engine tải video đơn `yt-dlp` của core downloader.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

1. **Trình duyệt ngầm Electron thay vì HTTP Fetch thuần:**
   - Facebook Reels tab sử dụng React/Relay kết hợp GraphQL tải động qua JavaScript và cơ chế chống bot nghiêm ngặt. Việc dùng BrowserWindow kế thừa Chromium engine và nạp trực tiếp session cookies giúp vượt qua anti-bot và hiển thị đúng DOM thực tế như người dùng lướt web.
2. **Thu thập dồn (Cumulative Extraction) trong mỗi nhịp cuộn:**
   - Facebook thường ảo hóa danh sách (virtualized list - unmount các phần tử phía trên khi cuộn sâu xuống dưới). Việc thu thập và đưa vào `Map<string, PlaylistEntry>` sau mỗi nhịp cuộn đảm bảo không bao giờ bị mất các video ở đầu trang.
3. **Giới hạn số lần cuộn và nhịp dừng:**
   - Dừng khi 4 nhịp cuộn liên tiếp không xuất hiện reel mới hoặc đạt trần 250 reels để bảo vệ tài nguyên và thời gian chờ của người dùng.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` [src/main/facebookReels.ts](file:///f:/Son/tool/TediaPros/src/main/facebookReels.ts): Module bóc tách danh sách Reels bằng Electron ngầm.
- `[MODIFY]` [src/main/cookies.ts](file:///f:/Son/tool/TediaPros/src/main/cookies.ts): Thêm `sitePartition` và `populateSessionFromDomainCookies`.
- `[MODIFY]` [src/main/ytdlp.ts](file:///f:/Son/tool/TediaPros/src/main/ytdlp.ts): Tích hợp kiểm tra `isFacebookReelsTabUrl` và gọi `crawlFacebookReelsTab`.
- `[NEW]` [tests/facebook-reels-crawler.test.ts](file:///f:/Son/tool/TediaPros/tests/facebook-reels-crawler.test.ts): Unit test nhận diện URL.
- `[MODIFY]` [scripts/run-local-runtime-tests.mjs](file:///f:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs): Đăng ký test suite mới.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:
```powershell
cmd.exe /c "node scripts/run-local-runtime-tests.mjs facebook-reels-crawler.test"
cmd.exe /c "npm run typecheck"
```

### Kết quả thực tế:
- `Test results`: PASS (3/3 tests passed, duration 93ms)
  ```
  ✔ isFacebookReelsTabUrl matches profile reels tab URLs (0.8396ms)
  ✔ isFacebookReelsTabUrl matches fanpage and username reels tabs (0.1591ms)
  ✔ isFacebookReelsTabUrl does not match single reel or video URLs (0.2488ms)
  ℹ tests 3, pass 3, fail 0
  ```
- `Typecheck`: PASS (0 errors across `typecheck:node` and `typecheck:web`)
