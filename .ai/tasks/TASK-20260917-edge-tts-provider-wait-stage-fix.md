# TASK-20260917-edge-tts-provider-wait-stage-fix: Sửa lỗi Provider wait stage

- **Trạng thái:** Đã kiểm chứng (CODE_CONFIRMED, TEST_CONFIRMED, LIVE_PARTIAL)
- **Người thực hiện:** Codex
- **Thời gian:** 2026-09-17

## 1. Mục Tiêu

Sửa lỗi `Provider wait stage không hợp lệ.` xuất hiện sau khi chuyển TTS sang EdgeTTS, giữ operation Gemini đã gửi và cho phép lần chạy tiếp theo nối checkpoint thay vì tạo generation trùng.

## 2. Tiêu Chuẩn Nghiệm Thu

- [x] Xác định stage thực tế gây lỗi từ operation lease.
- [x] Journal, queue, IPC/UI dùng chung contract stage.
- [x] Hai stage phục hồi audio/OCR được kiểm thử hồi quy.
- [x] Typecheck và các test liên quan pass.
- [x] Khởi động lại dev app với main bundle mới và xác nhận batch thật ghi đúng `waiting-provider/restoration-draft`.

## 3. Phạm Vi

Thay đổi chỉ mở rộng contract chờ provider cho `restoration-draft` và `restoration-review`. Không thay đổi EdgeTTS, cue, timestamp, tempo, model, payload hoặc chính sách retry.

## 4. Kết Luận Và Hướng Sửa

### LOG_CONFIRMED / LIVE_CONFIRMED

- EdgeTTS preflight đã tải thành công 322 giọng đọc.
- Video đầu đã hoàn tất operation `restoration-draft`; operation `restoration-review` được tạo với stage `restoration-review`.
- Batch journal schema v2 chỉ cho phép bốn stage cũ nên `markBatchWaitingProvider` ném lỗi. Lỗi này thoát khỏi callback deferred và outer catch đánh 77 item thành failed.
- Operation review sau đó hoàn tất ở Gateway với `status=succeeded`, `dispatch_state=dispatched`, một upstream attempt; scheduler trở lại `ready` với không permit đang hoạt động.
- Lần chạy lại thật nối đúng checkpoint video 1. Review trả JSON hợp lệ nhưng đặt `replacements` sai bên trong từng `groupAssessment`, đồng thời thiếu `groupId`, `reason`, top-level `findings` và top-level `replacements`; validator đã chặn trước TTS.
- Video 2 được journal đúng `waiting-provider/restoration-draft`; 75 video sau còn `pending`. Draft của video 2 kết thúc `outcome-unknown` sau khi Gateway đọc được 26.507 byte rồi upstream body timeout, nên không được tự replay.
- Một lần kiểm tra trung gian đã gọi nhầm đường dẫn thiếu prefix `/openai/v1` và nhận `404`; kết luận operation đã hết thời gian lưu từ lần kiểm tra đó không hợp lệ. Đọc lại đúng endpoint cùng operation token xác nhận operation video 2 vẫn tồn tại với `status=outcome-unknown`, `dispatch_state=dispatched`, một upstream attempt và lỗi đọc response body sau 26.507 byte.
- Scheduler hiện `blocked/outcome-unknown`, không có permit đang hoạt động. Operation review kế tiếp bị chặn trước dispatch (`status=blocked`, `dispatch_state=not-dispatched`, zero upstream attempt), vì vậy EdgeTTS không phải nguyên nhân của lỗi hiện tại.

### IMPLEMENTED

- Mở rộng `ProviderWaitStage` với `restoration-draft` và `restoration-review`.
- Dùng lại `ProviderWaitRecord` trong event/result types và `ProviderWaitStage` trong queue/Gateway để TypeScript phát hiện contract bị lệch.
- Thêm regression xác nhận journal v2 chấp nhận và bảo toàn hai stage restoration.
- Gửi JSON Schema riêng cho draft/review để Gateway chèn contract field-level vào prompt; schema review cấm nested `replacements` và bắt buộc `groupId`, `reason`, `findings`, `replacements` đúng cấp.
- Trước khi thay một lease không khớp payload/schema, đọc receipt cũ: chỉ operation chưa dispatch mới được cancel/recreate; `outcome-unknown` giữ nguyên lease và không submit request mới.

## 5. Tệp Thay Đổi

- `[MODIFY]` `src/shared/autoShortBatchJournal.ts`
- `[MODIFY]` `src/shared/types.ts`
- `[MODIFY]` `src/main/autoShortProviderWait.ts`
- `[MODIFY]` `src/main/geminiGateway.ts`
- `[MODIFY]` `src/main/geminiGatewayOperations.ts`
- `[MODIFY]` `src/main/geminiGatewayRestoration.ts`
- `[MODIFY]` `tests/autoshort-batch-resume.test.ts`
- `[MODIFY]` `tests/gateway-restoration-pipeline.test.ts`
- `[MODIFY]` `tests/gemini-gateway-operations.test.ts`
- `[MODIFY]` `docs/adr/012-gateway-upstream-governor-and-batch-scheduling.md`
- `[NEW]` Tài liệu bàn giao này.

## 6. Kiểm Chứng

```powershell
npm.cmd run typecheck
node scripts/run-local-runtime-tests.mjs autoshort-batch-resume.test
node scripts/run-local-runtime-tests.mjs gateway-restoration-pipeline.test
node scripts/run-local-runtime-tests.mjs gemini-gateway-operations.test
npm.cmd run test:local-runtime
npm.cmd run build
```

- Typecheck: PASS, Node và Web, exit 0.
- Batch journal: PASS 4/4.
- Gateway restoration pipeline: PASS 2/2.
- Gateway operation recovery: PASS 18/18, gồm regression không replay `outcome-unknown` khi payload thay đổi.
- Toàn bộ local runtime: PASS, exit 0.
- Production build: PASS, exit 0.

## 7. Bàn Giao

Batch mới nhất có 1 item `needs-review`, 1 item `waiting-provider/outcome-unknown` và 75 item `pending`. Sau khi người dùng xác nhận, hai receipt liên quan đã được ACK lúc 2026-09-17 19:13:25 +07:00: operation không rõ kết quả từng dispatch một lần và operation review bị chặn trước dispatch. Hai lease được đổi tên sang hậu tố `.abandoned-20260917-191325.json` để giữ bằng chứng; không còn lease hoạt động cho hai stage này. Governor đã reset và được xác minh cả runtime lẫn state lưu trên đĩa ở trạng thái `ready`, revision 9, zero active permit và zero queued request. Lần bấm chạy tiếp theo được phép tạo operation mới bằng schema đã sửa.
