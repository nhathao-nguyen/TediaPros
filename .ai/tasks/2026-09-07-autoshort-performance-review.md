# AUTOSHORT-PERF-REVIEW: Khảo sát tăng tốc giữ chất lượng

- **Trạng thái:** Hoàn thành khảo sát; chưa triển khai tối ưu.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-07

## 1. Mục Tiêu

Đối chiếu flow Auto Short hiện hành để tìm cơ hội giảm thời gian chờ, I/O và tính toán lặp mà giữ chất lượng xử lý.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Phân biệt code đã có, mặc định đang tắt, runtime đã cài và đề xuất mới.
- [x] Có vị trí code, điều kiện áp dụng và kiểm chứng chất lượng cho các đề xuất.
- [x] Typecheck node/web pass.
- [x] Test liên quan pass, có log 22/22.

## 3. Phạm Vi

Đọc code, probe phiên bản OCR cục bộ, chạy kiểm thử, đọc lại benchmark STTN và lập báo cáo. Không sửa source/config/dependency, không gọi tạo nội dung live, không khẳng định KPI chưa đo.

## 4. Quyết Định & Lý Do

Ưu tiên stream-full và prefetch có giới hạn; đề nghị đặt nhánh hình sau Whisper để tận dụng thời gian chờ server. Resource lease và disk ledger cần xử lý trước khi tăng mức song song tương ứng. Cache từng stage dành cho rerun. Không giảm thông tin đầu vào/model/encode để lấy tốc độ.

## 5. Tệp Thay Đổi

- [NEW] [Báo cáo](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/AUTOSHORT_PERFORMANCE.md).
- [NEW] [Log test](F:/Son/tool/TediaPros/docs/reviews/2026-09-07-system-review/evidence/performance-focused-tests.log).
- [NEW] Bản ghi bàn giao này.

## 6. Kiểm Chứng

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime -- autoshort-tts-pipeline.test autoshort-ocr-runtime.test autoshort-queue-throughput.test
```

Typecheck PASS; 22 test PASS, 0 fail. OCR executable đã cài báo 1.1.0, thiếu streaming features. Benchmark STTN là evidence ngày 06/09 được đọc lại, không phải benchmark mới. Chưa đo E2E hoặc server live.

## 7. Bàn Giao

Baseline đo riêng stage và thời gian chờ trước khi chọn tối ưu. Không bật hàng loạt các cờ cùng lúc; mỗi thay đổi phải có kiểm tra output tương đương và bằng chứng latency/throughput riêng. Giữ các tệp untracked có từ trước.
