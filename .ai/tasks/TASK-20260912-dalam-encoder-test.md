# TASK-20260912: Test CPU và NVENC trên video dalam

- **Trạng thái:** Hoàn thành kiểm thử trong phạm vi 10 giây mỗi nguồn.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-12

## 1. Mục tiêu

Thử xuất hai video người dùng chỉ định, xác định vì sao app dùng CPU và so sánh đường xuất NVENC khả dụng trên máy.

## 2. Tiêu chuẩn nghiệm thu

- [x] Kiểm tra cả hai video thật và binary app đang dùng.
- [x] Ghi đầy đủ lỗi NVENC và số đo xuất CPU/GPU.
- [x] Probe và decode tất cả 6 thành phẩm thành công.
- [x] `npm.cmd run typecheck`: PASS node/web, exit 0.

## 3. Phạm vi

Chỉ thêm script, log, video mẫu và báo cáo trong `.ai/tasks/2026-09-12-dalam-encoder-test/`. Không sửa code sản phẩm, đổi runtime/driver, hủy job, gọi provider hay sửa nguồn.

## 4. Quyết định và lý do

So sánh 10 giây đầu của mỗi nguồn bằng preset hiện có; lưu mask/ASS mô phỏng để tái hiện filter có kiểm soát. Đọc tiến trình app để xác nhận đúng binary. Ghi rõ tải nền và khác biệt build/quality giữa các lựa chọn.

## 5. Tệp thay đổi

- Thư mục `.ai/tasks/2026-09-12-dalam-encoder-test/`: `benchmark.cjs`, `REPORT.md`, `results.json`, `binaries.json`, `decode-verification.json`, ASS mẫu, log và video test.
- Bản ghi bàn giao này.

## 6. Kiểm chứng

`node .ai/tasks/2026-09-12-dalam-encoder-test/benchmark.cjs`: exit 0; 2 lượt active NVENC lỗi dự kiến API 13.1/13.0; 6 lượt còn lại thành công. FFmpeg decode 6/6 thành phẩm: exit 0. Typecheck: exit 0.

## 7. Bàn giao

Driver hiện tại 595.79 cung cấp NVENC API 13.0, binary active yêu cầu 13.1. Binary FFmpeg khác có sẵn chạy NVENC tốt trên cả hai nguồn. Xem `REPORT.md` để tối ưu runtime có kiểm chứng tương thích; chưa áp dụng sửa vào app.
