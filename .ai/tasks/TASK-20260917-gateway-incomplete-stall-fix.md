# TASK-20260917-gateway-incomplete-stall-fix: AutoShort dừng lâu ở Gemini Gateway

- **Trạng thái:** Hoàn tất
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-17

## 1. Mục tiêu

Xác định vì sao video đầu tiên đứng 8–9 phút, giảm request restoration lặp theo frame, giới hạn thời gian upstream và cung cấp đường phục hồi an toàn cho `outcome-unknown`.

## 2. Tiêu chuẩn nghiệm thu

- [x] Xác định operation và ranh giới lỗi từ batch thật.
- [x] Giảm prompt OCR lặp mà không đổi cue/timestamp/evidence ledger gốc.
- [x] `outcome-unknown` không còn hứa tự tiếp tục và có thao tác resume rõ ràng.
- [x] Gateway reset không được xóa active permit.
- [x] Request restoration dài được chia tối đa 8 cue, có checkpoint/lease riêng và validate lại sau khi ghép.
- [x] Typecheck, focused tests, full local runtime, Go tests và build pass.
- [x] Ghi lại kết quả kiểm tra live đúng media lỗi.

## 3. Phạm vi

- TediaPros: compact evidence tại wire boundary, output ceiling, provider-wait UI, durable manual recovery và regression tests.
- CreateMediaTool: deadline upstream 180 giây, log byte/frame/read-error, reset guard và regression tests.
- Không thay cookie, không tự replay operation đã dispatch, không thay cue ID/timestamp, không xóa dirty worktree.

## 4. Bằng chứng nguyên nhân

- Operation `op-12d11c6c-ddaa-4f49-b208-93bf3328583a` dispatch một lần, đọc body 5 phút rồi kết thúc `upstream-incomplete/outcome-unknown`.
- Request có 23 cue nhưng mang 405 evidence item; 404 item là OCR theo frame, làm user text dài 88.051 ký tự.
- Sau compact, còn 131 observation và 19.621 ký tự. Một generation thật hoàn tất sau 55 giây; một generation khác vẫn hết hạn sau 180 giây với 28.619 byte, 7 text frame và completion state `incomplete`. Vì vậy prompt lặp là tải không cần thiết, còn Gemini Web stream vẫn có độ bất định riêng.
- Payload thật được chia 8/8/7 cue. Cả 6 generation draft/review đều trả terminal response hợp lệ; kết quả ghép có 23/23 cue, `droppedCues=0`, `cueIdIntegrity=true`, `timestampsIntegrity=true` và `cueCountPreserved=true`.

## 5. Tệp thay đổi chính

- `src/main/translation/sourceRestoration.ts`
- `src/main/geminiGatewayRestoration.ts`
- `src/main/gatewayManualRecovery.ts`
- `src/shared/providerWaitPresentation.ts`
- `src/main/autoshort.ts`
- `src/renderer/src/components/AutoShort.tsx`
- `tests/autoshort-source-restoration.test.ts`
- `tests/autoshort-provider-wait.test.ts`
- `tests/gateway-restoration-pipeline.test.ts`
- `tests/gemini-gateway-operations.test.ts`
- `F:/Son/tool/CreateMediaTool/internal/modules/providers/gemini_service.go`
- `F:/Son/tool/CreateMediaTool/internal/modules/providers/upstream_governor.go`
- `F:/Son/tool/CreateMediaTool/internal/modules/openai/gateway_scheduler_controller.go`

## 6. Kiểm chứng

- Live artifact: `.ai/tasks/2026-09-17-gateway-stall-fix/live-result.json`
- SHA-256 live artifact: `78DC817E63BE8639C1F90EA067076A71B1EA86A8EC5650659066CEC61C30406D`
- Live summary: 23 cue, 12 source edit trong draft, review `needs_adjustment`; sau patch review áp dụng 17 source edit và 4 replacement group, không rơi cue.
- `npm run typecheck`: pass.
- Focused restoration/provider-wait/operation suites: 40/40 test pass.
- `npm run test:local-runtime`: exit 0; log tại `.ai/tasks/2026-09-17-gateway-stall-fix/full-local-runtime.log`.
- `npm run build`: pass.
- CreateMediaTool `go test ./...`: pass.
- CreateMediaTool `go build -o .artifacts/server-stall-fix-20260917-final.exe ./cmd/server`: pass; SHA-256 `DA2B4266428170EB6044FAD99A3FB15B6E2CAFEBA5401618319FBDFC58E914CE`, trùng binary đang chạy đã triển khai cho probe.
- Gateway sau probe: `ready`, `active_permits=0`, `queued_requests=0`; thư mục live không còn operation lease.
- Lần chạy lại `45d632ed-e9af-4566-8a02-4b3a1c88f5bb` xác nhận payload review đã giảm còn 8 cue, 25 evidence item và 4.954 ký tự user text. Request vẫn mang audio 106.979 byte (tổng wire payload 152.813 byte) và Gemini Web tiếp tục treo khi đọc body: 262 byte, 0 text frame, hết hạn đúng 180 giây.
- Receipt thật của operation `op-a2c326e1-baea-49fd-809e-feee2ba518ec` là `outcome-unknown`, nhưng journal giữ lý do scheduler cũ `spacing`. Recovery trước đó phụ thuộc lý do journal nên từ chối thao tác an toàn dù receipt đã được Gateway xác thực.
- TediaPros hiện chuẩn hóa mọi receipt `outcome-unknown`, và recovery dùng receipt trực tiếp làm nguồn quyết định sau khi kiểm tra operation ID, token, client request ID cùng trạng thái scheduler. Regression suites `gemini-gateway-operations.test` 20/20 và `autoshort-provider-wait.test` 5/5 pass; `npm run typecheck` và toàn bộ `npm run test:local-runtime` đều exit 0 sau thay đổi.
- Operation bị kẹt đã được reset/ACK chính xác; active lease được lưu thành `restoration-review-operation.abandoned-*.json`. Gateway trở về `ready`, `active_permits=0`, `queued_requests=0`.
- TediaPros Dev 0.1.26 đã khởi động lại bằng source mới lúc `2026-09-17T14:33:18Z`; renderer ở `http://localhost:5173/`. Snapshot batch vẫn giữ 1 item `waiting-provider` và 76 item `pending` để người dùng chủ động tiếp tục.
