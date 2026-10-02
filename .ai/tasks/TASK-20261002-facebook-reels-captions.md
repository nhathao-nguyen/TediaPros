# TASK-20261002-facebook-reels-captions: Bổ sung caption cho phần sau của danh sách

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex; reviewer độc lập reels_ui_review
- **Thời gian:** 2026-10-02

## 1. Mục tiêu

Sửa tình trạng chỉ các Reel đầu có caption, các mục sau hiển thị mã Reel. Giữ caption đúng ID, dữ liệu đã lấy khi dừng, lựa chọn và phiên tài khoản.

## 2. Tiêu chuẩn nghiệm thu

- [x] Tự bổ sung caption thiếu sau discovery và khi quét tiếp.
- [x] Mọi ID đã chọn được xử lý, gồm phần sau một phút và sau 1.000 mục.
- [x] Metadata không có caption có fallback sang trang Reel; chỉ nhận dữ liệu đã xác minh đúng ID.
- [x] Dừng giữ phần hoàn tất; caption đã có không bị thay bằng dữ liệu thiếu/lỗi.
- [x] UI hiển thị số caption thiếu và nút lấy tiếp bên ngoài phần chọn khoảng.
- [x] Typecheck node/web pass; build pass; các test liên quan pass.
- [x] Tài liệu hướng dẫn cập nhật.

## 3. Phạm vi

Chỉ luồng caption Reels trong main/renderer và regression tests/fixture. Giữ nguyên scanning membership/pagination rules, IPC contract, downloader các nền tảng khác, LICENSE/NOTICE và mọi thay đổi dirty trước đó. Không commit, không tạo installer, không tự đóng app.

## 4. Nguyên nhân và quyết định

Checkpoint đọc trên máy cho nguồn 61593895532705 có 28 Reel nhưng chỉ 10 caption GraphQL, 18 mục thiếu. Một nguồn khác có 129 Reel, 18 verified/110 missing/1 error. Mã scan chỉ discovery, không tự enrich; `FacebookReelsJobs.enrich` dừng toàn batch sau 60.000ms; renderer cắt ID ở 1.000 trước cả khi lọc ownership. Các trường hợp này gây phần phía sau chưa được xử lý, không có bằng chứng caption đã lấy bị xóa.

Hai ID trong ảnh người dùng (962495230201514 và 1635900537972468) đã có caption trong checkpoint mới nhất khi kiểm tra: lần lượt 3.633 và 16.263 ký tự, nguồn yt-dlp. Không lưu nội dung caption/cookie vào bản ghi này.

Giải pháp: discovery xong tự enrich, chia request 1.000 ID; backend không còn deadline tổng 60 giây, vẫn có timeout 20 giây cho từng metadata và hủy. Reuse browser caption-only nếu yt-dlp không trả caption. GraphQL/browser phải đúng ID; caption provisional không cho phép early success. Failed initialization dọn session ngay và cache lỗi cho batch, tránh tạo nhiều session không được dọn.

## 5. Tệp thay đổi

- src/main/facebookReelsJobs.ts, facebookReelDetails.ts, index.ts.
- src/renderer/src/lib/facebookReels.ts, components/Downloader.tsx, FacebookReelsSelection.tsx.
- tests/facebook-reels-jobs.test.ts, facebook-reels-selection.test.ts, facebook-reel-details.test.ts.
- tests/fixtures/facebook-reels-ui.tsx, docs/facebook-reels-export.md, docs/adr/012-facebook-reels-scoped-discovery.md và docs/facebook-reels-improvement-plan.md.

## 6. Kiểm chứng và bằng chứng

```powershell
npm.cmd run typecheck
npm.cmd run build
node scripts/run-local-runtime-tests.mjs facebook-reels-jobs.test facebook-reels-selection.test facebook-reel-details.test facebook-reels-crawler.test facebook-reels-lifecycle.test facebook-reels-parser.test facebook-reels-export.test
git diff --check
```

- Typecheck node/web cuối cùng: exit 0. Build cuối cùng: exit 0, renderer index-ASndBmdn.js.
- 61 test pass, 0 fail, 0 skip; log `%TEMP%\tediapros-reels-caption-tests.log`.
- RED trước sửa: batch vượt một phút chỉ gọi 3/8 metadata; browser fallback không gọi; helper stub không chia nhóm. Sau sửa: jobs 9/9, selection 9/9.
- Reviewer tìm 2 Important: trả provisional caption quá sớm và failed-init tạo 3 session nhưng chỉ clear 1. Thêm test quan sát cả hai fail; sửa và details 6/6. Reviewer kiểm tra lại, 24 focused test pass độc lập, không còn Critical/Important.
- Renderer thật với API giả: mode captions bắt đầu 28 Reel/10 caption, tự enrich thành 28/28; reader Reel 11 có đủ phần cuối và link. Ảnh `.ai/qa/facebook-reels-ui/07-caption-auto.jpg` đã xem lại.
- Renderer/API giả với 129 Reel: dừng giữ 96/129 caption; nút lấy 33 còn thiếu xử lý thành 129/129; page 3 hiển thị caption Reel 129. Không làm mất selection.
- Không rerun full global runtime suite trong task này; suite liên quan ở trên đã chạy đầy đủ. Không dùng browser fixture để tuyên bố quét/tải Facebook thật hoặc hết profile.

## 7. Bàn giao

App cần nạp lại build sau khi tác vụ hiện tại kết thúc; quét mới sẽ tự bổ sung. Trong phiên còn mở có thể dùng nút lấy caption thiếu để tiếp tục danh sách hiện tại. Tốc độ phụ thuộc Facebook/metadata từng Reel; caption không truy cập được vẫn được đánh dấu thiếu/lỗi, không bịa nội dung.
