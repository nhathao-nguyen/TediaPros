# TASK-20260912: Điều tra hiệu suất AutoShort Win Local

- **Trạng thái:** Hoàn thành chẩn đoán trong phạm vi bằng chứng; chưa sửa pipeline.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-12

## 1. Mục tiêu

Tìm log bản Windows local, đo thời gian và số thành phẩm, rà các bước AutoShort để giải thích hiệu suất thấp.

## 2. Tiêu chuẩn nghiệm thu

- [x] Xác nhận đúng profile/app.asar và trạng thái tiến trình hiện tại.
- [x] Đo thời gian, completion/failure bằng telemetry; phân biệt duplicate output và video nguồn.
- [x] Đối chiếu 90 task persisted với 36 item đã chạy trong batch cuối.
- [x] Phân loại toàn bộ 20 lỗi; tái hiện 13 lỗi OCR → STTN bằng hàm bản cài và cache thật.
- [x] Typecheck node/web PASS, exit 0.
- [x] Báo cáo workflow, inventory, coverage và giới hạn bằng chứng.

## 3. Phạm vi

Chỉ đọc sản phẩm, source và artifacts; thêm tài liệu/scripts chẩn đoán trong .ai/tasks. Không sửa triển khai, bật/tắt app, thay cấu hình, hủy job, gọi provider, thay checkpoint/cache, commit hoặc deploy.

## 4. Quyết định và lý do

Log đã bị xóa khi app thoát; dùng summary/events tại thư mục output làm nguồn chính. Không coi nhãn abort/timeout cuối log là server outage. Dùng trực tiếp 4 hàm từ installed bundle để tránh gán hành vi source 0.1.24 cho bản cài 0.1.23 mà chưa kiểm chứng.

## 5. Tệp thay đổi

- Thư mục mới `.ai/tasks/2026-09-12-winlocal-performance/`: REPORT.md, COVERAGE.md, FILE_INVENTORY.json, metrics/probe/replay/queue JSON, ba script CJS và 82 bản sao telemetry nhỏ.
- Bản ghi bàn giao này.

## 6. Kiểm chứng và bằng chứng

```powershell
npm.cmd run typecheck
node .ai/tasks/2026-09-12-winlocal-performance/analyze.cjs
node .ai/tasks/2026-09-12-winlocal-performance/replay-gap.cjs
node .ai/tasks/2026-09-12-winlocal-performance/read-queue.cjs
```

Tất cả exit 0. Analyze: 16/16 output metadata probes. Replay: 13/13 lỗi thực tái hiện đúng ở cả installed và source; đây là proof của defect, không phải proof đã fix. Queue: 90 item, khớp 36 item đã chạy, 54 chưa bắt đầu. Source probes: 15/15. Synthetic NVENC exact encoder options: exit 0. Không chạy full suite vì không sửa triển khai; không dùng kết quả này thay real-media regression sau sửa.

Batch cuối 7:55:51, 15 succeeded / 20 failed / 1 cancelled. Ba lượt từ 22:33:53 đến 07:31:06 có 16 file thành phẩm, 15 nguồn duy nhất. Lúc điều tra app đã dừng. Chi tiết số liệu, code lines và unknown xem REPORT.md.

## 7. Bàn giao

Ưu tiên sửa raw-vs-stabilized OCR validation, bảo toàn geometry/provenance và dùng 13 cache đã tìm để regression. Sau đó giữ log, replay duration/calibration, chẩn đoán libx264 fallback, tối ưu STTN/lịch tài nguyên dựa trên benchmark. Không hứa số lần tăng tốc khi chưa đo sau sửa.
