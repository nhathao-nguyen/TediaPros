# AUTOSHORT-OCR-OPT-20260908: Tối ưu transport, cache và ROI cho automatic OCR

- **Trạng thái:** Đã kiểm chứng cục bộ; runtime OCR 1.2.0 đã cập nhật và probe đạt; chờ benchmark real-media
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-08

---

## 1. Mục Tiêu (Goal)

Giữ nguyên chế độ `Tự động OCR` nhưng giảm thời gian chờ bằng cách ưu tiên transport stream ROI, chạy nhánh visual song song với các stage độc lập, tái sử dụng cache khi runtime fallback và giảm chi phí detector trong legacy transport.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Mặc định vẫn chỉ chạy một item, không tăng concurrency GPU/RAM.
- [x] Runtime đủ capability được yêu cầu `stream-roi`; runtime cũ fallback về `legacy-disk` an toàn.
- [x] Cache stream request tái sử dụng được artifact legacy fallback với cùng source/profile/geometry/ROI.
- [x] Legacy detector nhận ROI có halo và trả box về display-space đúng contract.
- [x] `npm run typecheck` pass.
- [x] Test TypeScript và Python OCR pass.
- [ ] Benchmark real-media cùng ba video mẫu với runtime user-data 1.2.0.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):** execution policy, OCR cache identity/compatibility, legacy OCR ROI crop, batch harness, regression tests và review/handoff docs.
- **Nằm ngoài phạm vi (Out of Scope):** thay RapidOCR/PaddleOCR, thay đổi ngưỡng nhận diện, xóa automatic OCR, tăng `maxActiveItems`, hoặc claim hiệu năng production chưa đo lại.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- *Lựa chọn:* `stream-roi` là transport mặc định, nhưng capability negotiation vẫn fallback về legacy.
- *Lý do:* source đã có implementation stream ROI; fallback bảo toàn khả năng chạy với binary cũ.
- *Lựa chọn:* cache key dùng revision mới không chứa transport yêu cầu.
- *Lý do:* transport là chi tiết triển khai; timeline display-space có thể tái sử dụng khi stream request rơi về legacy. Artifact legacy không được dùng cho request legacy ngược từ stream.
- *Lựa chọn:* overlap visual branch nhưng giữ `maxActiveItems=1`.
- *Lý do:* giảm thời gian trên critical path mà không tạo thêm áp lực tài nguyên cục bộ.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/main/autoShortExecutionPolicy.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `engines/ocr-engine/engine.py`
- `[MODIFY]` `scripts/run-video-input-batch.ts`
- `[MODIFY]` `tests/autoshort-ocr-runtime.test.ts`
- `[MODIFY]` `tests/autoshort-ocr-pipeline.test.ts`
- `[MODIFY]` `docs/reviews/2026-09-08-autoshort-stage-cost-review.md`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy:

```powershell
cmd.exe /d /c "npm run typecheck"
node scripts/run-local-runtime-tests.mjs autoshort-ocr-runtime.test
node scripts/run-local-runtime-tests.mjs autoshort-ocr-pipeline.test
cmd.exe /d /c "npm run test:ocr-engine"
```

### Kết quả thực tế:

- `Typecheck`: PASS, node và web không lỗi.
- `autoshort-ocr-runtime.test`: PASS.
- `autoshort-ocr-pipeline.test`: PASS.
- `test:ocr-engine`: PASS, 32 tests.
- Production `npm run build`: main/preload bundles passed, renderer cleanup failed on the pre-existing `out\renderer\assets` directory with Windows `EPERM/Access Denied`. A standalone renderer build to a clean temporary output passed.

### Những phần chưa kiểm tra / Rủi ro còn lại:

- Runtime user-data đã là 1.2.0; `--version`/`--probe` đạt, có `visual-stream-full-v1` và `visual-stream-roi-v1`, GPU probe hiện báo `false` nên dùng CPU fallback.
- Cần dọn quyền/lock của `out\renderer\assets` trước khi gọi lại full Electron build.
- Chưa đo thời gian OCR mới và chưa so sánh false negative/positive trên ba video thật.
- Legacy path vẫn phải ghi frame ra đĩa vì giới hạn binary cũ; ROI chỉ giảm chi phí detector/recognizer.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Runtime OCR 1.2.0 được build từ source hiện tại (fingerprint `1e0c8bd778d9d97cf129c891e053b0421f5b43b4c3d0914e29e38c63b614c6a4`), cài vào user data với backup 1.1.0; receipt ghi SHA-256 executable `7ac0d6fe1bc497544a60a74cd6ae66878158a8e772ea86c12ce3b1a3e190f781`. Remote `runtime-v5` hiện không có manifest nên đây là local verified build; môi trường Python 3.14 dùng `rapidocr-onnxruntime` 1.2.3 thay cho pin 1.4.4 không có wheel tương thích.
- Chạy lại batch harness với cùng video, lưu telemetry số frame, OCR call, transport thực tế và cache hit.
- Nếu quality parity đạt, giữ default stream ROI; nếu không, chỉ fallback profile affected về stream-full/accurate.
