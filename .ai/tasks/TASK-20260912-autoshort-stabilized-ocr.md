# TASK-20260912-AUTOSHORT-STABILIZED-OCR: Sửa hợp đồng timeline OCR sang STTN

- **Trạng thái:** Đã kiểm chứng
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-12

---

## 1. Mục Tiêu (Goal)

Loại bỏ lỗi hàng loạt khi OCR chèn gap một frame hợp lệ nhưng STTN dùng nhầm validator dành cho dữ liệu engine thô và từ chối chính gap đó.

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Raw OCR vẫn từ chối mọi segment `gap-*`.
- [x] Timeline đã ổn định chỉ được nhận khi có thể tái tạo chính xác từ các segment OCR thô.
- [x] STTN runner và visual OCR cache nhận đúng timeline đã ổn định.
- [x] Cả 13 artifact từng lỗi trong batch thật vượt qua boundary đã sửa.
- [x] Output containment, geometry và cancellation tests của STTN vẫn pass.
- [x] Typecheck pass 100% không có lỗi.

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** validator timeline, STTN runner, cache-read OCR, fixture hồi quy thu nhỏ và ADR 006.
- **Nằm ngoài phạm vi:** thay thuật toán OCR/STTN, đổi chất lượng, thay model, nới giới hạn tài nguyên hoặc tempo.

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Giữ `validateOcrVisualTimeline` nghiêm ngặt tại ranh giới provider.
- Thêm `validateStabilizedOcrVisualTimeline` cho artifact nội bộ. Hàm này không tin gap sẵn có: nó raw-validate phần OCR, tái chạy stabilizer và so khớp timeline canonical.
- Cache và runner dùng cùng hợp đồng đã ổn định để tránh fresh-run và resume có hành vi khác nhau.

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[MODIFY]` `src/shared/ocrVisualTimeline.ts`
- `[MODIFY]` `src/main/inpainting/runner.ts`
- `[MODIFY]` `src/main/autoShortItemCoordinator.ts`
- `[MODIFY]` `tests/ocr-visual-timeline.test.ts`
- `[MODIFY]` `tests/sttn-runtime.test.ts`
- `[NEW]` `tests/fixtures/ocr-stabilized-gap/`
- `[MODIFY]` `docs/adr/006-sttn-inpainting-vs-masked-blur.md`

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
node scripts/run-local-runtime-tests.mjs ocr-visual-timeline.test
node scripts/run-local-runtime-tests.mjs sttn-runtime.test
node scripts/run-local-runtime-tests.mjs sttn-contract.test
node scripts/run-local-runtime-tests.mjs sttn-pipeline.test
node scripts/run-local-runtime-tests.mjs autoshort-stage-cache.test
node .ai/tasks/2026-09-12-winlocal-performance/verify-gap-fix.cjs
npm.cmd run typecheck
```

### Kết quả thực tế

- `ocr-visual-timeline`: PASS, 12/12.
- `sttn-runtime`: PASS, 12/12.
- `sttn-contract`: PASS, 5/5.
- `sttn-pipeline`: PASS, 9/9.
- `autoshort-stage-cache`: PASS, 3/3.
- Replay artifact thật: PASS, 13/13 case.
- `Typecheck`: PASS, node + web, exit 0.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Chưa chạy lại batch video thật; việc này phụ thuộc các task logging, resume và nghiệm thu dài hạn tiếp theo.

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Tiếp tục Task 2: giữ log sau shutdown và bổ sung telemetry phân loại lỗi.
