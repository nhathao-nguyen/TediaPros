# TASK-20260914: Triển khai Edge-TTS throughput và recovery có giới hạn

- **Trạng thái:** Đã kiểm chứng; live 100 đạt, live 500 không đạt
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
- [x] Transient failure hết ba attempt giữ typed code, mở cooldown và cho item đúng một recovery pass từ cache.
- [x] Hai cue có thể chuẩn bị đồng thời nhưng planner/output vẫn consume theo source order.
- [x] Offline fixture 500 unit không thiếu/lặp và không vượt cap/lookahead.
- [x] Đổi concurrency không làm invalid content checkpoint.
- [x] Typecheck pass 100% không có lỗi.
- [x] Toàn bộ local runtime suite và build pass.
- [x] Hai lượt live 100 ở spacing 1.500 ms đạt 100/100, không retry.
- [x] DALAM-01 TTS-only tạo output thật đủ 32/32 speech unit, source không đổi và tempo dưới 1.80x.
- [ ] Live 500 đạt 500/500: lượt thực tế đạt 283 success, 8 exhausted failure rồi circuit dừng network.

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
- `[MODIFY]` `src/main/ipcSecurity.ts`, `src/main/index.ts`: cho đúng renderer entry `file://` của preview/unpackaged đi qua IPC gate; packaged cũng chỉ nhận đúng entry thay vì mọi file URL.
- `[MODIFY]` `src/shared/types.ts`, `src/shared/autoShortContract.ts`, `src/renderer/src/components/AutoShort.tsx`
- `[NEW]` `tests/edge-tts-scheduler.test.ts`, `tests/dubbing-preparation-queue.test.ts`, `docs/adr/010-bounded-edge-tts-scheduling.md`
- `[MODIFY]` `src/main/autoShortPolicy.ts`: tokenization nhận biết CJK cho kiểm tra audio completeness.
- `[NEW]` `scripts/run-autoshort-dalam-qualification.mjs`, `scripts/autoshort-dalam-qualification-worker.ts`: harness video thật với profile/output cô lập và hash nguồn trước/sau.

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### Các lệnh đã chạy

```powershell
npm.cmd run typecheck
npm.cmd run test:local-runtime
npm.cmd run test:local-runtime -- edge-tts-scheduler.test dubbing-preparation-queue.test edge-tts-adapter.test autoshort-ocr-runtime.test autoshort-tts-pipeline.test
npm.cmd run test:local-runtime -- autoshort-cut-legacy-resume.test autoshort-ocr-contract.test autoshort-ui-contract.test
npm.cmd run test:local-runtime -- ipc-origin-validation.test autoshort-ui-contract.test
npm.cmd run build
```

### Kết quả hiện tại

- Typecheck: PASS, node và web 0 lỗi.
- Full local runtime runner sau thay đổi cuối: PASS, exit 0; các test media cần biến FFmpeg riêng được ghi SKIP có điều kiện.
- Scheduler/recovery: 7 PASS, gồm spacing mặc định 1.500 ms và exhausted transient → cooldown → một item recovery pass.
- Preparation queue: 4 PASS, gồm corpus 500 unit, cap 2 và lookahead 4.
- Edge adapter: 20 PASS; OCR runtime: 15 PASS; legacy TTS pipeline: 6 PASS.
- Contract/resume/UI: các test đã chạy PASS.
- IPC origin regression: 4 PASS; đúng preview file entry được nhận, sibling/arbitrary file URL và child frame bị chặn.
- Preview restart: cửa sổ `TediaPros` PID `20128`, `Responding=True`; log mới không còn lỗi IPC origin ở `whisper:modelStatus` hoặc `autoshort:getReadiness`.

### Những phần chưa kiểm tra / Rủi ro còn lại

- Live 100 concurrency 1, spacing 1.500 ms: 100/100 hợp lệ, 0 retry, 150.391 giây.
- Live 100 concurrency 2, spacing 1.500 ms: 100/100 hợp lệ, 0 retry, 150.039 giây; peak active vẫn là 1 nên không có lợi ích throughput.
- Live 500 concurrency 1: 291 logical request tới network, 283 thành công, 8 exhausted; 67/350 network attempt transient lỗi, 36 request recovery thành công; circuit từ chối cục bộ 209 mẫu còn lại. Gate không đạt.
- DALAM-01 TTS-only: 56 source cue, 32/32 speech unit, output thật 131 giây; 29 request mới thành công attempt đầu và 3 cache hit; tempo tối đa 1.0918x.
- Target tiếng Việt chưa chạy hết vì local translation server timeout 30 giây ở preflight. DALAM-02 chưa chạy.
- macOS ARM64 chưa live-qualified.

---

## 7. Bước Tiếp Theo / Ghi Chú Bàn Giao (Handoff Notes)

- Bằng chứng chi tiết: `.ai/tasks/2026-09-14-edge-tts-throughput/verification.md` và hai JSON live.
- Giữ preset 1 là mặc định với spacing 1.500 ms; preset 2 tiếp tục mang nhãn thử nghiệm vì rate gate triệt tiêu lợi ích throughput trong phép đo hiện tại.
- Không chạy thêm tải live trong phiên này sau khi circuit mở; cần chờ dịch vụ hồi phục rồi dùng batch nhỏ/chia đợt thay vì ép tiếp 500 request.
- Bằng chứng video: `.ai/tasks/2026-09-14-edge-tts-dalam-acceptance/acceptance.md`.
- Không đưa tám MP4 benchmark không liên quan trong `.ai/tasks/2026-09-12-dalam-encoder-test/` vào commit.
