# STTN manual region release

- Trạng thái: Đã kiểm chứng local; chờ CI release.
- Người thực hiện: Codex
- Thời gian: 2026-10-14

## Mục tiêu và nghiệm thu

Xóa logo cố định dù OCR không nhận ra chữ. Bảo toàn chế độ OCR, kiểm tra IPC và xem thử.

## Phạm vi và quyết định

Thêm sttn-region dùng mask toàn thời lượng và hỗ trợ subtitleMethod none. Không thay engine/model, chưa triển khai khử alpha. Giữ các sửa đổi Facebook chưa commit ngoài bản release này.

## Thay đổi

Shared contracts và manual timeline, dependency IPC parser, coordinator, preview, renderer và test STTN.

## Kiểm chứng

Typecheck, build, test STTN/contract/pipeline đã qua trong phiên phát triển. Video thật 720x1280, 8 giây, CUDA, mask do mã mới tạo: 192 frame, logo biến mất trong các frame kiểm tra; xe đẩy còn nhòe. Chạy lại các gate release và kiểm tra CI trước công bố hoàn tất.

## Bàn giao

Bật Xóa logo/vùng khoanh suốt video, khoanh sát logo, xem thử trước khi xuất.
