# TASK-20260912: Lập kế hoạch sửa và tối ưu AutoShort hàng loạt

- **Trạng thái:** Hoàn thành tài liệu kế hoạch; chưa triển khai sản phẩm.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-12

## 1. Mục tiêu

Chuyển audit hiệu suất phiên đêm thành thiết kế và kế hoạch sửa lỗi, resume batch, tối ưu có đo và nghiệm thu 90 video.

## 2. Tiêu chuẩn nghiệm thu

- [x] Dựa trên telemetry/replay đã thu, không bịa nguyên nhân voice/server/NVENC.
- [x] Có thứ tự phụ thuộc, tệp liên quan, interface đề xuất, case kiểm thử và release gates.
- [x] Có cơ chế journal/resume/receipt, bảo toàn dữ liệu và các chính sách đã chấp thuận.
- [x] Nêu KPI là mục tiêu đề xuất, không khẳng định hiệu quả đã đạt.
- [x] Typecheck node/web chạy lại PASS, exit 0.

## 3. Phạm vi

Chỉ thêm spec, plan và handoff. Không sửa source, cache/checkpoint, ứng dụng cài đặt hoặc cấu hình. Giữ nguyên artifacts audit có sẵn. Không commit hoặc deploy.

## 4. Quyết định

Chọn sửa trên kiến trúc hiện tại, không tăng concurrency ngay hoặc đổi STTN thành blur. Bản sửa P0 xử lý 13 gap defects và giữ log; P1 journal/voice; P2 encoder/scheduling/cache/benchmark; P3 batch/soak/bản cài. Mặc định benchmark giữ chất lượng và policy.

## 5. Tệp thay đổi

- `docs/superpowers/specs/2026-09-12-autoshort-batch-reliability-design.md`
- `docs/superpowers/plans/2026-09-12-autoshort-batch-reliability.md`
- Bản ghi này.

## 6. Kiểm chứng

Đọc code queue, coordinator, resource manager, logger, cache, shared contracts, preload, renderer state và các test liên quan. Kiểm tra đường dẫn test/module có thật; sửa đường dẫn semanticGrouping thành src/main/semanticGrouping.ts. Kiểm tra coverage giữa spec và 8 task; không có placeholder chưa điền.

`npm.cmd run typecheck`: PASS node/web, exit 0. HEAD tại bàn giao 7e2b93e, package 0.1.25; đây là source hiện tại, không đồng nhất với source/installed của audit trước. Không chạy runtime regression vì chỉ thay tài liệu, chưa triển khai các interface trong plan.

## 7. Bàn giao

Đầu việc triển khai đầu tiên là Task 1 trong plan. Bảo toàn 13 cache fixtures của audit trước khi cache bị prune. Bản cài phải được kiểm tra lại version/hash trước khi thử hoặc nâng cấp. Không đánh dấu các checkpoint implementation là done từ sự hoàn tất của kế hoạch.
