# TASK-20260917-gemini-gateway-batch-scheduling-and-auto-recovery: Điều Tiết Gemini Gateway & Tự Phục Hồi Batch

- **Trạng thái:** Hoàn thành (TEST_CONFIRMED, CODE_CONFIRMED)
- **Người thực hiện:** Antigravity AI Agent
- **Thời gian:** 2026-09-17

---

## 1. Mục Tiêu (Goal)

Triển khai đồng bộ tính năng **Điều tiết Gemini Gateway (Upstream Governor & Operation Store)** và **Tự phục hồi Batch (Auto-Recovery & Provider Wait Journal)** trên cả hai repository:
- **CreateMediaTool**: Upstream Governor (concurrency = 1, exponential backoff, Retry-After header parsing, half-open probe), Operation Store (idempotency token, status polling, terminal/active state isolation, crash recovery).
- **TediaPros**: Batch Journal v2 (`waiting-provider`, `ProviderWaitRecord`), Queue Runner pauseOnDeferred, AutoShort UI countdown/banner, và Audio/OCR Evidence Restoration (P5).

---

## 2. Tiêu Chuẩn Nghiệm Thu (Acceptance Criteria)

- [x] Concurrency upload/generation = 1 cho toàn gateway egressGroup.
- [x] Throttled 429/cooldown không làm thất bại hàng loạt các video pending trong batch.
- [x] Checkpoint batch lưu trữ an toàn trước khi nhả tài nguyên hoặc tạm dừng queue.
- [x] Khôi phục từ crash/restart bảo toàn nguyên vẹn ID và timestamps cue (P5 restoration).
- [x] Không phát sinh generation thăm dò dư thừa khi scheduler đã được hỗ trợ.
- [x] Invariants bảo toàn: `TRANSLATION_BUDGET_LIMITS_ENABLED = false`, tempo trần 1.80x, Typed IPC, Planar RGB, Safe Contained Path.
- [x] `npm.cmd run typecheck` pass 100% không lỗi (Node + Web).
- [x] Toàn bộ test suites `npm.cmd run test:local-runtime` pass (kèm suites mới `gateway-batch-recovery.test` và `autoshort-source-restoration.test`).
- [x] `go test ./...` và `go build ./...` bên CreateMediaTool pass 100%.

---

## 3. Phạm Vi Triển Khai (Scope & Boundaries)

- **Thuộc phạm vi (In Scope):**
  - **P0**: ADR 012 và scheduler contract fixtures.
  - **P1**: Upstream failure classification, Upstream Governor, OS lock state store.
  - **P2**: Operation API, request store idempotency, scheduler controller.
  - **P3**: TediaPros gateway operation adapter, batch journal v2, `waiting-provider` queue flow, UI countdown & status banner.
  - **P4**: Verification suite 100-job batch scheduling mock với fake clock, cooldown pause, cancellation.
  - **P5**: Media restoration plan, `sourceRestoration.ts` module (evidence pack, draft/review validation, atomic patch, quality metrics), test suite 44-cue Volvo corpus.
- **Nằm ngoài phạm vi (Out of Scope):**
  - P6: Gemini API chính thức (trả phí) - tuân thủ chỉ thị người dùng giữ nguyên gemini-web gateway.

---

## 4. Quyết Định Kiến Trúc & Lý Do (Decisions & Rationale)

1. **Bypass Generation Ping Probe:** Trong `autoshort.ts` tiền kiểm tra năng lực gateway (`readGatewayCapabilitiesInfo`). Nếu `capabilities?.schedulerSupported === true`, bỏ qua `probeGeminiGatewayGeneration` để không lãng phí 1 generation quota quý giá và tránh rate limit ngay từ đầu batch.
2. **Dừng Queue Pass khi Deferred Cooldown (`pauseOnDeferred`):** Khi item gặp lỗi 429 hoặc cooldown dài (ví dụ 600s), thay vì giữ luồng hoặc loop đẩy lỗi sang các item tiếp theo, Queue Runner dừng pass hiện tại, chuyển item đó sang `waiting-provider`, giữ nguyên trạng thái `pending` của các item sau để resume an toàn.
3. **Restoration Patch Nguyên Khối theo Nhóm (Semantic Group):** Trong P5, nếu một semantic group bị reviewer đánh giá `rejected`, bản vá tự động rollback về text gốc của cue, ngăn ngừa việc sửa sai lan truyền.

---

## 5. Danh Sách Tệp Thay Đổi (Changes Made)

### CreateMediaTool
- `[NEW]` [upstream_failure.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/providers/upstream_failure.go)
- `[NEW]` [upstream_governor.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/providers/upstream_governor.go)
- `[NEW]` [upstream_state_store.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/providers/upstream_state_store.go)
- `[NEW]` [gateway_requests.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_requests.go)
- `[NEW]` [gateway_request_store.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_request_store.go)
- `[NEW]` [gateway_scheduler_controller.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_scheduler_controller.go)
- `[MODIFY]` [provider_module.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/providers/provider_module.go)
- `[MODIFY]` [openai_module.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/openai/openai_module.go)
- `[MODIFY]` [openai_controller.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/openai/openai_controller.go)
- `[MODIFY]` [gemini_service.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/providers/gemini_service.go)
- `[MODIFY]` [client_pool.go](file:///F:/Son/tool/CreateMediaTool/internal/modules/providers/client_pool.go)
- `[NEW]` Các test tương ứng: `upstream_failure_test.go`, `upstream_governor_test.go`, `upstream_state_store_test.go`, `gateway_requests_test.go`, `gateway_request_store_test.go`.

### TediaPros
- `[NEW]` [docs/adr/012-gateway-upstream-governor-and-batch-scheduling.md](file:///F:/Son/tool/TediaPros/docs/adr/012-gateway-upstream-governor-and-batch-scheduling.md)
- `[NEW]` [docs/superpowers/plans/2026-09-17-p5-audio-ocr-restoration-pipeline.md](file:///F:/Son/tool/TediaPros/docs/superpowers/plans/2026-09-17-p5-audio-ocr-restoration-pipeline.md)
- `[NEW]` [src/shared/gatewayOperation.ts](file:///F:/Son/tool/TediaPros/src/shared/gatewayOperation.ts)
- `[NEW]` [src/main/geminiGatewayOperations.ts](file:///F:/Son/tool/TediaPros/src/main/geminiGatewayOperations.ts)
- `[NEW]` [src/main/autoShortProviderWait.ts](file:///F:/Son/tool/TediaPros/src/main/autoShortProviderWait.ts)
- `[NEW]` [src/main/translation/sourceRestoration.ts](file:///F:/Son/tool/TediaPros/src/main/translation/sourceRestoration.ts)
- `[NEW]` [tests/autoshort-provider-wait.test.ts](file:///F:/Son/tool/TediaPros/tests/autoshort-provider-wait.test.ts)
- `[NEW]` [tests/gateway-batch-recovery.test.ts](file:///F:/Son/tool/TediaPros/tests/gateway-batch-recovery.test.ts)
- `[NEW]` [tests/autoshort-source-restoration.test.ts](file:///F:/Son/tool/TediaPros/tests/autoshort-source-restoration.test.ts)
- `[MODIFY]` [src/shared/types.ts](file:///F:/Son/tool/TediaPros/src/shared/types.ts)
- `[MODIFY]` [src/shared/autoShortBatchJournal.ts](file:///F:/Son/tool/TediaPros/src/shared/autoShortBatchJournal.ts)
- `[MODIFY]` [src/main/autoShortQueueRunner.ts](file:///F:/Son/tool/TediaPros/src/main/autoShortQueueRunner.ts)
- `[MODIFY]` [src/main/autoshort.ts](file:///F:/Son/tool/TediaPros/src/main/autoshort.ts)
- `[MODIFY]` [src/main/geminiGateway.ts](file:///F:/Son/tool/TediaPros/src/main/geminiGateway.ts)
- `[MODIFY]` [src/renderer/src/components/AutoShort.tsx](file:///F:/Son/tool/TediaPros/src/renderer/src/components/AutoShort.tsx)
- `[MODIFY]` [src/renderer/src/styles/autoshort.css](file:///F:/Son/tool/TediaPros/src/renderer/src/styles/autoshort.css)
- `[MODIFY]` [scripts/run-local-runtime-tests.mjs](file:///F:/Son/tool/TediaPros/scripts/run-local-runtime-tests.mjs)

---

## 6. Kiểm Chứng & Bằng Chứng (Verification & Evidence)

### CreateMediaTool
```powershell
cd F:\Son\tool\CreateMediaTool
go test ./internal/modules/openai/... ./internal/modules/providers/... -count=1
go test ./...
go build ./...
```
- Kết quả: **PASS 100%**.

### TediaPros
```powershell
cd F:\Son\tool\TediaPros
cmd.exe /c "npm.cmd run typecheck"
cmd.exe /c "npm.cmd run test:local-runtime"
cmd.exe /c "npm.cmd run build"
```
- Kết quả:
  - Typecheck Node & Web: **0 errors**.
  - Local runtime test suites: **All suites passed (0 failures)**.
  - Build: **Electron Vite build passed thành công ra out/**.

---

## 7. Bàn Giao & Rollback

- **Phân loại xác nhận:**
  - TEST_CONFIRMED: Toàn bộ bộ test mock 100-job batch scheduling, fake clock, cooldown 600s, rollback group, Volvo 44-cue restoration quality report.
  - CODE_CONFIRMED: Kiến trúc governor concurrency=1, lease persistence, journal v2 migration, restoration pipeline.
  - UNKNOWN: Mức độ khắt khe rate-limit thực tế của Google IP theo từng thời điểm mạng ngoài môi trường local.
- **Rollback:**
  - Nếu cần quay lại cơ chế v1 cũ: tắt scheduler capability hoặc đặt `scheduler_contract_version: 0` trong config CreateMediaTool; TediaPros tự động fall back về `requestGatewayLegacy` theo cơ chế backward compatibility đã tích hợp.
