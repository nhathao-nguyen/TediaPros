# OCR-GPU-ASSESSMENT: Đánh giá GPU OCR và điểm chờ AutoShort

- **Trạng thái:** Hoàn thành đánh giá; chưa triển khai GPU OCR.
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-09

## 1. Mục tiêu

Kiểm tra vì sao OCR dùng CPU, GPU trên máy có cải thiện không và ảnh hưởng tới
luồng AutoShort. Chỉ chẩn đoán/thử nghiệm cô lập theo yêu cầu người dùng.

## 2. Tiêu chuẩn nghiệm thu

- [x] Probe runtime hiện có và kiểm tra package/provider thực nạp.
- [x] Đo detector CPU/DirectML trên khung video thật, nêu giới hạn.
- [x] Kiểm tra coordinator và tái hiện điểm chờ bằng resource-manager thật.
- [x] Typecheck node/web và các suite liên quan pass.
- [x] Ghi rõ chưa thay runtime, chưa chạy GPU full OCR/AutoShort.

## 3. Phạm vi

Trong phạm vi: đọc source/audit/runtime, 3 khung video, microbenchmark detector,
phép thử scheduler không khởi chạy provider, kiểm thử và tài liệu bằng chứng.
Ngoài phạm vi: sửa engine/scheduler, cài dependency, đổi cấu hình ứng dụng,
restart/stop batch, xóa cache, commit/push, phát hành hoặc thay binary.

## 4. Quyết định và lý do

GPU đáng thử triển khai tiếp: warm detector 322.149 → 28.775 ms/khung, 11.195x;
profiling ghi 202 DML node events. Không suy ra toàn AutoShort nhanh hơn 11x.
OCR đã giữ CPU+GPU lease nên chuyển provider không tự thêm khóa. FIFO chung có
head-of-line blocking, đã tái hiện; đây là vấn đề scheduling độc lập.

## 5. Tệp thay đổi

- NEW `docs/reviews/2026-09-09-ocr-gpu-assessment/README.md`
- NEW `docs/reviews/2026-09-09-ocr-gpu-assessment/detector-probe.py`
- NEW `docs/reviews/2026-09-09-ocr-gpu-assessment/resource-wait-probe.mjs`
- NEW `.ai/tasks/2026-09-09-ocr-gpu-assessment.md`

Không sửa các file sản phẩm đang dirty từ trước. Profiling ONNX tạo 166783 byte
ở thư mục temp riêng, đường dẫn ghi trong báo cáo; không xóa file người dùng.

## 6. Kiểm chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-resource-manager.test autoshort-stage-scheduling.test autoshort-queue-throughput.test autoshort-item-scope.test autoshort-ocr-pipeline.test autoshort-ocr-runtime.test
node docs/reviews/2026-09-09-ocr-gpu-assessment/resource-wait-probe.mjs
$videoFile = @(rg --files 'F:/Son/doyuin/VideoInput' -g '*7675331033864178944.mp4')[0]
python -B docs/reviews/2026-09-09-ocr-gpu-assessment/detector-probe.py --video $videoFile --model 'C:/Users/PC/AppData/Roaming/tedia-pros/bin/ocr-engine/_internal/rapidocr_onnxruntime/models/ch_PP-OCRv3_det_infer.onnx'
```

Typecheck PASS; 48/48 local-runtime tests PASS. GPU detector output-map IoU=1.0
ở ngưỡng 0.3 trên 3 khung; không phải kiểm chứng text/polygon/timed-mask cuối.
Phép thử scheduler chứng minh server có thể chờ dù slot rảnh khi OCR giữ khóa
và tách giọng đứng đầu queue; nhả OCR thì các yêu cầu tiếp tục được cấp.

## 7. Bàn giao

Xem báo cáo cho root cause runtime CPU, RapidOCR version drift, provider telemetry
không đầy đủ và giới hạn source-vs-packaged-app. Bước tiếp theo cần yêu cầu triển
khai: runtime GPU cô lập, xác nhận det/cls/rec, A/B full pipeline không cache,
kiểm chứng hủy/fallback/VRAM trước khi thay runtime chính. Không cần sửa scheduler
để có thể thực hiện A/B provider.
