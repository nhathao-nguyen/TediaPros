# REELS-EXPORT-PARTS: chọn riêng nội dung tải về

- Trạng thái: Đã triển khai; kiểm chứng local.
- Người thực hiện: Codex
- Thời gian: 2026-10-15

## Mục tiêu và nghiệm thu

Checkbox MP4, caption TXT, bài viết/chương, thumbnail website và Excel. Preset Chỉ video và Tất cả. Không khởi chạy các bước web/caption/thumbnail hoặc ghi file nội dung khi chỉ chọn video. Tương thích request cũ; yêu cầu chọn ít nhất một phần.

## Phạm vi và quyết định

Flag mới optional với mặc định true cho request cũ. UI nhớ từng lựa chọn. Exporter chỉ tạo thư mục cho phần đã chọn; giữ results.json làm receipt/cancel checkpoint nội bộ. Thumbnail website vẫn cần đọc trang nguồn để tìm ảnh nhưng không lưu bài viết khi chưa chọn. Excel-only xuất metadata được lấy, không tự crawl bài viết. Chọn phần tải không thay đổi dữ liệu quét.

## Thay đổi

Shared selection helper/contract, jobs IPC validation, pipeline browser lazy init, exporter, Downloader, selection dialog và results UI. Giữ thay đổi Alpha và Facebook có sẵn.

## Kiểm chứng

Test từng lựa chọn và request cũ, skip dependencies trong video-only, file/directory outputs, cancellation, IPC từ chối malformed/all-off. Typecheck/build và tests liên quan phải qua trước bàn giao. Chưa xác nhận tải Facebook live hoặc GUI trực tiếp.

## Bàn giao

Mở Chọn Reels, nhấn Chỉ video rồi Xuất. Đưa vào release v0.1.38 theo yêu cầu ngày 2026-10-15.

Release gates 2026-10-15: metadata, typecheck, subtitle smoke và package:win passed; full local-runtime 1247 passed, 6 conditional skips, 0 failures. CI và published asset verification được kiểm tra sau khi push tag.
