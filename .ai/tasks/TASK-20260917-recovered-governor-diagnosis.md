# TASK-20260917-recovered-governor-diagnosis: Gateway chạy nhưng batch bị khóa

- **Trạng thái:** Hoàn thành (CODE_CONFIRMED, TEST_CONFIRMED, LIVE_CONFIRMED)
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-17

## 1. Mục Tiêu

Chẩn đoán và sửa lỗi `upstream governor is blocked: recovered-from-store`, phục hồi Gateway đang chạy và ngăn replay generation không an toàn.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Xác nhận riêng provider readiness và scheduler readiness.
- [x] Xác định request đã dispatch lên Google hay chưa.
- [x] Kiểm tra vì sao nhánh tự phục hồi hiện tại không xử lý tình huống này.
- [x] `npm.cmd run typecheck` pass.
- [x] Operation regression mới pass 17/17.
- [x] Toàn bộ `npm.cmd run test:local-runtime`, `go test ./...` và build Gateway pass.
- [x] Gateway live restart với binary mới; generation thật qua Operation API thành công.

## 3. Phạm Vi

Thay đổi khu trú ở operation recovery của TediaPros và snapshot governor của CreateMediaTool. Không đổi cookie, không xóa checkpoint, không reset Git và không ghi đè thay đổi không liên quan.

## 4. Kết Luận Và Hướng Sửa

### LIVE_CONFIRMED / LOG_CONFIRMED

- `GET http://127.0.0.1:4982/health`: HTTP 200, status `ok`.
- `GET /openai/v1/gateway/capabilities`: HTTP 200, `provider_ready=true`, `provider_error=""`, scheduler contract v1, request jobs/status supported.
- `GET /openai/v1/gateway/scheduler`: HTTP 200, `state=blocked`, `reason=recovered-from-store`, `active_permits=0`, `queued_requests=0`, revision 0. Không có thời điểm tự mở khóa được công bố.
- `F:/Son/tool/CreateMediaTool/.state/governor_state.json`: `state=blocked`, `not_before=0001-01-01T00:00:00Z`; mtime 16:55:14 giờ Việt Nam, trước lần server khởi động 17:28:03 trong log người dùng.
- Có 15 operation được tạo từ 17:31:51 đến 17:50:41 trong snapshot kiểm tra, đều `blocked`, `dispatch_state=not-dispatched`, `upstream_attempts=0`, `error_code=recovered-from-store`. Các operation này chưa gửi generation lên Google.
- Log dev: `C:/Users/PC/AppData/Roaming/tedia-pros-dev/logs/tblao-session-9809febf-c219-4823-b0ce-adc7c0e46511.log`; stack lỗi đi qua `pollGatewayOperation` → `requestGatewayOperation` → `runGatewayRestoration`.

### CODE_CONFIRMED

1. `CreateMediaTool/internal/modules/providers/upstream_governor.go:198`: `SetStore` nạp lại snapshot `blocked` và đặt reason thành `recovered-from-store`. Khởi động lại server không tự gỡ khóa.
2. `CreateMediaTool/internal/modules/providers/upstream_state_store.go:16`: snapshot không lưu lý do khóa ban đầu. Chỉ từ snapshot này không thể kết luận cookie lỗi, CAPTCHA hoặc rate limit là nguyên nhân ban đầu.
3. `CreateMediaTool/internal/modules/openai/gateway_scheduler_controller.go`: submit tạo operation `queued` và trả HTTP 202; worker sau đó mới chuyển operation sang `blocked` khi thấy governor bị khóa.
4. `src/main/geminiGateway.ts:778`: nhánh reset hiện tại chỉ chạy khi receipt từ submit đã là `blocked`. Nó bỏ lỡ lỗi phát hiện trong polling và các operation đã được nối lại từ lease.
5. `src/main/geminiGatewayOperations.ts:201`: polling coi `blocked` là terminal và ném lỗi. Batch hiện tại tiếp tục sang video sau, nên lặp lỗi sau ASR.
6. `CreateMediaTool/internal/modules/openai/gateway_request_store.go:96`: resubmit cùng `client_request_id` trả operation cũ. Reset governor rồi gửi lại cùng ID không tự biến operation terminal thành request mới.
7. `src/main/logger.ts:103`: lời nhắc khởi động lại Gateway chưa phù hợp với trạng thái khóa đã persist này.

### IMPLEMENTED

- Polling gắn receipt terminal vào error để lớp operation recovery kiểm tra bằng chứng dispatch.
- TediaPros chỉ tự reset `recovered-from-store` một lần khi operation terminal xác nhận `not-dispatched` và `upstream_attempts=0`. Operation cũ được ACK, lease mới có `client_request_id` và token mới được ghi bền vững trước khi submit.
- Gateway snapshot lưu `reason`; restart giữ nguyên `provider-auth-required`, `provider-challenge`, `outcome-unknown` và các khóa thật khác. Crash ở trạng thái `running` phục hồi thành `blocked/outcome-unknown`.
- Runtime đã reset từ `blocked/recovered-from-store` sang `ready`, binary Gateway mới được cài và restart.

## 5. Tệp Thay Đổi

- `[MODIFY]` `src/main/geminiGateway.ts`
- `[MODIFY]` `src/main/geminiGatewayOperations.ts`
- `[MODIFY]` `tests/gemini-gateway-operations.test.ts`
- `[MODIFY]` `docs/adr/012-gateway-upstream-governor-and-batch-scheduling.md`
- `[MODIFY]` `F:/Son/tool/CreateMediaTool/internal/modules/providers/upstream_governor.go`
- `[MODIFY]` `F:/Son/tool/CreateMediaTool/internal/modules/providers/upstream_state_store.go`
- `[MODIFY]` hai test tương ứng của governor/store.
- `[NEW]` Tài liệu bàn giao này.

## 6. Kiểm Chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs gemini-gateway-operations.test
npm.cmd run test:local-runtime
go test ./...
go build -o .artifacts/live-validation/server-governor-recovery-fix-20260917.exe ./cmd/server
```

- Typecheck: PASS, Node và Web, exit 0.
- Operation tests: PASS 17/17, gồm regression `recovered-from-store` qua polling, reset, ACK operation cũ và submit bằng ID mới.
- Toàn bộ local runtime suites: PASS, exit 0.
- CreateMediaTool `go test ./...`: PASS; binary SHA-256 `61FF78E747157BE8A3D6716834A4BBEEABE7CF0B3EC84D817D8727819808768D`.
- LIVE_CONFIRMED: PID `19092`, `/health=ok`, `provider_ready=true`, scheduler `ready` sau restart.
- LIVE_CONFIRMED: operation `op-c996b1b4-e705-4f32-b038-0f391885ee82` thành công, `dispatched`, 1 upstream attempt, completion `complete`, finish reason `stop`, nội dung `{"ok":true}`.
- UNKNOWN: lý do ban đầu đã tạo snapshot khóa đời cũ không thể khôi phục vì schema cũ không lưu `reason`.

## 7. Bàn Giao

Binary cũ được sao lưu tại `F:/Son/tool/CreateMediaTool/server.pre-governor-recovery-20260917-1816.exe`. Không xóa `.state` hoặc checkpoint; các operation lỗi cũ đã không dispatch nên không tiêu thụ generation. Những item đã bị đánh lỗi trước bản vá cần được người dùng chạy lại từ checkpoint/hàng đợi; pipeline không tự thay đổi lịch sử terminal cũ.
