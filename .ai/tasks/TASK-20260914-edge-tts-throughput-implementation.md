# TASK-20260914: Triển khai Edge-TTS throughput và recovery có giới hạn

- **Trạng thái:** Đã kiểm chứng local; live gate không đạt
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-14

---

## 1. Mục Tiêu (Goal)

Giảm nghẽn TTS trong AutoShort bằng scheduler dùng chung và preparation queue tối đa hai worker, đồng thời giữ source order, trần tempo 1.80x, cancel, cache, resume và giới hạn tài nguyên hiện có.

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Mặc định một request; UI chỉ cho chọn preset 1 hoặc 2.
- [x] 429/timeout/network/5xx dùng retry hữu hạn; 401/403 không tự retry hàng loạt.
- [x] Circuit/cooldown toàn Main được lưu atomically và có thao tác start/resume rõ ràng.
- [x] Hai cue có thể chuẩn bị đồng thời nhưng planner/output vẫn consume theo source order.
- [x] Offline fixture 500 unit không thiếu/lặp và không vượt cap/lookahead.
- [x] Đổi concurrency không làm invalid content checkpoint.
- [x] Typecheck pass 100% không có lỗi.
- [x] Toàn bộ local runtime suite và build pass.
- [x] Live 50 và 100 có artifact; mốc 100 không đạt 100/100 nên dừng trước 500 và video DALAM.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi:** Edge transport recovery, global scheduler, request telemetry, bounded preparation, execution policy/IPC validation, UI preset/progress, resume digest, test/docs.
- **Nằm ngoài phạm vi:** đổi provider tự động, lách giới hạn dịch vụ, concurrency lớn hơn 2, thay đổi tempo/timeline policy, chỉnh sửa hai video nguồn.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

- Main sở hữu scheduler để Voice/catalog/preflight/AutoShort cùng tuân theo một cap.
- Preparation hoàn tất ngoài thứ tự nhưng consume theo source order để predictor và timeline deterministic.
- Scheduler giữ slot tới sau validate/publish để cleanup đã quiesce trước khi cấp slot tiếp.
- `executionPolicy` không thuộc content digest vì chỉ thay đổi lịch chạy.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

- `[NEW]` `src/main/edgeTtsRecovery.ts`, `src/main/edgeTtsScheduler.ts`, `src/main/dubbing/preparationQueue.ts`
- `[MODIFY]` `src/main/edgeTts.ts`, `src/main/edgeTtsTransport.ts`, `src/main/dubbing/synthesis.ts`, `src/main/autoshort.ts`
- `[MODIFY]` `src/main/autoShortExecutionPolicy.ts`, `src/main/autoShortCutIdentity.ts`, `src/main/autoShortTelemetry.ts`
- `[MODIFY]` `src/shared/types.ts`, `src/shared/autoShortContract.ts`, `src/renderer/src/components/AutoShort.tsx`
- `[NEW]` `tests/edge-tts-scheduler.test.ts`, `tests/dubbing-preparation-queue.test.ts`, `docs/adr/010-bounded-edge-tts-scheduling.md`

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime -- edge-tts-scheduler.test dubbing-preparation-queue.test edge-tts-adapter.test autoshort-ocr-runtime.test autoshort-tts-pipeline.test
npm.cmd run test:local-runtime -- autoshort-cut-legacy-resume.test autoshort-ocr-contract.test autoshort-ui-contract.test
```

### Kết quả hiện tại

- Typecheck: PASS, node và web 0 lỗi.
- Scheduler/recovery: 5 PASS.
- Preparation queue: 4 PASS, gồm corpus 500 unit, cap 2 và lookahead 4.
- Edge adapter: 20 PASS; OCR runtime: 15 PASS; legacy TTS pipeline: 6 PASS.
- Contract/resume/UI: các test đã chạy PASS.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Live 50 concurrency 1: 50/50 hợp lệ, 11 retry, 389.809 giây, p50 6.959 giây, p95 12.834 giây.
- Live 100 concurrency 2: 97 sample được chạy, một sample lỗi `transient_network` sau 3 attempt; 3 sample cuối không dispatch do harness gate phiên đó dừng sớm. Retry và failure vượt ngưỡng nên không chạy 500/video.
- Chưa có full AutoShort output từ DALAM-01/DALAM-02 vì live gate 100 không đạt.
- macOS ARM64 chưa live-qualified.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Bằng chứng chi tiết: `.ai/tasks/2026-09-14-edge-tts-throughput/verification.md` và hai JSON live.
- Giữ preset 1 là mặc định; preset 2 tiếp tục mang nhãn thử nghiệm. Chỉ chạy lại 500/video sau khi một lượt 100 mới đạt failure/retry gate.
- Không đưa tám MP4 benchmark không liên quan trong `.ai/tasks/2026-09-12-dalam-encoder-test/` vào commit.
