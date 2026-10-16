# TASK-20261002-facebook-reels-ui: Thiết kế lại chọn và đọc kết quả Facebook Reels

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex; reviewer reels_ui_review
- **Thời gian:** 2026-10-02

## 1. Mục tiêu

Sửa UI bị ép mất vùng cấu hình/hàng đợi sau khi xuất, cho đọc caption và bài viết website, giữ lựa chọn và truy cập toàn bộ danh sách.

## 2. Tiêu chuẩn nghiệm thu

- [x] Kết quả không tạo hàng thứ hai trong grid cấu hình/hàng đợi.
- [x] Tiêu đề và caption không bị cắt một dòng; bài viết có vùng đọc/cuộn và mở TXT đầy đủ.
- [x] Tìm kiếm, lọc, phân trang giữ index và lựa chọn; truy cập được dòng 503.
- [x] Đóng/mở và thêm hàng đợi giữ danh sách Reels; lỗi hiện trong dialog; bàn phím thao tác Dừng được.
- [x] Số lượng xuất chỉ tính Facebook khi trộn playlist nền tảng khác.
- [x] Typecheck, build cuối cùng và kiểm tra 1298×807, 1000×700, 768×700 hoàn tất.

## 3. Phạm vi

Renderer Downloader, dialog chọn Reels, danh sách kết quả/reader, CSS riêng và helper selection/filter/page. Giữ backend quét/xuất đã triển khai, các dirty changes, IPC và quy trình tải playlist thông thường. Không tạo installer hoặc đóng app đang chạy.

## 4. Quyết định và nguyên nhân

Tái hiện ở 1298×807: section kết quả là grid child thứ ba, span cả hai cột và tạo hàng auto thứ hai; hai cột chính bị ép còn 42.56px. Root Downloader nay là flex với hai pane chuyển qua lại, grid chỉ còn hai con. Kết quả dùng danh sách và vùng đọc, dialog rộng có footer xuất riêng. Vùng hẹp xếp dọc và cuộn; nội dung có thể chọn/sao chép.

Reviewer đã phát hiện và xác nhận sửa bốn lỗi: trap bàn phím chặn nút Dừng, lỗi quét/enrich bị ẩn, queue xóa scanned entries, export đếm cả ordinary playlist. Danh sách mixed vẫn hiển thị các video thường với nhãn/warning rõ ràng; export chỉ đếm Reels, queue giữ mọi lựa chọn.

## 5. Tệp thay đổi

- Downloader.tsx: hai pane, input lên đầu, tiến trình export trong kết quả, giữ scan/selection.
- FacebookReelsSelection.tsx: dialog rộng, search/page/range, preview, focus/cancel/errors.
- FacebookReelsExportResults.tsx: thống kê, tìm/lọc, trạng thái từng bước, reader/file actions.
- FacebookReelReader.tsx: caption/article, copy, file/source links, phân trang.
- lib/facebookReels.ts và styles/facebookReels.css: helper và layout scoped.
- tests/facebook-reels-selection.test.ts: bốn regression mới.
- scripts/preview-facebook-reels-ui.mjs và tests/fixtures/facebook-reels-ui.tsx: renderer QA với dữ liệu giả.
- docs/facebook-reels-export.md: cập nhật quy trình.

## 6. Kiểm chứng

Lệnh thực tế:

```powershell
node scripts/run-local-runtime-tests.mjs facebook-reels-selection.test
npm.cmd run test:local-runtime
npm.cmd run typecheck
npm.cmd run build
```

- Selection: 7 pass, 0 fail; đã quan sát ba test mới fail trước khi triển khai helper.
- Full suite: 1.157 test; 1.122 pass, 35 runtime/FFmpeg skip, 0 fail. Log `%TEMP%\tediapros-reels-ui-suite.log`.
- Typecheck node/web cuối cùng pass, build cuối cùng pass. Log `%TEMP%\tediapros-reels-ui-typecheck.log` và `%TEMP%\tediapros-reels-ui-build.log`.
- Browser: close/reopen giữ 27/28 lựa chọn; search không đổi checked. Mixed 3 FB + 1 playlist: queue 4, reopen giữ 4, export ghi rõ 3 FB.
- Browser: page 11 hiển thị 501–503; bỏ checkbox 503 làm exportCount từ 503 xuống 502.
- Browser: lấy caption thiếu chuyển focus Dừng; Tab/Enter dừng, role=alert hiện “Đã dừng lấy caption.”, focus trở lại search. Quét tiếp expired hiện lỗi trong dialog.
- Browser 1298×807: sau xuất, grid chỉ có 2 con, hai cột cao 595px thay vì 42.56px; textarea cao 72px. Reader cao 352px, vùng đọc 217px, mọi nút file nằm trong khung. Bài viết minh họa 6.679 ký tự/30 đoạn; End đưa focus vào vùng đọc và cuộn đến scrollTop=2775, scrollHeight=2992, clientHeight=217, thấy đầy đủ đoạn 30; Home trở lại đầu.
- Browser 1000×700: footer chọn/xuất bottom=679 nằm trong dialog bottom=680, không tràn ngang. 768×700: bố cục xếp dọc, outer dialog cuộn tới reader, footer xuất ghim dưới. Lọc 5 mục cần kiểm tra; search không có kết quả hiện trạng thái rỗng. Mở TXT gọi đúng đường dẫn article của Reel đang xem.
- Reviewer đọc lại sau sửa và chạy riêng selection 7/7: không còn Critical/Important. Điều chỉnh sau đó chỉ thu gọn thống kê/output, thêm focus vào vùng đọc và phân biệt bản xem trước của bài viết dài.
- Bằng chứng trong `.ai/qa/facebook-reels-ui/`, ảnh 01-before chụp trước sửa bằng giao diện React thật với fixture. Đây là dữ liệu minh họa, không chứng minh quét/tải Facebook thật hoặc đầy đủ profile.

Các bước đã quan sát:

1. **Nhập liên kết / hàng đợi — đạt:** ảnh `06-download-after-export.jpg`, còn nguyên vùng nhập sau xuất.
2. **Chọn và đọc caption — đạt:** ảnh `02-selection.jpg`; tìm kiếm, checkbox, chọn khoảng và mở lại giữ dữ liệu.
3. **Đọc website / mở file — đạt:** ảnh `03-results-website.jpg`; toàn bộ văn bản trong phạm vi IPC, bài dài có thông báo xem trước và mở TXT đầy đủ.
4. **Cửa sổ nhỏ — đạt:** ảnh `04-selection-1000.jpg` và `05-selection-768-reader.jpg`, có cuộn và truy cập reader/footer.

Kiểm tra bàn phím có bằng chứng focus/cancel/End/Home; chưa tuyên bố kiểm định accessibility toàn app hoặc screen reader. Lưu lượng Facebook và file download thật không được mock preview chứng minh.

## 7. Bàn giao

Preview dùng component thật và bridge giả, chỉ bind localhost. App đang chạy có thể cần mở lại để nạp `out/`. Không tạo installer, không tự đóng app. Screenshot người dùng xác nhận một batch 28 đã xuất; không dùng số 28 để kết luận hết profile.
