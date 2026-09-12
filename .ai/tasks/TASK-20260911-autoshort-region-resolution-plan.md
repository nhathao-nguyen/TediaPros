# TASK-20260911-autoshort-region-resolution-plan: Lập kế hoạch sửa vùng theo độ phân giải

- **Trạng thái:** Hoàn thành kế hoạch; chưa triển khai bản sửa
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-11

## 1. Mục tiêu

Lập kế hoạch sửa lỗi khung phụ đề, blur và OCR đổi vị trí/kích thước khi chuyển video khác độ phân giải.

## 2. Tiêu chuẩn nghiệm thu

- [x] Đối chiếu state renderer, metadata, RegionBox và payload batch/STTN với coordinator.
- [x] Chọn kiến trúc normalized và quy định font/viền, metadata trễ, zoom và 9:16.
- [x] Định nghĩa regression, test matrix, phạm vi và điều kiện hoàn thành.
- [ ] Typecheck/tests của bản sửa: chờ triển khai; lượt này chỉ thêm tài liệu.

## 3. Phạm vi

Chỉ lập kế hoạch. Không sửa mã, config người dùng hoặc video nguồn.

## 4. Quyết định

Lưu vùng normalized trong renderer; tiếp tục dùng phép đổi normalized sang display pixels của backend. Bố cục chung cho batch, không thêm tùy chỉnh riêng từng video.

## 5. Tệp thay đổi

- `docs/plans/2026-09-11-autoshort-region-resolution-fix.md`
- Bản ghi task này.

## 6. Kiểm chứng

Đã đọc mã và đối chiếu đường đi của ba loại vùng, font/viền và STTN preview. Chưa chạy test ứng dụng vì không thay mã; các lệnh kiểm thử trong kế hoạch là công việc tương lai.

## 7. Bàn giao

Triển khai theo thứ tự regression → state normalized → metadata → font/viền → payload → acceptance. Chỉ tuyên bố sửa xong sau khi các gate trong kế hoạch có kết quả thực tế.
